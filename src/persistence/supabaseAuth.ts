export interface SupabasePublicConfig {
  url: string;
  publishableKey: string;
}

export interface AuthIdentity {
  id: string;
  email: string;
}

interface SavedSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: AuthIdentity;
}

interface AuthTokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  user?: { id?: unknown; email?: unknown };
}

export interface AuthStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const AUTH_SESSION_KEY = "schedule-engine:supabase:session:v1";

export function getSupabaseConfig(): SupabasePublicConfig | null {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!url || !publishableKey) return null;

  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !/\\.supabase\\.co$/.test(parsed.hostname)) {
    throw new Error("VITE_SUPABASE_URL tem de ser um endereço HTTPS do Supabase.");
  }

  return { url: parsed.origin, publishableKey };
}

function isSession(value: unknown): value is SavedSession {
  if (!value || typeof value !== "object") return false;
  const s = value as Record<string, unknown>;
  if (!s.user || typeof s.user !== "object") return false;
  const user = s.user as Record<string, unknown>;
  return (
    typeof s.access_token === "string" &&
    typeof s.refresh_token === "string" &&
    typeof s.expires_at === "number" &&
    Number.isFinite(s.expires_at) &&
    typeof user.id === "string" &&
    user.id.length > 0 &&
    typeof user.email === "string"
  );
}

function parseError(body: unknown, status: number): Error {
  let reason = `Supabase respondeu HTTP ${status}.`;
  if (body && typeof body === "object") {
    const payload = body as Record<string, unknown>;
    const label = payload.msg ?? payload.message ?? payload.error_description ?? payload.error;
    if (typeof label === "string") reason = label;
  }
  return new Error(reason);
}

export class SupabaseAuthClient {
  private session: SavedSession | null = null;
  private refreshInFlight: Promise<SavedSession> | null = null;

  constructor(
    private readonly config: SupabasePublicConfig,
    private readonly fetcher: typeof fetch,
    private readonly storage: AuthStorage
  ) {
    const raw = storage.getItem(AUTH_SESSION_KEY);
    if (raw) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (isSession(parsed)) this.session = parsed;
      } catch {
        // The cloud state is never touched if a local auth token is invalid.
      }
    }
  }

  get user(): AuthIdentity | null {
    return this.session?.user ?? null;
  }

  private saveSession(session: SavedSession | null): void {
    this.session = session;
    if (session) this.storage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
    else this.storage.removeItem(AUTH_SESSION_KEY);
  }

  private async authRequest(path: string, payload: Record<string, unknown>) {
    const response = await this.fetcher(this.config.url + "/auth/v1/" + path, {
      method: "POST",
      headers: {
        apikey: this.config.publishableKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const body: unknown = await response.json();
    if (!response.ok) throw parseError(body, response.status);
    return body as AuthTokenResponse;
  }

  private useTokenResponse(body: AuthTokenResponse, fallbackUser?: AuthIdentity): SavedSession {
    const user = body.user ?? fallbackUser;
    if (
      typeof body.access_token !== "string" ||
      typeof body.refresh_token !== "string" ||
      typeof body.expires_in !== "number" ||
      !user || typeof user.id !== "string" ||
      typeof user.email !== "string"
    ) {
      throw new Error("O Supabase devolveu uma sessão incompleta.");
    }

    const session: SavedSession = {
      access_token: body.access_token,
      refresh_token: body.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + body.expires_in,
      user: { id: user.id, email: user.email },
    };
    this.saveSession(session);
    return session;
  }

  async signIn(email: string, password: string): Promise<AuthIdentity> {
    const body = await this.authRequest("token?grant_type=password", {
      email: email.trim(),
      password,
    });
    return this.useTokenResponse(body).user;
  }

  private async refreshSession(): Promise<SavedSession> {
    if (!this.session) throw new Error("É necessário iniciar sessão.");
    if (!this.refreshInFlight) {
      this.refreshInFlight = (async () => {
        const current = this.session!;
        try {
          const body = await this.authRequest("token?grant_type=refresh_token", {
            refresh_token: current.refresh_token,
          });
          return this.useTokenResponse(body, current.user);
        } catch (error) {
          // On network failure keep the refresh token for a future retry.
          // Do not erase an existing cloud state or force new credentials.
          throw error;
        }
      })().finally(() => {
        this.refreshInFlight = null;
      });
    }
    return this.refreshInFlight;
  }

  private async accessToken(): Promise<string> {
    if (!this.session) throw new Error("É necessário iniciar sessão.");
    if (this.session.expires_at <= Math.floor(Date.now() / 1000) + 60) {
      await this.refreshSession();
    }
    return this.session!.access_token;
  }

  async restore(): Promise<AuthIdentity | null> {
    if (!this.session) return null;
    const response = await this.request("/auth/v1/user");
    const body: unknown = await response.json();
    if (!response.ok) throw parseError(body, response.status);
    if (!body || typeof body !== "object" ||
        typeof (body as {id?:unknown}).id !== "string") {
      throw new Error("Não foi possível validar a sessão existente.");
    }
    const serverUser = body as { id: string; email?: unknown };
    if (this.session?.user.id !== serverUser.id) {
      throw new Error("A sessão pertence a outro utilizador.");
    }
    return this.user;
  }

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.accessToken();
    const headers = new Headers(init.headers);
    headers.set("apikey", this.config.publishableKey);
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("Accept", "application/json");
    const response = await this.fetcher(this.config.url + path, {
      ...init,
      headers,
      cache: "no-store",
    });
    if (response.status === 401) {
      // Expired/revoked JWT: refresh once, never silently retry a write.
      if ((init.method ?? "GET").toUpperCase() !== "GET") {
        throw new Error("A sessão expirou antes da gravação. Não foram alterados dados.");
      }
      await this.refreshSession();
      const refreshed = new Headers(headers);
      refreshed.set("Authorization", `Bearer ${await this.accessToken()}`);
      return this.fetcher(this.config.url + path, {
        ...init,
        headers: refreshed,
        cache: "no-store",
      });
    }
    return response;
  }

  async signOut(): Promise<void> {
    if (this.session) {
      try {
        await this.request("/auth/v1/logout", { method: "POST" });
      } catch {
        // Signout locally even when the network is offline.
      }
    }
    this.saveSession(null);
  }
}
