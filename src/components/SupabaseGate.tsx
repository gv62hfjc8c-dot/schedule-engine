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
  const [showPassword, setShowPassword] = useState(false);

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
      <main className="auth-screen">
        <div className="auth-layout">
          <aside className="auth-brand-panel" aria-label="Apresentação do Schedule Engine">
            <div className="auth-brand-header">
              <div className="auth-brand-symbol" aria-hidden="true">SE</div>
              <strong>Schedule Engine</strong>
            </div>
            <div className="auth-brand-intro">
              <span className="auth-eyebrow">PLANEAMENTO DE EQUIPAS</span>
              <h1>Horários organizados. Decisões fundamentadas.</h1>
              <p>Prepara turnos, consulta a cobertura necessária e acompanha as propostas da tua equipa num único espaço de trabalho.</p>
            </div>
            <div className="auth-brand-features" aria-label="Principais capacidades">
              <span><span className="auth-feature-dot" aria-hidden="true" /> Planeamento com regras e restrições</span>
              <span><span className="auth-feature-dot" aria-hidden="true" /> Consulta diária e mensal</span>
              <span><span className="auth-feature-dot" aria-hidden="true" /> Histórico e versões de propostas</span>
            </div>
            <p className="auth-brand-footer">Schedule Engine · Planeamento profissional</p>
          </aside>
          <section className="auth-form-section" aria-labelledby="auth-title">
            <div className="auth-form-wrap">
              <div className="auth-mobile-brand">
                <span className="auth-brand-symbol" aria-hidden="true">SE</span>
                <strong>Schedule Engine</strong>
              </div>
              <span className="auth-eyebrow">ACESSO À CONTA</span>
              <h2 id="auth-title">Bem-vindo de volta</h2>
              <p className="auth-form-subtitle">Inicia sessão para continuares a gerir os horários da tua equipa.</p>
              <form className="auth-form" onSubmit={(event) => {
                event.preventDefault();
                if(busy)return;
                setError("");
                setBusy(true);
                void client.signIn(email.trim(),password).then((user) => {
                  setIdentity(user);
                  setPassword("");
                  setShowPassword(false);
                  setStatus("ready");
                }).catch((reason: unknown) => {
                  const message=reason instanceof Error ? reason.message : "A autenticação falhou.";
                  const normalized=message.toLowerCase();
                  setError(normalized.includes("invalid login")||normalized.includes("invalid credentials")||
                    normalized.includes("credenciais inválidas")?
                    "Email ou palavra-passe incorretos. Verifica os dados e tenta novamente.":
                    "Não foi possível iniciar sessão. "+message);
                }).finally(() => setBusy(false));
              }}>
                <div className="auth-field">
                  <label htmlFor="supabase-email">Email</label>
                  <input id="supabase-email" type="email" autoComplete="username"
                    inputMode="email" autoCapitalize="none" spellCheck={false}
                    value={email} onChange={(event)=>setEmail(event.target.value)}
                    placeholder="nome@empresa.pt" required disabled={busy}/>
                </div>
                <div className="auth-field">
                  <label htmlFor="supabase-password">Palavra-passe</label>
                  <div className="auth-password-field">
                    <input id="supabase-password"
                      type={showPassword?"text":"password"}
                      autoComplete="current-password" value={password}
                      onChange={(event)=>setPassword(event.target.value)}
                      placeholder="Introduz a tua palavra-passe"
                      required disabled={busy}/>
                    <button className="auth-show-password" type="button"
                      disabled={busy}
                      aria-label={showPassword?"Ocultar palavra-passe":"Mostrar palavra-passe"}
                      aria-pressed={showPassword}
                      onClick={()=>setShowPassword(value=>!value)}>
                      {showPassword?"Ocultar":"Mostrar"}
                    </button>
                  </div>
                </div>
                {error&&<p className="auth-error" role="alert">{error}</p>}
                <button className="auth-submit" type="submit" disabled={busy}
                  aria-busy={busy}>
                  {busy?"A iniciar sessão…":"Entrar no Schedule Engine"}
                </button>
              </form>
              <p className="auth-access-note">O acesso está disponível para contas previamente autorizadas.</p>
            </div>
          </section>
        </div>
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
