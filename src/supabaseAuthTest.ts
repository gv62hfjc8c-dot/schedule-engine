import {
  AUTH_SESSION_KEY,
  SupabaseAuthClient,
  type AuthStorage,
} from "./persistence/supabaseAuth";

function ensure(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

class MemoryStorage implements AuthStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

let loginCalls = 0;
let refreshCalls = 0;
let stateCalls = 0;
const mockedFetch: typeof fetch = async (input, init) => {
  const url = String(input);

  if (url.endsWith("/auth/v1/token?grant_type=password")) {
    loginCalls++;
    const credentials = JSON.parse(String(init?.body)) as { email: string };
    ensure(credentials.email === "ana@example.com", "Passa email correto.");
    return Response.json({
      access_token: "jwt-one",
      refresh_token: "refresh-one",
      expires_in: 3600,
      user: { id: "user-one", email: credentials.email },
    });
  }

  if (url.endsWith("/auth/v1/token?grant_type=refresh_token")) {
    refreshCalls++;
    return Response.json({
      access_token: "jwt-two",
      refresh_token: "refresh-two",
      expires_in: 3600,
      user: { id: "user-one", email: "ana@example.com" },
    });
  }

  if (url.endsWith("/auth/v1/user")) {
    const headers = new Headers(init?.headers);
    ensure(headers.has("apikey"), "Envia chave pública.");
    ensure(headers.get("Authorization")?.startsWith("Bearer jwt-"),
      "A requisição tem JWT de utilizador.");
    return Response.json({ id: "user-one", email: "ana@example.com" });
  }

  if (url.endsWith("/rest/v1/schedule_engine_states")) {
    stateCalls++;
    return Response.json([]);
  }

  if (url.endsWith("/auth/v1/logout")) {
    return new Response(null, { status: 204 });
  }

  return Response.json({ error: "Rota desconhecida." }, { status: 404 });
};

const storage = new MemoryStorage();
const config = {
  url: "https://test-project.supabase.co",
  publishableKey: "sb_publishable_test",
};

const auth = new SupabaseAuthClient(config, mockedFetch, storage);
ensure(auth.user === null, "Sem sessão começa sem utilizador.");

const user = await auth.signIn("ana@example.com", "example-password");
ensure(user.email === "ana@example.com", "Login identifica utilizador.");
ensure(loginCalls === 1, "Login ocorre uma vez.");
ensure(storage.getItem(AUTH_SESSION_KEY) !== null, "Sessão guardada localmente.");

await auth.request("/rest/v1/schedule_engine_states");
ensure(stateCalls === 1, "Dados são lidos com autenticação.");

const restored = new SupabaseAuthClient(config, mockedFetch, storage);
ensure((await restored.restore())?.id === "user-one", "Sessão reabre.");

const existing = JSON.parse(storage.getItem(AUTH_SESSION_KEY)!) as {
  expires_at: number;
};
storage.setItem(AUTH_SESSION_KEY, JSON.stringify({
  ...existing,
  access_token: "jwt-one",
  refresh_token: "refresh-one",
  user: { id: "user-one", email: "ana@example.com" },
  expires_at: 0,
}));

const expired = new SupabaseAuthClient(config, mockedFetch, storage);
await expired.request("/rest/v1/schedule_engine_states");
ensure(refreshCalls === 1, "Sessão expirada é renovada antes de ler.");

await expired.signOut();
ensure(storage.getItem(AUTH_SESSION_KEY) === null, "Logout limpa a sessão.");
ensure(expired.user === null, "Logout remove identidade.");

console.log("Supabase Auth V0: todos os testes passaram.");
