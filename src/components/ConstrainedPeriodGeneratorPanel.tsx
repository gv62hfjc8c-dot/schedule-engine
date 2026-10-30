import { useEffect, useState } from "react";
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
import { MAX_PERIOD_DAYS } from "../utils/periodGenerator";

export interface ConstrainedPeriodGeneratorPanelProps {
  people: Person[];
  availabilities: PersonAvailability[];
  operatingCalendar: OperatingCalendarConfiguration;
  workRules: WorkRulesConfiguration;
  presence: PresenceConfiguration;
}

interface Snapshot extends ConstrainedPeriodGeneratorPanelProps {
  startDate: string;
  endDate: string;
  timeZone: string;
  confirmedNoExternalShifts: true;
  result: GenerateConstrainedPeriodResult;
}

const PREVIEW_MAX_NODES = 5_000;

function todayKey(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

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
 * - no Supabase writes or modifications to the existing generator.
 *
 * This declaration only makes the result valid IN THAT SCENARIO.
 */
export default function ConstrainedPeriodGeneratorPanel({
  people,
  availabilities,
  operatingCalendar,
  workRules,
  presence,
}: ConstrainedPeriodGeneratorPanelProps) {
  const [startDate, setStartDate] = useState(() => readGeneratorDate("constrained:start", todayKey));
  const [endDate, setEndDate] = useState(() => readGeneratorDate("constrained:end", () => addCivilDays(todayKey(), 6)));
  const [timeZone, setTimeZone] = useState("Atlantic/Azores");
  const [confirmed, setConfirmed] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // An edited roster/configuration requires a fresh, explicit declaration.
    setConfirmed(false);
    setSnapshot(null);
  }, [people, availabilities, operatingCalendar, workRules, presence]);

  const context = prepareExplicitEmptyContext({
    startDate,
    endDate,
    timeZone,
    rules: INITIAL_WORK_CONSTRAINTS,
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
    setConfirmed(false);
    setSnapshot(null);
    setError(null);
  }

  function handleGenerate() {
    setSnapshot(null);
    setError(null);
    // Independent gate immediately before engine execution. This prevents
    // the UI from supplying a fabricated complete empty context.
    const prepared = prepareExplicitEmptyContext({
      startDate,
      endDate,
      timeZone,
      rules: INITIAL_WORK_CONSTRAINTS,
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
        workConstraints: INITIAL_WORK_CONSTRAINTS,
        externalContext: prepared.externalContext,
        maxSearchNodes: PREVIEW_MAX_NODES,
      });
      setSnapshot({
        startDate,
        endDate,
        timeZone,
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
    <div className="generator-layout period-generator-layout">
      <section className="panel generator-panel">
        <div className="panel-header">
          <div>
            <p className="section-kicker">Planeamento de horários</p>
            <h2>Gerar horário</h2>
          </div>
          <span className="work-rule-badge">Até {MAX_PERIOD_DAYS} dias</span>
        </div>

        <p className="section-description">
          Pesquisa turnos, refeições e alternativas entre dias, respeitando
          cobertura, 11 horas de descanso e o limite de 40 horas semanais.
          Esta simulação não grava nem altera dados no Supabase.
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
              placeholder="Atlantic/Azores"
              autoComplete="off"
              onChange={(event) => {
                setTimeZone(event.target.value);
                resetScenario();
              }}
            />
          </label>
        </div>

        <div className="generator-facts">
          <div><span>Trabalho máximo</span><strong>8h/dia · 40h/semana</strong></div>
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
                Ainda não existe um registo persistido de horários gerados
                que permita consultar automaticamente estes turnos.
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
          Os horários não são guardados nem aprovados nesta experiência.
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
                representa uma aprovação nem persistência de escala.
              </p>
            )}
            {result.status === "generated" &&
              weekMonday(startDate) === weekMonday(endDate) && (
              <div className="p63-violations">
                <h4>Horas semanais atribuídas · objetivo 40h por pessoa</h4>
                {people.filter(p => p.active).map(person => {
                  const total = result.assignments
                    .filter(shift => shift.personId === person.id)
                    .reduce((sum, shift) => {
                      const minutes = (clock: string) =>
                        Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
                      return sum + minutes(shift.interval.end) -
                        minutes(shift.interval.start) -
                        (shift.mealBreak
                          ? minutes(shift.mealBreak.end) - minutes(shift.mealBreak.start)
                          : 0);
                    }, 0);
                  const format = (value: number) =>
                    `${Math.floor(value / 60)}h${String(value % 60).padStart(2, "0")}`;
                  return (
                    <p key={person.id}>
                      <strong>{person.name}</strong>: {format(total)} / 40h00
                      {" · "}défice {format(Math.max(0, 2400 - total))}
                    </p>
                  );
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
      {result?.status === "generated" && <ScheduleViews assignments={result.assignments} people={people} startDate={startDate} endDate={endDate} />}
    </div>
  );
}
