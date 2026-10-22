import type {
  CoverageException,
  CoverageRequirement,
  OperatingHoursException,
  TimeInterval,
  Weekday,
  WeeklyCoverage,
  WeeklyOperatingHours,
} from "../types";
import {
  getCoverageGaps,
  hasOverlappingCoverage,
  isCoverageRequirementWithinOperation,
} from "../utils/coverage";
import {
  getOperatingIntervalsForDate,
  WEEKDAYS,
} from "../utils/operatingCalendar";

interface CoveragePanelProps {
  weeklyOperatingHours: WeeklyOperatingHours;
  operatingExceptions: OperatingHoursException[];
  weeklyCoverage: WeeklyCoverage;
  coverageExceptions: CoverageException[];
  onWeeklyCoverageChange: (coverage: WeeklyCoverage) => void;
  onCoverageExceptionsChange: (
    exceptions: CoverageException[]
  ) => void;
}

const weekdayLabels: Record<Weekday, string> = {
  monday: "Segunda",
  tuesday: "Terça",
  wednesday: "Quarta",
  thursday: "Quinta",
  friday: "Sexta",
  saturday: "Sábado",
  sunday: "Domingo",
};

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

const allTimes = Array.from(
  { length: 97 },
  (_, index) => minutesToTime(index * 15)
);

function formatIntervals(intervals: TimeInterval[]): string {
  if (intervals.length === 0) return "Empresa fechada";

  return intervals
    .map((interval) => `${interval.start}–${interval.end}`)
    .join(" · ");
}

function findOperatingIntervalForTime(
  time: string,
  operatingIntervals: TimeInterval[]
): TimeInterval | null {
  const minute = timeToMinutes(time);

  return (
    operatingIntervals.find((interval) => {
      const start = timeToMinutes(interval.start);
      const end = timeToMinutes(interval.end);

      return minute >= start && minute < end;
    }) ?? null
  );
}

function startOptions(
  operatingIntervals: TimeInterval[]
): string[] {
  return allTimes.filter((time) =>
    findOperatingIntervalForTime(
      time,
      operatingIntervals
    )
  );
}

function endOptions(
  start: string,
  operatingIntervals: TimeInterval[]
): string[] {
  const operatingInterval =
    findOperatingIntervalForTime(
      start,
      operatingIntervals
    );

  if (!operatingInterval) return [];

  const startMinutes = timeToMinutes(start);
  const endMinutes = timeToMinutes(
    operatingInterval.end
  );

  return allTimes.filter((time) => {
    const minute = timeToMinutes(time);

    return (
      minute > startMinutes &&
      minute <= endMinutes
    );
  });
}

function todayKey(): string {
  const now = new Date();
  const local = new Date(
    now.getTime() - now.getTimezoneOffset() * 60_000
  );

  return local.toISOString().slice(0, 10);
}

interface RequirementsEditorProps {
  operatingIntervals: TimeInterval[];
  requirements: CoverageRequirement[];
  onChange: (requirements: CoverageRequirement[]) => void;
}

