import { useState } from "react";
import { readGeneratorDate, saveGeneratorDate } from "./generatorUiPreferences";
import type {
  OperatingCalendarConfiguration,
  Person,
  PersonAvailability,
  PresenceConfiguration,
  WorkRulesConfiguration,
} from "../types";
import {
  generateDaySchedule,
  type GenerateDayScheduleResult,
} from "../utils/dailyGenerator";
import { getOperatingIntervalsForDate } from "../utils/operatingCalendar";
import {
  getPresencePhaseWindows,
  resolvePresenceForDate,
} from "../utils/presence";

interface DailyGeneratorPanelProps {
  people: Person[];
  availabilities: PersonAvailability[];
  operatingCalendar: OperatingCalendarConfiguration;
  workRules: WorkRulesConfiguration;
  presence: PresenceConfiguration;
}

interface GeneratedSnapshot {
  date: string;
  people: Person[];
  availabilities: PersonAvailability[];
  operatingCalendar: OperatingCalendarConfiguration;
  workRules: WorkRulesConfiguration;
  presence: PresenceConfiguration;
  result: GenerateDayScheduleResult;
}

function todayKey(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function formatIntervals(
  intervals: { start: string; end: string }[]
): string {
  if (intervals.length === 0) return "Fechado";
  return intervals.map((item) => `${item.start}–${item.end}`).join(" · ");
}

const resultLabels: Record<GenerateDayScheduleResult["status"], string> = {
  generated: "Horário gerado e validado",
  closed: "Dia fechado",
  invalid_input: "Configuração incompleta ou inválida",
  insufficient_capacity: "Disponibilidade insuficiente",
  not_found: "Sem solução encontrada nesta pesquisa",
  search_limit: "Limite de pesquisa atingido",
};

export default function DailyGeneratorPanel({
  people,
  availabilities,
  operatingCalendar,
  workRules,
  presence,
}: DailyGeneratorPanelProps) {
  const [date, setDate] = useState(() => readGeneratorDate("day:date", todayKey));
  const [snapshot, setSnapshot] = useState<GeneratedSnapshot | null>(null);
  const [unexpectedError, setUnexpectedError] = useState<string | null>(null);

  const sameInputs =
    snapshot?.date === date &&
    snapshot.people === people &&
    snapshot.availabilities === availabilities &&
    snapshot.operatingCalendar === operatingCalendar &&
    snapshot.workRules === workRules &&
    snapshot.presence === presence;

  // Results are transient and tied to the exact inputs used at generation.
  // Editing calendar, presence, availability or people never leaves a stale
  // result visible and never modifies the persisted application state.
  const result = sameInputs ? snapshot.result : null;
  const hasStaleResult = snapshot !== null && !sameInputs;

  let operatingIntervals: { start: string; end: string }[] | null = null;
  let resolvedPresence: ReturnType<typeof resolvePresenceForDate> | null = null;
  if (date) {
    try {
      operatingIntervals = getOperatingIntervalsForDate(
        date,
        operatingCalendar.weeklyOperatingHours,
        operatingCalendar.exceptions
      );
      resolvedPresence = resolvePresenceForDate(
        date,
        presence.weeklyPresenceRequirements,
        presence.presenceExceptions,
        operatingCalendar.weeklyOperatingHours,
        operatingCalendar.exceptions
      );
    } catch {
      // The generator reports invalid date/configuration after explicit run.
    }
  }

  const windows = operatingIntervals
    ? getPresencePhaseWindows(operatingIntervals)
    : null;

  const handleGenerate = () => {
    setUnexpectedError(null);
    setSnapshot(null);
    try {
      const generated = generateDaySchedule({
        date,
        people,
        availabilities,
        operatingCalendar,
        workRules,
        presence,
      });
      setSnapshot({
        date,
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
          : "Ocorreu um erro inesperado na geração."
      );
    }
  };

  return (
    <div className="generator-layout">
      <section className="panel generator-panel">
        <div className="panel-header">
          <div>
            <p className="section-kicker">Ponto 6 · experimental</p>
            <h2>Gerador de horários</h2>
          </div>
          <span className="work-rule-badge">Um dia · V0</span>
        </div>

        <p className="section-description">
          Escolhe uma data e procura uma combinação de turnos contínuos
          que cumpra as disponibilidades e os mínimos de presença.
          O resultado é apenas uma simulação: não é guardado no Supabase
          e não altera pessoas, disponibilidades ou regras.
        </p>

        <div className="generator-controls">
          <label className="select-field generator-date-field" htmlFor="generator-date">
            <span>Data do horário</span>
            <input
              id="generator-date"
              className="date-input"
              type="date"
              value={date}
              onChange={(event) => {
                setDate(event.target.value);
                saveGeneratorDate("day:date", event.target.value);
                setUnexpectedError(null);
              }}
            />
          </label>
          <button
            type="button"
            className="primary-button"
            disabled={!date}
            onClick={handleGenerate}
          >
            Gerar horário
          </button>
        </div>

        <div className="generator-facts" aria-label="Parâmetros da geração">
          <div>
            <span>Funcionamento</span>
            <strong>
              {operatingIntervals
                ? formatIntervals(operatingIntervals)
                : "Data ou calendário inválido"}
            </strong>
          </div>
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
        </div>

        {resolvedPresence?.status === "configured" && windows && (
          <div className="generator-phase-preview">
            <p>Requisitos aplicados nesta data</p>
            <div className="generator-phase-grid">
              <div>
                <span>Abertura · {formatIntervals(windows.opening)}</span>
                <strong>{resolvedPresence.requirements.minimumAtOpening} mín.</strong>
              </div>
              <div>
                <span>Centro · {formatIntervals(windows.central)}</span>
                <strong>
                  {windows.central.length === 0
                    ? "Não existe"
                    : `${resolvedPresence.requirements.minimumDuringOperation} mín.`}
                </strong>
              </div>
              <div>
                <span>Fecho · {formatIntervals(windows.closing)}</span>
                <strong>{resolvedPresence.requirements.minimumAtClosing} mín.</strong>
              </div>
            </div>
            {windows.opening.some((opening) =>
              windows.closing.some((closing) =>
                opening.start < closing.end && closing.start < opening.end
              )
            ) && (
              <p className="generator-hint">
                Abertura e fecho sobrepõem-se. Nesse intervalo aplica-se
                o maior dos dois mínimos.
              </p>
            )}
          </div>
        )}

        <p className="generator-footnote">
          O V0 pesquisa turnos candidatos a cada 15 minutos e também nos
          limites exatos dos períodos. Um resultado sem solução não prova
          impossibilidade fora desta pesquisa.
        </p>
      </section>

      <section className="panel generator-results" aria-live="polite">
        <div className="panel-header">
          <div>
            <p className="section-kicker">Validação do motor</p>
            <h2>Resultado</h2>
          </div>
          {result && (
            <span className={`generator-status generator-status-${result.status}`}>
              {result.status === "generated" ? "Válido" : "Diagnóstico"}
            </span>
          )}
        </div>

        {unexpectedError ? (
          <div className="generator-result-body" role="alert">
            <h3>Erro inesperado na geração</h3>
            <p>{unexpectedError}</p>
            <p>O horário não foi gerado nem guardado.</p>
          </div>
        ) : result ? (
          <div className="generator-result-body">
            <h3>{resultLabels[result.status]}</h3>

            {result.status === "generated" && (
              <>
                <p>
                  {result.assignments.length === 0
                    ? "Os mínimos configurados são zero. Não foi necessário atribuir turnos."
                    : `${result.assignments.length} turno(s) contínuo(s) encontrado(s) e validado(s).`}
                </p>
                {result.assignments.length > 0 && (
                  <div className="generator-assignment-list">
                    {result.assignments.map((assignment) => {
                      const person = people.find(
                        (item) => item.id === assignment.personId
                      );
                      return (
                        <div className="generator-assignment" key={assignment.personId}>
                          <strong>{person?.name ?? assignment.personId}</strong>
                          <span>
                            {assignment.interval.start}–{assignment.interval.end}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
                <p className="generator-hint">
                  Validação V0: cobertura e disponibilidade. Ainda não existem
                  regras de descanso, contratos ou limites semanais.
                </p>
              </>
            )}

            {result.status === "closed" && (
              <p>A empresa está fechada nesta data. Não há turnos para gerar.</p>
            )}

            {result.issues.map((issue, index) => (
              <p className="generator-issue" key={index}>{issue}</p>
            ))}

            {result.shortages.length > 0 && (
              <>
                <h4>Intervalos com capacidade insuficiente</h4>
                <div className="generator-shortage-list">
                  {result.shortages.slice(0, 8).map((shortage, index) => (
                    <p key={index}>
                      <strong>
                        {shortage.interval.start}–{shortage.interval.end}
                      </strong>
                      <span>
                        {shortage.actual} disponível(is) para {shortage.required} necessário(s)
                      </span>
                    </p>
                  ))}
                </div>
                {result.shortages.length > 8 && (
                  <p className="generator-hint">
                    + {result.shortages.length - 8} outros intervalos com falta de cobertura.
                  </p>
                )}
              </>
            )}

            {result.status !== "closed" && result.status !== "invalid_input" && (
              <p className="generator-footnote">
                {result.exploredNodes} nó(s) de pesquisa analisado(s).
                {result.status !== "generated" &&
                  " Não foi publicado nenhum horário parcial."}
              </p>
            )}
          </div>
        ) : (
          <div className="generator-result-body generator-idle">
            <h3>{hasStaleResult ? "Parâmetros alterados" : "Sem geração realizada"}</h3>
            <p>
              {hasStaleResult
                ? "A configuração ou a data mudou desde a geração anterior. Executa novamente para obter um resultado atualizado."
                : "Clica em «Gerar horário» para testar a data escolhida sem alterar os dados guardados."}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
