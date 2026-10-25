import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { AuthIdentity } from "../persistence/supabaseAuth";
import {
  supabaseAuthClient,
  supabaseConfigurationError,
} from "../persistence/supabaseInstance";

interface Props {
  children: ReactNode;
}

export default function SupabaseGate({ children }: Props) {
  const client = useMemo(() => supabaseAuthClient, []);
  const [identity, setIdentity] = useState<AuthIdentity | null>(null);
  const [status, setStatus] = useState<"checking" | "login" | "ready">(
    client ? "checking" : "login"
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    void client.restore().then((user) => {
      if (cancelled) return;
      setIdentity(user);
      setStatus(user ? "ready" : "login");
    }).catch((reason: unknown) => {
      if (cancelled) return;
      setError(
        reason instanceof Error ? reason.message :
          "Não foi possível validar a sessão."
      );
      setStatus("login");
    });
    return () => { cancelled = true; };
  }, [client]);

  if (!client) {
    return (
      <main className="app-shell" style={{ padding: 24 }}>
        <section className="panel" role="alert" style={{ padding: 24 }}>
          <h1>Schedule Engine — Supabase</h1>
          <p>A ligação à base de dados ainda não está configurada.</p>
          <p>
            Define VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY
            no ficheiro .env.local do projeto.
          </p>
          {supabaseConfigurationError && (
            <p role="alert">{supabaseConfigurationError}</p>
          )}
          <p>
            Os dados existentes no navegador não foram apagados nem alterados.
          </p>
        </section>
      </main>
    );
  }

  if (status === "checking") {
    return (
      <main className="app-shell" style={{ padding: 24 }}>
        <p>A validar a sessão Supabase…</p>
      </main>
    );
  }

  if (status !== "ready" || !identity) {
    return (
      <main className="app-shell" style={{ padding: 24 }}>
        <section className="panel" style={{ padding: 24, maxWidth: 480 }}>
          <h1>Schedule Engine</h1>
          <p>Inicia sessão para aceder aos horários guardados no Supabase.</p>
          <form onSubmit={(event) => {
            event.preventDefault();
            setError("");
            setBusy(true);
            void client.signIn(email, password).then((user) => {
              setIdentity(user);
              setPassword("");
              setStatus("ready");
            }).catch((reason: unknown) => {
              setError(
                reason instanceof Error
                  ? reason.message
                  : "A autenticação falhou."
              );
            }).finally(() => setBusy(false));
          }}>
            <label htmlFor="supabase-email">Email</label>
            <input
              id="supabase-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              style={{ display: "block", width: "100%", marginBottom: 12 }}
            />
            <label htmlFor="supabase-password">Palavra-passe</label>
            <input
              id="supabase-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              style={{ display: "block", width: "100%", marginBottom: 12 }}
            />
            {error && <p role="alert">{error}</p>}
            <button type="submit" disabled={busy}>
              {busy ? "A autenticar…" : "Entrar"}
            </button>
          </form>
          <p>
            Utiliza uma conta criada em Authentication → Users
            no teu projeto Supabase.
          </p>
        </section>
      </main>
    );
  }

  return (
    <>
      <div style={{
        display: "flex",
        justifyContent: "flex-end",
        alignItems: "center",
        gap: 12,
        padding: "8px 24px",
      }}>
        <small>Sessão: {identity.email}</small>
        <button type="button" onClick={() => {
          setBusy(true);
          void client.signOut().finally(() => {
            setIdentity(null);
            setStatus("login");
            setBusy(false);
          });
        }} disabled={busy}>
          Terminar sessão
        </button>
      </div>
      {children}
    </>
  );
}
