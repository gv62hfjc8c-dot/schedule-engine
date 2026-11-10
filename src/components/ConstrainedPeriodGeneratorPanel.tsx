import { useEffect, useRef, useState } from "react";
import type { GeneratedSchedulePayload, StoredGeneratedSchedule } from "../persistence/generatedScheduleRepository";
import { readGeneratorDate, saveGeneratorDate } from "./generatorUiPreferences";
import CalendarDateInput from "./CalendarDateInput";
import ScheduleViews from "./ScheduleViews";
import type {
  OperatingCalendarConfiguration,
  Person,
  PersonAvailability,
  PresenceConfiguration,
  WorkRulesConfiguration,
} from "../types";
import {
  generateConstrainedPeriodSchedule,
  type GenerateConstrainedPeriodResult,
} from "../utils/constrainedPeriodGenerator";
import { prepareExplicitEmptyContext } from "../utils/explicitEmptyContext";
import { readProtectedApprovedPeriods } from "../persistence/readApprovedPeriodProtection";
import { supabaseAuthClient } from "../persistence/supabaseInstance";
import { INITIAL_WORK_CONSTRAINTS } from "../utils/workConstraints";
import { MAX_CONSTRAINED_PERIOD_DAYS } from "../utils/constrainedPeriodGenerator";

import { parseCivilDays } from "../utils/generatorPeriodCapability";
import {
  stagePendingGeneratedProposal,
  loadPendingGeneratedProposal,
  acknowledgePendingGeneratedProposal,
  rawPendingGeneratedProposal,
  discardPendingGeneratedProposal,
} from "../utils/pendingGeneratedProposal";
import { todayInTimeZone } from "../utils/monthlyScheduleView";
import { weeklyPersonWorkSummary, formatWorkMinutes } from "../utils/weeklyWorkSummary";
import {reviseMealStart} from "../utils/mealBreakRevision";

export interface ConstrainedPeriodGeneratorPanelProps {
  people: Person[];
  availabilities: PersonAvailability[];
  operatingCalendar: OperatingCalendarConfiguration;
  workRules: WorkRulesConfiguration;
  presence: PresenceConfiguration;
  operationTimeZone: string;
  /** Authenticated Supabase UUID; browser outbox is strictly owner-scoped. */
  ownerId?: string | null;
  initialDate?: string;
  onSaveGenerated?(proposal: GeneratedSchedulePayload, proposalId: string): Promise<StoredGeneratedSchedule>;
  onBackToCalendar?(): void;
}

interface Snapshot extends ConstrainedPeriodGeneratorPanelProps {
  startDate: string;
  endDate: string;
  timeZone: string;
  confirmedNoExternalShifts: true;
  result: GenerateConstrainedPeriodResult;
}

const PREVIEW_MAX_NODES = 5_000;
const UI_MAX_PERIOD_DAYS = MAX_CONSTRAINED_PERIOD_DAYS;


function addCivilDays(date: string, amount: number): string {
  const utc = new Date(`${date}T00:00:00Z`);
  utc.setUTCDate(utc.getUTCDate() + amount);
  return utc.toISOString().slice(0, 10);
}

function weekMonday(date: string): string {
  const value = new Date(date + "T00:00:00Z");
  value.setUTCDate(value.getUTCDate() - (value.getUTCDay() + 6) % 7);
  return value.toISOString().slice(0, 10);
}

