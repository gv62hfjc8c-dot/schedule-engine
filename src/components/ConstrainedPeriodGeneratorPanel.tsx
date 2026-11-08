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
import { INITIAL_WORK_CONSTRAINTS } from "../utils/workConstraints";
import { MAX_CONSTRAINED_PERIOD_DAYS } from "../utils/constrainedPeriodGenerator";
import { MAX_PERIOD_DAYS } from "../utils/periodGenerator";
import { parseCivilDays } from "../utils/generatorPeriodCapability";
import {
  stagePendingGeneratedProposal,
  loadPendingGeneratedProposal,
  acknowledgePendingGeneratedProposal,
} from "../utils/pendingGeneratedProposal";
import { todayInTimeZone } from "../utils/monthlyScheduleView";
import { weeklyPersonWorkSummary, formatWorkMinutes } from "../utils/weeklyWorkSummary";

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
const UI_MAX_PERIOD_DAYS =
  import.meta.env.VITE_GENERATOR_28_DAY_READY === "true"
    ? MAX_CONSTRAINED_PERIOD_DAYS : MAX_PERIOD_DAYS;


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

  function resetScenario() {
    setWorkspaceView("settings");
    setConfirmed(false);
    setSnapshot(null);
    setError(null);
    saveAttempt.current++;
    setSaveState("idle");
    setSaveProblem(null);
    setRetryPayload(null);
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
      acknowledgePendingGeneratedProposal(window.localStorage,ownerId,id);
      if (saveAttempt.current === token) {
        setSaveState("saved");
        setRetryPayload(null);
      }
    }).catch(problem => {
      if (saveAttempt.current === token) {
        setSaveState("failed");
        setSaveProblem(problem instanceof Error ? problem.message :
          "A base de dados não confirmou a gravação.");
      }
    });
  }

  function handleGenerate() {
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
      setError("O motor suporta 28 dias, mas a base de dados ainda não foi "+
        "confirmada como compatível. Limite operacional atual: "+
        UI_MAX_PERIOD_DAYS+" dias.");
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

  return (
    <div className="generator-workspace">
      {onBackToCalendar && <div className="p63-action-row">
        <button type="button" onClick={onBackToCalendar}>← Voltar ao calendário mensal</button>
      </div>}
      {saveState !== "idle" && <div className="p63-context-box" role={saveState === "failed" ? "alert" : "status"}>
        {saveState === "saving" && <strong>A guardar proposta no Supabase…</strong>}
        {saveState === "saved" && <strong>Horário guardado com sucesso. Podes sair e voltar a consultá-lo no calendário. Não está oficialmente aprovado.</strong>}
        {saveState === "failed" && <>
          <strong>O horário foi gerado, mas não ficou guardado.</strong>
          <p>{saveProblem ?? "Erro de armazenamento."}</p>
          <button type="button" disabled={!retryPayload} onClick={() => {
            if (retryPayload) persistProposal(retryPayload.payload,retryPayload.id);
          }}>Tentar guardar novamente sem regenerar</button>
        </>}
      </div>}
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

        <div className="generator-facts">
          <div><span>Trabalho máximo</span><strong>{`${(effectiveConstraints.maximumDailyEffectiveMinutes / 60).toLocaleString("pt-PT")}h/dia · ${(effectiveConstraints.maximumWeeklyEffectiveMinutes / 60).toLocaleString("pt-PT")}h/semana`}</strong></div>
          <div><span>Descanso mínimo</span><strong>11h entre jornadas</strong></div>
          <div><span>Refeição obrigatória</span><strong>60min se mais de 6h</strong></div>
        </div>

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
            Limite de {PREVIEW_MAX_NODES.toLocaleString("pt-PT")} nós de pesquisa.
            Um limite atingido não prova inexistência de solução.
          </p>
        </div>

        <p className="generator-footnote">
          O resultado é válido apenas para o cenário exterior expressamente
          declarado. Se existirem outros turnos conhecidos, não confirmes
          ausência: o motor precisa desses turnos para os considerar.
          As propostas válidas são guardadas automaticamente, mas não são aprovadas.
        </p>
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
            <h3>{titleForStatus(result.status)}</h3>
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
      {workspaceView === "schedule" && result?.status === "generated" && <ScheduleViews assignments={result.assignments} people={people} startDate={startDate} endDate={endDate} storageState={saveState} />}
    </div>
  );
}
