import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { monthCells, monthLabel, selectedDayLabel } from "./calendar";
import { knownFoundationPath, pageForPath } from "./routes";

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "brand brand-compact" : "brand"}>
      <span className="brand-mark" aria-hidden="true">SE</span>
      <span>Schedule Engine</span>
    </div>
  );
}

function WelcomePage() {
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [signInError, setSignInError] = useState(false);

  function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // No authentication provider is connected yet. Never simulate a session,
    // store passwords or navigate to a protected screen on submission.
    setSignInError(true);
  }

  return (
    <main className="entry-page">
      <section className="entry-card" aria-label="Schedule Engine">
        <div className="entry-intro">
          <Brand />
          <div className="entry-copy">
            <p className="eyebrow">Planeamento de equipas</p>
            <h1>Horários claros.<br />Decisões com confiança.</h1>
            <p className="intro-description">
              Organiza os horários da tua equipa e acompanha o planeamento
              num único espaço, simples e intuitivo.
            </p>
          </div>
          <div className="entry-benefits">
            <p><span className="teal-dot" aria-hidden="true" /> Calendário organizado</p>
            <p><span className="teal-dot" aria-hidden="true" /> Planeamento de equipas</p>
            <p><span className="teal-dot" aria-hidden="true" /> Informação clara e acessível</p>
          </div>
        </div>

        <div className="entry-access">
          <div className="access-content">
            <p className="eyebrow">Acesso à conta</p>
            <h2>Bem-vindo de volta</h2>
            <p className="access-description">
              Inicia sessão para continuares a gerir os horários da tua equipa.
            </p>
            <form className="login-fields" onSubmit={handleSignIn}>
              <label htmlFor="login-email">Email</label>
              <input id="login-email" name="email" type="email"
                placeholder="nome@empresa.pt" autoComplete="username"
                required onChange={() => setSignInError(false)} />
              <label htmlFor="login-password">Palavra-passe</label>
              <div className="password-input">
                <input id="login-password" name="password"
                  type={passwordVisible ? "text" : "password"}
                  placeholder="Introduz a tua palavra-passe"
                  autoComplete="current-password" required
                  onChange={() => setSignInError(false)} />
                <button type="button" className="password-toggle"
                  onClick={() => setPasswordVisible(visible => !visible)}
                  aria-label={passwordVisible ? "Ocultar palavra-passe" : "Mostrar palavra-passe"}
                  aria-controls="login-password">
                  {passwordVisible ? "Ocultar" : "Mostrar"}
                </button>
              </div>
              {signInError && (
                <p className="form-error" role="alert">
                  Não é possível iniciar sessão de momento.
                </p>
              )}
              <button type="submit" className="button button-primary">
                Entrar no Schedule Engine
              </button>
            </form>
          </div>
        </div>
      </section>
    </main>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const page = pageForPath(window.location.pathname);
  return (
    <div className="workspace-page">
      <header className="workspace-header">
        <div className="workspace-header-inner">
          <a className="brand-link" href="/" aria-label="Schedule Engine — início">
            <Brand compact />
          </a>
          <nav className="workspace-nav" aria-label="Navegação principal">
            <a href="/horarios" aria-current={page === "calendar" ? "page" : undefined}>Calendário</a>
            <a href="/configuracao" aria-current={page === "settings" ? "page" : undefined}>Configuração</a>
            <a href="/" className="home-link">Início</a>
          </nav>
        </div>
      </header>
      <main className="workspace-main">{children}</main>
    </div>
  );
}

const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

