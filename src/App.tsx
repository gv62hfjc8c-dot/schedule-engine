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
import TimeWheelSelect from "./components/TimeWheelSelect";
import IntervalListEditor from "./components/IntervalListEditor";
import OperationExceptionEditor from "./components/OperationExceptionEditor";
import OperationCycleSettings from "./components/OperationCycleSettings";
import GuidedSetup from "./components/GuidedSetup";
import {hasAdjacentOperatingIntervals,mergeAdjacentOperatingIntervals,operatingPresentation} from "./utils/operationConfigurationDraft";
import CalendarDateInput from "./components/CalendarDateInput";
import PresencePanel from "./components/PresencePanel";
import ScheduleGeneratorPanel from "./components/ScheduleGeneratorPanel";
import ScheduleHome from "./components/ScheduleHome";
import ApplicationNavigation,{areaFor,sectionLabel} from "./components/ApplicationNavigation";
import AccountEntryDecision from "./components/AccountEntryDecision";
import {useWorkspaceRouting} from "./utils/useWorkspaceRouting";
import { supabaseAuthClient } from "./persistence/supabaseInstance";
import { createSupabaseGeneratedScheduleRepository } from "./persistence/supabaseGeneratedScheduleRepository";
import { authorizeLegacyImportForOwner, startFreshCloudAccountForOwner, LegacyImportConsentRequiredError } from "./persistence/supabaseStateRepository";
import type { GeneratedSchedulePayload, StoredGeneratedSchedule } from "./persistence/generatedScheduleRepository";
import { createEmptyWeeklyPresenceRequirements } from "./utils/presence";
import { appStateRepository } from "./persistence/appStateRepository";
import { APP_STATE_VERSION } from "./persistence/stateRepository";
import {isOperationConfirmed,operationFingerprint,type AccountingCycleDays,type OnboardingConfiguration} from "./utils/accountingCycleConfiguration";
import {validateEditedIntervals} from "./utils/intervalEditing";
import {coverageFingerprint,isCoverageConfirmed,validCoverageConfiguration} from "./utils/presenceConfiguration";
import {
  notifyOtherTabsOfStateCommit,
  isOtherTabStateCommit,
} from "./utils/crossTabStateSignal";
import { DEFAULT_OPERATION_TIME_ZONE, isIanaOperationTimeZone, resolveOperationTimeZone } from "./utils/operationTimeZone";
import {
  createPersonAvailability,
  intersectIntervals,
} from "./utils/availability";
import {
  getOperatingIntervalsForDate,
  WEEKDAYS,
} from "./utils/operatingCalendar";
import {validateEmploymentPeriods} from "./utils/employmentPeriods";
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
  const [operationTimeZone, setOperationTimeZone] = useState(DEFAULT_OPERATION_TIME_ZONE);
  const [timeZoneDraft, setTimeZoneDraft] = useState(DEFAULT_OPERATION_TIME_ZONE);
  const [cycleAnchorDate, setCycleAnchorDate] = useState("");
  const [accountingCycleDays,setAccountingCycleDays]=useState<AccountingCycleDays|undefined>();
  const [onboarding,setOnboarding]=useState<OnboardingConfiguration>({});
  const [cycleDraftOpen,setCycleDraftOpen]=useState(false);
  const [presenceDraftOpen,setPresenceDraftOpen]=useState(false);
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
  const [mobileNavigationOpen,setMobileNavigationOpen]=useState(false);
  const [editingPersonName, setEditingPersonName] = useState("");
  const [employmentStartDraft,setEmploymentStartDraft] = useState("");
  const [employmentEndDraft,setEmploymentEndDraft] = useState("");
  const [personError, setPersonError] = useState("");
  const [editingExceptionIndex,setEditingExceptionIndex]=useState<number | "new" | null>(null);
  const [editingWeekday,setEditingWeekday]=useState<Weekday|null>(null);
  const [removingExceptionIndex,setRemovingExceptionIndex]=useState<number|null>(null);
  const [availabilityExceptionIssue, setAvailabilityExceptionIssue] = useState("");
  const {route,navigate}=useWorkspaceRouting();
  const activeSection=route.section;
  const [
    selectedAvailabilityPersonId,
    setSelectedAvailabilityPersonId,
  ] = useState<string | null>(null);
  const [persistenceReady, setPersistenceReady] = useState(false);
  const [persistenceProblem, setPersistenceProblem] = useState<string | null>(null);
  const [needsLegacyConsent, setNeedsLegacyConsent] = useState(false);
  const skipInitialSave = useRef(true);
  const wasHydrated = useRef(false);
  const [persistenceStatus, setPersistenceStatus] = useState<
    "loading" | "saving" | "saved" | "error"
  >("loading");
  const saveRequestId = useRef(0);
  const [lastSavedStart, setLastSavedStart] = useState<string | undefined>();
  const [savedRevision, setSavedRevision] = useState(0);
  const [generatorInitialDate, setGeneratorInitialDate] = useState<string | undefined>();

  function openGenerator(date?: string) {
    setGeneratorInitialDate(date);
    navigate("generator");
  }

  async function saveGenerated(payload: GeneratedSchedulePayload, proposalId: string): Promise<StoredGeneratedSchedule> {
    if (!supabaseAuthClient) throw new Error("A ligação Supabase não está configurada.");
    const repository = createSupabaseGeneratedScheduleRepository(supabaseAuthClient);
    const stored = await repository.save(payload, proposalId);
    setLastSavedStart(stored.startDate);
    setSavedRevision(value => value + 1);
    return stored;
  }

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
          const resolvedZone=resolveOperationTimeZone(persisted.operationTimeZone);
          setOperationTimeZone(resolvedZone);
          setTimeZoneDraft(resolvedZone);
          setCycleAnchorDate(persisted.cycleAnchorDate ?? "");
          setAccountingCycleDays(persisted.accountingCycleDays);
          setOnboarding(persisted.onboarding??{});
          setAvailabilities(persisted.availabilities);
          setWorkRules(persisted.workRules);
          setWeeklyPresenceRequirements(persisted.weeklyPresenceRequirements);
          setPresenceExceptions(persisted.presenceExceptions);
        }

        wasHydrated.current = true;
        setPersistenceReady(true);
        setPersistenceStatus("saved");
      } catch (error) {
        if (cancelled) return;

        // Never enable autosave when hydration fails.
        setPersistenceReady(false);
        setNeedsLegacyConsent(error instanceof LegacyImportConsentRequiredError);
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

  // A successful write in another Safari tab makes this tab's baseline
  // obsolete. Block autosave immediately instead of leaving an optimistic
  // "A guardar" or silently overwriting the first tab.
  useEffect(() => {
    if (!persistenceReady) return;
    const onOtherTabSave = (event: StorageEvent) => {
      const ownerId=supabaseAuthClient?.user?.id;
      if (!ownerId ||
          !isOtherTabStateCommit(event.key,event.newValue,ownerId))
        return;
      // Invalidate in-flight UI acknowledgements. The database remains the
      // authority; CAS still rejects a genuine concurrent write.
      saveRequestId.current++;
      setPersistenceReady(false);
      setPersistenceStatus("error");
      setPersistenceProblem(
        "Outra aba desta conta guardou alterações à configuração. " +
        "Para impedir que edições simultâneas substituam dados, " +
        "esta aba foi bloqueada. Se editaste algo aqui, descarrega " +
        "primeiro uma cópia JSON; depois recarrega os dados do servidor."
      );
    };
    window.addEventListener("storage",onOtherTabSave);
    return () => window.removeEventListener("storage",onOtherTabSave);
  }, [persistenceReady]);

  useEffect(() => {
    if (!persistenceReady) return;

    // Loading existing data is not a user change.
    if (skipInitialSave.current) {
      skipInitialSave.current = false;
      return;
    }

    const requestId = ++saveRequestId.current;
    setPersistenceStatus("saving");

    // A lost HTTP response may otherwise leave "A guardar" on screen
    // indefinitely. A timeout means UNKNOWN commit state, not a failed write:
    // preserve the local snapshot for export and require an explicit reload.
    let confirmationTimeoutId: number | null = null;
    const timeoutId = window.setTimeout(() => {
      const requested: Parameters<typeof appStateRepository.save>[0] = {
          version: APP_STATE_VERSION,
          operationTimeZone,
          ...(cycleAnchorDate ? {cycleAnchorDate} : {}),
          ...(cycleAnchorDate && accountingCycleDays ? {accountingCycleDays} : {}),
          onboarding,
          weeklyOperatingHours: weeklyHours,
          exceptions,
          people,
          availabilities,
          workRules,
          weeklyPresenceRequirements,
          presenceExceptions,
        };
      confirmationTimeoutId = window.setTimeout(() => {
        if (requestId !== saveRequestId.current) return;
        ++saveRequestId.current; // Ignore a late success or error for this UI.
        setPersistenceReady(false);
        setPersistenceProblem(
          "A base de dados não confirmou a gravação dentro do prazo. " +
          "O resultado pode ser incerto: não assumes que ficou guardado. " +
          "Descarrega uma cópia JSON antes de recarregar e verificar " +
          "a última configuração do servidor."
        );
        setPersistenceStatus("error");
      }, 20000);
      const requestedOwnerId=supabaseAuthClient?.user?.id;
      void appStateRepository.save(requested)
        .then(reconciled => {
          // Send metadata only, never the personnel data or auth session.
          // The storage event fires in other same-origin tabs, not this one.
          // The SQL compare-and-swap is still the security boundary.
          if (requestedOwnerId &&
              supabaseAuthClient?.user?.id === requestedOwnerId) {
            try {
              notifyOtherTabsOfStateCommit(
                window.localStorage,requestedOwnerId,crypto.randomUUID()
              );
            } catch {
              // Storage may be unavailable in private mode. CAS remains safe.
            }
          }
          if (requestId !== saveRequestId.current) return;
          if (reconciled && JSON.stringify(reconciled)!==JSON.stringify(requested)) {
            // The server merged disjoint updates from another tab.
            // Reflect them in React before a future edit can overwrite them.
            setWeeklyHours(reconciled.weeklyOperatingHours);
            setExceptions(reconciled.exceptions);
            setPeople(reconciled.people);
            setAvailabilities(reconciled.availabilities);
            setWorkRules(reconciled.workRules);
            setWeeklyPresenceRequirements(reconciled.weeklyPresenceRequirements);
            setPresenceExceptions(reconciled.presenceExceptions);
            const zone=resolveOperationTimeZone(reconciled.operationTimeZone);
            setOperationTimeZone(zone);
            setTimeZoneDraft(zone);
            setCycleAnchorDate(reconciled.cycleAnchorDate??"");
            setAccountingCycleDays(reconciled.accountingCycleDays);
            setOnboarding(reconciled.onboarding??{});
          }
          setPersistenceStatus("saved");
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
        })
        .finally(() => {
          if (confirmationTimeoutId !== null)
            window.clearTimeout(confirmationTimeoutId);
        });
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
      if (confirmationTimeoutId !== null)
        window.clearTimeout(confirmationTimeoutId);
    };
  }, [
    persistenceReady,
    operationTimeZone,cycleAnchorDate,accountingCycleDays,onboarding,
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

  // Stable, read-only snapshots for the experimental generator.
  // These objects are not added to the persistence/autosave dependencies.
  const generatorOperatingCalendar = useMemo(
    () => ({ weeklyOperatingHours: weeklyHours, exceptions }),
    [weeklyHours, exceptions]
  );
  const generatorPresence = useMemo(
    () => ({ weeklyPresenceRequirements, presenceExceptions }),
    [weeklyPresenceRequirements, presenceExceptions]
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

  // The compact editor only changes the first interval; imported extra
  // intervals must remain intact until the full editor is available.
  // Availability exceptions still use the existing legacy date allocation workflow.
  const nextUnusedExceptionDate = (items: {date: string}[]): string => {
    const used = new Set(items.map(item => item.date));
    const date = new Date(todayKey() + "T00:00:00Z");
    for (let i = 0; i < 36525; i++) {
      const candidate = date.toISOString().slice(0, 10);
      if (!used.has(candidate)) return candidate;
      date.setUTCDate(date.getUTCDate() + 1);
    }
    throw new Error("Não existe data livre para uma nova exceção.");
  };

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
        [weekday]: [next, ...current[weekday].slice(1)],
      };
    });
  };

  const toggleClosed = (weekday: Weekday) => {
    setEditingWeekday(null);
    setWeeklyHours((current) => ({
      ...current,
      [weekday]:
        current[weekday].length === 0
          ? [{ start: "09:00", end: "18:00" }]
          : [],
    }));
  };

  const saveException = (next: OperatingHoursException) => {
    setExceptions(current=>{
      if(editingExceptionIndex==="new") return [...current,next];
      if(typeof editingExceptionIndex!=="number") return current;
      return current.map((item,index)=>index===editingExceptionIndex?next:item);
    });
    setEditingExceptionIndex(null);
    setRemovingExceptionIndex(null);
  };
  const confirmRemoveException = (index:number) => {
    setExceptions(current=>current.filter((_,currentIndex)=>currentIndex!==index));
    setEditingExceptionIndex(null);
    setRemovingExceptionIndex(null);
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
    setEmploymentStartDraft("");
    setEmploymentEndDraft("");
    setPersonError("");
  };

  const cancelEditingPerson = () => {
    setEditingPersonId(null);
    setEditingPersonName("");
    setEmploymentStartDraft("");
    setEmploymentEndDraft("");
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

  const addPersonEmploymentPeriod = (person:Person) => {
    const periods=[...(person.employmentPeriods??[]),
      {startDate:employmentStartDraft,endDate:employmentEndDraft || null}];
    const problems=validateEmploymentPeriods(periods);
    if(problems.length){
      setPersonError(problems.join(" "));
      return;
    }
    setPeople(current=>current.map(p=>p.id===person.id
      ? {...p,employmentPeriods:periods} : p));
    setEmploymentStartDraft("");
    setEmploymentEndDraft("");
    setPersonError("");
  };

  const removePersonEmploymentPeriod = (person:Person,index:number) => {
    setPeople(current=>current.map(p=>p.id===person.id
      ? {...p,employmentPeriods:person.employmentPeriods?.filter((_,i)=>i!==index)??[]}
      : p));
    setPersonError("");
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
        [weekday]: [next, ...selectedAvailability.weeklyAvailability[weekday].slice(1)],
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
          date: nextUnusedExceptionDate(selectedAvailability.exceptions),
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
    if (selectedAvailability.exceptions.some((item, i) => i !== index && item.date === next.date)) {
      setAvailabilityExceptionIssue("Já existe uma exceção de disponibilidade para essa data.");
      return;
    }
    setAvailabilityExceptionIssue("");

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
      intervals: [nextInterval, ...exception.intervals.slice(1)],
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

  function exportPendingConfiguration(): void {
    if (!wasHydrated.current) return;
    const pending = {
      version: APP_STATE_VERSION,
      operationTimeZone,...(cycleAnchorDate ? {cycleAnchorDate} : {}),
      ...(cycleAnchorDate && accountingCycleDays ? {accountingCycleDays} : {}),onboarding,
      weeklyOperatingHours: weeklyHours, exceptions, people,
      availabilities, workRules,
      weeklyPresenceRequirements, presenceExceptions,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(pending, null, 2)],
      {type: "application/json"}));
    const link = document.createElement("a");
    link.href = url;
    link.download = "schedule-engine-configuracao-pendente.json";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // A consent decision is not a synchronization failure. The repository
  // reaches this state only when cloud state is empty and unowned local
  // configuration exists. Never enable editing or autosave before resolution.
  if (persistenceProblem && needsLegacyConsent) {
    return <AccountEntryDecision
      onStartFresh={()=>{
        const ownerId=supabaseAuthClient?.user?.id;
        if(!ownerId)return;
        startFreshCloudAccountForOwner(window.localStorage,ownerId);
        window.location.reload();
      }}
      onImportConfirmed={()=>{
        const ownerId=supabaseAuthClient?.user?.id;
        if(!ownerId)return;
        authorizeLegacyImportForOwner(window.localStorage,ownerId);
        window.location.reload();
      }}
    />;
  }

  // Real network, conflict and incompatible-data failures remain fail-closed
  // and are NEVER presented as onboarding choices.
  if (persistenceProblem) {
    return (
      <main className="entry-screen">
        <section className="entry-card entry-error-card" role="alert" aria-labelledby="entry-error-title">
          <div className="entry-brand">
            <span className="entry-brand-symbol" aria-hidden="true">SE</span>
            <strong>Schedule Engine</strong>
          </div>
          <div className="entry-error-icon" aria-hidden="true">!</div>
          <span className="entry-eyebrow">SEGURANÇA DA CONFIGURAÇÃO</span>
          <h1 id="entry-error-title">Não foi possível carregar a configuração</h1>
          <p className="entry-error-lead">Para proteger os horários e as alterações existentes,
            a edição e a gravação automática estão temporariamente bloqueadas.</p>
          <div className="entry-error-message">{persistenceProblem}</div>
          {wasHydrated.current && <div className="entry-error-actions">
            <p>Existem alterações locais que podem ainda não ter sido confirmadas no servidor.
              Guarda uma cópia antes de recarregar, se precisares dessas alterações.</p>
            <button type="button" className="entry-outline-button" onClick={exportPendingConfiguration}>
              Descarregar cópia das alterações pendentes (JSON)
            </button>
            <button type="button" className="entry-outline-button" onClick={()=>{
              if(window.confirm("Descartar as alterações locais por guardar e recarregar a última configuração do servidor? Exporta primeiro uma cópia JSON se precisares das alterações.")){
                window.location.reload();
              }
            }}>
              Recarregar configuração remota (descartar edição local)
            </button>
          </div>}
          {!wasHydrated.current && <button type="button" className="entry-outline-button"
            onClick={()=>window.location.reload()}>Tentar carregar novamente</button>}
          <p className="entry-error-footnote">Não apagues os dados do navegador enquanto esta situação
            não estiver resolvida. Nenhum dado foi importado automaticamente.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell application-layout">
      <ApplicationNavigation activeSection={activeSection}
        navigate={navigate}
        mobileOpen={mobileNavigationOpen}
        closeMobile={()=>setMobileNavigationOpen(false)}/>
      <div className="application-workspace">
        <header className="application-topbar">
          <div className="application-topbar-start">
            <button type="button" className="app-menu-trigger"
              aria-label="Abrir menu de navegação"
              aria-expanded={mobileNavigationOpen}
              onClick={()=>setMobileNavigationOpen(value=>!value)}>
              <span aria-hidden="true">☰</span>
            </button>
            <div className="app-breadcrumb" aria-label="Localização atual">
              <span>{({schedules:"Horários",operation:"Operação",team:"Equipa",rules:"Regras"} as const)[areaFor(activeSection)]}</span>
              <span className="app-breadcrumb-divider" aria-hidden="true">/</span>
              <strong>{route.dayDate?"Gestão diária · "+route.dayDate:sectionLabel(activeSection)}</strong>
            </div>
          </div>
          <div className="header-statuses">
            <div className={`save-status ${persistenceStatus}`}
              title="Estado da gravação da configuração no Supabase"
              aria-live="polite">
              <span className="save-status-dot"/>
              {persistenceStatus === "loading" && "A carregar"}
              {persistenceStatus === "saving" && "A guardar"}
              {persistenceStatus === "saved" && "Guardado"}
              {persistenceStatus === "error" && "Erro ao guardar"}
            </div>
            {editingExceptionIndex!==null && <span className="operation-draft-status" role="status">Exceção por guardar</span>}
            {cycleDraftOpen && <span className="operation-draft-status" role="status">Escolha do ciclo por guardar</span>}
            {activeSection==="presence" && presenceDraftOpen && <span className="operation-draft-status" role="status">Cobertura por guardar</span>}
          </div>
        </header>
        <div className="application-page">
      {activeSection === "schedules" && (
        <ScheduleHome
          people={people}
          availabilities={availabilities}
          operatingCalendar={generatorOperatingCalendar}
          operationTimeZone={operationTimeZone}
          cycleAnchorDate={cycleAnchorDate || undefined}
          accountingCycleDays={accountingCycleDays}
          savedRevision={savedRevision}
          initialMonth={lastSavedStart}
          onCreate={openGenerator}
          onConfigureTeam={() => navigate("people")}
          initialDailyDate={route.dayDate}
          onNavigateDay={date=>navigate("schedules",date)}
        />
      )}

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

          <GuidedSetup
             operationConfirmed={isOperationConfirmed(
               onboarding,weeklyHours,operationTimeZone,cycleAnchorDate,accountingCycleDays)}
             cycleDecisionConfirmed={onboarding.cycleDecisionConfirmed===true}
             canConfirmOperation={onboarding.cycleDecisionConfirmed===true &&
               summary.openDays>0 && isIanaOperationTimeZone(operationTimeZone) &&
               WEEKDAYS.every(day=>validateEditedIntervals(weeklyHours[day]).valid)}
             saving={persistenceStatus!=="saved"}
             coverageConfirmed={isCoverageConfirmed(onboarding,
               isOperationConfirmed(onboarding,weeklyHours,operationTimeZone,cycleAnchorDate,accountingCycleDays),
               weeklyHours,exceptions,weeklyPresenceRequirements,presenceExceptions)}
             hasCoverage={validCoverageConfiguration(
               weeklyHours,weeklyPresenceRequirements,presenceExceptions)}
             hasTeam={people.some(person=>person.active)}
             hasAvailabilityAndRules={workRules.standardShiftDurationMinutes!==null &&
               people.some(person=>person.active) && availabilities.length>0}
             onConfirmOperation={()=>setOnboarding(previous=>({
               ...previous,
               operationConfirmedFingerprint:operationFingerprint(
                 weeklyHours,operationTimeZone,cycleAnchorDate,accountingCycleDays),
             }))}
             onNavigate={navigate}
           />
           <section className="panel operation-context-compact" aria-label="Configuração temporal da operação">
             <div className="operation-context-heading">
               <div>
                 <p className="section-kicker">Contexto da operação</p>
                 <h2>Fuso horário e ciclos de trabalho</h2>
               </div>
               <p>A empresa pode funcionar sem ciclo fixo. A escolha não limita a geração mensal.</p>
             </div>
             <div className="operation-context-controls">
               <div className="operation-timezone">
                 <label className="se-control">
                   <span>Fuso horário IANA</span>
                   <input type="text" value={timeZoneDraft} autoComplete="off"
                     placeholder="Atlantic/Azores"
                     onChange={event=>setTimeZoneDraft(event.target.value)} />
                 </label>
                 <button type="button" className="se-outline"
                   disabled={!isIanaOperationTimeZone(timeZoneDraft) ||
                     timeZoneDraft===operationTimeZone}
                   onClick={()=>setOperationTimeZone(timeZoneDraft)}>
                   Aplicar fuso horário
                 </button>
                 {!isIanaOperationTimeZone(timeZoneDraft) &&
                   <span role="alert">Indica um fuso horário IANA válido antes de guardar.</span>}
               </div>
               <OperationCycleSettings
                 anchorDate={cycleAnchorDate}
                 days={accountingCycleDays}
                 decisionConfirmed={onboarding.cycleDecisionConfirmed===true}
                 onDraftOpenChange={setCycleDraftOpen}
                 onSave={(anchor,days)=>{
                   setCycleAnchorDate(anchor);
                   setAccountingCycleDays(days);
                   setOnboarding(previous=>({...previous,cycleDecisionConfirmed:true}));
                 }}
               />
             </div>
             <p className="operation-context-footnote">
               O fuso aplicado rege o calendário e a geração; os horários arquivados mantêm
               o original. A geração certificada suporta períodos de até 28 dias por proposta,
               independentemente do ciclo de trabalho escolhido.
             </p>
           </section>
          <div className="dashboard-grid">
        <section className="panel schedule-panel">
          <div className="panel-header">
            <div>
              
              <h2>Horário de funcionamento</h2>
            </div>
            <p className="panel-help">
              Confirma os horários sugeridos antes da primeira geração. Abertura não é turno nem refeição.
            </p>
          </div>

          <p className="operation-mode-hint">Funcionamento semanal: <strong>{operatingPresentation(weeklyHours)==="interrupted"?"com interrupções":"contínuo"}</strong>. Se a operação fechar e voltar a abrir no mesmo dia, adiciona outro intervalo nesse dia.</p>
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
                  className={`schedule-row operation-schedule-row ${closed ? "is-closed" : ""}`}
                >
                  <div className="day-name">
                    <strong>{weekdayLabels[weekday]}</strong>
                    {intervals.length>1 && <span>{formatIntervals(intervals)}</span>}
                    {!closed && <button type="button" className="operation-inline-trigger"
                      aria-label={`${weekdayLabels[weekday]}: ${editingWeekday===weekday?"Ocultar edição de intervalos":intervals.length>1?"Editar intervalos de funcionamento":"Adicionar outro intervalo de funcionamento"}`}
                      aria-controls={editingWeekday===weekday?`operation-intervals-${weekday}`:undefined}
                      aria-expanded={editingWeekday===weekday}
                      onClick={()=>setEditingWeekday(current=>current===weekday?null:weekday)}>
                      {editingWeekday===weekday?"Fechar intervalos":intervals.length>1?"Editar intervalos":"+ Outro intervalo"}
                    </button>}
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

                  {!closed && interval && intervals.length===1 ? (
                    <>
                      <label className="select-field">
                        <span className="sr-only">
                          Abertura de {weekdayLabels[weekday]}
                        </span>
                        <TimeWheelSelect
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
                        </TimeWheelSelect>
                      </label>

                      <label className="select-field">
                        <span className="sr-only">
                          Fecho de {weekdayLabels[weekday]}
                        </span>
                        <TimeWheelSelect
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
                        </TimeWheelSelect>
                      </label>
                    </>
                  ) : (
                    <div className="closed-span">
                      {closed ? "Sem horário de funcionamento" :
                        "Vários intervalos configurados"}
                    </div>
                  )}
                  {!closed && editingWeekday===weekday && <div
                    className="operation-advanced-row" id={`operation-intervals-${weekday}`}>
                    <IntervalListEditor
                      label={"funcionamento de "+weekdayLabels[weekday]}
                      intervals={intervals}
                      operationMode
                      inlineEditor
                      onChange={next=>setWeeklyHours(current=>({
                        ...current,[weekday]:next,
                      }))}
                    />
                    <button type="button" className="operation-advanced-close"
                      onClick={()=>setEditingWeekday(null)}>Fechar edição</button>
                  </div>}
                  {hasAdjacentOperatingIntervals(intervals) &&
                    <div className="operation-adjacent-hint">
                      <span>Os intervalos são contíguos; podes apresentá-los como um único horário.</span>
                      <button type="button" className="se-outline"
                        onClick={()=>{
                          const joined=mergeAdjacentOperatingIntervals(intervals);
                          if(joined.valid) setWeeklyHours(current=>({...current,[weekday]:joined.intervals}));
                        }}>Unir intervalos contíguos</button>
                    </div>}
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
             <button type="button" className="primary-button"
               onClick={()=>{setEditingExceptionIndex("new");setRemovingExceptionIndex(null);}}>
               <span>+</span> Adicionar
             </button>
           </div>
           <p className="section-description">
             Feriados, encerramentos ou horários diferentes do padrão.
             A configuração só muda depois de Guardar exceção.
           </p>
           {editingExceptionIndex==="new" && <OperationExceptionEditor
             key="new"
             existing={exceptions}
             editingIndex={null}
             weeklyHours={weeklyHours}
             onSave={saveException}
             onCancel={()=>setEditingExceptionIndex(null)}
           />}
           {exceptions.length===0 && editingExceptionIndex!=="new"
             ? <div className="empty-state"><div className="empty-icon">◎</div>
                 <strong>Nenhuma exceção definida</strong>
                 <p>O padrão semanal aplica-se a todas as datas.</p>
               </div>
             : <div className="exception-list">
                 {exceptions.map((exception,index)=>
                   <div className="operation-exception-entry" key={exception.date}>
                     {editingExceptionIndex===index
                       ? <OperationExceptionEditor
                           key={exception.date}
                           initial={exception}
                           existing={exceptions}
                           editingIndex={index}
                           weeklyHours={weeklyHours}
                           onSave={saveException}
                           onCancel={()=>setEditingExceptionIndex(null)}
                         />
                       : <>
                           <div className="operation-exception-entry-info">
                             <strong>{exception.date}</strong>
                             <span>{exception.reason||"Motivo não indicado (registo anterior)"}</span>
                             <small>{formatIntervals(exception.intervals)}</small>
                           </div>
                           {removingExceptionIndex===index
                             ? <div className="operation-exception-actions">
                                 <span>Confirmas a remoção desta exceção?</span>
                                 <button type="button" className="se-outline"
                                   onClick={()=>setRemovingExceptionIndex(null)}>Cancelar</button>
                                 <button type="button" className="se-outline"
                                   onClick={()=>confirmRemoveException(index)}>Confirmar remoção</button>
                               </div>
                             : <div className="operation-exception-actions">
                                 <button type="button" className="se-outline"
                                   onClick={()=>{setEditingExceptionIndex(index);setRemovingExceptionIndex(null);}}>Editar</button>
                                 <button type="button" className="se-outline"
                                   onClick={()=>setRemovingExceptionIndex(index)}>Remover</button>
                               </div>}
                         </>}
                   </div>)}
               </div>}
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
                          {person.employmentPeriods!==undefined && !editing && (
                            <small>Vínculos: {person.employmentPeriods.length
                              ? person.employmentPeriods.map(p=>p.startDate+" a "+(p.endDate??"presente")).join("; ")
                              : "nenhum período configurado"}</small>
                          )}
                        </div>
                      )}
                      {editing && (
                        <div className="person-employment-editor">
                          <p>Vínculos laborais (datas inclusivas)</p>
                          {(person.employmentPeriods??[]).map((period,index)=>(
                            <div key={index}>
                              <span>{period.startDate} a {period.endDate??"presente"}</span>{" "}
                              <button type="button" className="secondary-button"
                                onClick={()=>removePersonEmploymentPeriod(person,index)}>
                                Remover vínculo
                              </button>
                            </div>
                          ))}
                          <label>Entrada
                            <input aria-label={"Entrada de "+person.name} type="date"
                              value={employmentStartDraft}
                              onChange={event=>setEmploymentStartDraft(event.target.value)}/>
                          </label>
                          <label>Saída (opcional)
                            <input aria-label={"Saída de "+person.name} type="date"
                              value={employmentEndDraft}
                              onChange={event=>setEmploymentEndDraft(event.target.value)}/>
                          </label>
                          <button type="button" className="secondary-button"
                            disabled={!employmentStartDraft}
                            onClick={()=>addPersonEmploymentPeriod(person)}>
                            Adicionar vínculo
                          </button>
                          <small>Os vínculos não alteram horários históricos ou propostas já arquivadas.</small>
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
                            operatingInterval &&
                            configuredIntervals.length===1 ? (
                              <>
                                <label className="select-field">
                                  <span className="sr-only">
                                    Início de {weekdayLabels[weekday]}
                                  </span>
                                  <TimeWheelSelect
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
                                  </TimeWheelSelect>
                                </label>

                                <label className="select-field">
                                  <span className="sr-only">
                                    Fim de {weekdayLabels[weekday]}
                                  </span>
                                  <TimeWheelSelect
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
                                  </TimeWheelSelect>
                                </label>
                              </>
                            ) : (
                              <div className="closed-span">
                                {operationClosed
                                  ? "Sem funcionamento nesse dia"
                                  : "Não pode ser escalada"}
                              </div>
                            )}
                            <IntervalListEditor
                              label={"disponibilidade de "+weekdayLabels[weekday]}
                              intervals={configuredIntervals}
                              allowed={operatingIntervals}
                              onChange={next=>upsertAvailability({
                                ...selectedAvailability,
                                weeklyAvailability:{
                                  ...selectedAvailability.weeklyAvailability,
                                  [weekday]:next,
                                },
                              })}
                            />
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
                    {availabilityExceptionIssue && <p className="presence-validation" role="alert">{availabilityExceptionIssue}</p>}
                    {selectedAvailability && selectedAvailability.exceptions.length !== new Set(selectedAvailability.exceptions.map(item => item.date)).size &&
                      <p className="presence-validation" role="alert">Existem exceções de disponibilidade repetidas. Corrige as datas duplicadas.</p>}

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
                                  <CalendarDateInput
                                    className="date-input"
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
                                    operatingInterval &&
                                    exception.intervals.length===1 && (
                                    <div className="exception-time-grid">
                                      <label className="select-field">
                                        <span>Início</span>
                                        <TimeWheelSelect
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
                                        </TimeWheelSelect>
                                      </label>

                                      <label className="select-field">
                                        <span>Fim</span>
                                        <TimeWheelSelect
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
                                        </TimeWheelSelect>
                                      </label>
                                    </div>
                                  )}
                                </div>
                                <IntervalListEditor
                                  label={"disponibilidade excecional de "+exception.date}
                                  intervals={exception.intervals}
                                  allowed={operatingIntervals}
                                  onChange={next=>updateAvailabilityException(
                                    index,{...exception,intervals:next})}
                                />
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
          people={people}
          onPeopleChange={setPeople}
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
          onboarding={onboarding}
          operationConfirmed={isOperationConfirmed(
            onboarding,weeklyHours,operationTimeZone,cycleAnchorDate,accountingCycleDays)}
          persistenceStatus={persistenceStatus}
          onConfirmCoverage={()=>setOnboarding(previous=>({
            ...previous,coverageConfirmedFingerprint:coverageFingerprint(
              weeklyHours,exceptions,weeklyPresenceRequirements,presenceExceptions),
          }))}
          onDraftOpenChange={setPresenceDraftOpen}
        />
      )}

      {activeSection === "generator" && (
        <ScheduleGeneratorPanel
          people={people}
          availabilities={availabilities}
          operatingCalendar={generatorOperatingCalendar}
          workRules={workRules}
          presence={generatorPresence}
          operationTimeZone={operationTimeZone}
          ownerId={supabaseAuthClient?.user?.id}
          initialDate={generatorInitialDate}
          onSaveGenerated={saveGenerated}
          onBackToCalendar={() => navigate("schedules")}
        />
      )}
        </div>
      </div>
    </main>
  );
}
