import { useMemo, useState } from "react";
import type {
  OperatingHoursException,
  OperatingInterval,
  Person,
  Weekday,
  WeeklyOperatingHours,
} from "./types";
import { WEEKDAYS } from "./utils/operatingCalendar";
import {
  createPerson,
  getActivePeople,
  renamePerson,
  setPersonActive,
} from "./utils/people";

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

function getInitials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export default function App() {
  const [weeklyHours, setWeeklyHours] =
    useState<WeeklyOperatingHours>(initialWeeklyOperatingHours);
  const [exceptions, setExceptions] = useState<
    OperatingHoursException[]
  >([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [newPersonName, setNewPersonName] = useState("");
  const [editingPersonId, setEditingPersonId] = useState<string | null>(
    null
  );
  const [editingPersonName, setEditingPersonName] = useState("");
  const [personError, setPersonError] = useState("");

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

  const activePeople = useMemo(
    () => getActivePeople(people),
    [people]
  );

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

  const addPerson = () => {
    try {
      const person = createPerson(
        crypto.randomUUID(),
        newPersonName
      );

      setPeople((current) => [...current, person]);
      setNewPersonName("");
      setPersonError("");
    } catch (error) {
      setPersonError(
        error instanceof Error ? error.message : "Nome inválido."
      );
    }
  };

  const startEditingPerson = (person: Person) => {
    setEditingPersonId(person.id);
    setEditingPersonName(person.name);
    setPersonError("");
  };

  const cancelEditingPerson = () => {
    setEditingPersonId(null);
    setEditingPersonName("");
    setPersonError("");
  };

  const savePersonName = (person: Person) => {
    try {
      const renamed = renamePerson(person, editingPersonName);

      setPeople((current) =>
        current.map((candidate) =>
          candidate.id === person.id ? renamed : candidate
        )
      );

      cancelEditingPerson();
    } catch (error) {
      setPersonError(
        error instanceof Error ? error.message : "Nome inválido."
      );
    }
  };

  const changePersonActive = (
    person: Person,
    active: boolean
  ) => {
    setPeople((current) =>
      current.map((candidate) =>
        candidate.id === person.id
          ? setPersonActive(candidate, active)
          : candidate
      )
    );

    if (editingPersonId === person.id) {
      cancelEditingPerson();
    }
  };

  return (
    <main className="app-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Configuração operacional</p>
          <h1>Schedule Engine</h1>
          <p className="page-subtitle">
            Define a base que o motor irá usar continuamente:
            funcionamento da operação e pessoas que podem ser escaladas.
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
        <div className="overview-item">
          <span>Funcionamento</span>
          <strong>{summary.weeklyHours}h / semana</strong>
        </div>
        <div className="overview-item">
          <span>Datas especiais</span>
          <strong>{exceptions.length} exceções</strong>
        </div>
        <div className="overview-item">
          <span>Pessoas ativas</span>
          <strong>{activePeople.length}</strong>
        </div>
        <div className="overview-item">
          <span>Arquivadas</span>
          <strong>{people.length - activePeople.length}</strong>
        </div>
      </section>

      <div className="dashboard-grid">
        <section className="panel schedule-panel">
          <div className="panel-header">
            <div>
              <p className="section-kicker">Ponto 1</p>
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
              <p>O padrão semanal aplica-se a todas as datas.</p>
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

      <section className="panel people-panel">
        <div className="panel-header people-header">
          <div>
            <p className="section-kicker">Ponto 2</p>
            <h2>Pessoas</h2>
            <p className="people-description">
              Pessoas ativas podem participar em horários futuros.
              Arquivar mantém a pessoa no sistema sem a considerar para
              novas escalas.
            </p>
          </div>

          <div className="people-count">
            <strong>{activePeople.length}</strong>
            <span>ativas</span>
          </div>
        </div>

        <form
          className="person-form"
          onSubmit={(event) => {
            event.preventDefault();
            addPerson();
          }}
        >
          <label className="text-field">
            <span>Nome</span>
            <input
              type="text"
              value={newPersonName}
              onChange={(event) => {
                setNewPersonName(event.target.value);
                setPersonError("");
              }}
              placeholder="Nome da pessoa"
            />
          </label>

          <button className="primary-button add-person-button" type="submit">
            <span>+</span>
            Adicionar pessoa
          </button>
        </form>

        {personError && (
          <p className="form-error" role="alert">
            {personError}
          </p>
        )}

        {people.length === 0 ? (
          <div className="people-empty">
            <div className="empty-icon">◎</div>
            <strong>Ainda não existem pessoas</strong>
            <p>
              Adiciona a primeira pessoa que poderá ser usada pelo motor.
            </p>
          </div>
        ) : (
          <div className="people-table">
            <div className="people-head" aria-hidden="true">
              <span>Pessoa</span>
              <span>Estado</span>
              <span>Ações</span>
            </div>

            {[...people]
              .sort(
                (a, b) =>
                  Number(b.active) - Number(a.active) ||
                  a.name.localeCompare(b.name)
              )
              .map((person) => {
                const editing = editingPersonId === person.id;

                return (
                  <div
                    className={`person-row ${person.active ? "" : "is-archived"}`}
                    key={person.id}
                  >
                    <div className="person-identity">
                      <div className="person-avatar" aria-hidden="true">
                        {getInitials(person.name)}
                      </div>

                      {editing ? (
                        <input
                          className="inline-name-input"
                          type="text"
                          value={editingPersonName}
                          onChange={(event) => {
                            setEditingPersonName(event.target.value);
                            setPersonError("");
                          }}
                          autoFocus
                        />
                      ) : (
                        <div>
                          <strong>{person.name}</strong>
                          <span>ID {person.id.slice(0, 8)}</span>
                        </div>
                      )}
                    </div>

                    <div>
                      <span
                        className={`person-status ${person.active ? "active" : "archived"}`}
                      >
                        <span />
                        {person.active ? "Ativa" : "Arquivada"}
                      </span>
                    </div>

                    <div className="person-actions">
                      {editing ? (
                        <>
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={cancelEditingPerson}
                          >
                            Cancelar
                          </button>
                          <button
                            type="button"
                            className="primary-button"
                            onClick={() => savePersonName(person)}
                          >
                            Guardar
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => startEditingPerson(person)}
                          >
                            Editar
                          </button>

                          {person.active ? (
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() =>
                                changePersonActive(person, false)
                              }
                            >
                              Arquivar
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() =>
                                changePersonActive(person, true)
                              }
                            >
                              Reativar
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </section>
    </main>
  );
}