function CalendarPage() {
  const [visible, setVisible] = useState(() => {
    const today = new Date();
    return { year: today.getFullYear(), month: today.getMonth() };
  });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const cells = useMemo(
    () => monthCells(visible.year, visible.month), [visible.year, visible.month]
  );
  const today = new Date();
  const todayString = String(today.getFullYear()) + "-" +
    String(today.getMonth() + 1).padStart(2, "0") + "-" +
    String(today.getDate()).padStart(2, "0");

  function navigateMonth(direction: number) {
    setVisible(current => {
      const next = new Date(current.year, current.month + direction, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });
    setSelectedDate(null);
  }

  function showToday() {
    setVisible({ year: today.getFullYear(), month: today.getMonth() });
    setSelectedDate(todayString);
  }

  return (
    <Shell>
      <header className="page-heading">
        <div>
          <p className="eyebrow">Planeamento</p>
          <h1>Horários</h1>
          <p>Consulta o calendário e os horários da tua equipa.</p>
        </div>
      </header>
      <div className="calendar-layout">
        <section className="surface calendar-panel" aria-label="Calendário mensal">
          <header className="calendar-header">
            <div>
              <p className="surface-kicker">Calendário</p>
              <h2>{monthLabel(visible.year, visible.month)}</h2>
            </div>
            <div className="month-actions">
              <button className="icon-button" type="button" onClick={() => navigateMonth(-1)}
                aria-label="Mês anterior">‹</button>
              <button className="today-button" type="button" onClick={showToday}>Hoje</button>
              <button className="icon-button" type="button" onClick={() => navigateMonth(1)}
                aria-label="Mês seguinte">›</button>
            </div>
          </header>
          <div className="calendar-grid" aria-label={monthLabel(visible.year, visible.month)}>
            {WEEKDAYS.map(day => <span className="weekday" key={day}>{day}</span>)}
            {cells.map((cell, index) => cell.day === null
              ? <span className="empty-day" key={"empty-" + index} aria-hidden="true" />
              : <button type="button" key={cell.date}
                  className={"calendar-day" +
                    (cell.date === todayString ? " is-today" : "") +
                    (cell.date === selectedDate ? " is-selected" : "")}
                  onClick={() => setSelectedDate(cell.date)}
                  aria-label={selectedDayLabel(cell.date!)}
                  aria-pressed={selectedDate === cell.date}>
                  <span>{cell.day}</span>
                </button>
            )}
          </div>
          <p className="calendar-footnote">
            <span className="neutral-dot" aria-hidden="true" />
            Não existem horários registados neste mês.
          </p>
        </section>
        <aside className="surface detail-panel" aria-label="Detalhe do dia" aria-live="polite">
          <p className="surface-kicker">Detalhe do dia</p>
          <h2>{selectedDate ? selectedDayLabel(selectedDate) : "Seleciona uma data"}</h2>
          {selectedDate
            ? <>
                <span className="detail-state">Sem horário registado</span>
                <p>Não existem turnos atribuídos a este dia.</p>
                <p className="detail-explanation">
                  Um dia sem turnos registados não corresponde automaticamente a uma folga.
                </p>
              </>
            : <p>Seleciona um dia do calendário para consultar o seu horário.</p>}
        </aside>
      </div>
    </Shell>
  );
}

function SettingsPage() {
  return (
    <Shell>
      <header className="page-heading">
        <div>
          <p className="eyebrow">Organização</p>
          <h1>Configuração</h1>
          <p>Consulta e gere as definições utilizadas no planeamento.</p>
        </div>
      </header>
      <section className="surface settings-panel" aria-label="Funcionamento da empresa">
        <div className="settings-icon" aria-hidden="true">◷</div>
        <div className="settings-copy">
          <p className="surface-kicker">Operação</p>
          <h2>Funcionamento da empresa</h2>
          <p>Define os dias e os intervalos de funcionamento da organização.</p>
          <div className="settings-empty">
            <span className="neutral-dot" aria-hidden="true" />
            Ainda não existem horários de funcionamento configurados.
          </div>
          <a className="text-link" href="/horarios">
            Voltar ao calendário <span aria-hidden="true">→</span>
          </a>
        </div>
      </section>
    </Shell>
  );
}

export default function App() {
  const path = window.location.pathname;
  useEffect(() => {
    if (!knownFoundationPath(path)) window.history.replaceState(null, "", "/");
  }, [path]);
  const page = pageForPath(path);
  if (page === "calendar") return <CalendarPage />;
  if (page === "settings") return <SettingsPage />;
  return <WelcomePage />;
}
