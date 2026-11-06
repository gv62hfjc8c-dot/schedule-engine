import { useEffect, useMemo, useState } from "react";
import type {
  OperatingCalendarConfiguration, Person, PersonAvailability,
} from "../types";
import {
  dayKind, dailyTeamRows, daySummary, effectiveShiftMinutes, filterDailyTeam,
  monthCalendarDates, monthStart, moveCalendarMonth, todayInTimeZone,
  toggleFilteredSelection, type DayTeamRow, type SchedulePreview, type TeamFilter,
} from "../utils/monthlyScheduleView";

interface Props {
  people: Person[];
  availabilities: PersonAvailability[];
  operatingCalendar: OperatingCalendarConfiguration;
  preview: SchedulePreview | null;
  onCreate(date?: string): void;
  onConfigureTeam(): void;
}
const ZONE = "Atlantic/Azores";
const FILTER_LABELS: Record<TeamFilter, string> = {
  all: "Toda a equipa",
  assigned: "Escalados na proposta",
  available: "Disponíveis sem turno",
  unavailable: "Sem disponibilidade",
  unplanned: "Por planear / sem escala",
  selected: "Selecionados",
};
const ROW_LABELS: Record<DayTeamRow["kind"], string> = {
  assigned: "Escalado na proposta",
  available: "Disponível, sem turno",
  unavailable: "Sem disponibilidade",
  unplanned: "Sem horário",
};
function dateLabel(date: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("pt-PT", {...options, timeZone: "UTC"})
    .format(new Date(date + "T12:00:00Z"));
}
function clockLabel(shift: NonNullable<DayTeamRow["shift"]>): string {
  return shift.interval.start + "–" + shift.interval.end;
}
const PAGE_SIZE = 12;

/**
 * One main entry screen, one quick-inspection side panel, one full-width
 * daily management screen. The UI is read-only while official approvals
 * and revisions are out of scope; never present simulated shifts as official.
 */
