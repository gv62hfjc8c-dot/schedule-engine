import type {
  AvailabilityException,
  OperatingHoursException,
  Person,
  PersonAvailability,
  PresenceException,
  PresenceRequirement,
  WeeklyPresenceRequirements,
  TimeInterval,
  Weekday,
  WeeklyAvailability,
  WeeklyOperatingHours,
  WorkRulesConfiguration,
} from "../types";
import { createEmptyWeeklyPresenceRequirements } from "../utils/presence";
import {
  APP_STATE_VERSION,
  type PersistedAppState,
  type StateRepository,
} from "./stateRepository";

export const LOCAL_STORAGE_KEY =
  "schedule-engine:app-state";

export const LEGACY_LOCAL_STORAGE_KEY_V1 =
  "schedule-engine:app-state:v1";

export const BACKUP_LATEST_STORAGE_KEY =
  "schedule-engine:app-state:backup:latest";
export const BACKUP_PEOPLE_STORAGE_KEY =
  "schedule-engine:app-state:backup:people";

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const WEEKDAYS: Weekday[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

interface LegacyAppStateV1 {
  version: 1;
  weeklyOperatingHours: WeeklyOperatingHours;
  exceptions: OperatingHoursException[];
  people: Person[];
}

interface LegacyAppStateV2 {
  version: 2;
  weeklyOperatingHours: WeeklyOperatingHours;
  exceptions: OperatingHoursException[];
  people: Person[];
  availabilities: PersonAvailability[];
}

interface LegacyAppStateV3 extends Omit<LegacyAppStateV2, "version"> {
  version: 3;
  workRules: WorkRulesConfiguration;
}

function isTimeInterval(
  value: unknown
): value is TimeInterval {
  if (!value || typeof value !== "object") return false;

  const interval = value as Record<string, unknown>;

  return (
    typeof interval.start === "string" &&
    typeof interval.end === "string"
  );
}

function isWeeklyIntervals(
  value: unknown
): value is Record<Weekday, TimeInterval[]> {
  if (!value || typeof value !== "object") return false;

  const intervalsByDay = value as Record<string, unknown>;

  return WEEKDAYS.every((weekday) => {
    const intervals = intervalsByDay[weekday];

    return (
      Array.isArray(intervals) &&
      intervals.every(isTimeInterval)
    );
  });
}

function isOperatingException(
  value: unknown
): value is OperatingHoursException {
  if (!value || typeof value !== "object") return false;

  const exception = value as Record<string, unknown>;

  return (
    typeof exception.date === "string" &&
    Array.isArray(exception.intervals) &&
    exception.intervals.every(isTimeInterval)
  );
}

function isAvailabilityException(
  value: unknown
): value is AvailabilityException {
  return isOperatingException(value);
}

function isPerson(value: unknown): value is Person {
  if (!value || typeof value !== "object") return false;

  const person = value as Record<string, unknown>;

  return (
    typeof person.id === "string" &&
    typeof person.name === "string" &&
    typeof person.active === "boolean"
  );
}

function isPersonAvailability(
  value: unknown
): value is PersonAvailability {
  if (!value || typeof value !== "object") return false;

  const availability = value as Record<string, unknown>;

  return (
    typeof availability.personId === "string" &&
    isWeeklyIntervals(availability.weeklyAvailability) &&
    Array.isArray(availability.exceptions) &&
    availability.exceptions.every(isAvailabilityException)
  );
}

function isWorkRulesConfiguration(
  value: unknown
): value is WorkRulesConfiguration {
  if (!value || typeof value !== "object") return false;

  const workRules = value as Record<string, unknown>;
  const duration =
    workRules.standardShiftDurationMinutes;

  return (
    duration === null ||
    (
      typeof duration === "number" &&
      Number.isInteger(duration) &&
      duration > 0
    )
  );
}

function isPresenceRequirement(
  value: unknown
): value is PresenceRequirement {
  if (!value || typeof value !== "object") return false;
  const requirement = value as Record<string, unknown>;
  return (
    typeof requirement.minimumDuringOperation === "number" &&
    typeof requirement.minimumAtOpening === "number" &&
    typeof requirement.minimumAtClosing === "number" &&
    Number.isFinite(requirement.minimumDuringOperation) &&
    Number.isFinite(requirement.minimumAtOpening) &&
    Number.isFinite(requirement.minimumAtClosing)
  );
}

function isWeeklyPresenceRequirements(
  value: unknown
): value is WeeklyPresenceRequirements {
  if (!value || typeof value !== "object") return false;
  const weekly = value as Record<string, unknown>;
  return WEEKDAYS.every(
    (day) => weekly[day] === null || isPresenceRequirement(weekly[day])
  );
}

function isPresenceException(value: unknown): value is PresenceException {
  if (!value || typeof value !== "object") return false;
  const exception = value as Record<string, unknown>;
  return (
    typeof exception.date === "string" &&
    (exception.requirements === null ||
      isPresenceRequirement(exception.requirements))
  );
}

function isLegacyAppStateV1(
  value: unknown
): value is LegacyAppStateV1 {
  if (!value || typeof value !== "object") return false;

  const state = value as Record<string, unknown>;

  return (
    state.version === 1 &&
    isWeeklyIntervals(state.weeklyOperatingHours) &&
    Array.isArray(state.exceptions) &&
    state.exceptions.every(isOperatingException) &&
    Array.isArray(state.people) &&
    state.people.every(isPerson)
  );
}

function isLegacyAppStateV2(
  value: unknown
): value is LegacyAppStateV2 {
  if (!value || typeof value !== "object") return false;

  const state = value as Record<string, unknown>;

  return (
    state.version === 2 &&
    isWeeklyIntervals(state.weeklyOperatingHours) &&
    Array.isArray(state.exceptions) &&
    state.exceptions.every(isOperatingException) &&
    Array.isArray(state.people) &&
    state.people.every(isPerson) &&
    Array.isArray(state.availabilities) &&
    state.availabilities.every(isPersonAvailability)
  );
}

function isLegacyAppStateV3(value: unknown): value is LegacyAppStateV3 {
  if (!value || typeof value !== "object") return false;
  const state = value as Record<string, unknown>;
  return (
    state.version === 3 &&
    isWeeklyIntervals(state.weeklyOperatingHours) &&
    Array.isArray(state.exceptions) &&
    state.exceptions.every(isOperatingException) &&
    Array.isArray(state.people) &&
    state.people.every(isPerson) &&
    Array.isArray(state.availabilities) &&
    state.availabilities.every(isPersonAvailability) &&
    isWorkRulesConfiguration(state.workRules)
  );
}

export function isPersistedAppState(
  value: unknown
): value is PersistedAppState {
  if (!value || typeof value !== "object") return false;

  const state = value as Record<string, unknown>;

  return (
    state.version === APP_STATE_VERSION &&
    isWeeklyIntervals(state.weeklyOperatingHours) &&
    Array.isArray(state.exceptions) &&
    state.exceptions.every(isOperatingException) &&
    Array.isArray(state.people) &&
    state.people.every(isPerson) &&
    Array.isArray(state.availabilities) &&
    state.availabilities.every(isPersonAvailability) &&
    isWorkRulesConfiguration(state.workRules) &&
    isWeeklyPresenceRequirements(state.weeklyPresenceRequirements) &&
    Array.isArray(state.presenceExceptions) &&
    state.presenceExceptions.every(isPresenceException)
  );
}

function emptyWeeklyAvailability(): WeeklyAvailability {
  return WEEKDAYS.reduce(
    (availability, weekday) => {
      availability[weekday] = [];
      return availability;
    },
    {} as WeeklyAvailability
  );
}

function emptyWorkRules(): WorkRulesConfiguration {
  return {
    standardShiftDurationMinutes: null,
  };
}

function migrateV1(
  state: LegacyAppStateV1
): PersistedAppState {
  return {
    version: APP_STATE_VERSION,
    weeklyOperatingHours: state.weeklyOperatingHours,
    exceptions: state.exceptions,
    people: state.people,
    availabilities: state.people.map((person) => ({
      personId: person.id,
      weeklyAvailability: emptyWeeklyAvailability(),
      exceptions: [],
    })),
    workRules: emptyWorkRules(),
    weeklyPresenceRequirements: createEmptyWeeklyPresenceRequirements(),
    presenceExceptions: [],
  };
}

function migrateV2(
  state: LegacyAppStateV2
): PersistedAppState {
  return {
    version: APP_STATE_VERSION,
    weeklyOperatingHours: state.weeklyOperatingHours,
    exceptions: state.exceptions,
    people: state.people,
    availabilities: state.availabilities,
    workRules: emptyWorkRules(),
    weeklyPresenceRequirements: createEmptyWeeklyPresenceRequirements(),
    presenceExceptions: [],
  };
}

function migrateV3(state: LegacyAppStateV3): PersistedAppState {
  return {
    ...state,
    version: APP_STATE_VERSION,
    weeklyPresenceRequirements: createEmptyWeeklyPresenceRequirements(),
    presenceExceptions: [],
  };
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/**
 * Keep the previous full state before replacing it. In particular, the
 * last state containing people survives any later edits with zero people.
 * A failed backup must abort the write instead of silently losing data.
 */
function backupPreviousState(storage: KeyValueStorage, raw: string): void {
  const previous = parseJson(raw);
  storage.setItem(BACKUP_LATEST_STORAGE_KEY, raw);

  if (
    previous &&
    typeof previous === "object" &&
    Array.isArray((previous as { people?: unknown }).people) &&
    (previous as { people: unknown[] }).people.length > 0
  ) {
    storage.setItem(BACKUP_PEOPLE_STORAGE_KEY, raw);
  }
}

function throwIncompatibleState(raw: string): never {
  const parsed = parseJson(raw);
  const version = parsed && typeof parsed === "object" &&
    "version" in parsed ? String(parsed.version) : "desconhecida";

  throw new Error(
    `Estado guardado incompatível ou inválido (versão ${version}). ` +
    "Os dados foram preservados; a gravação automática está bloqueada."
  );
}

export function createLocalStorageStateRepository(
  storage: KeyValueStorage
): StateRepository {
  let lastObservedRaw: string | null | undefined;

  return {
    async load() {
      const currentRaw = storage.getItem(LOCAL_STORAGE_KEY);

      if (currentRaw !== null) {
        const parsed = parseJson(currentRaw);

        if (isPersistedAppState(parsed)) {
          lastObservedRaw = currentRaw;
          return parsed;
        }

        if (isLegacyAppStateV3(parsed)) {
          const migrated = migrateV3(parsed);
          const migratedRaw = JSON.stringify(migrated);

          backupPreviousState(storage, currentRaw);
          storage.setItem(LOCAL_STORAGE_KEY, migratedRaw);
          lastObservedRaw = migratedRaw;

          return migrated;
        }

        if (isLegacyAppStateV2(parsed)) {
          const migrated = migrateV2(parsed);
          const migratedRaw = JSON.stringify(migrated);

          backupPreviousState(storage, currentRaw);
          storage.setItem(LOCAL_STORAGE_KEY, migratedRaw);
          lastObservedRaw = migratedRaw;

          return migrated;
        }

        throwIncompatibleState(currentRaw);
      }

      const legacyRaw = storage.getItem(LEGACY_LOCAL_STORAGE_KEY_V1);

      if (legacyRaw !== null) {
        const legacy = parseJson(legacyRaw);

        if (!isLegacyAppStateV1(legacy)) {
          throwIncompatibleState(legacyRaw);
        }

        const migrated = migrateV1(legacy);
        const migratedRaw = JSON.stringify(migrated);

        backupPreviousState(storage, legacyRaw);
        storage.setItem(LOCAL_STORAGE_KEY, migratedRaw);
        lastObservedRaw = migratedRaw;

        return migrated;
      }

      lastObservedRaw = null;
      return null;
    },

    async save(state) {
      const currentRaw = storage.getItem(LOCAL_STORAGE_KEY);

      if (
        lastObservedRaw !== undefined &&
        currentRaw !== lastObservedRaw
      ) {
        throw new Error(
          "Os dados guardados foram alterados por outra janela ou versão. " +
          "A gravação foi bloqueada para evitar perdas."
        );
      }

      if (lastObservedRaw === undefined && currentRaw !== null) {
        throw new Error(
          "É necessário carregar os dados guardados antes de os alterar."
        );
      }

      if (currentRaw !== null) {
        const current = parseJson(currentRaw);

        if (!isPersistedAppState(current)) {
          throwIncompatibleState(currentRaw);
        }

        if (current.people.length > 0 && state.people.length === 0) {
          throw new Error(
            "A gravação foi bloqueada: iria apagar os colaboradores existentes."
          );
        }
      }

      const nextRaw = JSON.stringify(state);

      if (nextRaw === currentRaw) {
        return;
      }

      if (currentRaw !== null) {
        backupPreviousState(storage, currentRaw);
      }

      storage.setItem(LOCAL_STORAGE_KEY, nextRaw);
      lastObservedRaw = nextRaw;
    },
  };
}
