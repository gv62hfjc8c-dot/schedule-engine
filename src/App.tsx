import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { monthCells, monthLabel, selectedDayLabel } from "./calendar";
import { knownFoundationPath, pageForPath } from "./routes";
import {loadCompanyDraftFromBrowser,saveCompanyDraftToBrowser} from "./companyDraftRepository";
import {
  WEEKDAYS as OPERATING_WEEKDAYS,suggestedWeeklyOpeningHours,type Weekday,
} from "./operatingHours";
import {
  loadOpeningHoursDraftFromBrowser,saveOpeningHoursDraftToBrowser,
} from "./openingHoursDraftRepository";

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

/**
 * Landing screen for the future guided setup. It presents only lasting,
 * user-facing content. No steps are marked complete or simulated.
 */
function InitialSetupPage() {
  const [initial] = useState(loadCompanyDraftFromBrowser);
  const [name, setName] = useState(initial.company?.name ?? "");
  const [savedName, setSavedName] = useState(initial.company?.name ?? "");
  const [feedback, setFeedback] = useState<{
    type:"error"|"success";message:string
  } | null>(() => initial.status==="unavailable"
    ? {type:"error",message:"Não é possível aceder ao armazenamento deste dispositivo."}
    : initial.status==="invalid"
      ? {type:"error",message:"Não foi possível recuperar os dados da empresa. Podes introduzi-los novamente."}
      : null);

  function handleCompanySave(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result=saveCompanyDraftToBrowser({name});
    if (!result.ok) {
      setFeedback({type:"error",message:result.message});
      return;
    }
    setName(result.company.name);
    setSavedName(result.company.name);
    setFeedback({type:"success",message:"Os dados da empresa foram guardados neste dispositivo."});
  }

  return (
    <Shell>
      <header className="page-heading">
        <div>
          <p className="eyebrow">Configuração inicial</p>
          <h1>Dados da empresa</h1>
          <p>Começa por identificar a organização cujos horários vais gerir.</p>
        </div>
      </header>
      <section className="surface settings-panel" aria-label="Dados da empresa">
        <div className="settings-icon" aria-hidden="true">◷</div>
        <div className="settings-copy">
          <p className="surface-kicker">A tua organização</p>
          <h2>{savedName ? "Identificação da empresa" : "Como se chama a tua empresa?"}</h2>
          <p>O nome será utilizado para identificar a organização no Schedule Engine.</p>
          <form className="company-form" onSubmit={handleCompanySave}>
            <label htmlFor="company-name">Nome da empresa <span aria-hidden="true">*</span></label>
            <input id="company-name" name="companyName" type="text"
              autoComplete="organization" maxLength={120} minLength={2}
              value={name} onChange={event => {
                setName(event.target.value);
                setFeedback(null);
              }} placeholder="Nome da empresa" required />
            <p className="company-field-help">Utiliza o nome pelo qual identificas a tua organização.</p>
            {feedback && (
              <p className={feedback.type==="error" ? "form-error" : "form-success"}
                role={feedback.type==="error" ? "alert" : "status"}>
                {feedback.message}
              </p>
            )}
            {savedName && (
              <a className="text-link" href="/configuracao/funcionamento">
                Definir dias e horários de funcionamento <span aria-hidden="true">→</span>
              </a>
            )}
            <div className="company-actions">
              <button className="button button-primary company-save" type="submit">
                Guardar dados da empresa
              </button>
              <a className="text-link" href="/configuracao">Voltar à configuração</a>
            </div>
          </form>
          <p className="local-storage-note">
            Estes dados ficam guardados apenas neste dispositivo.
          </p>
        </div>
      </section>
    </Shell>
  );
}

interface DayEditor {
  day:Weekday;
  open:boolean;
  start:string;
  end:string;
}

