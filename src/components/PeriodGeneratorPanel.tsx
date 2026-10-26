import { useState } from "react";
import { readGeneratorDate, saveGeneratorDate } from "./generatorUiPreferences";
import type {
  OperatingCalendarConfiguration,
  Person,
  PersonAvailability,
  PresenceConfiguration,
  WorkRulesConfiguration,
} from "../types";
import type { DayScheduleStatus } from "../utils/dailyGenerator";
import {
  generatePeriodSchedule,
  MAX_PERIOD_DAYS,
  type GeneratePeriodScheduleResult,
} from "../utils/periodGenerator";

interface PeriodGeneratorPanelProps {
  people: Person[];
  availabilities: PersonAvailability[];
  operatingCalendar: OperatingCalendarConfiguration;
  workRules: WorkRulesConfiguration;
  presence: PresenceConfiguration;
}

interface PeriodSnapshot extends PeriodGeneratorPanelProps {
  startDate: string;
  endDate: string;
  result: GeneratePeriodScheduleResult;
}

const dayLabels: Record<DayScheduleStatus, string> = {
  generated: "Validado no dia",
  closed: "Fechado",
  invalid_input: "Configuração inválida",
  insufficient_capacity: "Disponibilidade insuficiente",
  not_found: "Sem solução encontrada",
  search_limit: "Pesquisa limitada",
};

