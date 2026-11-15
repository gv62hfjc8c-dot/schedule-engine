import { useEffect, useMemo, useState } from "react";
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
  return (
    <main className="entry-page">
      <section className="entry-card" aria-label="Apresentação e acesso ao Schedule Engine">
        <div className="entry-intro">
          <Brand />
          <div className="entry-copy">
            <p className="eyebrow">Planeamento de equipas</p>
            <h1>Horários claros.<br />Decisões com confiança.</h1>
            <p className="intro-description">
              Um espaço pensado para organizar horários e simplificar o trabalho
              das equipas. Estamos a construir cada função com rigor.
            </p>
          </div>
          <div className="entry-benefits" aria-label="Princípios do produto">
            <p><span className="teal-dot" /> Planeamento simples e transparente</p>
            <p><span className="teal-dot" /> Calendário como ponto de partida</p>
            <p><span className="teal-dot" /> Regras e validação desenvolvidas por etapas</p>
          </div>
          <p className="entry-footer">Schedule Engine · Fundação V2</p>
        </div>

        <div className="entry-access">
          <div className="access-content">
            <p className="eyebrow">Acesso à conta</p>
            <h2>Bem-vindo de volta</h2>
            <p className="access-description">
              Nesta primeira versão estamos a preparar a experiência de entrada.
              A ligação às contas será implementada numa etapa própria.
            </p>
            <fieldset className="login-fields" disabled>
              <legend className="sr-only">Campos de autenticação em preparação</legend>
              <label htmlFor="login-email">Email</label>
              <input id="login-email" type="email" placeholder="nome@empresa.pt" autoComplete="off" />
              <label htmlFor="login-password">Palavra-passe</label>
              <input id="login-password" type="password" placeholder="Acesso ainda não disponível" autoComplete="off" />
              <button type="button" className="button button-primary" disabled>Entrar no Schedule Engine</button>
            </fieldset>
            <p className="access-note">Não introduzas credenciais reais nesta demonstração.</p>
            <div className="preview-entry">
              <span className="preview-label">Explorar a nova base</span>
              <p>Consulta a estrutura inicial do calendário, sem iniciar sessão nem guardar dados.</p>
              <a className="button button-secondary" href="/horarios">Abrir demonstração <span aria-hidden="true">→</span></a>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="workspace-page">
      <header className="workspace-header">
        <a className="brand-link" href="/" aria-label="Schedule Engine — início">
          <Brand compact />
        </a>
        <nav className="workspace-nav" aria-label="Navegação principal">
          <a href="/horarios" aria-current={pageForPath(window.location.pathname) === "calendar" ? "page" : undefined}>Calendário</a>
          <a href="/configuracao" aria-current={pageForPath(window.location.pathname) === "settings" ? "page" : undefined}>Configuração</a>
          <a href="/" className="exit-link">Fechar demonstração</a>
        </nav>
      </header>
      <main className="workspace-main">{children}</main>
      <footer className="workspace-footer">V2 · Demonstração local · Sem autenticação e sem dados guardados</footer>
    </div>
  );
}

const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

function CalendarPage() {
  const today = new Date();
  const [visible, setVisible] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const cells = useMemo(() => monthCells(visible.year, visible.month), [visible.year, visible.month]);
  const todayString = String(today.getFullYear()) + "-" +
    String(today.getMonth() + 1).padStart(2, "0") + "-" +
    String(today.getDate()).padStart(2, "0");

  function navigateMonth(direction: number) {
    const date = new Date(visible.year, visible.month + direction, 1);
    setVisible({ year: date.getFullYear(), month: date.getMonth() });
    setSelectedDate(null);
  }

  return (
    <Shell>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Espaço de trabalho</p>
          <h1>Horários</h1>
          <p>O calendário será o centro da operação. Ainda não existem horários configurados.</p>
        </div>
        <span className="stage-tag">V2 · Base visual</span>
      </div>
      <div className="calendar-layout">
        <section className="surface calendar-panel" aria-label="Calendário mensal">
          <header className="calendar-header">
            <div>
              <p className="surface-kicker">Calendário</p>
              <h2>{monthLabel(visible.year, visible.month)}</h2>
            </div>
            <div className="month-actions">
              <button className="icon-button" type="button" onClick={() => navigateMonth(-1)} aria-label="Mês anterior">‹</button>
              <button className="today-button" type="button" onClick={() => {
                setVisible({ year: today.getFullYear(), month: today.getMonth() });
                setSelectedDate(todayString);
              }}>Hoje</button>
              <button className="icon-button" type="button" onClick={() => navigateMonth(1)} aria-label="Mês seguinte">›</button>
            </div>
          </header>
          <div className="calendar-grid" role="grid" aria-label={monthLabel(visible.year, visible.month)}>
            {WEEKDAYS.map(day => <span className="weekday" key={day} role="columnheader">{day}</span>)}
            {cells.map((cell, index) => cell.day === null
              ? <span className="empty-day" key={"empty-" + index} aria-hidden="true" />
              : <button type="button" role="gridcell" key={cell.date}
                  className={"calendar-day" + (cell.date === todayString ? " is-today" : "") + (cell.date === selectedDate ? " is-selected" : "")}
                  onClick={() => setSelectedDate(cell.date)}
                  aria-label={selectedDayLabel(cell.date!)}
                  aria-selected={selectedDate === cell.date}>
                  <span>{cell.day}</span>
                </button>
            )}
          </div>
          <p className="calendar-footnote"><span className="neutral-dot" /> Nenhum dia classificado — falta configurar a operação</p>
        </section>
        <aside className="surface detail-panel" aria-label="Detalhe do dia">
          <p className="surface-kicker">Detalhe do dia</p>
          <h2>{selectedDate ? selectedDayLabel(selectedDate) : "Seleciona uma data"}</h2>
          <span className="detail-state">Sem configuração</span>
          <p>
            {selectedDate
              ? "Este dia ainda não tem um horário. A ausência de turnos não significa folga."
              : "Seleciona um dia do calendário para consultar o seu estado."}
          </p>
          <div className="detail-divider" />
          <p className="detail-explanation">
            Nesta etapa não existem pessoas, funcionamento, regras nem geração de turnos.
          </p>
          <a className="text-link" href="/configuracao">Ver próximo passo <span aria-hidden="true">→</span></a>
        </aside>
      </div>
    </Shell>
  );
}

function SettingsPage() {
  return (
    <Shell>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Próxima etapa</p>
          <h1>Configuração</h1>
          <p>Vamos definir a operação uma decisão de cada vez.</p>
        </div>
        <span className="stage-tag">Ainda não implementado</span>
      </div>
      <section className="surface settings-panel">
        <span className="step-number">01</span>
        <div>
          <p className="surface-kicker">Primeiro conceito</p>
          <h2>Funcionamento da empresa</h2>
          <p>Antes de gerar horários, o motor precisa de saber em que dias e intervalos a empresa funciona. Ainda não vamos introduzir regras ou pessoas.</p>
          <p className="settings-note">Esta página é apenas a estrutura visual da próxima etapa. Não guarda configuração.</p>
          <a className="button button-secondary" href="/horarios">Voltar ao calendário <span aria-hidden="true">→</span></a>
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