function RequirementsEditor({
  operatingIntervals,
  requirements,
  onChange,
}: RequirementsEditorProps) {
  const gaps = getCoverageGaps(
    operatingIntervals,
    requirements
  );
  const overlaps = hasOverlappingCoverage(
    requirements
  );
  const invalid = requirements.some(
    (requirement) =>
      !isCoverageRequirementWithinOperation(
        requirement,
        operatingIntervals
      )
  );
  const complete =
    operatingIntervals.length === 0 ||
    (gaps.length === 0 &&
      !overlaps &&
      !invalid);

  const addRequirement = () => {
    const gap = gaps[0];

    if (!gap) return;

    onChange([
      ...requirements,
      {
        ...gap,
        minimumPeople: 1,
      },
    ]);
  };

  const updateRequirement = (
    index: number,
    patch: Partial<CoverageRequirement>
  ) => {
    onChange(
      requirements.map(
        (requirement, currentIndex) =>
          currentIndex === index
            ? {
                ...requirement,
                ...patch,
              }
            : requirement
      )
    );
  };

  const changeStart = (
    index: number,
    requirement: CoverageRequirement,
    start: string
  ) => {
    const operatingInterval =
      findOperatingIntervalForTime(
        start,
        operatingIntervals
      );

    if (!operatingInterval) return;

    const allowedEnds = endOptions(
      start,
      operatingIntervals
    );

    const currentEndValid =
      timeToMinutes(requirement.end) >
        timeToMinutes(start) &&
      timeToMinutes(requirement.end) <=
        timeToMinutes(operatingInterval.end);

    updateRequirement(index, {
      start,
      end: currentEndValid
        ? requirement.end
        : allowedEnds[0] ??
          operatingInterval.end,
    });
  };

  const removeRequirement = (index: number) => {
    onChange(
      requirements.filter(
        (_, currentIndex) =>
          currentIndex !== index
      )
    );
  };

  if (operatingIntervals.length === 0) {
    return (
      <div className="coverage-closed-state">
        <strong>Empresa fechada</strong>
        <span>
          Não é possível definir cobertura fora do
          calendário operacional.
        </span>
        {requirements.length > 0 && (
          <button
            type="button"
            className="secondary-button"
            onClick={() => onChange([])}
          >
            Limpar cobertura antiga
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="coverage-editor">
      <div
        className={
          complete
            ? "coverage-validation is-complete"
            : "coverage-validation is-incomplete"
        }
      >
        <strong>
          {complete
            ? "Cobertura completa"
            : "Configuração incompleta"}
        </strong>
        {!complete && (
          <span>
            {overlaps
              ? "Existem períodos sobrepostos."
              : invalid
                ? "Existe cobertura fora do funcionamento."
                : gaps.length > 0
                  ? `${gaps.length} período(s) sem cobertura.`
                  : "Revê a configuração."}
          </span>
        )}
      </div>

      {requirements.length === 0 ? (
        <div className="coverage-empty">
          Nenhuma cobertura definida. Isto não significa
          zero pessoas.
        </div>
      ) : (
        <div className="coverage-requirements">
          {requirements.map(
            (requirement, index) => (
              <div
                className="coverage-requirement-row"
                key={index}
              >
                <label className="select-field">
                  <span>Início</span>
                  <select
                    value={requirement.start}
                    onChange={(event) =>
                      changeStart(
                        index,
                        requirement,
                        event.target.value
                      )
                    }
                  >
                    {startOptions(
                      operatingIntervals
                    ).map((time) => (
                      <option
                        key={time}
                        value={time}
                      >
                        {time}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="select-field">
                  <span>Fim</span>
                  <select
                    value={requirement.end}
                    onChange={(event) =>
                      updateRequirement(index, {
                        end: event.target.value,
                      })
                    }
                  >
                    {endOptions(
                      requirement.start,
                      operatingIntervals
                    ).map((time) => (
                      <option
                        key={time}
                        value={time}
                      >
                        {time}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="coverage-number-field">
                  <span>Mínimo</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={requirement.minimumPeople}
                    onChange={(event) =>
                      updateRequirement(index, {
                        minimumPeople:
                          Math.max(
                            0,
                            Math.floor(
                              Number(
                                event.target.value
                              ) || 0
                            )
                          ),
                      })
                    }
                  />
                </label>

                <button
                  type="button"
                  className="icon-button coverage-remove"
                  onClick={() =>
                    removeRequirement(index)
                  }
                  aria-label="Remover período de cobertura"
                  title="Remover período"
                >
                  ×
                </button>
              </div>
            )
          )}
        </div>
      )}

      <div className="coverage-actions">
        <button
          type="button"
          className="secondary-button"
          onClick={addRequirement}
          disabled={gaps.length === 0}
        >
          + Adicionar período
        </button>

        {gaps.length > 0 && (
          <span>
            Próximo espaço: {gaps[0].start}–
            {gaps[0].end}
          </span>
        )}
      </div>
    </div>
  );
}

export default function CoveragePanel({
  weeklyOperatingHours,
  operatingExceptions,
  weeklyCoverage,
  coverageExceptions,
  onWeeklyCoverageChange,
  onCoverageExceptionsChange,
}: CoveragePanelProps) {
  const weeklyStatus = WEEKDAYS.map(
    (weekday) => {
      const operation =
        weeklyOperatingHours[weekday];
      const requirements =
        weeklyCoverage[weekday];
      const gaps = getCoverageGaps(
        operation,
        requirements
      );

      return {
        weekday,
        open: operation.length > 0,
        complete:
          operation.length === 0 ||
          (gaps.length === 0 &&
            !hasOverlappingCoverage(
              requirements
            ) &&
            requirements.every(
              (requirement) =>
                isCoverageRequirementWithinOperation(
                  requirement,
                  operation
                )
            )),
      };
    }
  );

  const openDays = weeklyStatus.filter(
    (status) => status.open
  );
  const completeDays = openDays.filter(
    (status) => status.complete
  ).length;

  const addException = () => {
    onCoverageExceptionsChange([
      ...coverageExceptions,
      {
        date: todayKey(),
        requirements: [],
      },
    ]);
  };

  const updateException = (
    index: number,
    next: CoverageException
  ) => {
    onCoverageExceptionsChange(
      coverageExceptions.map(
        (exception, currentIndex) =>
          currentIndex === index
            ? next
            : exception
      )
    );
  };

  const removeException = (index: number) => {
    onCoverageExceptionsChange(
      coverageExceptions.filter(
        (_, currentIndex) =>
          currentIndex !== index
      )
    );
  };

  return (
    <>
      <section
        className="overview-bar"
        aria-label="Resumo de cobertura"
      >
        <div className="overview-item">
          <span>Dias operacionais</span>
          <strong>{openDays.length}</strong>
        </div>
        <div className="overview-item">
          <span>Cobertura completa</span>
          <strong>
            {completeDays} / {openDays.length}
          </strong>
        </div>
        <div className="overview-item">
          <span>Exceções</span>
          <strong>{coverageExceptions.length}</strong>
        </div>
      </section>

      <div className="coverage-layout">
        <section className="panel coverage-panel">
          <div className="panel-header">
            <div>
              <p className="section-kicker">
                Ponto 4
              </p>
              <h2>Cobertura semanal</h2>
            </div>
            <p className="panel-help">
              Quantas pessoas são necessárias em cada
              período da operação.
            </p>
          </div>

          <div className="coverage-days">
            {WEEKDAYS.map((weekday) => (
              <article
                className="coverage-day"
                key={weekday}
              >
                <div className="coverage-day-header">
                  <div>
                    <strong>
                      {weekdayLabels[weekday]}
                    </strong>
                    <span>
                      {formatIntervals(
                        weeklyOperatingHours[
                          weekday
                        ]
                      )}
                    </span>
                  </div>
                </div>

                <RequirementsEditor
                  operatingIntervals={
                    weeklyOperatingHours[
                      weekday
                    ]
                  }
                  requirements={
                    weeklyCoverage[weekday]
                  }
                  onChange={(requirements) =>
                    onWeeklyCoverageChange({
                      ...weeklyCoverage,
                      [weekday]: requirements,
                    })
                  }
                />
              </article>
            ))}
          </div>
        </section>

        <aside className="panel coverage-exceptions-panel">
          <div className="panel-header compact">
            <div>
              <p className="section-kicker">
                Datas específicas
              </p>
              <h2>Exceções</h2>
            </div>
            <button
              type="button"
              className="primary-button"
              onClick={addException}
            >
              <span>+</span>
              Adicionar
            </button>
          </div>

          <p className="section-description">
            Substitui a cobertura semanal apenas numa
            data.
          </p>

          {coverageExceptions.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">◎</div>
              <strong>
                Nenhuma exceção definida
              </strong>
              <p>
                Aplica-se a cobertura semanal.
              </p>
            </div>
          ) : (
            <div className="coverage-exception-list">
              {coverageExceptions.map(
                (exception, index) => {
                  const operatingIntervals =
                    getOperatingIntervalsForDate(
                      exception.date,
                      weeklyOperatingHours,
                      operatingExceptions
                    );

                  return (
                    <article
                      className="coverage-exception-card"
                      key={index}
                    >
                      <div className="exception-topline">
                        <input
                          className="date-input"
                          type="date"
                          value={exception.date}
                          onChange={(event) =>
                            updateException(index, {
                              ...exception,
                              date: event.target.value,
                            })
                          }
                        />

                        <button
                          type="button"
                          className="icon-button"
                          onClick={() =>
                            removeException(index)
                          }
                          aria-label="Remover exceção de cobertura"
                          title="Remover exceção"
                        >
                          ×
                        </button>
                      </div>

                      <div className="coverage-operation-label">
                        Operação:{" "}
                        {formatIntervals(
                          operatingIntervals
                        )}
                      </div>

                      <RequirementsEditor
                        operatingIntervals={
                          operatingIntervals
                        }
                        requirements={
                          exception.requirements
                        }
                        onChange={(requirements) =>
                          updateException(index, {
                            ...exception,
                            requirements,
                          })
                        }
                      />
                    </article>
                  );
                }
              )}
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
