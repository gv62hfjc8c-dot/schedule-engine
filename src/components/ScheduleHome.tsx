import { useEffect, useMemo, useRef, useState } from "react";
import { supabaseAuthClient } from "../persistence/supabaseInstance";
import { accountingCycleForDate } from "../utils/accountingCycle28";
import ScheduleViews from "./ScheduleViews";
import DailyShiftDetails from "./DailyShiftDetails";
import OfficialApprovalPanel from "./OfficialApprovalPanel";
import { createSupabaseGeneratedScheduleRepository } from "../persistence/supabaseGeneratedScheduleRepository";
import {
  createHistoricalDayRepository,historicalFactsForDate,historicalDayTotals,
  type HistoricalDayOccurrence,
} from "../persistence/supabaseHistoricalDayRepository";
import type { StoredGeneratedSchedule, UnreadableGeneratedSchedule } from "../persistence/generatedScheduleRepository";
import { proposalsForDay, selectedProposalForDay, calendarProposalForDay, calendarArchiveOverview, unreadableArchiveAffectsDate, archiveDayState, previewFromStored, savedProposalLabel } from "../utils/savedScheduleView";
import type {
  OperatingCalendarConfiguration, Person, PersonAvailability,
} from "../types";
import {
  addCivilDays, dailyTeamRows, daySummary, effectiveShiftMinutes, filterDailyTeam,
  monthCalendarDates, monthStart, moveCalendarMonth, todayInTimeZone,
  toggleFilteredSelection, type DayTeamRow, type TeamFilter,
} from "../utils/monthlyScheduleView";

interface Props {
  people: Person[];
  availabilities: PersonAvailability[];
  operatingCalendar: OperatingCalendarConfiguration;
  operationTimeZone: string;
  cycleAnchorDate?: string;
  savedRevision: number;
  initialMonth?: string;
  onCreate(date?: string): void;
  onConfigureTeam(): void;
}
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
function effectiveHoursLabel(shift: NonNullable<DayTeamRow["shift"]>, timeZone: string): string {
  const minutes = effectiveShiftMinutes(shift,timeZone);
  return Number.isFinite(minutes)
    ? (minutes/60).toLocaleString("pt-PT") + "h efetivas"
    : "Duração não verificável no fuso";
}
const HISTORY_LABELS = {
  worked:"Trabalho realizado",day_off:"Folga registada",
  vacation:"Férias registadas",holiday:"Feriado registado",
} as const;
const PAGE_SIZE = 12;
const archive = supabaseAuthClient
  ? createSupabaseGeneratedScheduleRepository(supabaseAuthClient)
  : null;
const historicalArchive = supabaseAuthClient
  ? createHistoricalDayRepository(supabaseAuthClient) : null;

/**
 * One main entry screen, one quick-inspection side panel, one full-width
 * daily management screen. The UI is read-only while official approvals
 * and revisions are out of scope; never present simulated shifts as official.
 */
