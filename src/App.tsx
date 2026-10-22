import { useMemo, useState } from "react";
import type {
  OperatingHoursException,
  OperatingInterval,
  SchedulePeriod,
  Weekday,
  WeeklyOperatingHours,
} from "./types";
import {
  getDatesInPeriod,
  getOperatingIntervalsForDate,
  WEEKDAYS,
} from "./utils/operatingCalendar";

const weekdayLabels: Record<Weekday, string> = {
  monday: "Segunda",
  tuesday: "Terça",
  wednesday: "Quarta",
  thursday: "Quinta",
  friday: "Sexta",
  saturday: "Sábado",
  sunday: "Domingo",
};

const initialPeriod: SchedulePeriod = {
  startDate: "2026-10-26",
  endDate: "2026-11-01",
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
  const [period, setPeriod] = useState<SchedulePeriod>(initialPeriod);
  const [weeklyHours, setWeeklyHours] =
    useState<WeeklyOperatingHours>(initialWeeklyOperatingHours);
  const [exceptions, setExceptions] = useState<
    OperatingHoursException[]
  >([]);

  const dates = useMemo(() => {
    try {
      return getDatesInPeriod(period);
    } catch {
      return [];
    }
  }, [period]);

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
        [weekday]: [
          {
            ...existing,
            [field]: value,
          },
        ],
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
    const firstDate = dates[0];

    if (!firstDate) return;

    setExceptions((current) => [
      ...current,
      {
        date: firstDate,
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
    <main
      style={{
        maxWidth: 1040,
        margin: "0 auto",
        padding: 32,
        fontFamily: "Arial, sans-serif",
      }}
    >
      <h1>Schedule Engine</h1>

      <p>
        Fundação V0 — período de planeamento e horário de funcionamento.
      </p>

      <section style={sectionStyle}>
        <h2>1. Período de planeamento</h2>

        <div style={rowStyle}>
          <label>
            Data inicial
            <input
              type="date"
              value={period.startDate}
              onChange={(event) =>
                setPeriod((current) => ({
                  ...current,
                  startDate: event.target.value,
                }))
              }
              style={inputStyle}
            />
          </label>

          <label>
            Data final
            <input
              type="date"
              value={period.endDate}
              onChange={(event) =>
                setPeriod((current) => ({
                  ...current,
                  endDate: event.target.value,
                }))
              }
              style={inputStyle}
            />
          </label>
        </div>

        {dates.length === 0 ? (
          <p style={{ color: "#a00" }}>
            O período definido não é válido.
          </p>
        ) : (
          <p>{dates.length} dia(s) no período.</p>
        )}
      </section>

      <section style={sectionStyle}>
        <h2>2. Horário semanal padrão</h2>

        <p>
          Esta configuração pertence à empresa/aplicação. O motor apenas a
          recebe e utiliza.
        </p>

        <div style={{ display: "grid", gap: 12 }}>
          {WEEKDAYS.map((weekday) => {
            const intervals = weeklyHours[weekday];
            const closed = intervals.length === 0;
            const interval = intervals[0];

            return (
              <div
                key={weekday}
                style={{
                  display: "grid",
                  gridTemplateColumns: "120px 100px 1fr",
                  gap: 12,
                  alignItems: "center",
                }}
              >
                <strong>{weekdayLabels[weekday]}</strong>

                <label>
                  <input
                    type="checkbox"
                    checked={closed}
                    onChange={() => toggleClosed(weekday)}
                  />{" "}
                  Fechado
                </label>

                {!closed && interval && (
                  <div style={rowStyle}>
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
                    <span>até</span>
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
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section style={sectionStyle}>
        <h2>3. Exceções por data</h2>

        <p>
          Uma exceção substitui o horário semanal dessa data. Por agora,
          pode marcar o dia como fechado ou definir um único intervalo.
        </p>

        <button onClick={addException} disabled={dates.length === 0}>
          Adicionar exceção
        </button>

        <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
          {exceptions.map((exception, index) => {
            const closed = exception.intervals.length === 0;
            const interval = exception.intervals[0] ?? {
              start: "09:00",
              end: "18:00",
            };

            return (
              <div
                key={index}
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
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

                <label>
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
                  />{" "}
                  Fechado
                </label>

                {!closed && (
                  <>
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
                  </>
                )}

                <button onClick={() => removeException(index)}>
                  Remover
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <section style={sectionStyle}>
        <h2>Calendário operacional resultante</h2>

        {dates.length > 0 && (
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
            }}
          >
            <thead>
              <tr>
                <th style={cellStyle}>Data</th>
                <th style={cellStyle}>Funcionamento</th>
              </tr>
            </thead>

            <tbody>
              {dates.map((date) => {
                const intervals = getOperatingIntervalsForDate(
                  date,
                  weeklyHours,
                  exceptions
                );

                return (
                  <tr key={date}>
                    <td style={cellStyle}>{date}</td>
                    <td style={cellStyle}>
                      {formatIntervals(intervals)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}

const sectionStyle = {
  marginTop: 28,
  padding: 20,
  border: "1px solid #ddd",
  borderRadius: 8,
};

const rowStyle = {
  display: "flex",
  gap: 12,
  alignItems: "center",
  flexWrap: "wrap" as const,
};

const inputStyle = {
  display: "block",
  marginTop: 6,
};

const cellStyle = {
  border: "1px solid #ddd",
  padding: 10,
  textAlign: "left" as const,
};
