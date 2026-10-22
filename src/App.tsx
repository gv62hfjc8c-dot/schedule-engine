import { useMemo, useState } from "react";
import type {
  OperatingHoursException,
  OperatingInterval,
  Weekday,
  WeeklyOperatingHours,
} from "./types";
import { WEEKDAYS } from "./utils/operatingCalendar";

const weekdayLabels: Record<Weekday, string> = {
  monday: "Segunda",
  tuesday: "Terça",
  wednesday: "Quarta",
  thursday: "Quinta",
  friday: "Sexta",
  saturday: "Sábado",
  sunday: "Domingo",
};

const initialWeeklyOperatingHours: WeeklyOperatingHours = {
  monday: [{ start: "09:00", end: "18:00" }],
  tuesday: [{ start: "09:00", end: "18:00" }],
  wednesday: [{ start: "09:00", end: "18:00" }],
  thursday: [{ start: "09:00", end: "18:00" }],
  friday: [{ start: "09:00", end: "18:00" }],
  saturday: [{ start: "09:00", end: "13:00" }],
  sunday: [],
};

function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

const openingOptions = Array.from(
  { length: 96 },
  (_, index) => minutesToTime(index * 15)
);

const closingOptions = Array.from(
  { length: 96 },
  (_, index) => minutesToTime((index + 1) * 15)
);

function closingOptionsAfter(start: string): string[] {
  const startMinutes = timeToMinutes(start);

  return closingOptions.filter(
    (time) => timeToMinutes(time) > startMinutes
  );
}

function normalizeEnd(start: string, end: string): string {
  if (timeToMinutes(end) > timeToMinutes(start)) {
    return end;
  }

  return minutesToTime(
    Math.min(timeToMinutes(start) + 15, 24 * 60)
  );
}

function formatIntervals(intervals: OperatingInterval[]): string {
  if (intervals.length === 0) return "Fechado";

  return intervals
    .map((interval) => `${interval.start}–${interval.end}`)
    .join(" · ");
}

function todayKey(): string {
  const now = new Date();
  const local = new Date(
    now.getTime() - now.getTimezoneOffset() * 60_000
  );

  return local.toISOString().slice(0, 10);
}

