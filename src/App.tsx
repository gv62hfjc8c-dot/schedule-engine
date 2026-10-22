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

function formatIntervals(intervals: OperatingInterval[]): string {
  if (intervals.length === 0) return "Fechado";

  return intervals
    .map((interval) => `${interval.start}–${interval.end}`)
    .join(" · ");
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
        weeklyHours[weekday].reduce((dayTotal, interval) => {
          const [startHour, startMinute] = interval.start
            .split(":")
            .map(Number);
          const [endHour, endMinute] = interval.end
            .split(":")
            .map(Number);

          return (
            dayTotal +
            endHour * 60 +
            endMinute -
            (startHour * 60 + startMinute)
          );
        }, 0)
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

      return {
        ...current,
        [weekday]: [{ ...existing, [field]: value }],
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
        date: new Date().toISOString().slice(0, 10),
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

  const removeException = (index: number) => {
    setExceptions((current) =>
      current.filter((_, currentIndex) => currentIndex !== index)
    );
  };

  return (
    <main className="app-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Configuração</p>
          <h1>Schedule Engine</h1>
          <p className="page-subtitle">
            Define o calendário operacional base. O motor usa esta
            configuração continuamente ao longo do tempo.
          </p>
        </div>

        <div className="status-badge">Fundação V0</div>
      </header>

      <section className="summary-grid" aria-label="Resumo">
        <article className="summary-card">
          <span>Dias abertos</span>
          <strong>{summary.openDays}</strong>
        </article>
        <article className="summary-card">
          <span>Dias fechados</span>
          <strong>{summary.closedDays}</strong>
        </article>
        <article className="summary-card">
          <span>Horas semanais</span>
          <strong>{summary.weeklyHours}h</strong>
        </article>
        <article className="summary-card">
          <span>Exceções</span>
          <strong>{exceptions.length}</strong>
        </article>
      </section>

      <div className="dashboard-grid">
        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="section-kicker">Padrão semanal</p>
              <h2>Horário de funcionamento</h2>
            </div>
            <p className="panel-help">
              Cada dia pode estar aberto ou fechado.
            </p>
          </div>

          <div className="week-list">
            {WEEKDAYS.map((weekday) => {
              const intervals = weeklyHours[weekday];
              const closed = intervals.length === 0;
              const interval = intervals[0];

              return (
                <div
                  key={weekday}
                  className={`day-row ${closed ? "is-closed" : ""}`}
                >
                  <div className="day-name">
                    <strong>{weekdayLabels[weekday]}</strong>
                    <span>{formatIntervals(intervals)}</span>
                  </div>

                  <label className="closed-toggle">
                    <input
                      type="checkbox"
                      checked={closed}
                      onChange={() => toggleClosed(weekday)}
                    />
                    Fechado
                  </label>

                  <div className="time-editor">
                    {!closed && interval ? (
                      <>
                        <input
                          type="time"
                          value={interval.start}
                          onChange={(event) =>
                            updateDayInterval(
                              weekday,
                              "start",
                              event.target.value
                            )
                          }
                        />
                        <span>—</span>
                        <input
                          type="time"
                          value={interval.end}
                          onChange={(event) =>
                            updateDayInterval(
                              weekday,
                              "end",
                              event.target.value
                            )
                          }
                        />
                      </>
                    ) : (
                      <span className="closed-label">
                        Sem funcionamento
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <aside className="panel exceptions-panel">
          <div className="panel-header">
            <div>
              <p className="section-kicker">Datas especiais</p>
              <h2>Exceções</h2>
            </div>
            <button className="primary-button" onClick={addException}>
              + Adicionar
            </button>
          </div>

          {exceptions.length === 0 ? (
            <div className="empty-state">
              <strong>Sem exceções</strong>
              <p>
                Usa exceções para feriados, encerramentos ou horários
                especiais.
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
                        className="ghost-button"
                        onClick={() => removeException(index)}
                      >
                        Remover
                      </button>
                    </div>

                    <label className="closed-toggle">
                      <input
                        type="checkbox"
                        checked={closed}
                        onChange={() =>
                          updateException(index, {
                            ...exception,
                            intervals: closed
                              ? [{ start: "09:00", end: "18:00" }]
                              : [],
                          })
                        }
                      />
                      Fechado
                    </label>

                    {!closed && (
                      <div className="exception-times">
                        <input
                          type="time"
                          value={interval.start}
                          onChange={(event) =>
                            updateException(index, {
                              ...exception,
                              intervals: [
                                {
                                  ...interval,
                                  start: event.target.value,
                                },
                              ],
                            })
                          }
                        />
                        <span>até</span>
                        <input
                          type="time"
                          value={interval.end}
                          onChange={(event) =>
                            updateException(index, {
                              ...exception,
                              intervals: [
                                {
                                  ...interval,
                                  end: event.target.value,
                                },
                              ],
                            })
                          }
                        />
                      </div>
                    )}
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
