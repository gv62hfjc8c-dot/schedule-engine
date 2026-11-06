import { useEffect, useMemo, useRef, useState } from "react";
import { supabaseAuthClient } from "../persistence/supabaseInstance";
import { createSupabaseGeneratedScheduleRepository } from "../persistence/supabaseGeneratedScheduleRepository";
import type { StoredGeneratedSchedule } from "../persistence/generatedScheduleRepository";
import { proposalsForDay, selectedProposalForDay, previewFromStored, savedProposalLabel } from "../utils/savedScheduleView";
import type {
  OperatingCalendarConfiguration, Person, PersonAvailability,
} from "../types";
import {
  dayKind, dailyTeamRows, daySummary, effectiveShiftMinutes, filterDailyTeam,
  monthCalendarDates, monthStart, moveCalendarMonth, todayInTimeZone,
  toggleFilteredSelection, type DayTeamRow, type TeamFilter,
} from "../utils/monthlyScheduleView";

interface Props {
  people: Person[];
  availabilities: PersonAvailability[];
  operatingCalendar: OperatingCalendarConfiguration;
  savedRevision: number;
  initialMonth?: string;
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
const archive = supabaseAuthClient
  ? createSupabaseGeneratedScheduleRepository(supabaseAuthClient)
  : null;

/**
 * One main entry screen, one quick-inspection side panel, one full-width
 * daily management screen. The UI is read-only while official approvals
 * and revisions are out of scope; never present simulated shifts as official.
 */
export default function ScheduleHome({
  people, availabilities, operatingCalendar, savedRevision, initialMonth,
  onCreate, onConfigureTeam,
}: Props) {
  const today = todayInTimeZone(ZONE);
  const [month, setMonth] = useState(() => monthStart(initialMonth ?? today));
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [screen, setScreen] = useState<"month" | "manage">("month");
  const [filter, setFilter] = useState<TeamFilter>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [showSelectedSummary, setShowSelectedSummary] = useState(false);
  const [savedRows, setSavedRows] = useState<StoredGeneratedSchedule[]>([]);
  const [loadState, setLoadState] = useState<"loading"|"ready"|"failed">("loading");
  const [loadProblem, setLoadProblem] = useState<string | null>(null);
  const [retryLoad, setRetryLoad] = useState(0);
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);
  const initialLookupDone = useRef(false);
  const manuallyNavigated = useRef(false);
  const dates = useMemo(() => monthCalendarDates(month), [month]);

  useEffect(() => {
    let current = true;
    setSavedRows([]);
    setLoadProblem(null);
    setLoadState("loading");
    if (!archive) {
      setLoadProblem("A ligação Supabase não está configurada.");
      setLoadState("failed");
      return;
    }
    const windowDates = monthCalendarDates(month);
    void archive.listBetween(windowDates[0], windowDates[windowDates.length - 1])
      .then(records => {
        if (!current) return;
        setSavedRows(records);
        setLoadState("ready");
      }).catch(problem => {
        if (!current) return;
        setLoadProblem(problem instanceof Error ? problem.message :
          "Não foi possível recuperar os horários guardados.");
        setLoadState("failed");
      });
    return () => {current = false;};
  }, [month, savedRevision, retryLoad]);

  useEffect(() => {
    if (initialMonth || loadState !== "ready" || savedRows.length > 0 ||
        initialLookupDone.current || !archive) return;
    initialLookupDone.current = true;
    let active = true;
    void archive.latest().then(last => {
      if (active && !manuallyNavigated.current && last)
        setMonth(monthStart(last.startDate));
    }).catch(problem => {
      if (!active || manuallyNavigated.current) return;
      setLoadProblem(problem instanceof Error ? problem.message :
        "Não foi possível localizar o último horário guardado.");
      setLoadState("failed");
    });
    return () => {active = false;};
  }, [initialMonth, loadState, savedRows]);

  useEffect(() => {
    setSelectedIds(new Set());
    setShowSelectedSummary(false);
  }, [savedRevision]);

  const proposals = selectedDate ? proposalsForDay(savedRows, selectedDate) : [];
  const stored = selectedDate ? selectedProposalForDay(savedRows, selectedDate, selectedProposalId) : null;
  const snapshotPeople = stored?.payload.people ?? people;
  const snapshotAvailability = stored?.payload.configuration.availabilities ?? availabilities;
  const snapshotOperation = stored?.payload.configuration.operatingCalendar ?? operatingCalendar;
  const preview = stored ? previewFromStored(stored) : null;

