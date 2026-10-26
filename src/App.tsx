import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AvailabilityException,
  OperatingHoursException,
  OperatingInterval,
  Person,
  PersonAvailability,
  PresenceException,
  WeeklyPresenceRequirements,
  Weekday,
  WeeklyOperatingHours,
  WorkRulesConfiguration,
} from "./types";
import WorkRulesPanel from "./components/WorkRulesPanel";
import PresencePanel from "./components/PresencePanel";
import { createEmptyWeeklyPresenceRequirements } from "./utils/presence";
import { appStateRepository } from "./persistence/appStateRepository";
import { APP_STATE_VERSION } from "./persistence/stateRepository";
import {
  createPersonAvailability,
  intersectIntervals,
} from "./utils/availability";
import {
  getOperatingIntervalsForDate,
  WEEKDAYS,
} from "./utils/operatingCalendar";
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

function openingOptionsWithin(
  interval: OperatingInterval
): string[] {
  const start = timeToMinutes(interval.start);
  const end = timeToMinutes(interval.end);

  return openingOptions.filter((time) => {
    const minutes = timeToMinutes(time);

    return minutes >= start && minutes < end;
  });
}

function closingOptionsWithin(
  start: string,
  interval: OperatingInterval
): string[] {
  const startMinutes = timeToMinutes(start);
  const operationEnd = timeToMinutes(interval.end);

  return closingOptions.filter((time) => {
    const minutes = timeToMinutes(time);

    return (
      minutes > startMinutes &&
      minutes <= operationEnd
    );
  });
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

function formatAvailabilityIntervals(
  intervals: OperatingInterval[]
): string {
  if (intervals.length === 0) return "Indisponível";

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
  const [availabilities, setAvailabilities] = useState<
    PersonAvailability[]
  >([]);
  const [workRules, setWorkRules] =
    useState<WorkRulesConfiguration>({
      standardShiftDurationMinutes: null,
    });
  const [weeklyPresenceRequirements, setWeeklyPresenceRequirements] =
    useState<WeeklyPresenceRequirements>(createEmptyWeeklyPresenceRequirements);
  const [presenceExceptions, setPresenceExceptions] =
    useState<PresenceException[]>([]);
  const [newPersonName, setNewPersonName] = useState("");
  const [editingPersonId, setEditingPersonId] = useState<string | null>(
    null
  );
  const [editingPersonName, setEditingPersonName] = useState("");
  const [personError, setPersonError] = useState("");
  const [activeSection, setActiveSection] = useState<
    "calendar" | "people" | "availability" | "workRules" | "presence"
  >("calendar");
  const [
    selectedAvailabilityPersonId,
    setSelectedAvailabilityPersonId,
  ] = useState<string | null>(null);
  const [persistenceReady, setPersistenceReady] = useState(false);
  const [persistenceProblem, setPersistenceProblem] = useState<string | null>(null);
  const skipInitialSave = useRef(true);
  const [persistenceStatus, setPersistenceStatus] = useState<
    "loading" | "saving" | "saved" | "error"
  >("loading");
  const saveRequestId = useRef(0);

  useEffect(() => {
    let cancelled = false;

    async function loadPersistedState() {
      try {
        const persisted = await appStateRepository.load();

        if (cancelled) return;

        if (persisted) {
          setWeeklyHours(persisted.weeklyOperatingHours);
          setExceptions(persisted.exceptions);
          setPeople(persisted.people);
          setAvailabilities(persisted.availabilities);
          setWorkRules(persisted.workRules);
          setWeeklyPresenceRequirements(persisted.weeklyPresenceRequirements);
          setPresenceExceptions(persisted.presenceExceptions);
        }

        setPersistenceReady(true);
        setPersistenceStatus("saved");
      } catch (error) {
        if (cancelled) return;

        // Never enable autosave when hydration fails.
        setPersistenceReady(false);
        setPersistenceProblem(
          error instanceof Error
            ? error.message
            : "Não foi possível carregar os dados guardados."
        );
        setPersistenceStatus("error");
      }
    }

    void loadPersistedState();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!persistenceReady) return;

    // Loading existing data is not a user change.
    if (skipInitialSave.current) {
      skipInitialSave.current = false;
      return;
    }

    const requestId = ++saveRequestId.current;
    setPersistenceStatus("saving");

    const timeoutId = window.setTimeout(() => {
      void appStateRepository
        .save({
          version: APP_STATE_VERSION,
          weeklyOperatingHours: weeklyHours,
          exceptions,
          people,
          availabilities,
          workRules,
          weeklyPresenceRequirements,
          presenceExceptions,
        })
        .then(() => {
          if (requestId === saveRequestId.current) {
            setPersistenceStatus("saved");
          }
        })
        .catch((error) => {
          if (requestId === saveRequestId.current) {
            setPersistenceReady(false);
            setPersistenceProblem(
              error instanceof Error
                ? error.message
                : "Não foi possível guardar os dados."
            );
            setPersistenceStatus("error");
          }
        });
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    persistenceReady,
    weeklyHours,
    exceptions,
    people,
    availabilities,
    workRules,
    weeklyPresenceRequirements,
    presenceExceptions,
  ]);

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

  const selectedAvailabilityPerson =
    activePeople.find(
      (person) => person.id === selectedAvailabilityPersonId
    ) ??
    activePeople[0] ??
    null;

  const selectedAvailability = selectedAvailabilityPerson
    ? availabilities.find(
        (availability) =>
          availability.personId === selectedAvailabilityPerson.id
      ) ?? createPersonAvailability(selectedAvailabilityPerson.id)
    : null;

  const availabilitySummary = useMemo(() => {
    if (!selectedAvailability) {
      return {
        availableDays: 0,
        exceptions: 0,
      };
    }

    return {
      availableDays: WEEKDAYS.filter(
        (weekday) =>
          intersectIntervals(
            selectedAvailability.weeklyAvailability[weekday],
            weeklyHours[weekday]
          ).length > 0
      ).length,
      exceptions: selectedAvailability.exceptions.length,
    };
  }, [selectedAvailability, weeklyHours]);

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
      setAvailabilities((current) => [
        ...current,
        createPersonAvailability(person.id),
      ]);
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

  const upsertAvailability = (
    nextAvailability: PersonAvailability
  ) => {
    setAvailabilities((current) => {
      const exists = current.some(
        (availability) =>
          availability.personId === nextAvailability.personId
      );

      if (!exists) {
        return [...current, nextAvailability];
      }

      return current.map((availability) =>
        availability.personId === nextAvailability.personId
          ? nextAvailability
          : availability
      );
    });
  };

  const toggleAvailabilityDay = (weekday: Weekday) => {
    if (!selectedAvailability) return;

    const operatingIntervals = weeklyHours[weekday];
    const defaultInterval = operatingIntervals[0];

    if (!defaultInterval) return;

    const currentIntervals =
      selectedAvailability.weeklyAvailability[weekday];

    const currentlyAvailable =
      intersectIntervals(
        currentIntervals,
        operatingIntervals
      ).length > 0;

    upsertAvailability({
      ...selectedAvailability,
      weeklyAvailability: {
        ...selectedAvailability.weeklyAvailability,
        [weekday]: currentlyAvailable
          ? []
          : [{ ...defaultInterval }],
      },
    });
  };

  const updateAvailabilityInterval = (
    weekday: Weekday,
    field: "start" | "end",
    value: string
  ) => {
    if (!selectedAvailability) return;

    const operatingInterval = weeklyHours[weekday][0];

    if (!operatingInterval) return;

    const effectiveExisting =
      intersectIntervals(
        selectedAvailability.weeklyAvailability[weekday],
        [operatingInterval]
      )[0] ?? operatingInterval;

    const next =
      field === "start"
        ? {
            start: value,
            end:
              timeToMinutes(effectiveExisting.end) >
              timeToMinutes(value)
                ? effectiveExisting.end
                : closingOptionsWithin(
                    value,
                    operatingInterval
                  )[0] ?? operatingInterval.end,
          }
        : {
            start: effectiveExisting.start,
            end: value,
          };

    upsertAvailability({
      ...selectedAvailability,
      weeklyAvailability: {
        ...selectedAvailability.weeklyAvailability,
        [weekday]: [next],
      },
    });
  };

  const addAvailabilityException = () => {
    if (!selectedAvailability) return;

    upsertAvailability({
      ...selectedAvailability,
      exceptions: [
        ...selectedAvailability.exceptions,
        {
          date: todayKey(),
          intervals: [],
        },
      ],
    });
  };

  const updateAvailabilityException = (
    index: number,
    next: AvailabilityException
  ) => {
    if (!selectedAvailability) return;

    upsertAvailability({
      ...selectedAvailability,
      exceptions: selectedAvailability.exceptions.map(
        (exception, currentIndex) =>
          currentIndex === index ? next : exception
      ),
    });
  };

  const updateAvailabilityExceptionInterval = (
    index: number,
    exception: AvailabilityException,
    field: "start" | "end",
    value: string
  ) => {
    const operatingInterval =
      getOperatingIntervalsForDate(
        exception.date,
        weeklyHours,
        exceptions
      )[0];

    if (!operatingInterval) return;

    const effectiveExisting =
      intersectIntervals(
        exception.intervals,
        [operatingInterval]
      )[0] ?? operatingInterval;

    const nextInterval =
      field === "start"
        ? {
            start: value,
            end:
              timeToMinutes(effectiveExisting.end) >
              timeToMinutes(value)
                ? effectiveExisting.end
                : closingOptionsWithin(
                    value,
                    operatingInterval
                  )[0] ?? operatingInterval.end,
          }
        : {
            start: effectiveExisting.start,
            end: value,
          };

    updateAvailabilityException(index, {
      ...exception,
      intervals: [nextInterval],
    });
  };

  const removeAvailabilityException = (index: number) => {
    if (!selectedAvailability) return;

    upsertAvailability({
      ...selectedAvailability,
      exceptions: selectedAvailability.exceptions.filter(
        (_, currentIndex) => currentIndex !== index
      ),
    });
  };

  if (persistenceProblem) {
    return (
      <main className="app-shell">
        <header className="page-header">
          <div>
            <p className="eyebrow">Proteção dos dados</p>
            <h1>Schedule Engine</h1>
          </div>
        </header>
        <section className="panel" role="alert" style={{ padding: "24px" }}>
          <h2>Dados guardados não carregados</h2>
          <p style={{ marginTop: "12px" }}>
            {persistenceProblem}
          </p>
          <p>
            Para evitar substituir dados existentes por um estado vazio,
            a aplicação bloqueou a edição e a gravação automática.
            Não limpes os dados do navegador. Confirma a versão da
            aplicação antes de voltares a carregar esta página.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Configuração operacional</p>
          <h1>Schedule Engine</h1>
          <p className="page-subtitle">
            Define a base que o motor irá usar continuamente:
            funcionamento, pessoas, disponibilidade, regras de trabalho e presença mínima.
          </p>
        </div>

        <div className="header-statuses">
          <div className="status-badge">
            <span className="status-dot" />
            Fundação V0
          </div>

          <div
            className={`save-status ${persistenceStatus}`}
            title="Estado da gravação local"
          >
            <span className="save-status-dot" />
            {persistenceStatus === "loading" && "A carregar"}
            {persistenceStatus === "saving" && "A guardar"}
            {persistenceStatus === "saved" && "Guardado"}
            {persistenceStatus === "error" && "Erro ao guardar"}
          </div>
        </div>
      </header>

      <nav className="workspace-tabs" aria-label="Áreas de configuração">
        <button
          type="button"
          className={`workspace-tab ${activeSection === "calendar" ? "active" : ""}`}
          onClick={() => setActiveSection("calendar")}
          aria-current={activeSection === "calendar" ? "page" : undefined}
        >
          <span>Calendário operacional</span>
          <small>Ponto 1</small>
        </button>

        <button
          type="button"
          className={`workspace-tab ${activeSection === "people" ? "active" : ""}`}
          onClick={() => setActiveSection("people")}
          aria-current={activeSection === "people" ? "page" : undefined}
        >
          <span>Pessoas</span>
          <small>Ponto 2</small>
        </button>

        <button
          type="button"
          className={`workspace-tab ${activeSection === "availability" ? "active" : ""}`}
          onClick={() => setActiveSection("availability")}
          aria-current={
            activeSection === "availability" ? "page" : undefined
          }
        >
          <span>Disponibilidade</span>
          <small>Ponto 3</small>
        </button>

        <button
          type="button"
          className={`workspace-tab ${activeSection === "workRules" ? "active" : ""}`}
          onClick={() => setActiveSection("workRules")}
          aria-current={
            activeSection === "workRules" ? "page" : undefined
          }
        >
          <span>Regras de trabalho</span>
          <small>Ponto 4</small>
        </button>
        <button
          type="button"
          className={`workspace-tab ${activeSection === "presence" ? "active" : ""}`}
          onClick={() => setActiveSection("presence")}
          aria-current={activeSection === "presence" ? "page" : undefined}
        >
          <span>Presença mínima</span>
          <small>Ponto 5</small>
        </button>

      </nav>

      {activeSection === "calendar" && (
        <>
          <section className="overview-bar" aria-label="Resumo do calendário">
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
        </>
      )}

      {activeSection === "people" && (
        <>
          <section className="overview-bar" aria-label="Resumo de pessoas">
            <div className="overview-item">
              <span>Total</span>
              <strong>{people.length}</strong>
            </div>
            <div className="overview-item">
              <span>Ativas</span>
              <strong>{activePeople.length}</strong>
            </div>
            <div className="overview-item">
              <span>Arquivadas</span>
              <strong>{people.length - activePeople.length}</strong>
            </div>
          </section>

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
        </>
      )}

      {activeSection === "availability" && (
        <>
          {activePeople.length === 0 ? (
            <section className="panel availability-empty-panel">
              <div className="people-empty">
                <div className="empty-icon">◎</div>
                <strong>Não existem pessoas ativas</strong>
                <p>
                  Adiciona ou reativa uma pessoa antes de configurar
                  disponibilidade.
                </p>
              </div>
            </section>
          ) : (
            <>
              <section
                className="overview-bar"
                aria-label="Resumo de disponibilidade"
              >
                <div className="overview-item">
                  <span>Pessoa</span>
                  <strong>
                    {selectedAvailabilityPerson?.name ?? "—"}
                  </strong>
                </div>
                <div className="overview-item">
                  <span>Dias disponíveis</span>
                  <strong>
                    {availabilitySummary.availableDays} / 7
                  </strong>
                </div>
                <div className="overview-item">
                  <span>Exceções</span>
                  <strong>{availabilitySummary.exceptions}</strong>
                </div>
              </section>

              <div className="availability-person-picker">
                <label className="select-field">
                  <span>Pessoa</span>
                  <select
                    value={
                      selectedAvailabilityPerson?.id ?? ""
                    }
                    onChange={(event) =>
                      setSelectedAvailabilityPersonId(
                        event.target.value
                      )
                    }
                  >
                    {activePeople.map((person) => (
                      <option
                        key={person.id}
                        value={person.id}
                      >
                        {person.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {selectedAvailability && (
                <div className="dashboard-grid">
                  <section className="panel schedule-panel">
                    <div className="panel-header">
                      <div>
                        <p className="section-kicker">Ponto 3</p>
                        <h2>Disponibilidade semanal</h2>
                      </div>
                      <p className="panel-help">
                        Quando esta pessoa pode ser escalada.
                      </p>
                    </div>

                    <div className="schedule-table">
                      <div
                        className="schedule-head"
                        aria-hidden="true"
                      >
                        <span>Dia</span>
                        <span>Estado</span>
                        <span>Início</span>
                        <span>Fim</span>
                      </div>

                      {WEEKDAYS.map((weekday) => {
                        const configuredIntervals =
                          selectedAvailability.weeklyAvailability[weekday];
                        const operatingIntervals = weeklyHours[weekday];
                        const operatingInterval = operatingIntervals[0];
                        const operationClosed =
                          operatingIntervals.length === 0;
                        const effectiveIntervals = intersectIntervals(
                          configuredIntervals,
                          operatingIntervals
                        );
                        const unavailable =
                          effectiveIntervals.length === 0;
                        const interval = effectiveIntervals[0];

                        return (
                          <div
                            key={weekday}
                            className={`schedule-row ${unavailable ? "is-closed" : ""}`}
                          >
                            <div className="day-name">
                              <strong>{weekdayLabels[weekday]}</strong>
                              <span>
                                {operationClosed
                                  ? "Empresa fechada"
                                  : formatAvailabilityIntervals(
                                      effectiveIntervals
                                    )}
                              </span>
                            </div>

                            <button
                              type="button"
                              className={`state-button ${unavailable ? "closed" : "open"}`}
                              onClick={() =>
                                toggleAvailabilityDay(weekday)
                              }
                              disabled={operationClosed}
                              title={
                                operationClosed
                                  ? "O calendário operacional está fechado neste dia."
                                  : undefined
                              }
                            >
                              <span className="state-dot" />
                              {operationClosed
                                ? "Empresa fechada"
                                : unavailable
                                  ? "Indisponível"
                                  : "Disponível"}
                            </button>

                            {!operationClosed &&
                            !unavailable &&
                            interval &&
                            operatingInterval ? (
                              <>
                                <label className="select-field">
                                  <span className="sr-only">
                                    Início de {weekdayLabels[weekday]}
                                  </span>
                                  <select
                                    value={interval.start}
                                    onChange={(event) =>
                                      updateAvailabilityInterval(
                                        weekday,
                                        "start",
                                        event.target.value
                                      )
                                    }
                                  >
                                    {openingOptionsWithin(
                                      operatingInterval
                                    ).map((time) => (
                                      <option key={time} value={time}>
                                        {time}
                                      </option>
                                    ))}
                                  </select>
                                </label>

                                <label className="select-field">
                                  <span className="sr-only">
                                    Fim de {weekdayLabels[weekday]}
                                  </span>
                                  <select
                                    value={interval.end}
                                    onChange={(event) =>
                                      updateAvailabilityInterval(
                                        weekday,
                                        "end",
                                        event.target.value
                                      )
                                    }
                                  >
                                    {closingOptionsWithin(
                                      interval.start,
                                      operatingInterval
                                    ).map((time) => (
                                      <option key={time} value={time}>
                                        {time}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              </>
                            ) : (
                              <div className="closed-span">
                                {operationClosed
                                  ? "Sem funcionamento nesse dia"
                                  : "Não pode ser escalada"}
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
                        <p className="section-kicker">
                          Datas específicas
                        </p>
                        <h2>Exceções</h2>
                      </div>
                      <button
                        type="button"
                        className="primary-button"
                        onClick={addAvailabilityException}
                      >
                        <span>+</span>
                        Adicionar
                      </button>
                    </div>

                    <p className="section-description">
                      Altera a disponibilidade apenas numa data.
                    </p>

                    {selectedAvailability.exceptions
                      .length === 0 ? (
                      <div className="empty-state">
                        <div className="empty-icon">◎</div>
                        <strong>
                          Nenhuma exceção definida
                        </strong>
                        <p>
                          Aplica-se a disponibilidade
                          semanal.
                        </p>
                      </div>
                    ) : (
                      <div className="exception-list">
                        {selectedAvailability.exceptions.map(
                          (exception, index) => {
                            const operatingIntervals =
                              getOperatingIntervalsForDate(
                                exception.date,
                                weeklyHours,
                                exceptions
                              );
                            const operatingInterval =
                              operatingIntervals[0];
                            const operationClosed =
                              operatingIntervals.length === 0;
                            const effectiveIntervals =
                              intersectIntervals(
                                exception.intervals,
                                operatingIntervals
                              );
                            const unavailable =
                              effectiveIntervals.length === 0;
                            const interval =
                              effectiveIntervals[0];

                            return (
                              <article
                                className="exception-card"
                                key={index}
                              >
                                <div className="exception-topline">
                                  <input
                                    className="date-input"
                                    type="date"
                                    value={exception.date}
                                    onChange={(event) =>
                                      updateAvailabilityException(
                                        index,
                                        {
                                          ...exception,
                                          date: event.target
                                            .value,
                                        }
                                      )
                                    }
                                  />

                                  <button
                                    type="button"
                                    className="icon-button"
                                    onClick={() =>
                                      removeAvailabilityException(
                                        index
                                      )
                                    }
                                    aria-label="Remover exceção de disponibilidade"
                                  >
                                    ×
                                  </button>
                                </div>

                                <div className="exception-controls">
                                  <button
                                    type="button"
                                    className={`state-button ${unavailable ? "closed" : "open"}`}
                                    disabled={operationClosed}
                                    title={
                                      operationClosed
                                        ? "A operação está fechada nesta data."
                                        : undefined
                                    }
                                    onClick={() =>
                                      updateAvailabilityException(
                                        index,
                                        {
                                          ...exception,
                                          intervals:
                                            unavailable &&
                                            operatingInterval
                                              ? [
                                                  {
                                                    ...operatingInterval,
                                                  },
                                                ]
                                              : [],
                                        }
                                      )
                                    }
                                  >
                                    <span className="state-dot" />
                                    {operationClosed
                                      ? "Empresa fechada"
                                      : unavailable
                                        ? "Indisponível"
                                        : "Disponível"}
                                  </button>

                                  {operationClosed && (
                                    <p className="operation-closed-note">
                                      O calendário operacional não permite
                                      trabalho nesta data.
                                    </p>
                                  )}

                                  {!operationClosed &&
                                    !unavailable &&
                                    interval &&
                                    operatingInterval && (
                                    <div className="exception-time-grid">
                                      <label className="select-field">
                                        <span>Início</span>
                                        <select
                                          value={
                                            interval.start
                                          }
                                          onChange={(event) =>
                                            updateAvailabilityExceptionInterval(
                                              index,
                                              exception,
                                              "start",
                                              event.target
                                                .value
                                            )
                                          }
                                        >
                                          {openingOptionsWithin(
                                            operatingInterval
                                          ).map(
                                            (time) => (
                                              <option
                                                key={time}
                                                value={time}
                                              >
                                                {time}
                                              </option>
                                            )
                                          )}
                                        </select>
                                      </label>

                                      <label className="select-field">
                                        <span>Fim</span>
                                        <select
                                          value={interval.end}
                                          onChange={(event) =>
                                            updateAvailabilityExceptionInterval(
                                              index,
                                              exception,
                                              "end",
                                              event.target
                                                .value
                                            )
                                          }
                                        >
                                          {closingOptionsWithin(
                                            interval.start,
                                            operatingInterval
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
                                    </div>
                                  )}
                                </div>
                              </article>
                            );
                          }
                        )}
                      </div>
                    )}
                  </aside>
                </div>
              )}
            </>
          )}
        </>
      )}

      {activeSection === "workRules" && (
        <WorkRulesPanel
          weeklyOperatingHours={weeklyHours}
          workRules={workRules}
          onChange={setWorkRules}
        />
      )}
      {activeSection === "presence" && (
        <PresencePanel
          weeklyOperatingHours={weeklyHours}
          operatingExceptions={exceptions}
          people={people}
          availabilities={availabilities}
          weeklyRequirements={weeklyPresenceRequirements}
          exceptions={presenceExceptions}
          onWeeklyChange={setWeeklyPresenceRequirements}
          onExceptionsChange={setPresenceExceptions}
        />
      )}

    </main>
  );
}