function OperatingHoursPage() {
  const [initial] = useState(loadOpeningHoursDraftFromBrowser);
  const [days,setDays] = useState<DayEditor[]>(() => {
    const week=initial.status==="loaded" ? initial.value : suggestedWeeklyOpeningHours();
    return week.days.map(d=>({
      day:d.day,
      open:d.intervals.length>0,
      start:d.intervals[0]?.start??"09:00",
      end:d.intervals[0]?.end??"18:00",
    }));
  });
  const [saved,setSaved] = useState(initial.status==="loaded");
  const [feedback,setFeedback] = useState<{
    type:"error"|"success";message:string;
  } | null>(() => initial.status==="unavailable"
    ? {type:"error",message:"Não é possível consultar os horários guardados neste dispositivo."}
    : initial.status==="invalid"
      ? {type:"error",message:"Não foi possível recuperar os horários anteriores. Confirma os valores antes de guardar."}
      : null);

  function updateDay(day:Weekday,change:Partial<DayEditor>) {
    setDays(current=>current.map(item=>
      item.day===day ? {...item,...change} : item
    ));
    setSaved(false);
    setFeedback(null);
  }

  function handleSave(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const weeklyHours={
      days:days.map(d=>({
        day:d.day,
        intervals:d.open?[{start:d.start,end:d.end}]:[],
      })),
    };
    const result=saveOpeningHoursDraftToBrowser(weeklyHours);
    if(!result.ok){
      setFeedback({type:"error",message:result.message});
      setSaved(false);
      return;
    }
    setSaved(true);
    setFeedback({type:"success",message:"Os horários de funcionamento foram guardados neste dispositivo."});
  }

  return (
    <Shell>
      <header className="page-heading">
        <div>
          <p className="eyebrow">Configuração da empresa</p>
          <h1>Horário de funcionamento</h1>
          <p>Escolhe os dias em que a empresa funciona e as horas de abertura e encerramento.</p>
        </div>
      </header>
      <section className="surface opening-panel" aria-label="Funcionamento semanal">
        <div className="opening-header">
          <div>
            <p className="surface-kicker">Semana habitual</p>
            <h2>Dias e horários</h2>
          </div>
          <span className="detail-state">{saved ? "Horários guardados" : "Alterações por guardar"}</span>
        </div>
        <p className="opening-description">
          Os horários repetem-se semanalmente. Os dias encerrados não têm período de abertura.
        </p>
        {initial.status==="empty" && (
          <p className="opening-suggestion">
            Apresentamos um horário inicial sugerido. Confirma os dias e as horas antes de guardar.
          </p>
        )}
        <form onSubmit={handleSave} className="opening-form">
          <div className="opening-days">
            {OPERATING_WEEKDAYS.map(weekday=>{
              const item=days.find(d=>d.day===weekday.id)!;
              return (
                <div className="opening-day" role="group"
                  aria-label={weekday.label} key={weekday.id}>
                  <label className="opening-toggle">
                    <input type="checkbox" checked={item.open}
                      onChange={event=>updateDay(weekday.id,{open:event.target.checked})}/>
                    <span>{weekday.label}</span>
                  </label>
                  {item.open
                    ? <div className="opening-times">
                        <label htmlFor={"from-"+weekday.id}>
                          Abertura
                          <input id={"from-"+weekday.id} type="time" step={60}
                            value={item.start} required
                            onChange={event=>updateDay(weekday.id,{start:event.target.value})}/>
                        </label>
                        <label htmlFor={"to-"+weekday.id}>
                          Encerramento
                          <input id={"to-"+weekday.id} type="time" step={60}
                            value={item.end} required
                            onChange={event=>updateDay(weekday.id,{end:event.target.value})}/>
                        </label>
                      </div>
                    : <span className="opening-closed">Encerrado</span>}
                </div>
              );
            })}
          </div>
          {feedback && (
            <p className={feedback.type==="error" ? "form-error" : "form-success"}
              role={feedback.type==="error" ? "alert" : "status"}>
              {feedback.message}
            </p>
          )}
          <div className="opening-actions">
            <button className="button button-primary opening-save" type="submit">
              Guardar funcionamento
            </button>
            <a className="text-link" href="/configuracao">Ver configuração</a>
          </div>
        </form>
        <p className="local-storage-note">Estes dados ficam guardados apenas neste dispositivo.</p>
      </section>
    </Shell>
  );
}

function SettingsPage() {
  const [companyDraft] = useState(loadCompanyDraftFromBrowser);
  const [openingDraft] = useState(loadOpeningHoursDraftFromBrowser);
  return (
    <Shell>
      <header className="page-heading">
        <div>
          <p className="eyebrow">Organização</p>
          <h1>Configuração</h1>
          <p>Consulta e gere as definições utilizadas no planeamento.</p>
        </div>
      </header>
      <div className="settings-stack">
        <section className="surface settings-panel" aria-label="Dados da empresa">
          <div className="settings-icon" aria-hidden="true">◷</div>
          <div className="settings-copy">
            <p className="surface-kicker">Identificação</p>
            <h2>{companyDraft.status==="loaded" ? companyDraft.company.name : "Dados da empresa"}</h2>
            <p>{companyDraft.status==="loaded"
              ? "Identificação guardada neste dispositivo."
              : "Adiciona o nome da tua organização."}</p>
            <a className="text-link" href="/configuracao/inicial">
              {companyDraft.status==="loaded" ? "Editar dados da empresa" : "Adicionar dados da empresa"}
              <span aria-hidden="true">→</span>
            </a>
          </div>
        </section>
        <section className="surface settings-panel" aria-label="Funcionamento da empresa">
          <div className="settings-icon" aria-hidden="true">◷</div>
          <div className="settings-copy">
            <p className="surface-kicker">Operação</p>
            <h2>Funcionamento da empresa</h2>
            <p>Configura os dias e os intervalos de abertura da organização.</p>
            <div className="settings-empty">
              <span className="neutral-dot" aria-hidden="true" />
              {openingDraft.status==="loaded"
                ? "Funcionamento guardado: " +
                  openingDraft.value.days.filter(day=>day.intervals.length>0).length +
                  " dias por semana."
                : openingDraft.status==="empty"
                  ? "Ainda não existem horários de funcionamento guardados."
                  : "Não foi possível consultar os horários guardados."}
            </div>
            <a className="text-link" href="/configuracao/funcionamento">
              {openingDraft.status==="loaded" ? "Editar funcionamento" : "Definir funcionamento"}
              <span aria-hidden="true">→</span>
            </a>
          </div>
        </section>
      </div>
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
  if (page === "setup") return <InitialSetupPage />;
  if (page === "operatingHours") return <OperatingHoursPage />;
  return <WelcomePage />;
}