function todayKey(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function addCivilDays(date: string, numberOfDays: number): string {
  const utc = new Date(`${date}T00:00:00Z`);
  utc.setUTCDate(utc.getUTCDate() + numberOfDays);
  return utc.toISOString().slice(0, 10);
}

function displayDate(date: string): string {
  return new Intl.DateTimeFormat("pt-PT", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

export default function PeriodGeneratorPanel({
  people,
  availabilities,
  operatingCalendar,
  workRules,
  presence,
}: PeriodGeneratorPanelProps) {
  const [startDate, setStartDate] = useState(() => readGeneratorDate("period:start", todayKey));
  const [endDate, setEndDate] = useState(() => readGeneratorDate("period:end", () => addCivilDays(todayKey(), 6)));
  const [snapshot, setSnapshot] = useState<PeriodSnapshot | null>(null);
  const [unexpectedError, setUnexpectedError] = useState<string | null>(null);

  const sameInputs =
    snapshot !== null &&
    snapshot.startDate === startDate &&
    snapshot.endDate === endDate &&
    snapshot.people === people &&
    snapshot.availabilities === availabilities &&
    snapshot.operatingCalendar === operatingCalendar &&
    snapshot.workRules === workRules &&
    snapshot.presence === presence;

  const result = sameInputs ? snapshot.result : null;
  const hasStaleResult = snapshot !== null && !sameInputs;

  const handleGenerate = () => {
    setSnapshot(null);
    setUnexpectedError(null);
    try {
      const generated = generatePeriodSchedule({
        startDate,
        endDate,
        people,
        availabilities,
        operatingCalendar,
        workRules,
        presence,
      });
      setSnapshot({
        startDate,
        endDate,
        people,
        availabilities,
        operatingCalendar,
        workRules,
        presence,
        result: generated,
      });
    } catch (error) {
      setUnexpectedError(
        error instanceof Error
          ? error.message
          : "Ocorreu um erro inesperado durante a geração do período."
      );
    }
  };

  return (
    <div className="generator-layout period-generator-layout">
      <section className="panel generator-panel">
        <div className="panel-header">
          <div>
            <p className="section-kicker">Ponto 6.2 · experimental</p>
            <h2>Gerar um período</h2>
          </div>
          <span className="work-rule-badge">Até {MAX_PERIOD_DAYS} dias · V0</span>
        </div>

        <p className="section-description">
          Escolhe duas datas, incluindo o primeiro e o último dia.
          O motor verifica separadamente cada dia do período.
          Esta simulação não guarda turnos no Supabase nem altera
          os dados dos colaboradores.
        </p>

        <div className="generator-controls period-generator-controls">
          <label className="select-field generator-date-field" htmlFor="period-start-date">
            <span>Data inicial</span>
            <input
              id="period-start-date"
              className="date-input"
              type="date"
              value={startDate}
              onChange={(event) => {
                setStartDate(event.target.value);
                saveGeneratorDate("period:start", event.target.value);
                setUnexpectedError(null);
              }}
            />
          </label>
          <label className="select-field generator-date-field" htmlFor="period-end-date">
            <span>Data final (inclusive)</span>
            <input
              id="period-end-date"
              className="date-input"
              type="date"
              value={endDate}
              onChange={(event) => {
                setEndDate(event.target.value);
                saveGeneratorDate("period:end", event.target.value);
                setUnexpectedError(null);
              }}
            />
          </label>
          <button
            type="button"
            className="primary-button"
            disabled={!startDate || !endDate}
            onClick={handleGenerate}
          >
            Gerar período
          </button>
        </div>

        <div className="generator-facts">
          <div>
            <span>Colaboradores ativos</span>
            <strong>{people.filter((person) => person.active).length}</strong>
          </div>
          <div>
            <span>Duração padrão</span>
            <strong>
              {workRules.standardShiftDurationMinutes === null
                ? "Por configurar"
                : `${workRules.standardShiftDurationMinutes} min`}
            </strong>
          </div>
          <div>
            <span>Limite de datas</span>
            <strong>{MAX_PERIOD_DAYS} dias consecutivos</strong>
          </div>
        </div>

        <div className="period-generator-disclaimer" role="note">
          <strong>Validação apenas diária</strong>
          <p>
            A composição de dias válidos ainda não valida descansos entre
            dias, limites de horas semanais, contratos ou equilíbrio entre
            pessoas. Não é um horário semanal certificado.
          </p>
        </div>

        <p className="generator-footnote">
          Os turnos só são apresentados para o período inteiro se todos os
          dias estiverem individualmente validados. Um dia com conflitos
          impede a publicação de um horário parcial.
        </p>
      </section>

      <section className="panel generator-results" aria-live="polite">
        <div className="panel-header">
          <div>
            <p className="section-kicker">Validação do motor</p>
            <h2>Resultado do período</h2>
          </div>
          {result && (
            <span className={`generator-status generator-status-${result.status}`}>
              {result.status === "daily_complete"
                ? "Dias validados"
                : "Diagnóstico"}
            </span>
          )}
        </div>

        {unexpectedError ? (
          <div className="generator-result-body" role="alert">
            <h3>Erro inesperado na geração</h3>
            <p>{unexpectedError}</p>
            <p>Não foi publicado nem guardado qualquer horário.</p>
          </div>
        ) : result ? (
          <div className="generator-result-body">
            <h3>
              {result.status === "daily_complete"
                ? "Todos os dias passaram na validação individual"
                : result.status === "incomplete"
                  ? "Período incompleto"
                  : "Datas ou configuração inválidas"}
            </h3>

            {result.status !== "invalid_input" && (
              <div className="period-generator-summary" aria-label="Resumo dos dias">
                <div>
                  <strong>{result.generatedDays}</strong>
                  <span>Dias com turnos</span>
                </div>
                <div>
                  <strong>{result.closedDays}</strong>
                  <span>Dias fechados</span>
                </div>
                <div>
                  <strong>{result.failedDays}</strong>
                  <span>Dias com falha</span>
                </div>
              </div>
            )}

            {result.status === "daily_complete" && (
              <p className="generator-hint">
                Sequência de turnos obtida com validação diária.
                Ainda não foi verificada a viabilidade do conjunto
                face a regras de trabalho entre dias.
              </p>
            )}

            {result.issues.map((issue, index) => (
              <p className="generator-issue" key={index}>{issue}</p>
            ))}

            {result.days.length > 0 && (
              <div className="period-day-list">
                {result.days.map((day) => {
                  // Only period-wide approved daily results are exposed.
                  // An incomplete period keeps diagnostic counts, not shifts.
                  const assignments = result.status === "daily_complete"
                    ? result.assignments.filter(
                        (assignment) => assignment.date === day.date
                      )
                    : [];
                  return (
                    <article className="period-day-card" key={day.date}>
                      <div className="period-day-heading">
                        <div>
                          <strong>{displayDate(day.date)}</strong>
                          <span>{day.date}</span>
                        </div>
                        <span className={`period-day-state period-day-state-${day.status}`}>
                          {dayLabels[day.status]}
                        </span>
                      </div>

                      {result.status === "daily_complete" &&
                        day.status === "generated" && (
                          assignments.length > 0 ? (
                            <div className="generator-assignment-list">
                              {assignments.map((assignment) => {
                                const person = people.find(
                                  (candidate) => candidate.id === assignment.personId
                                );
                                return (
                                  <div
                                    className="generator-assignment"
                                    key={assignment.personId}
                                  >
                                    <strong>{person?.name ?? assignment.personId}</strong>
                                    <span>
                                      {assignment.interval.start}–{assignment.interval.end}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="generator-hint">Sem turnos necessários.</p>
                          )
                        )}

                      {result.status === "incomplete" &&
                        day.status === "generated" && (
                          <p className="generator-hint">
                            {day.foundAssignments} turno(s) encontrado(s) neste dia,
                            mas não publicados porque o período está incompleto.
                          </p>
                        )}

                      {day.status === "closed" && (
                        <p className="generator-hint">
                          Empresa fechada. Não há turnos.
                        </p>
                      )}

                      {day.issues.map((issue, index) => (
                        <p className="generator-issue" key={index}>{issue}</p>
                      ))}

                      {day.shortages.length > 0 && (
                        <div className="generator-shortage-list">
                          {day.shortages.slice(0, 3).map((shortage, index) => (
                            <p key={index}>
                              <strong>
                                {shortage.interval.start}–{shortage.interval.end}
                              </strong>
                              <span>
                                {shortage.actual} disponíveis para {shortage.required} necessários
                              </span>
                            </p>
                          ))}
                          {day.shortages.length > 3 && (
                            <p className="generator-hint">
                              + {day.shortages.length - 3} outros intervalos em falta.
                            </p>
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}

            {result.status !== "invalid_input" && (
              <p className="generator-footnote">
                {result.exploredNodes} nó(s) de pesquisa analisado(s) no período.
                {result.status === "incomplete" &&
                  " Nenhum horário agregado foi publicado."}
              </p>
            )}
          </div>
        ) : (
          <div className="generator-result-body generator-idle">
            <h3>{hasStaleResult ? "Parâmetros alterados" : "Sem geração realizada"}</h3>
            <p>
              {hasStaleResult
                ? "A data ou a configuração mudou desde a última execução. Gera novamente o período para obter um resultado atualizado."
                : "Escolhe um intervalo de datas e clica em «Gerar período». A simulação não altera os dados guardados."}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
