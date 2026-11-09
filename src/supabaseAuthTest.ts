import {
  AUTH_SESSION_KEY,
  SupabaseAuthClient,
  parseSupabaseProjectUrl,
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
    ensure(Boolean(headers.get("Authorization")?.startsWith("Bearer jwt-")),
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

// Regression: valid production project URLs must never be rejected.
ensure(
  parseSupabaseProjectUrl("https://zuczsheoixuwienbkprz.supabase.co") ===
    "https://zuczsheoixuwienbkprz.supabase.co",
  "Aceita o domínio do projeto Supabase."
);
ensure(
  parseSupabaseProjectUrl("https://zuczsheoixuwienbkprz.supabase.co/rest/v1/") ===
    "https://zuczsheoixuwienbkprz.supabase.co",
  "Normaliza URLs que incluem /rest/v1/."
);
for (const invalid of [
  "http://zuczsheoixuwienbkprz.supabase.co",
  "https://zuczsheoixuwienbkprz.supabase.co.evil.test",
  "not-a-url",
]) {
  let rejected = false;
  try {
    parseSupabaseProjectUrl(invalid);
  } catch {
    rejected = true;
  }
  ensure(rejected, "Rejeita URLs inválidos ou inseguros.");
}

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


// PR47-F: an in-flight refresh must never resurrect a session after logout.
{
  const memory=new MemoryStorage();
  memory.setItem(AUTH_SESSION_KEY,JSON.stringify({
    access_token:"old-token",refresh_token:"old-refresh",expires_at:0,
    user:{id:"first-user",email:"first@example.test"},
  }));
  let releaseRefresh=()=>{};
  const gate=new Promise<void>(resolve=>{releaseRefresh=()=>resolve();});
  let refreshStarted=false;
  const delayedFetch:typeof fetch=async(input)=>{
    const url=String(input);
    if(url.endsWith("token?grant_type=refresh_token")){
      refreshStarted=true;
      await gate;
      return Response.json({
        access_token:"late-token",refresh_token:"late-refresh",expires_in:3600,
        user:{id:"first-user",email:"first@example.test"},
      });
    }
    if(url.endsWith("/auth/v1/logout"))return new Response(null,{status:204});
    if(url.endsWith("/rest/v1/schedule_engine_states"))return Response.json([]);
    return Response.json({message:"unsupported"},{status:404});
  };
  const client=new SupabaseAuthClient(config,delayedFetch,memory);
  const request=client.request("/rest/v1/schedule_engine_states")
    .then(()=>false,()=>true);
  await Promise.resolve();
  await Promise.resolve();
  ensure(refreshStarted,"The refresh request must be in flight.");
  await client.signOut();
  ensure(client.user===null && memory.getItem(AUTH_SESSION_KEY)===null,
    "Local logout must clear immediately, without waiting for the refresh.");
  releaseRefresh();
  ensure(await request,
    "A delayed refresh response must be rejected after signout.");
  ensure(client.user===null && memory.getItem(AUTH_SESSION_KEY)===null,
    "A late refresh cannot resurrect an authenticated identity.");
}
// PR47-F: completing an old remote logout must not erase a subsequent login.
{
  const memory=new MemoryStorage();
  memory.setItem(AUTH_SESSION_KEY,JSON.stringify({
    access_token:"old-token",refresh_token:"old-refresh",expires_at:Math.floor(Date.now()/1000)+3600,
    user:{id:"first-user",email:"first@example.test"},
  }));
  let releaseLogout=()=>{};
  const gate=new Promise<void>(resolve=>{releaseLogout=()=>resolve();});
  const delayedFetch:typeof fetch=async(input)=>{
    const url=String(input);
    if(url.endsWith("/auth/v1/logout")){await gate;return new Response(null,{status:204});}
    if(url.endsWith("token?grant_type=password"))
      return Response.json({
        access_token:"new-token",refresh_token:"new-refresh",expires_in:3600,
        user:{id:"second-user",email:"second@example.test"},
      });
    return Response.json({message:"unsupported"},{status:404});
  };
  const client=new SupabaseAuthClient(config,delayedFetch,memory);
  const oldLogout=client.signOut();
  ensure(client.user===null,"Logout clears local identity synchronously.");
  const newUser=await client.signIn("second@example.test","example-password");
  ensure(newUser.id==="second-user","A new account can authenticate while old logout is pending.");
  releaseLogout();
  await oldLogout;
  ensure(client.user?.id==="second-user" &&
    memory.getItem(AUTH_SESSION_KEY)!==null,
    "A stale logout completion cannot clear a newer account.");
}

console.log("Supabase Auth V0: todos os testes passaram.");