export default function ScheduleHome({
  people, availabilities, operatingCalendar, operationTimeZone, cycleAnchorDate, savedRevision, initialMonth,
  onCreate, onConfigureTeam,
}: Props) {
  const today = todayInTimeZone(operationTimeZone);
  const [month, setMonth] = useState(() => monthStart(initialMonth ?? today));
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [screen, setScreen] = useState<"month" | "manage" | "saved">("month");
  const [filter, setFilter] = useState<TeamFilter>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [showSelectedSummary, setShowSelectedSummary] = useState(false);
  const [showCalendarDetails,setShowCalendarDetails] = useState(false);
  const [savedRows, setSavedRows] = useState<StoredGeneratedSchedule[]>([]);
  const [unreadable, setUnreadable] = useState<UnreadableGeneratedSchedule[]>([]);
  const [historicalFacts,setHistoricalFacts]=useState<HistoricalDayOccurrence[]>([]);
  const [historyLoadState,setHistoryLoadState]=useState<"loading"|"ready"|"failed">("loading");
  const [historyError,setHistoryError]=useState<string|null>(null);
  // Null: inspect independent latest proposals per day. ID: one immutable
  // snapshot for the entire visible calendar; never stitch from other records.
  const [focusedProposalId, setFocusedProposalId] = useState<string | null>(null);
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
    setUnreadable([]);
    setLoadProblem(null);
    setLoadState("loading");
    if (!archive) {
      setLoadProblem("A ligação Supabase não está configurada.");
      setLoadState("failed");
      return;
    }
    const windowDates = monthCalendarDates(month);
    void archive.listBetweenDetailed(windowDates[0], windowDates[windowDates.length - 1])
      .then(result => {
        if (!current) return;
        setSavedRows(result.records);
        setUnreadable(result.unreadable);
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
    let active=true;
    setHistoryLoadState("loading");
    setHistoryError(null);
    setHistoricalFacts([]);
    if(!historicalArchive){
      setHistoryError("Ligação ao arquivo histórico indisponível.");
      setHistoryLoadState("failed");
      return;
    }
    const days=monthCalendarDates(month);
    void historicalArchive.listBetween(days[0],days[days.length-1])
      .then(result=>{
        if(!active)return;
        setHistoricalFacts(result);
        setHistoryLoadState("ready");
      }).catch(problem=>{
        if(!active)return;
        setHistoryError(problem instanceof Error?problem.message:
          "Não foi possível consultar o histórico factual.");
        setHistoryLoadState("failed");
      });
    return ()=>{active=false;};
  },[month,savedRevision,retryLoad]);

  useEffect(() => {
    if (initialMonth || loadState !== "ready" || savedRows.length > 0 ||
        unreadable.length > 0 || initialLookupDone.current || !archive) return;
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
  }, [initialMonth, loadState, savedRows, unreadable]);

  useEffect(() => {
    setSelectedIds(new Set());
    setShowSelectedSummary(false);
  }, [savedRevision]);

  const coreMonthDates = dates.filter(date=>date.slice(0,7)===month.slice(0,7));
  const archiveOverview = calendarArchiveOverview(savedRows,coreMonthDates,focusedProposalId);
  const calendarMetrics=useMemo(()=>{
    let proposals=0,history=0,unplanned=0,closed=0,unknown=0;
    for(const date of coreMonthDates){
      const state=archiveDayState({
        date,records:savedRows,unreadable,operation:operatingCalendar,
        focusedProposalId,loadState,
      });
      // Never claim an unknown source is an empty or unplanned day.
      if(state==="proposal"){proposals++;continue;}
      if(state==="unknown"||state==="loading"||state==="failed"||
        state==="outside-proposal"){unknown++;continue;}
      if(!focusedProposalId&&historyLoadState==="ready"&&
        historicalDayTotals(historicalFacts,date).total>0){history++;continue;}
      if(historyLoadState!=="ready"){unknown++;continue;}
      if(state==="closed")closed++;else unplanned++;
    }
    return {proposals,history,unplanned,closed,unknown};
  },[coreMonthDates.join("|"),savedRows,unreadable,operatingCalendar,
    focusedProposalId,loadState,historyLoadState,historicalFacts]);
  const focusedRecord = focusedProposalId ?
    savedRows.find(record=>record.id===focusedProposalId) ?? null : null;
  const proposals = selectedDate ? proposalsForDay(savedRows, selectedDate) : [];
  const stored = selectedDate ? (
    focusedProposalId
      ? calendarProposalForDay(savedRows,selectedDate,focusedProposalId)
      : selectedProposalForDay(savedRows,selectedDate,selectedProposalId)
  ) : null;
  const snapshotPeople = stored?.payload.people ?? people;
  const snapshotAvailability = stored?.payload.configuration.availabilities ?? availabilities;
  const snapshotOperation = stored?.payload.configuration.operatingCalendar ?? operatingCalendar;
  const preview = stored ? previewFromStored(stored) : null;

  const rows = useMemo(() => selectedDate ? dailyTeamRows({
    date: selectedDate, people: snapshotPeople, availabilities: snapshotAvailability,
    operation: snapshotOperation, preview,
  }) : [], [selectedDate, people, availabilities, operatingCalendar, stored]);
  const historicalDay=selectedDate?
    historicalFactsForDate(historicalFacts,selectedDate):[];
  const historicalTotals=selectedDate?
    historicalDayTotals(historicalFacts,selectedDate):null;
  const historicalDateAvailable=historyLoadState==="ready" &&
    historicalDay.length>0 && !stored && !focusedProposalId;
  const summary = useMemo(() => daySummary(rows), [rows]);
  const matching = useMemo(() =>
    filterDailyTeam(rows, filter, search, selectedIds),
    [rows, filter, search, selectedIds]);
  const totalPages = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visible = matching.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const selectedDayState = selectedDate ? archiveDayState({
    date:selectedDate,records:savedRows,unreadable,operation:operatingCalendar,
    focusedProposalId,loadState,selectedProposalId,
  }) : null;
  const kind = selectedDayState === "closed" || selectedDayState === "proposal"
    ? selectedDayState : "unplanned";
  const activeCycle = selectedDate && cycleAnchorDate ? accountingCycleForDate(selectedDate,cycleAnchorDate) : null;
  const unknownArchive = selectedDate ?
    unreadableArchiveAffectsDate(unreadable,selectedDate) : unreadable.length>0;
  const canInspectDay = selectedDayState === "proposal" ||
    selectedDayState === "unplanned" || selectedDayState === "closed";
  const statusLabel = historicalDateAvailable ? "Histórico factual · importado" :
    selectedDayState === "loading" ? "A recuperar arquivo" :
    selectedDayState === "failed" ? "Falha na consulta do arquivo" :
    selectedDayState === "unknown" ? "Arquivo incompleto · por confirmar" :
    selectedDayState === "outside-proposal" ? "Fora da proposta selecionada" :
    selectedDayState === "closed" ? "Operação encerrada" :
    selectedDayState === "proposal" ? "Proposta guardada · não aprovada" :
    "Ainda por planear";

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
  /** Stay on a known month so changing days never masquerades as loaded data. */
  function navigateDaily(offset:number) {
    if(!selectedDate)return;
    const next=addCivilDays(selectedDate,offset);
    if(monthStart(next)!==month)return;
    setSelectedDate(next);
    setSelectedProposalId(null);
    setFilter("all");
    setSearch("");
    setPage(1);
    setSelectedIds(new Set());
    setShowSelectedSummary(false);
  }
  const dailyNavigator=(date:string)=>(
    <nav className="se-daily-navigator" aria-label="Navegação entre dias">
      <button type="button" className="se-outline" aria-label="Dia anterior"
        disabled={monthStart(addCivilDays(date,-1))!==month}
        onClick={()=>navigateDaily(-1)}>← Anterior</button>
      <span className="se-daily-navigator-date">
        {dateLabel(date,{weekday:"short",day:"numeric",month:"short"})}
      </span>
      <button type="button" className="se-outline" aria-label="Dia seguinte"
        disabled={monthStart(addCivilDays(date,1))!==month}
        onClick={()=>navigateDaily(1)}>Seguinte →</button>
    </nav>
  );
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
  const currentMonth = month.slice(0, 7);
  const activeCount = people.filter(p => p.active).length;
  const personName=(id:string)=>people.find(p=>p.id===id)?.name ?? id;

  if (screen === "saved" && stored) {
    return <section className="se-home" aria-label="Horário guardado">
      <div className="se-management-top">
        <button type="button" className="se-outline" onClick={() => setScreen("month")}>
          ← Voltar ao calendário
        </button>
        <span className="se-context">{import.meta.env.VITE_OFFICIAL_APPROVAL_READY==="true"
          ? "Proposta arquivada · consultar estado oficial"
          : "Proposta guardada · não aprovada"}</span>
      </div>
      <div className="se-readonly-note">
        Horário arquivado em {savedProposalLabel(stored)}. A vista utiliza os turnos
        e os nomes originais da geração e não executa novamente o motor.
      </div>
      <OfficialApprovalPanel proposal={stored}/>
      <ScheduleViews
        assignments={stored.payload.shifts}
        people={stored.payload.people}
        startDate={stored.startDate}
        endDate={stored.endDate}
        storageState="saved"
        sourceLabel="Horário guardado"
      />
    </section>;
  }

  if (screen === "manage" && selectedDate && historicalDateAvailable) {
    return <section className="se-home se-management" aria-label="Consulta do histórico factual">
      <div className="se-daily-topbar">
        <button type="button" className="se-outline" onClick={()=>setScreen("month")}>
          ← Calendário mensal
        </button>
        {dailyNavigator(selectedDate)}
      </div>
      <div className="se-heading">
        <div>
          <p className="section-kicker">Histórico factual importado</p>
          <h2>{dateLabel(selectedDate,{weekday:"long",day:"numeric",month:"long",year:"numeric"})}</h2>
          <p>Registos históricos da fonte original. Não são propostas nem aprovações oficiais.</p>
        </div>
      </div>
      <div className="se-manage-stats">
        <div><strong>{historicalTotals?.worked??0}</strong><span>Trabalharam</span></div>
        <div><strong>{historicalTotals?.dayOff??0}</strong><span>Folgas</span></div>
        <div><strong>{historicalTotals?.vacation??0}</strong><span>Férias</span></div>
        <div><strong>{historicalTotals?.holiday??0}</strong><span>Feriados</span></div>
      </div>
      <div className="se-team-list" aria-label="Ocorrências históricas">
        {historicalDay.map(fact=> <div className="se-person-row se-daily-person-card"
          key={fact.sourceId+"|"+fact.personId}>
          <span className="se-person-identity">
            <strong>{personName(fact.personId)}</strong>
            {fact.shifts.map(shift=><DailyShiftDetails key={shift.date}
              shift={shift} effectiveHours={effectiveHoursLabel(shift,operationTimeZone)}/>)}
            <small>Fonte: {fact.sourceLabel}</small>
          </span>
          <span className="se-person-status">{HISTORY_LABELS[fact.type]}</span>
        </div>)}
      </div>
      <div className="se-readonly-note">
        A ausência de um colaborador nesta lista não equivale a folga.
        O histórico não altera o planeamento nem as propostas guardadas.
      </div>
    </section>;
  }

  if (screen === "manage" && selectedDate && canInspectDay) {
    const selectedPeople = rows.filter(row => selectedIds.has(row.id));
    return <section className="se-home se-management" aria-label="Gestão diária">
      <header className="se-daily-management-header">
        <div className="se-daily-management-heading">
          <button type="button" className="se-outline" onClick={() => {
            setScreen("month");
            setShowSelectedSummary(false);
          }}>← Calendário mensal</button>
          <div>
            <p className="section-kicker">Horários / Gestão diária</p>
            <h2>{dateLabel(selectedDate, {weekday: "long", day: "numeric", month: "long", year: "numeric"})}</h2>
            <p className="se-daily-status-line">{statusLabel}</p>
          </div>
        </div>
        <div className="se-daily-management-actions">
          {dailyNavigator(selectedDate)}
          <button type="button" className="primary-button"
            onClick={() => onCreate(selectedDate)}>Gerar proposta para este dia</button>
        </div>
      </header>
      {proposals.length>1 && <div className="se-daily-versions">
        <label className="se-control">
          <span>Versão da proposta a consultar</span>
          <select value={stored?.id??""} onChange={event=>{
            setSelectedProposalId(event.target.value);
            setSelectedIds(new Set());
            setShowSelectedSummary(false);
          }}>
            {proposals.map((item,index)=><option key={item.id} value={item.id}>
              {index===0?"Mais recente":"Anterior"} · {savedProposalLabel(item)}
            </option>)}
          </select>
        </label>
        <small>A troca de versão não altera nenhuma proposta arquivada.</small>
      </div>}
      {loadState !== "ready" && <p className="generator-issue" role="alert">Os dados ainda não foram confirmados pelo servidor.</p>}
      <details className="se-daily-safety-note">
        <summary>Informação sobre esta consulta</summary>
        <div className="se-readonly-note" role="note">
        {kind === "proposal"
          ? "Estás a consultar o horário tal como foi guardado no Supabase. É uma proposta, não uma escala oficialmente aprovada."
          : kind === "closed"
            ? "A operação está encerrada neste dia. Não existem turnos para gerir."
            : "Não existe uma proposta guardada para este dia. Não é possível inferir folgas ou ausências a partir desta situação."}
        {" "}A edição e a aprovação oficiais ainda não estão disponíveis nesta interface.
        </div>
      </details>
      <div className="se-manage-stats se-daily-compact-stats" aria-label="Resumo da equipa neste dia">
        <div><strong>{summary.total}</strong><span>Equipa ativa</span></div>
        <div><strong>{kind==="proposal"?summary.assigned:"—"}</strong><span>Escalados (proposta)</span></div>
        <div><strong>{kind==="proposal"?summary.available:"—"}</strong><span>Disponíveis sem turno</span></div>
        <div><strong>{kind==="proposal"?summary.unavailable:"—"}</strong><span>Sem disponibilidade</span></div>
        <div><strong>{summary.unplanned}</strong><span>Por planear</span></div>
      </div>
      <div className="se-daily-roster-heading">
        <div>
          <h3>Colaboradores</h3>
          <p>Consulta os turnos e compara pessoas sem modificar a proposta.</p>
        </div>
        <strong>{matching.length} de {summary.total} colaboradores</strong>
      </div>
      <div className="se-daily-filter-bar">
        <label className="se-control se-daily-search">
          <span>Pesquisar colaborador</span>
          <input type="search" value={search} placeholder="Pesquisar pelo nome…"
            onChange={event => {setSearch(event.target.value);setPage(1);}} />
        </label>
        <div className="se-daily-quick-filters" role="group" aria-label="Filtros rápidos">
          {(["all","assigned","available","unavailable"] as TeamFilter[]).map(option=>
            <button key={option} type="button" className={"se-daily-filter-button"+(filter===option?" active":"")}
              aria-pressed={filter===option} onClick={()=>setTeamFilter(option)}>
              {option==="all"?"Toda a equipa":option==="assigned"?"Escalados":
                option==="available"?"Disponíveis sem turno":"Indisponíveis"}
            </button>)}
        </div>
        <label className="se-control se-daily-more-filters">
          <span>Outros filtros</span>
          <select aria-label="Mais filtros" value={filter==="unplanned"||filter==="selected"?filter:""}
            onChange={event=>{if(event.target.value)setTeamFilter(event.target.value as TeamFilter);}}>
            <option value="">Mais filtros</option>
            <option value="unplanned">{FILTER_LABELS.unplanned}</option>
            <option value="selected">{FILTER_LABELS.selected}</option>
          </select>
        </label>
      </div>
      <div className="se-list-bar se-daily-list-bar">
        <strong>Seleção da equipa</strong>
        <button type="button" className="se-outline" disabled={!matching.length}
          onClick={() => setSelectedIds(old =>
            toggleFilteredSelection(old, matching.map(row => row.id)))}>
          {matching.length > 0 && matching.every(row => selectedIds.has(row.id))
            ? "Desmarcar filtrados" : "Selecionar filtrados"}
        </button>
      </div>
      <div className="se-team-list se-daily-team-list se-daily-roster" role="group" aria-label="Lista de colaboradores">
        {visible.length === 0 && <p className="se-empty-list">Nenhuma pessoa corresponde a este filtro.</p>}
        {visible.map(row => <label className="se-person-row se-daily-person-card se-daily-roster-row" key={row.id}>
          <input type="checkbox" checked={selectedIds.has(row.id)}
            onChange={() => togglePerson(row.id)} />
          <span className="se-person-identity">
            <strong>{row.name}</strong>
            <DailyShiftDetails shift={row.shift}
              effectiveHours={row.shift?
                effectiveHoursLabel(row.shift,stored?.timeZone??operationTimeZone):undefined}
              emptyLabel={ROW_LABELS[row.kind]}/>
          </span>
          <span className={"se-person-status " + row.kind}>{ROW_LABELS[row.kind]}</span>
        </label>)}
      </div>
      {totalPages>1&&<div className="se-pagination">
        <button type="button" className="se-outline" disabled={currentPage <= 1}
          onClick={() => setPage(currentPage - 1)}>← Anterior</button>
        <span>Página {currentPage} de {totalPages}</span>
        <button type="button" className="se-outline" disabled={currentPage >= totalPages}
          onClick={() => setPage(currentPage + 1)}>Seguinte →</button>
      </div>}
      {selectedIds.size>0&&<div className="se-selection-bar se-daily-selection-bar" aria-live="polite">
        <div>
          <strong>{selectedIds.size} selecionado(s)</strong>
          <small>Seleção preservada ao mudar filtros e páginas · apenas consulta.</small>
        </div>
        <div className="se-selection-actions">
          <button type="button" className="se-outline" disabled={!selectedIds.size}
            onClick={() => {setSelectedIds(new Set());setShowSelectedSummary(false);setTeamFilter("all");}}>
            Limpar
          </button>
          <button type="button" className="primary-button" disabled={!selectedIds.size}
            onClick={() => setShowSelectedSummary(previous => !previous)}>
            {showSelectedSummary ? "Ocultar comparação" : "Comparar horários"}
          </button>
        </div>
      </div>}
      {showSelectedSummary && selectedIds.size>0 && <section className="se-selection-summary se-daily-comparison" aria-label="Comparação de colaboradores">
        <div className="se-daily-comparison-heading">
          <div>
            <h3>Comparação de colaboradores ({selectedPeople.length})</h3>
            <p>Turnos e disponibilidade da versão selecionada, lado a lado.</p>
          </div>
          <button type="button" className="se-outline" onClick={()=>setShowSelectedSummary(false)}>
            Fechar comparação
          </button>
        </div>
        <div className="se-daily-comparison-grid">
          {selectedPeople.map(row=><article className="se-daily-comparison-card" key={row.id}>
            <strong>{row.name}</strong>
            <span className={"se-person-status "+row.kind}>{ROW_LABELS[row.kind]}</span>
            <DailyShiftDetails shift={row.shift}
              effectiveHours={row.shift?
                effectiveHoursLabel(row.shift,stored?.timeZone??operationTimeZone):undefined}
              emptyLabel={ROW_LABELS[row.kind]}/>
          </article>)}
        </div>
        <p>Comparação apenas de leitura. Não altera turnos, disponibilidades ou registos oficiais.</p>
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
    <div className="se-calendar-help">
      <span>São propostas, não escalas oficialmente aprovadas.
        O histórico factual é apresentado em separado.</span>
      <button type="button" className="se-calendar-more"
        aria-expanded={showCalendarDetails} aria-controls="calendar-explanations"
        onClick={()=>setShowCalendarDetails(value=>!value)}>
        {showCalendarDetails?"Ocultar detalhes":"Informação do calendário"}
      </button>
    </div>
    <div id="calendar-explanations" className="se-calendar-explanations"
      hidden={!showCalendarDetails}>
      <p>Os dias podem apresentar propostas, histórico factual ou ausência de planeamento.
        Uma proposta não representa aprovação oficial nem confirma que todo o mês foi validado.</p>
      <p>As ocorrências históricas são apresentadas apenas quando existe evidência importada.
        Um dia sem registo não prova uma folga.</p>
    </div>
    {loadState === "ready" && !focusedProposalId &&
      (archiveOverview.mixedSources || archiveOverview.overlappingDays>0) &&
      <div className="se-calendar-context" role="note">
        <span className="se-calendar-context-icon" aria-hidden="true">i</span>
        <div>
          <strong>Panorama de propostas independentes</strong>
          <p>
            {archiveOverview.mixedSources &&
              `${archiveOverview.sourceIds.length} propostas diferentes neste mês. `}
            {archiveOverview.overlappingDays>0 &&
              `${archiveOverview.overlappingDays} dia(s) com propostas sobrepostas. `}
            O panorama não constitui um horário mensal validado em conjunto.
            Seleciona uma data para consultar a origem e a versão apresentada.
          </p>
        </div>
      </div>}
    {loadState === "ready" && focusedProposalId && <div className="se-readonly-note" role="note">
      <strong>Vista de uma única proposta.</strong>{" "}
      {focusedRecord
        ? "Apenas os dias do horário de " + focusedRecord.startDate + " a " + focusedRecord.endDate + " estão apresentados."
        : "A proposta selecionada não abrange o mês consultado."}
      {" "}Datas não abrangidas não significam folgas ou ausência de planeamento.
      <button type="button" className="se-outline"
        onClick={()=>{setFocusedProposalId(null);setSelectedProposalId(null);}}>
        Voltar ao panorama de propostas
      </button>
    </div>}
    {loadState === "ready" && unreadable.length>0 && <div className="se-readonly-note" role="alert">
      <strong>Arquivo parcialmente ilegível: {unreadable.length} registo(s).</strong>{" "}
      As propostas válidas continuam disponíveis, mas não é possível confirmar
      que os restantes dias não têm horários guardados. Os registos incompatíveis
      não são apresentados como válidos.
      <button type="button" className="se-outline"
        onClick={()=>setRetryLoad(value=>value+1)}>Recarregar arquivo</button>
    </div>}
    {historyLoadState === "failed" && <div className="se-readonly-note" role="alert">
      O histórico factual não pôde ser carregado: {historyError}
      <button type="button" className="se-outline"
        onClick={()=>setRetryLoad(value=>value+1)}>Repetir consulta histórica</button>
    </div>}
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
      <div className="se-calendar-period">
        <span className="se-calendar-period-kicker">Vista mensal</span>
        <h3>{dateLabel(month, {month: "long", year: "numeric"})}</h3>
      </div>
      <div className="se-month-actions">
        <button type="button" className="se-outline" aria-label="Mês anterior"
          onClick={() => browseMonth(-1)}>‹</button>
        <button type="button" className="se-outline" onClick={() => selectDate(today)}>Hoje</button>
        <button type="button" className="se-outline" aria-label="Mês seguinte"
          onClick={() => browseMonth(1)}>›</button>
      </div>
    </div>
    <div className="se-calendar-metrics" aria-label="Resumo do mês">
      <div><strong>{calendarMetrics.proposals}</strong><span>Dias com proposta</span></div>
      <div><strong>{calendarMetrics.history}</strong><span>Dias com histórico</span></div>
      <div><strong>{calendarMetrics.unplanned}</strong><span>Por planear</span></div>
      <div><strong>{calendarMetrics.closed}</strong><span>Encerrados</span></div>
      {calendarMetrics.unknown>0&&<div className="se-calendar-unknown">
        <strong>{calendarMetrics.unknown}</strong><span>Por confirmar</span>
      </div>}
    </div>
    <div className={"se-calendar-layout " + (selectedDate ? "with-panel" : "")}>
      <div className="se-calendar-area">
        <div className="se-calendar-grid">
          {["Seg","Ter","Qua","Qui","Sex","Sáb","Dom"].map((label,index)=>
            <span className="se-weekday" key={index}>{label}</span>)}
          {dates.map(date => {
            const active = selectedDate === date;
            const latest = calendarProposalForDay(savedRows,date,focusedProposalId);
            const baseState = archiveDayState({
              date,records:savedRows,unreadable,operation:operatingCalendar,
              focusedProposalId,loadState,
            });
            const historicalCount=historyLoadState==="ready" && !focusedProposalId
              ? historicalDayTotals(historicalFacts,date).total : 0;
            const state=historicalCount>0 && baseState!=="proposal" &&
              baseState!=="loading" && baseState!=="failed" &&
              baseState!=="unknown" ? "history" : baseState;
            const inMonth = date.slice(0,7) === currentMonth;
            const proposalCount = latest && state === "proposal"
              ? latest.payload.shifts.filter(shift => shift.date === date).length : 0;
            return <button type="button" key={date}
              className={"se-day " + (active ? "selected " : "") +
                (inMonth ? "" : "outside ") + state + (date === today ? " today" : "")}
              title={state==="history"?"Histórico factual importado ("+historicalCount+" pessoas)":latest ? "Proposta " + latest.id + " · guardada em " + savedProposalLabel(latest) : undefined}
              aria-label={dateLabel(date,{day:"numeric",month:"long"}) + " · " +
                (state === "history" ? "histórico factual de "+historicalCount+" pessoas" :
                 state === "proposal" ? "proposta guardada com " + proposalCount + " turnos" :
                 state === "closed" ? "operação encerrada" :
                 state === "loading" ? "a carregar" :
                  state === "failed" ? "arquivo indisponível" :
                 state === "unknown" ? "arquivo por confirmar" :
                 state === "outside-proposal" ? "fora da proposta selecionada" : "por planear")}
              aria-pressed={active}
              onClick={() => selectDate(date)}>
              <span className="se-day-top"><strong>{Number(date.slice(8,10))}</strong>
                {state==="proposal"&&<span className="se-day-indicator proposal" aria-hidden="true"/>}
                {state==="history"&&<span className="se-day-indicator history" aria-hidden="true"/>}
              </span>
              <small>{state === "history" ? "Histórico · "+historicalCount :
                state === "proposal" ? proposalCount + " turno(s)" :
                state === "closed" ? "Fechado" :
                state === "loading" ? "A carregar" :
                state === "failed" ? "Erro de leitura" :
                state === "unknown" ? "Por confirmar" :
                state === "outside-proposal" ? "Fora da proposta" : "Por planear"}</small>
            </button>;
          })}
        </div>
        <div className="se-legend">
          <span><i className="proposal" /> Proposta guardada</span>
          <span><i className="history" /> Histórico factual</span>
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
        <div className={"se-panel-status " + (selectedDayState ?? "unplanned")}>{statusLabel}</div>
        {activeCycle && <div className="se-readonly-note">
          <strong>Ciclo de 28 dias</strong>
          <p>{activeCycle.startDate} a {activeCycle.endDate} · semana {activeCycle.week}/4</p>
          <small>Referência contabilística; não representa aprovação nem geração automática de 28 dias.</small>
        </div>}
        {historicalDateAvailable && <div className="se-history-summary">
          <h4>Registos históricos importados</h4>
          <p>{historicalTotals?.total} colaborador(es) com ocorrência registada.</p>
          <div className="se-count-grid">
            <div><strong>{historicalTotals?.worked}</strong><span>Trabalho</span></div>
            <div><strong>{historicalTotals?.dayOff}</strong><span>Folgas</span></div>
            <div><strong>{historicalTotals?.vacation}</strong><span>Férias</span></div>
            <div><strong>{historicalTotals?.holiday}</strong><span>Feriados</span></div>
          </div>
          <p className="se-panel-hint">
            Fonte factual. Não é proposta gerada nem horário oficialmente aprovado.
            As pessoas ausentes desta lista não são consideradas de folga.
          </p>
          <button type="button" className="se-outline"
            onClick={()=>setScreen("manage")}>Consultar registos deste dia</button>
        </div>}
        {stored && <div className="se-archive-meta">
          <span>Guardada em {savedProposalLabel(stored)} · {stored.startDate} a {stored.endDate}</span>
          {proposals.length > 1 && <label className="se-control">
            <span>Versão guardada ({proposals.length})</span>
            <select value={stored.id} onChange={event => {
              setSelectedProposalId(event.target.value);
              setFocusedProposalId(event.target.value);
              setSelectedIds(new Set());
            }}>
              {proposals.map((item, index) => <option key={item.id} value={item.id}>
                {index===0?"Mais recente":"Anterior"} · {savedProposalLabel(item)}
              </option>)}
            </select>
          </label>}
        </div>}
        {stored && !focusedProposalId && <button type="button" className="se-outline"
          onClick={()=>{setFocusedProposalId(stored.id);setSelectedProposalId(stored.id);}}>
          Ver apenas esta proposta no calendário
        </button>}
        {stored && <button type="button" className="se-outline" onClick={() => setScreen("saved")}>
          Consultar horário completo →
        </button>}
        {!historicalDateAvailable && canInspectDay ? <div className="se-panel-team">
          <h4>Resumo da equipa</h4>
          <div className="se-team-total">Equipa ativa: <strong>{summary.total}</strong></div>
          <div className="se-count-grid">
            <button type="button" className={filter==="assigned"?"active":""}
              onClick={()=>setTeamFilter(filter==="assigned"?"all":"assigned")}>
              <strong>{kind==="proposal"?summary.assigned:"—"}</strong><span>Escalados</span>
            </button>
            <button type="button" className={filter==="available"?"active":""}
              onClick={()=>setTeamFilter(filter==="available"?"all":"available")}>
              <strong>{kind==="proposal"?summary.available:"—"}</strong><span>Sem turno</span>
            </button>
            <button type="button" className={filter==="unavailable"?"active":""}
              onClick={()=>setTeamFilter(filter==="unavailable"?"all":"unavailable")}>
              <strong>{kind==="proposal"?summary.unavailable:"—"}</strong><span>Sem disp.</span>
            </button>
          </div>
          {kind !== "proposal" && <p className="se-panel-hint">
            {kind === "closed" ? "Sem operação neste dia." :
            unknownArchive ? "O arquivo contém registos ilegíveis. Não é possível confirmar o estado deste dia." :
            focusedProposalId ? "Este dia está fora da proposta selecionada; consulta o panorama para procurar outras propostas." :
            "Ainda não há proposta para este dia; não é possível classificar folgas ou ausências."}
          </p>}
          <label className="se-control">
            <span>Filtrar na página de gestão</span>
            <select value={filter} onChange={event => setTeamFilter(event.target.value as TeamFilter)}>
              {filters.map(value => <option key={value} value={value}>{FILTER_LABELS[value]}</option>)}
            </select>
          </label>
        </div> : !historicalDateAvailable && <div className="se-readonly-note" role="status">
          O estado deste dia não está confirmado. Não serão apresentados
          indicadores de equipa ou ausência de turnos como se fossem definitivos.
          {selectedDayState === "outside-proposal"
            ? " Volta ao panorama para procurar outros horários guardados."
            : " Consulta o aviso do arquivo antes de gerir este dia."}
        </div>}
        <button type="button" className="primary-button se-manage-action"
          disabled={!canInspectDay && !historicalDateAvailable}
          onClick={() => {
            setScreen("manage");setSearch("");setPage(1);
            setSelectedIds(new Set());setShowSelectedSummary(false);
          }}>{historicalDateAvailable?"Consultar histórico deste dia →":"Gerir horário deste dia →"}</button>
      </aside>}
    </div>
  </section>;
}