function displayDate(date: string): string {
  return new Intl.DateTimeFormat("pt-PT", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

function titleForStatus(status: GenerateConstrainedPeriodResult["status"]): string {
  switch (status) {
    case "generated":
      return "Solução completa neste cenário";
    case "incomplete":
      return "Sem solução encontrada nesta pesquisa";
    case "incomplete_context":
      return "Contexto exterior por confirmar";
    case "invalid_input":
      return "Configuração inválida";
    case "search_limit":
      return "Limite de pesquisa atingido";
  }
}

function dayStatus(status: string | null): string {
  switch (status) {
    case "generated": return "Turnos encontrados";
    case "closed": return "Fechado";
    case "invalid_input": return "Configuração inválida";
    case "insufficient_capacity": return "Capacidade insuficiente";
    case "not_found": return "Sem solução diária";
    case "search_limit": return "Pesquisa limitada";
    default: return "Não concluído";
  }
}

/**
 * Deliberately narrow read-only experiment:
 * - the app has configuration data, NOT a persisted approved roster;
 * - no empty external schedule is assumed by default;
 * - the user must explicitly declare no other shifts over the whole
 *   required period, including dates outside the chosen target;
 * - valid proposals are archived, never approved by the browser.
 *
 * This declaration only makes the result valid IN THAT SCENARIO.
 */
export default function ConstrainedPeriodGeneratorPanel({
  people,
  availabilities,
  operatingCalendar,
  workRules,
  presence,
  operationTimeZone,
  ownerId,
  initialDate,
  onSaveGenerated,
  onBackToCalendar,
}: ConstrainedPeriodGeneratorPanelProps) {
  const [workspaceView, setWorkspaceView] = useState<"settings" | "schedule">("settings");
  const [startDate, setStartDate] = useState(() => initialDate ?? readGeneratorDate("constrained:start", () => todayInTimeZone(operationTimeZone)));
  const [endDate, setEndDate] = useState(() => initialDate ?? readGeneratorDate("constrained:end", () => addCivilDays(todayInTimeZone(operationTimeZone), 6)));
  const timeZone=operationTimeZone;
  const [confirmed, setConfirmed] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle"|"saving"|"saved"|"failed">("idle");
  const [saveProblem, setSaveProblem] = useState<string | null>(null);
  const [mealEdit,setMealEdit]=useState<{date:string;personId:string;start:string}|null>(null);
  const [mealIssue,setMealIssue]=useState<string|null>(null);
  const [showTechnicalDetails,setShowTechnicalDetails]=useState(false);
  const [retryPayload, setRetryPayload] = useState<{payload: GeneratedSchedulePayload; id: string} | null>(null);
  const saveAttempt = useRef(0);

  function recoverPendingProposal(): void {
    if(!ownerId)return;
    try{
      const existing=loadPendingGeneratedProposal(window.localStorage,ownerId);
      if(existing){
        setRetryPayload({payload:existing.payload,id:existing.id});
        setSaveState("failed");
        setSaveProblem("Foi recuperada uma tentativa de gravação ainda sem confirmação. "+
          "Repete o envio com o mesmo identificador; não será criado um horário duplicado.");
      }
    }catch(problem){
      setSaveState("failed");
      setSaveProblem(problem instanceof Error?problem.message:
        "A recuperação local está indisponível.");
    }
  }

  useEffect(() => {
    // An edited roster/configuration requires a fresh, explicit declaration.
    setConfirmed(false);
    setSnapshot(null);
    setWorkspaceView("settings");
    saveAttempt.current++;
    setSaveState("idle");
    setSaveProblem(null);
    setRetryPayload(null);
    setMealEdit(null);
    setMealIssue(null);
    recoverPendingProposal();
  }, [people, availabilities, operatingCalendar, workRules, presence,
      operationTimeZone, ownerId]);

  // A generated result is not guaranteed persisted until the server confirms.
  // Protect a browser reload/close during the in-flight write.
  useEffect(() => {
    if (saveState !== "saving") return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saveState]);

  const effectiveConstraints = { ...INITIAL_WORK_CONSTRAINTS,
    maximumDailyEffectiveMinutes: workRules.maximumDailyEffectiveMinutes ?? 480,
  };

  const context = prepareExplicitEmptyContext({
    startDate,
    endDate,
    timeZone,
    rules: effectiveConstraints,
    confirmedNoExternalShifts: confirmed,
  });

  const sameInputs = snapshot !== null && confirmed &&
    snapshot.startDate === startDate &&
    snapshot.endDate === endDate &&
    snapshot.timeZone === timeZone &&
    snapshot.people === people &&
    snapshot.availabilities === availabilities &&
    snapshot.operatingCalendar === operatingCalendar &&
    snapshot.workRules === workRules &&
    snapshot.presence === presence;

  const result = sameInputs ? snapshot.result : null;
  const stale = snapshot !== null && !sameInputs;
  const periodDays=parseCivilDays(startDate,endDate);
  const periodIsValid=periodDays!==null && periodDays>0 && periodDays<=UI_MAX_PERIOD_DAYS;
  const workflowStep=workspaceView==="schedule"&&result?.status==="generated" ? 3 :
    result || error ? 2 : 1;
  const readinessLabel= !periodIsValid ? "Corrige o período" :
    !confirmed ? "Confirma o contexto exterior" :
    context.status!=="ready" ? "Verifica as condições" : "Pronto para simular";

  function selectDuration(days:7|14|28) {
    if(parseCivilDays(startDate,startDate)!==1)return;
    const end=addCivilDays(startDate,days-1);
    setEndDate(end);
    saveGeneratorDate("constrained:end",end);
    resetScenario();
  }

  function resetScenario() {
    setWorkspaceView("settings");
    setConfirmed(false);
    setSnapshot(null);
    setError(null);
    saveAttempt.current++;
    setSaveState("idle");
    setSaveProblem(null);
    setRetryPayload(null);
    setMealEdit(null);
    setMealIssue(null);
    recoverPendingProposal();
  }

  function persistProposal(payload: GeneratedSchedulePayload, id: string) {
    const token = ++saveAttempt.current;
    setRetryPayload({payload,id});
    if(!ownerId){
      setSaveState("failed");
      setSaveProblem("Não foi possível identificar a conta da proposta.");
      return;
    }
    try{
      // Must complete synchronously BEFORE sending to Supabase, otherwise
      // forced tab closure can permanently lose a generated proposal.
      stagePendingGeneratedProposal(window.localStorage,{ownerId,id,payload});
    }catch(problem){
      setSaveState("failed");
      setSaveProblem(problem instanceof Error?problem.message:
        "Não foi possível garantir a cópia de recuperação no navegador.");
      return;
    }
    setSaveState("saving");
    setSaveProblem(null);
    if (!onSaveGenerated) {
      setSaveState("failed");
      setSaveProblem("O serviço de arquivo não está disponível.");
      return;
    }
    void onSaveGenerated(payload,id).then(() => {
      // Even if another view was opened during the in-flight write, the
      // identical server-confirmed UUID must be removed from the outbox.
      // The server confirmation remains valid even if local cleanup fails.
      try{ acknowledgePendingGeneratedProposal(window.localStorage,ownerId,id); }
      catch{ /* Safe idempotent replay remains available on next load. */ }
      if (saveAttempt.current === token) {
        setSaveState("saved");
        setRetryPayload(null);
        // The archived copy is immutable: move preview to the newly confirmed
        // proposal only after the server acknowledges its own new UUID.
        setSnapshot(current=>current&&current.result.status==="generated" &&
          current.startDate===payload.startDate && current.endDate===payload.endDate
          ? {...current,result:{...current.result,
              assignments:structuredClone(payload.shifts)}} : current);
        setMealEdit(null);
        setMealIssue(null);
      }
    }).catch(problem => {
      if (saveAttempt.current === token) {
        setSaveState("failed");
        setSaveProblem(problem instanceof Error ? problem.message :
          "A base de dados não confirmou a gravação.");
      }
    });
  }

  function exportLocalRecovery():void {
    if(!ownerId)return;
    try{
      const raw=rawPendingGeneratedProposal(window.localStorage,ownerId);
      if(!raw)return;
      const url=URL.createObjectURL(new Blob([raw],{type:"application/json"}));
      const anchor=document.createElement("a");
      anchor.href=url;
      anchor.download="schedule-engine-proposta-pendente.json";
      anchor.click();
      window.setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(problem){
      setSaveProblem(problem instanceof Error?problem.message:
        "Não foi possível exportar a proposta pendente.");
    }
  }
  function discardLocalRecovery():void {
    if(!ownerId ||
      !window.confirm("Descartar a única cópia local desta tentativa? "+
        "A gravação remota pode ainda existir e não será eliminada. "+
        "Exporta uma cópia JSON primeiro se pretenderes guardar a proposta."))
      return;
    try{
      discardPendingGeneratedProposal(window.localStorage,ownerId);
      setRetryPayload(null);
      setSaveState("idle");
      setSaveProblem(null);
    }catch(problem){
      setSaveProblem(problem instanceof Error?problem.message:
        "Não foi possível libertar o arquivo local.");
    }
  }

  async function handleGenerate() {
    if(ownerId){
      try {
        const existing=loadPendingGeneratedProposal(window.localStorage,ownerId);
        if(existing){
          setRetryPayload({payload:existing.payload,id:existing.id});
          setSaveState("failed");
          setSaveProblem("Confirma primeiro a gravação anterior usando "+
            "'Tentar guardar novamente sem regenerar'.");
          return;
        }
      }catch(problem){
        setSaveState("failed");
        setSaveProblem(problem instanceof Error?problem.message:
          "A cópia de segurança local não pôde ser lida.");
        return;
      }
    }
    const days=parseCivilDays(startDate,endDate);
    if(days!==null && days>UI_MAX_PERIOD_DAYS){
      setError("O período não pode ultrapassar " + UI_MAX_PERIOD_DAYS +
        " dias. Seleciona um intervalo mais curto.");
      setSnapshot(null);
      setSaveState("idle");
      return;
    }
    saveAttempt.current++;
    setSaveState("idle");
    setSaveProblem(null);
    setRetryPayload(null);
    setSnapshot(null);
    setError(null);
    // Independent gate immediately before engine execution. This prevents
    // the UI from supplying a fabricated complete empty context.
    const prepared = prepareExplicitEmptyContext({
      startDate,
      endDate,
      timeZone,
      rules: effectiveConstraints,
      confirmedNoExternalShifts: confirmed,
    });
    if (prepared.status !== "ready" || !prepared.externalContext) {
      setError(prepared.issues.join(" ") ||
        "É necessária a confirmação do contexto exterior.");
      return;
    }
    try {
      // A declaration of no EXTERNAL shifts does not authorize overriding
      // approved dates INSIDE the target. Read the trusted ledger each time.
      if (!supabaseAuthClient || !ownerId ||
          supabaseAuthClient.user?.id !== ownerId) {
        setError("Não foi possível confirmar a conta para consultar horários aprovados.");
        return;
      }
      // The public UI can READ protected dates but cannot import approval
      // mutation modules. Missing ledger never certifies official completeness.
      const protection = await readProtectedApprovedPeriods(
        supabaseAuthClient, ownerId
      );
      const protectedApprovedPeriods = protection.periods;
      if (protectedApprovedPeriods.some(period =>
        period.startDate <= endDate && period.endDate >= startDate
      )) {
        setError("O período sobrepõe-se a um horário oficialmente aprovado. "+
          "A geração não pode alterá-lo; usa o fluxo de revisão oficial.");
        return;
      }
      const generated = generateConstrainedPeriodSchedule({
        startDate,
        endDate,
        timeZone,
        people,
        availabilities,
        operatingCalendar,
        workRules,
        presence,
        workConstraints: effectiveConstraints,
        externalContext: prepared.externalContext,
        protectedApprovedPeriods,
        maxSearchNodes: PREVIEW_MAX_NODES,
      });
      setWorkspaceView(generated.status === "generated" ? "schedule" : "settings");
      if (generated.status === "generated") {
        persistProposal({
          schemaVersion: 1,
          validationScope: "user_attested_no_external_shifts",
          startDate, endDate, timeZone,
          shifts: structuredClone(generated.assignments),
          people: structuredClone(people),
          configuration: structuredClone({
            availabilities, operatingCalendar, workRules, presence,
            workConstraints: effectiveConstraints,
          }),
        }, crypto.randomUUID());
      }
      setSnapshot({
        startDate,
        endDate,
        timeZone,
        operationTimeZone,
        people,
        availabilities,
        operatingCalendar,
        workRules,
        presence,
        confirmedNoExternalShifts: true,
        result: generated,
      });
    } catch (unexpected) {
      setError(unexpected instanceof Error
        ? unexpected.message
        : "Ocorreu um erro inesperado. Nenhum horário foi publicado.");
    }
  }

  async function handleSaveMealRevision() {
    if(!mealEdit || result?.status!=="generated" || !sameInputs || saveState!=="saved"){
      setMealIssue("Só é possível rever uma proposta atual com gravação confirmada.");
      return;
    }
    if(!ownerId || !supabaseAuthClient || supabaseAuthClient.user?.id!==ownerId){
      setMealIssue("A conta autenticada não foi confirmada.");
      return;
    }
    try {
      const pending=loadPendingGeneratedProposal(window.localStorage,ownerId);
      if(pending){
        setMealIssue("Confirma primeiro a gravação pendente da proposta.");
        return;
      }
      const protection=await readProtectedApprovedPeriods(supabaseAuthClient,ownerId);
      if(protection.periods.some(period=>period.startDate<=endDate &&
          period.endDate>=startDate)){
        setMealIssue("O período já está oficialmente aprovado. Usa o fluxo de revisão oficial.");
        return;
      }
      const prepared=prepareExplicitEmptyContext({
        startDate,endDate,timeZone,rules:effectiveConstraints,
        confirmedNoExternalShifts:confirmed,
      });
      if(prepared.status!=="ready" || !prepared.externalContext){
        setMealIssue("O contexto exterior deixou de estar confirmado.");
        return;
      }
      const revised=reviseMealStart({
        startDate,endDate,timeZone,people,availabilities,operatingCalendar,
        workRules,presence,workConstraints:effectiveConstraints,
        externalContext:prepared.externalContext,
        protectedApprovedPeriods:protection.periods,
      },result.assignments,mealEdit.date,mealEdit.personId,mealEdit.start);
      if(revised.status!=="valid"){
        setMealIssue(revised.issues.join(" "));
        return;
      }
      setMealIssue(null);
      persistProposal({
        schemaVersion:1,
        validationScope:"user_attested_no_external_shifts",
        startDate,endDate,timeZone,
        shifts:structuredClone(revised.shifts),
        people:structuredClone(people),
        configuration:structuredClone({
          availabilities,operatingCalendar,workRules,presence,
          workConstraints:effectiveConstraints,
        }),
      },crypto.randomUUID());
    }catch(problem){
      setMealIssue(problem instanceof Error?problem.message:
        "Não foi possível validar a alteração da refeição.");
    }
  }

  return (
    <div className="generator-workspace">
      {onBackToCalendar && <div className="p63-action-row">
        <button type="button" onClick={onBackToCalendar}>← Voltar ao calendário mensal</button>
      </div>}
      {saveState !== "idle" && <div className="p63-context-box" role={saveState === "failed" ? "alert" : "status"}>
        {saveState === "saving" && <strong>A guardar proposta no Supabase…</strong>}
        {saveState === "saved" && <strong>Horário guardado com sucesso. Podes sair e voltar a consultá-lo no calendário. Não está oficialmente aprovado.</strong>}
        {saveState === "failed" && <>
          <strong>A gravação desta proposta ainda não foi confirmada.</strong>
          <p>{saveProblem ?? "Erro de armazenamento."}</p>
          <button type="button" disabled={!retryPayload} onClick={() => {
            if (retryPayload) persistProposal(retryPayload.payload,retryPayload.id);
          }}>Tentar guardar novamente sem regenerar</button>
          {ownerId && <div className="p63-action-row">
            <button type="button" className="se-outline"
              onClick={exportLocalRecovery}>Descarregar cópia local (JSON)</button>
            <button type="button" className="se-outline"
              onClick={discardLocalRecovery}>Descartar tentativa local</button>
          </div>}
        </>}
      </div>}
      <header className="generator-flow-header">
        <div className="generator-flow-heading">
          <p className="section-kicker">Planeamento inteligente</p>
          <h2>Nova proposta de horário</h2>
          <p>Prepara o período, executa uma simulação e consulta a proposta sem a confundir com uma aprovação oficial.</p>
        </div>
        <ol className="generator-flow-steps" aria-label="Etapas do planeamento">
          <li className={workflowStep===1?"current":workflowStep>1?"complete":""}>
            <button type="button" className="generator-step-action"
              aria-current={workflowStep===1?"step":undefined}
              aria-label="Etapa 1: Preparar"
              onClick={()=>setWorkspaceView("settings")}>
              <span className="generator-step-number">1</span>
              <span><strong>Preparar</strong><small>Datas e contexto</small></span>
            </button>
          </li>
          <li className={workflowStep===2?"current":workflowStep>2?"complete":""}>
            <button type="button" className="generator-step-action"
              aria-current={workflowStep===2?"step":undefined}
              aria-label="Etapa 2: Simular"
              disabled={!result && !error}
              title={!result&&!error?"Executa primeiro a simulação em Preparar":undefined}
              onClick={()=>setWorkspaceView("settings")}>
              <span className="generator-step-number">2</span>
              <span><strong>Simular</strong><small>Regras e resultado</small></span>
            </button>
          </li>
          <li className={workflowStep===3?"current":""}>
            <button type="button" className="generator-step-action"
              aria-current={workflowStep===3?"step":undefined}
              aria-label="Etapa 3: Consultar"
              disabled={result?.status!=="generated"}
              title={result?.status!=="generated"?"Só é possível consultar uma proposta válida":undefined}
              onClick={()=>setWorkspaceView("schedule")}>
              <span className="generator-step-number">3</span>
              <span><strong>Consultar</strong><small>Proposta e versões</small></span>
            </button>
          </li>
        </ol>
      </header>
      <nav className="generator-workspace-tabs" aria-label="Secções de horários">
        <button type="button" className={workspaceView === "settings" ? "active" : ""} aria-pressed={workspaceView === "settings"} onClick={() => setWorkspaceView("settings")}>Gerar horário</button>
        <button type="button" className={workspaceView === "schedule" ? "active" : ""} aria-pressed={workspaceView === "schedule"} disabled={result?.status !== "generated"} onClick={() => setWorkspaceView("schedule")}>Visualizar horário</button>
      </nav>
      {workspaceView === "settings" && <div className="generator-layout period-generator-layout">
      <section className="panel generator-panel">
        <div className="panel-header">
          <div>
            <p className="section-kicker">Planeamento de horários</p>
            <h2>Gerar horário</h2>
          </div>
          <span className="work-rule-badge">Até {UI_MAX_PERIOD_DAYS} dias</span>
        </div>

        <p className="section-description">
          Pesquisa turnos, refeições e alternativas entre dias, respeitando
          cobertura, descanso e limites semanais globais e individuais.
          Cada proposta válida é guardada no Supabase para consulta futura, sem aprovação automática.
        </p>

        <div className="generator-period-presets" role="group" aria-label="Duração do período">
          <span>Período rápido</span>
          {[7,14,28].map(days=>
            <button type="button" className="se-outline" key={days}
              disabled={parseCivilDays(startDate,startDate)!==1}
              aria-pressed={periodDays===days}
              onClick={()=>selectDuration(days as 7|14|28)}>
              {days} dias
            </button>)}
        </div>
        <div className="generator-controls period-generator-controls">
          <label className="select-field generator-date-field" htmlFor="p63-start-date">
            <span>Data inicial</span>
            <CalendarDateInput
              id="p63-start-date"
              className="date-input"
              value={startDate}
              onChange={(event) => {
                setStartDate(event.target.value);
                saveGeneratorDate("constrained:start", event.target.value);
                resetScenario();
              }}
            />
          </label>
          <label className="select-field generator-date-field" htmlFor="p63-end-date">
            <span>Data final (inclusive)</span>
            <CalendarDateInput
              id="p63-end-date"
              className="date-input"
              value={endDate}
              onChange={(event) => {
                setEndDate(event.target.value);
                saveGeneratorDate("constrained:end", event.target.value);
                resetScenario();
              }}
            />
          </label>
          <label className="select-field generator-date-field" htmlFor="p63-time-zone">
            <span>Fuso horário IANA da operação</span>
            <input
              id="p63-time-zone"
              className="date-input"
              type="text"
              value={timeZone}
              readOnly
              title="Alterar em Operação → Fuso horário e ciclo contabilístico"
            />
          </label>
        </div>

        <div className="generator-readiness" role="status">
          <div>
            <strong>{readinessLabel}</strong>
            <span>{periodIsValid
              ? periodDays+" dia(s) · "+people.filter(person=>person.active).length+" colaborador(es) ativos · "+timeZone
              : "Escolhe um intervalo válido até "+UI_MAX_PERIOD_DAYS+" dias."}</span>
          </div>
          <span className={"generator-readiness-dot "+(context.status==="ready"?"ready":"pending")} aria-hidden="true"/>
        </div>
        <details className="generator-technical-details" open={showTechnicalDetails}
          onToggle={event=>setShowTechnicalDetails(event.currentTarget.open)}>
          <summary>Regras técnicas consideradas na simulação</summary>
          <div className="generator-facts">
            <div><span>Trabalho máximo</span><strong>{`${(effectiveConstraints.maximumDailyEffectiveMinutes / 60).toLocaleString("pt-PT")}h/dia · ${(effectiveConstraints.maximumWeeklyEffectiveMinutes / 60).toLocaleString("pt-PT")}h/semana`}</strong></div>
            <div><span>Descanso mínimo</span><strong>11h entre jornadas</strong></div>
            <div><span>Refeição obrigatória</span><strong>60min se mais de 6h</strong></div>
          </div>
        </details>

        <div className="period-generator-disclaimer p63-context-box" role="group" aria-label="Contexto exterior ao período">
          <strong>Contexto exterior — confirmação obrigatória</strong>
          {context.requiredContext ? (
            <>
              <p>
                Para verificar horas semanais e descanso, o motor precisa
                de conhecer todos os turnos dos colaboradores entre
                <b> {context.requiredContext.startDate}</b> e
                <b> {context.requiredContext.endDate}</b>.
              </p>
              <p>
                As propostas guardadas não constituem horários oficialmente
                aprovados nem permitem verificar outros turnos existentes.
                Nesta primeira experiência, só é suportado o cenário
                em que <b>não há quaisquer outros turnos atribuídos fora
                do período escolhido</b>, dentro destas datas.
              </p>
              <label className="p63-confirmation">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => {
                    setConfirmed(event.target.checked);
                    setSnapshot(null);
                    setError(null);
                  }}
                />
                <span>
                  Confirmo explicitamente que não existem turnos já
                  atribuídos aos colaboradores nos dias fora do período
                  selecionado, entre {context.requiredContext.startDate} e
                  {" "}{context.requiredContext.endDate}.
                </span>
              </label>
            </>
          ) : (
            <p>Indica datas válidas e um fuso IANA para calcular o contexto necessário.</p>
          )}
          {context.status === "invalid_input" && context.issues.map((issue, i) => (
            <p className="generator-issue" key={i}>{issue}</p>
          ))}
        </div>

        <div className="p63-action-row">
          <button
            type="button"
            className="primary-button"
            disabled={context.status !== "ready" || !startDate || !endDate}
            onClick={handleGenerate}
          >
            Simular período com regras
          </button>
          <p className="generator-hint">
            {context.status==="ready"
              ? "A confirmação está completa. A simulação poderá guardar automaticamente uma nova proposta."
              : "Indica datas válidas e confirma expressamente o contexto exterior para continuar."}
          </p>
        </div>

        <details className="generator-technical-details generator-technical-note">
          <summary>Limites da pesquisa e da validade</summary>
          <p className="generator-footnote">
            O resultado é válido apenas para o cenário exterior expressamente
            declarado. Se existirem outros turnos conhecidos, não confirmes
            ausência: o motor precisa desses turnos para os considerar.
            As propostas válidas são guardadas automaticamente, mas não são aprovadas.
            A pesquisa tem um limite de {PREVIEW_MAX_NODES.toLocaleString("pt-PT")} nós;
            atingir esse limite não prova que não existe solução.
          </p>
        </details>
      </section>

      <section className="panel generator-results" aria-live="polite">
        <div className="panel-header">
          <div>
            <p className="section-kicker">Resultado do planeamento</p>
            <h2>Resultado da simulação</h2>
          </div>
          {result && (
            <span className={`generator-status generator-status-${result.status}`}>
              {result.status === "generated" ? "Válido no cenário" : "Diagnóstico"}
            </span>
          )}
        </div>

        {error ? (
          <div className="generator-result-body" role="alert">
            <h3>Não foi possível simular</h3>
            <p>{error}</p>
            <p>Nenhuma escala foi guardada.</p>
          </div>
        ) : result ? (
          <div className="generator-result-body">
            <div className="generator-result-overview">
              <div>
                <span className="generator-result-eyebrow">Estado do planeamento</span>
                <h3>{titleForStatus(result.status)}</h3>
              </div>
              <span className={"generator-result-state "+(result.status==="generated"?"success":"attention")}>
                {result.status==="generated"?"Solução encontrada":"Revisão necessária"}
              </span>
            </div>
            <div className="generator-result-metrics" aria-label="Resumo da execução">
              <div><strong>{result.days.length}</strong><span>Dias analisados</span></div>
              <div><strong>{result.status==="generated"?result.assignments.length:"—"}</strong><span>Turnos validados</span></div>
              <div><strong>{result.issues.length}</strong><span>Observações</span></div>
            </div>
            {result.status === "generated" && (
              <p className="generator-hint">
                Cobertura, refeições, descanso e limites diários/semanais
                verificados <strong>apenas sob a declaração de ausência de
                outros turnos exteriores ao período</strong>. Isto não
                representa uma aprovação oficial. A gravação é confirmada separadamente.
              </p>
            )}
            {result.status === "generated" &&
              weekMonday(startDate) === weekMonday(endDate) && (
              <div className="p63-violations">
                <h4>Horas semanais efetivas · objetivos individuais</h4>
                {people.filter(p=>p.active).map(person=>{
                  const workload=weeklyPersonWorkSummary(person,result.assignments,
                    timeZone,effectiveConstraints.maximumWeeklyEffectiveMinutes);
                  return <p key={person.id}>
                    <strong>{person.name}</strong>: {formatWorkMinutes(workload.effectiveMinutes)}
                    {" / objetivo "}{formatWorkMinutes(workload.targetMinutes)}
                    {" · máximo "}{formatWorkMinutes(workload.hardMaximumMinutes)}
                    {" · défice "}{formatWorkMinutes(workload.deficitMinutes)}
                    {workload.aboveTargetMinutes!==null && workload.aboveTargetMinutes>0 &&
                      <>{" · acima do objetivo "}{formatWorkMinutes(workload.aboveTargetMinutes)}</>}
                  </p>;
                })}
                <p className="generator-hint">
                  Objetivo preferencial; melhoria local limitada, sem garantia
                  de ótimo global. Mantêm-se as regras obrigatórias.
                </p>
              </div>
            )}
            {result.issues.map((issue, index) => (
              <p className="generator-issue" key={index}>{issue}</p>
            ))}

            {result.workViolations.length > 0 && (
              <div className="p63-violations">
                <h4>Regras que impediram candidatos</h4>
                {result.workViolations.slice(0, 5).map((violation, index) => (
                  <p className="generator-issue" key={index}>
                    {violation.date} · {violation.personId}: {violation.message}
                  </p>
                ))}
              </div>
            )}

            {result.status !== "generated" && result.days.length > 0 && (
              <div className="period-day-list">
                {result.days.map((day) => {
                  // Never show partial assignments for a rejected period.
                  const shifts = result.status === "generated"
                    ? result.assignments.filter(shift => shift.date === day.date)
                    : [];
                  return (
                    <article className="period-day-card" key={day.date}>
                      <div className="period-day-heading">
                        <div>
                          <strong>{displayDate(day.date)}</strong>
                          <span>{day.date}</span>
                        </div>
                        <span className={`period-day-state period-day-state-${day.lastDailyStatus ?? "unknown"}`}>
                          {dayStatus(day.lastDailyStatus)}
                        </span>
                      </div>

                      {result.status === "generated" && shifts.length > 0 && (
                        <div className="generator-assignment-list">
                          {shifts.map(shift => {
                            const person = people.find(p => p.id === shift.personId);
                            return (
                              <div className="generator-assignment p63-assignment" key={shift.personId}>
                                <strong>{person?.name ?? shift.personId}</strong>
                                <div className="p63-assignment-times">
                                  <span>{shift.interval.start}–{shift.interval.end}</span>
                                  <small>
                                    {shift.mealBreak
                                      ? `Refeição ${shift.mealBreak.start}–${shift.mealBreak.end}`
                                      : "Sem pausa obrigatória"}
                                  </small>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {result.status === "generated" && shifts.length === 0 && (
                        <p className="generator-hint">
                          {day.lastDailyStatus === "closed"
                            ? "Operação fechada." : "Sem turnos necessários."}
                        </p>
                      )}
                      {result.status !== "generated" && day.attempts > 0 && (
                        <p className="generator-hint">
                          {day.attempts} tentativa(s) ·{" "}
                          {day.rejectedByWorkRules} alternativa(s) recusada(s)
                          por restrições de trabalho. Sem publicação parcial.
                        </p>
                      )}
                      {day.issues.slice(0, 2).map((issue, index) => (
                        <p className="generator-issue" key={index}>{issue}</p>
                      ))}
                      {day.shortages.slice(0, 2).map((shortage, index) => (
                        <p className="generator-issue" key={index}>
                          {shortage.interval.start}–{shortage.interval.end}:{" "}
                          {shortage.actual}/{shortage.required} disponíveis
                        </p>
                      ))}
                    </article>
                  );
                })}
              </div>
            )}

            <p className="generator-footnote">
              {result.exploredNodes.toLocaleString("pt-PT")} nós analisados;
              {" "}{result.rejectedByWorkRules} alternativas recusadas pelas regras.
              {result.status !== "generated" && " Nenhum horário foi publicado."}
            </p>
          </div>
        ) : (
          <div className="generator-result-body generator-idle">
            <h3>{stale ? "Parâmetros alterados" : "Ainda sem simulação"}</h3>
            <p>
              {stale
                ? "Alteraste os dados desde a última execução. Confirma novamente o contexto para gerar um resultado atualizado."
                : "Escolhe as datas e confirma expressamente o contexto exterior. Sem essa confirmação, o motor não assume horas livres."}
            </p>
          </div>
        )}
      </section>
      </div>}
      {workspaceView === "schedule" && result?.status === "generated" && <>
        <div className="generator-review-intro">
          <div>
            <p className="section-kicker">Etapa 3 · consulta</p>
            <h3>Proposta gerada</h3>
            <p>Consulta o calendário e os turnos. A gravação e a aprovação oficial são estados diferentes.</p>
          </div>
          <button type="button" className="se-outline"
            onClick={()=>setWorkspaceView("settings")}>← Rever parâmetros</button>
        </div>
        <ScheduleViews assignments={result.assignments} people={people}
          startDate={startDate} endDate={endDate} storageState={saveState}/>
      </>}
      {workspaceView === "schedule" && result?.status === "generated" && (
        <section className="panel generator-meal-editor" aria-label="Editar refeições da proposta">
          <h3>Editar hora de refeição</h3>
          <p className="generator-hint">
            Um turno continua a ser um único período com pausa de refeição.
            Guardar uma alteração cria outra proposta imutável e verifica novamente
            as hard constraints e a cobertura. A proposta anterior permanece no arquivo.
          </p>
          {result.assignments.filter(shift=>shift.mealBreak).map(shift=>(
            <div key={shift.date+"|"+shift.personId} className="p63-action-row">
              <strong>{people.find(p=>p.id===shift.personId)?.name??shift.personId}</strong>
              <span>{shift.date} · {shift.interval.start}–{shift.interval.end}</span>
              <span>Refeição {shift.mealBreak?.start}–{shift.mealBreak?.end}</span>
              <button type="button" className="secondary-button"
                disabled={saveState!=="saved"}
                onClick={()=>{
                  setMealEdit({date:shift.date,personId:shift.personId,
                    start:shift.mealBreak!.start});
                  setMealIssue(null);
                }}>Editar refeição</button>
              {mealEdit?.date===shift.date && mealEdit.personId===shift.personId && (
                <div className="p63-action-row">
                  <label>Início da refeição
                    <input type="time" step={900} value={mealEdit.start}
                      onChange={event=>setMealEdit({...mealEdit,start:event.target.value})}/>
                  </label>
                  <button type="button" className="primary-button"
                    disabled={saveState!=="saved"}
                    onClick={()=>{void handleSaveMealRevision();}}>Validar e guardar nova proposta</button>
                  <button type="button" className="secondary-button"
                    onClick={()=>{setMealEdit(null);setMealIssue(null);}}>Cancelar</button>
                </div>
              )}
            </div>
          ))}
          {mealIssue && <p className="generator-issue" role="alert">{mealIssue}</p>}
        </section>
      )}
    </div>
  );
}