  const rows = useMemo(() => selectedDate ? dailyTeamRows({
    date: selectedDate, people: snapshotPeople, availabilities: snapshotAvailability,
    operation: snapshotOperation, preview,
  }) : [], [selectedDate, people, availabilities, operatingCalendar, stored]);
  const summary = useMemo(() => daySummary(rows), [rows]);
  const matching = useMemo(() =>
    filterDailyTeam(rows, filter, search, selectedIds),
    [rows, filter, search, selectedIds]);
  const totalPages = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visible = matching.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const kind = selectedDate ? dayKind(selectedDate, snapshotOperation, preview) : null;
  const statusLabel = loadState !== "ready" ? "Estado por confirmar" :
    kind === "closed" ? "Operação encerrada" :
    kind === "proposal" ? "Proposta guardada · não aprovada" : "Ainda por planear";

  function browseMonth(offset: number) {
    manuallyNavigated.current = true;
    setMonth(previous => moveCalendarMonth(previous, offset));
    setSelectedDate(null);
    setFilter("all");
    setSearch("");
    setPage(1);
    setSelectedIds(new Set());
    setShowSelectedSummary(false);
    setSelectedProposalId(null);
  }

  function selectDate(date: string) {
    manuallyNavigated.current = true;
    const nextMonth = monthStart(date);
    if (nextMonth !== month) setMonth(nextMonth);
    setSelectedDate(date);
    setSelectedProposalId(null);
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
      {loadState !== "ready" && <p className="generator-issue" role="alert">Os dados ainda não foram confirmados pelo servidor.</p>}
      <div className="se-readonly-note" role="note">
        {kind === "proposal"
          ? "Estás a consultar o horário tal como foi guardado no Supabase. É uma proposta, não uma escala oficialmente aprovada."
          : kind === "closed"
            ? "A operação está encerrada neste dia. Não existem turnos para gerir."
            : "Não existe uma proposta guardada para este dia. Não é possível inferir folgas ou ausências a partir desta situação."}
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
      <button type="button" className="primary-button" onClick={() => onCreate(selectedDate ?? undefined)}>
        + Criar horário
      </button>
    </div>
    <div className="se-readonly-note" role="note">
      Os horários gerados e guardados são recuperados automaticamente do Supabase.
      São propostas, não escalas oficialmente aprovadas.
    </div>
    {loadState === "loading" && <div className="se-readonly-note" role="status">A recuperar horários guardados…</div>}
    {loadState === "failed" && <div className="se-readonly-note" role="alert">
      Não foi possível carregar os horários guardados: {loadProblem}
      <button type="button" className="se-outline" onClick={() => setRetryLoad(value=>value+1)}>Tentar novamente</button>
    </div>}
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
            const latest = selectedProposalForDay(savedRows, date, null);
            const state = loadState === "ready"
              ? dayKind(date, latest?.payload.configuration.operatingCalendar ?? operatingCalendar,
                  latest ? previewFromStored(latest) : null)
              : "loading";
            const inMonth = date.slice(0,7) === currentMonth;
            const proposalCount = latest && state === "proposal"
              ? latest.payload.shifts.filter(shift => shift.date === date).length : 0;
            return <button type="button" key={date}
              className={"se-day " + (active ? "selected " : "") +
                (inMonth ? "" : "outside ") + state + (date === today ? " today" : "")}
              aria-label={dateLabel(date,{day:"numeric",month:"long"}) + " · " +
                (state === "proposal" ? "proposta guardada com " + proposalCount + " turnos" :
                 state === "closed" ? "operação encerrada" : state === "loading" ? "a carregar" : "por planear")}
              aria-pressed={active}
              onClick={() => selectDate(date)}>
              <strong>{Number(date.slice(8,10))}</strong>
              <small>{state === "proposal" ? proposalCount + " turno(s)" :
                state === "closed" ? "Fechado" : state === "loading" ? "A carregar" : "Por planear"}</small>
            </button>;
          })}
        </div>
        <div className="se-legend">
          <span><i className="proposal" /> Proposta guardada</span>
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
        {stored && <div className="se-archive-meta">
          <span>Guardada em {savedProposalLabel(stored)} · {stored.startDate} a {stored.endDate}</span>
          {proposals.length > 1 && <label className="se-control">
            <span>Versão guardada ({proposals.length})</span>
            <select value={stored.id} onChange={event => {setSelectedProposalId(event.target.value);setSelectedIds(new Set());}}>
              {proposals.map((item, index) => <option key={item.id} value={item.id}>
                {index===0?"Mais recente":"Anterior"} · {savedProposalLabel(item)}
              </option>)}
            </select>
          </label>}
        </div>}
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