export default function ScheduleHome({
  people, availabilities, operatingCalendar, preview,
  onCreate, onConfigureTeam,
}: Props) {
  const today = todayInTimeZone(ZONE);
  const [month, setMonth] = useState(() => monthStart(today));
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [screen, setScreen] = useState<"month" | "manage">("month");
  const [filter, setFilter] = useState<TeamFilter>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [showSelectedSummary, setShowSelectedSummary] = useState(false);

  useEffect(() => {
    // A new simulation invalidates any selection based on the previous one.
    setSelectedIds(new Set());
    setShowSelectedSummary(false);
  }, [preview]);

  const rows = useMemo(() => selectedDate ? dailyTeamRows({
    date: selectedDate, people, availabilities,
    operation: operatingCalendar, preview,
  }) : [], [selectedDate, people, availabilities, operatingCalendar, preview]);
  const summary = useMemo(() => daySummary(rows), [rows]);
  const matching = useMemo(() =>
    filterDailyTeam(rows, filter, search, selectedIds),
    [rows, filter, search, selectedIds]);
  const totalPages = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visible = matching.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const dates = useMemo(() => monthCalendarDates(month), [month]);
  const kind = selectedDate ? dayKind(selectedDate, operatingCalendar, preview) : null;
  const statusLabel = kind === "closed" ? "Operação encerrada" :
    kind === "proposal" ? "Proposta temporária" : "Ainda por planear";

  function browseMonth(offset: number) {
    setMonth(previous => moveCalendarMonth(previous, offset));
    setSelectedDate(null);
    setFilter("all");
    setSearch("");
    setPage(1);
    setSelectedIds(new Set());
    setShowSelectedSummary(false);
  }

  function selectDate(date: string) {
    const nextMonth = monthStart(date);
    if (nextMonth !== month) setMonth(nextMonth);
    setSelectedDate(date);
    setScreen("month");
    setFilter("all");
    setSearch("");
    setPage(1);
    setSelectedIds(new Set());
    setShowSelectedSummary(false);
  }
  function setTeamFilter(value: TeamFilter) {
    setFilter(value);
    setPage(1);
    setShowSelectedSummary(false);
  }
  function togglePerson(id: string) {
    setSelectedIds(old => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setShowSelectedSummary(false);
  }
  const filters: TeamFilter[] = ["all","assigned","available","unavailable","unplanned"];
  const visibleFilters = selectedIds.size ? [...filters, "selected" as const] : filters;
  const currentMonth = month.slice(0, 7);
  const activeCount = people.filter(p => p.active).length;

  if (screen === "manage" && selectedDate) {
    const selectedPeople = rows.filter(row => selectedIds.has(row.id));
    return <section className="se-home se-management" aria-label="Gestão diária">
      <div className="se-management-top">
        <button type="button" className="se-outline" onClick={() => {
          setScreen("month");
          setShowSelectedSummary(false);
        }}>← Voltar ao calendário</button>
        <span className="se-context">Consulta e preparação · sem alteração oficial</span>
      </div>
      <div className="se-heading">
        <div>
          <p className="section-kicker">Gestão do dia</p>
          <h2>{dateLabel(selectedDate, {weekday: "long", day: "numeric", month: "long", year: "numeric"})}</h2>
          <p>Consulta toda a equipa e reúne pessoas para análise, mesmo que estejam em páginas ou filtros diferentes.</p>
        </div>
        <button type="button" className="primary-button"
          onClick={() => onCreate(selectedDate)}>Gerar proposta para este dia</button>
      </div>
      <div className="se-readonly-note" role="note">
        {kind === "proposal"
          ? "Estás a consultar a última simulação desta sessão. Os turnos não estão aprovados nem guardados."
          : kind === "closed"
            ? "A operação está encerrada neste dia. Não existem turnos para gerir."
            : "Não existe uma proposta carregada para este dia. Não é possível inferir folgas ou ausências a partir desta situação."}
        {" "}A edição e aprovação oficial não fazem parte da base PR #41.
      </div>
      <div className="se-manage-stats">
        <div><strong>{summary.total}</strong><span>Equipa ativa</span></div>
        <div><strong>{summary.assigned}</strong><span>Escalados (proposta)</span></div>
        <div><strong>{summary.available}</strong><span>Disponíveis sem turno</span></div>
        <div><strong>{summary.unavailable}</strong><span>Sem disponibilidade</span></div>
      </div>
      <div className="se-controls">
        <label className="se-control">
          <span>Pesquisar colaborador</span>
          <input type="search" value={search} placeholder="Nome do colaborador"
            onChange={event => {setSearch(event.target.value);setPage(1);}} />
        </label>
        <label className="se-control">
          <span>Filtrar</span>
          <select value={filter} onChange={event => setTeamFilter(event.target.value as TeamFilter)}>
            {visibleFilters.map(option =>
              <option key={option} value={option}>{FILTER_LABELS[option]}</option>)}
          </select>
        </label>
      </div>
      <div className="se-list-bar">
        <strong>{matching.length} de {summary.total} colaboradores</strong>
        <button type="button" className="se-outline" disabled={!matching.length}
          onClick={() => setSelectedIds(old =>
            toggleFilteredSelection(old, matching.map(row => row.id)))}>
          {matching.length > 0 && matching.every(row => selectedIds.has(row.id))
            ? "Desmarcar filtrados" : "Selecionar filtrados"}
        </button>
      </div>
      <div className="se-team-list" role="group" aria-label="Lista de colaboradores">
        {visible.length === 0 && <p className="se-empty-list">Nenhuma pessoa corresponde a este filtro.</p>}
        {visible.map(row => <label className="se-person-row" key={row.id}>
          <input type="checkbox" checked={selectedIds.has(row.id)}
            onChange={() => togglePerson(row.id)} />
          <span className="se-person-identity">
            <strong>{row.name}</strong>
            <small>{row.shift ? clockLabel(row.shift) +
              (row.shift.mealBreak ? " · Refeição " +
                row.shift.mealBreak.start + "–" + row.shift.mealBreak.end : " · Sem refeição") +
              " · " + (effectiveShiftMinutes(row.shift) / 60).toLocaleString("pt-PT") + "h efetivas" :
              ROW_LABELS[row.kind]}</small>
          </span>
          <span className={"se-person-status " + row.kind}>{ROW_LABELS[row.kind]}</span>
        </label>)}
      </div>
      <div className="se-pagination">
        <button type="button" className="se-outline" disabled={currentPage <= 1}
          onClick={() => setPage(currentPage - 1)}>← Anterior</button>
        <span>Página {currentPage} de {totalPages}</span>
        <button type="button" className="se-outline" disabled={currentPage >= totalPages}
          onClick={() => setPage(currentPage + 1)}>Seguinte →</button>
      </div>
      <div className="se-selection-bar" aria-live="polite">
        <div>
          <strong>{selectedIds.size} selecionado(s)</strong>
          <small>Seleção preservada ao mudar filtros e páginas.</small>
        </div>
        <div className="se-selection-actions">
          <button type="button" className="se-outline" disabled={!selectedIds.size}
            onClick={() => {setSelectedIds(new Set());setShowSelectedSummary(false);setTeamFilter("all");}}>
            Limpar
          </button>
          <button type="button" className="primary-button" disabled={!selectedIds.size}
            onClick={() => setShowSelectedSummary(previous => !previous)}>
            {showSelectedSummary ? "Ocultar seleção" : "Consultar seleção"}
          </button>
        </div>
      </div>
      {showSelectedSummary && <section className="se-selection-summary" aria-label="Resumo da seleção">
        <h3>Colaboradores selecionados ({selectedPeople.length})</h3>
        <div className="se-selected-names">{selectedPeople.map(row =>
          <span key={row.id}>{row.name} · {row.shift ? clockLabel(row.shift) : ROW_LABELS[row.kind]}</span>)}</div>
        <p>A seleção organiza a consulta. Não altera jornadas, disponibilidade nem registos oficiais.</p>
      </section>}
    </section>;
  }

  return <section className="se-home" aria-label="Calendário mensal de horários">
    <div className="se-heading">
      <div>
        <p className="section-kicker">Horários</p>
        <h2>Calendário mensal</h2>
        <p>Consulta a operação por dia. Seleciona uma data para abrir o resumo lateral.</p>
      </div>
      <button type="button" className="primary-button" onClick={() => onCreate(selectedDate ?? today)}>
        + Criar horário
      </button>
    </div>
    <div className="se-readonly-note" role="note">
      Base PR #41: sem horários oficiais carregados. Apenas a última proposta gerada nesta
      sessão pode aparecer no calendário; desaparece ao atualizar a página.
    </div>
    {!activeCount && <div className="se-empty-team">
      A equipa ainda não tem colaboradores ativos. Configura a equipa antes de gerar horários.
      <button type="button" className="se-outline" onClick={onConfigureTeam}>Configurar equipa</button>
    </div>}
    <div className="se-calendar-toolbar">
      <h3>{dateLabel(month, {month: "long", year: "numeric"})}</h3>
      <div className="se-month-actions">
        <button type="button" className="se-outline" aria-label="Mês anterior"
          onClick={() => browseMonth(-1)}>‹</button>
        <button type="button" className="se-outline" onClick={() => selectDate(today)}>Hoje</button>
        <button type="button" className="se-outline" aria-label="Mês seguinte"
          onClick={() => browseMonth(1)}>›</button>
      </div>
    </div>
    <div className={"se-calendar-layout " + (selectedDate ? "with-panel" : "")}>
      <div className="se-calendar-area">
        <div className="se-calendar-grid">
          {["Seg","Ter","Qua","Qui","Sex","Sáb","Dom"].map((label,index)=>
            <span className="se-weekday" key={index}>{label}</span>)}
          {dates.map(date => {
            const active = selectedDate === date;
            const state = dayKind(date, operatingCalendar, preview);
            const inMonth = date.slice(0,7) === currentMonth;
            const proposalCount = state === "proposal" && preview
              ? preview.assignments.filter(shift => shift.date === date).length : 0;
            return <button type="button" key={date}
              className={"se-day " + (active ? "selected " : "") +
                (inMonth ? "" : "outside ") + state + (date === today ? " today" : "")}
              aria-label={dateLabel(date,{day:"numeric",month:"long"}) + " · " +
                (state === "proposal" ? "proposta com " + proposalCount + " turnos" :
                 state === "closed" ? "operação encerrada" : "por planear")}
              aria-pressed={active}
              onClick={() => selectDate(date)}>
              <strong>{Number(date.slice(8,10))}</strong>
              <small>{state === "proposal" ? proposalCount + " turno(s)" :
                state === "closed" ? "Fechado" : "Por planear"}</small>
            </button>;
          })}
        </div>
        <div className="se-legend">
          <span><i className="proposal" /> Proposta da sessão</span>
          <span><i className="unplanned" /> Por planear</span>
          <span><i className="closed" /> Fechado</span>
        </div>
      </div>
      {selectedDate && <aside className="se-day-panel" aria-label="Resumo lateral do dia">
        <div className="se-panel-title">
          <div>
            <span>Resumo do dia</span>
            <h3>{dateLabel(selectedDate,{day:"numeric",month:"long"})}</h3>
          </div>
          <button type="button" className="se-outline se-close" aria-label="Fechar painel"
            onClick={() => setSelectedDate(null)}>×</button>
        </div>
        <div className={"se-panel-status " + (kind ?? "unplanned")}>{statusLabel}</div>
        <div className="se-panel-team">
          <h4>Resumo da equipa</h4>
          <div className="se-team-total">Equipa ativa: <strong>{summary.total}</strong></div>
          <div className="se-count-grid">
            <button type="button" className={filter==="assigned"?"active":""}
              onClick={()=>setTeamFilter(filter==="assigned"?"all":"assigned")}>
              <strong>{summary.assigned}</strong><span>Escalados</span>
            </button>
            <button type="button" className={filter==="available"?"active":""}
              onClick={()=>setTeamFilter(filter==="available"?"all":"available")}>
              <strong>{summary.available}</strong><span>Sem turno</span>
            </button>
            <button type="button" className={filter==="unavailable"?"active":""}
              onClick={()=>setTeamFilter(filter==="unavailable"?"all":"unavailable")}>
              <strong>{summary.unavailable}</strong><span>Sem disp.</span>
            </button>
          </div>
          {kind !== "proposal" && <p className="se-panel-hint">
            {kind === "closed" ? "Sem operação neste dia." :
            "Ainda não há proposta para este dia; não é possível classificar folgas ou ausências."}
          </p>}
          <label className="se-control">
            <span>Filtrar na página de gestão</span>
            <select value={filter} onChange={event => setTeamFilter(event.target.value as TeamFilter)}>
              {filters.map(value => <option key={value} value={value}>{FILTER_LABELS[value]}</option>)}
            </select>
          </label>
        </div>
        <button type="button" className="primary-button se-manage-action" onClick={() => {
          setScreen("manage");setSearch("");setPage(1);
          setSelectedIds(new Set());setShowSelectedSummary(false);
        }}>Gerir horário deste dia →</button>
      </aside>}
    </div>
  </section>;
}