export default function App() {
  const [weeklyHours, setWeeklyHours] =
    useState<WeeklyOperatingHours>(initialWeeklyOperatingHours);
  const [exceptions, setExceptions] = useState<
    OperatingHoursException[]
  >([]);

  const summary = useMemo(() => {
    const openDays = WEEKDAYS.filter(
      (weekday) => weeklyHours[weekday].length > 0
    ).length;

    const totalWeeklyMinutes = WEEKDAYS.reduce((total, weekday) => {
      return (
        total +
        weeklyHours[weekday].reduce(
          (dayTotal, interval) =>
            dayTotal +
            timeToMinutes(interval.end) -
            timeToMinutes(interval.start),
          0
        )
      );
    }, 0);

    return {
      openDays,
      closedDays: 7 - openDays,
      weeklyHours: Math.round((totalWeeklyMinutes / 60) * 10) / 10,
    };
  }, [weeklyHours]);

  const updateDayInterval = (
    weekday: Weekday,
    field: "start" | "end",
    value: string
  ) => {
    setWeeklyHours((current) => {
      const existing = current[weekday][0] ?? {
        start: "09:00",
        end: "18:00",
      };

      const next =
        field === "start"
          ? {
              start: value,
              end: normalizeEnd(value, existing.end),
            }
          : {
              start: existing.start,
              end: value,
            };

      return {
        ...current,
        [weekday]: [next],
      };
    });
  };

  const toggleClosed = (weekday: Weekday) => {
    setWeeklyHours((current) => ({
      ...current,
      [weekday]:
        current[weekday].length === 0
          ? [{ start: "09:00", end: "18:00" }]
          : [],
    }));
  };

  const addException = () => {
    setExceptions((current) => [
      ...current,
      {
        date: todayKey(),
        intervals: [],
      },
    ]);
  };

  const updateException = (
    index: number,
    next: OperatingHoursException
  ) => {
    setExceptions((current) =>
      current.map((exception, currentIndex) =>
        currentIndex === index ? next : exception
      )
    );
  };

  const updateExceptionInterval = (
    index: number,
    exception: OperatingHoursException,
    field: "start" | "end",
    value: string
  ) => {
    const existing = exception.intervals[0] ?? {
      start: "09:00",
      end: "18:00",
    };

    const nextInterval =
      field === "start"
        ? {
            start: value,
            end: normalizeEnd(value, existing.end),
          }
        : {
            start: existing.start,
            end: value,
          };

    updateException(index, {
      ...exception,
      intervals: [nextInterval],
    });
  };

  const removeException = (index: number) => {
    setExceptions((current) =>
      current.filter((_, currentIndex) => currentIndex !== index)
    );
  };

  return (
    <main className="app-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Configuração operacional</p>
          <h1>Schedule Engine</h1>
          <p className="page-subtitle">
            Define quando a operação está aberta. Esta base será usada
            continuamente pelo motor, independentemente da empresa.
          </p>
        </div>

        <div className="status-badge">
          <span className="status-dot" />
          Fundação V0
        </div>
      </header>

      <section className="overview-bar" aria-label="Resumo">
        <div className="overview-item">
          <span>Semana padrão</span>
          <strong>{summary.openDays} dias abertos</strong>
        </div>
        <div className="overview-divider" />
        <div className="overview-item">
          <span>Funcionamento</span>
          <strong>{summary.weeklyHours}h / semana</strong>
        </div>
        <div className="overview-divider" />
        <div className="overview-item">
          <span>Encerrados</span>
          <strong>{summary.closedDays} dias</strong>
        </div>
        <div className="overview-divider" />
        <div className="overview-item">
          <span>Datas especiais</span>
          <strong>{exceptions.length} exceções</strong>
        </div>
      </section>

      <div className="dashboard-grid">
        <section className="panel schedule-panel">
          <div className="panel-header">
            <div>
              <p className="section-kicker">Padrão semanal</p>
              <h2>Horário de funcionamento</h2>
            </div>
            <p className="panel-help">
              Configuração recorrente de segunda a domingo.
            </p>
          </div>

          <div className="schedule-table">
            <div className="schedule-head" aria-hidden="true">
              <span>Dia</span>
              <span>Estado</span>
              <span>Abertura</span>
              <span>Fecho</span>
            </div>

            {WEEKDAYS.map((weekday) => {
              const intervals = weeklyHours[weekday];
              const closed = intervals.length === 0;
              const interval = intervals[0];

              return (
                <div
                  key={weekday}
                  className={`schedule-row ${closed ? "is-closed" : ""}`}
                >
                  <div className="day-name">
                    <strong>{weekdayLabels[weekday]}</strong>
                    <span>{formatIntervals(intervals)}</span>
                  </div>

                  <button
                    type="button"
                    className={`state-button ${closed ? "closed" : "open"}`}
                    onClick={() => toggleClosed(weekday)}
                    aria-label={`${weekdayLabels[weekday]}: ${closed ? "fechado" : "aberto"}. Alterar estado.`}
                  >
                    <span className="state-dot" />
                    {closed ? "Fechado" : "Aberto"}
                  </button>

                  {!closed && interval ? (
                    <>
                      <label className="select-field">
                        <span className="sr-only">
                          Abertura de {weekdayLabels[weekday]}
                        </span>
                        <select
                          value={interval.start}
                          onChange={(event) =>
                            updateDayInterval(
                              weekday,
                              "start",
                              event.target.value
                            )
                          }
                        >
                          {openingOptions.map((time) => (
                            <option key={time} value={time}>
                              {time}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="select-field">
                        <span className="sr-only">
                          Fecho de {weekdayLabels[weekday]}
                        </span>
                        <select
                          value={interval.end}
                          onChange={(event) =>
                            updateDayInterval(
                              weekday,
                              "end",
                              event.target.value
                            )
                          }
                        >
                          {closingOptionsAfter(interval.start).map(
                            (time) => (
                              <option key={time} value={time}>
                                {time}
                              </option>
                            )
                          )}
                        </select>
                      </label>
                    </>
                  ) : (
                    <div className="closed-span">
                      Sem horário de funcionamento
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <aside className="panel exceptions-panel">
          <div className="panel-header compact">
            <div>
              <p className="section-kicker">Datas especiais</p>
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
            Feriados, encerramentos ou horários diferentes do padrão.
          </p>

          {exceptions.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">◎</div>
              <strong>Nenhuma exceção definida</strong>
              <p>
                O padrão semanal aplica-se a todas as datas.
              </p>
            </div>
          ) : (
            <div className="exception-list">
              {exceptions.map((exception, index) => {
                const closed = exception.intervals.length === 0;
                const interval = exception.intervals[0] ?? {
                  start: "09:00",
                  end: "18:00",
                };

                return (
                  <article className="exception-card" key={index}>
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
                        onClick={() => removeException(index)}
                        aria-label="Remover exceção"
                        title="Remover exceção"
                      >
                        ×
                      </button>
                    </div>

                    <div className="exception-controls">
                      <button
                        type="button"
                        className={`state-button ${closed ? "closed" : "open"}`}
                        onClick={() =>
                          updateException(index, {
                            ...exception,
                            intervals: closed
                              ? [{ start: "09:00", end: "18:00" }]
                              : [],
                          })
                        }
                      >
                        <span className="state-dot" />
                        {closed ? "Fechado" : "Aberto"}
                      </button>

                      {!closed && (
                        <div className="exception-time-grid">
                          <label className="select-field">
                            <span>Abertura</span>
                            <select
                              value={interval.start}
                              onChange={(event) =>
                                updateExceptionInterval(
                                  index,
                                  exception,
                                  "start",
                                  event.target.value
                                )
                              }
                            >
                              {openingOptions.map((time) => (
                                <option key={time} value={time}>
                                  {time}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label className="select-field">
                            <span>Fecho</span>
                            <select
                              value={interval.end}
                              onChange={(event) =>
                                updateExceptionInterval(
                                  index,
                                  exception,
                                  "end",
                                  event.target.value
                                )
                              }
                            >
                              {closingOptionsAfter(interval.start).map(
                                (time) => (
                                  <option key={time} value={time}>
                                    {time}
                                  </option>
                                )
                              )}
                            </select>
                          </label>
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
