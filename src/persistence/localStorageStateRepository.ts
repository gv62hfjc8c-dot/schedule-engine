import type {
  AvailabilityException,
  CoverageException,
  CoverageRequirement,
  OperatingHoursException,
  Person,
  PersonAvailability,
  TimeInterval,
  Weekday,
  WeeklyAvailability,
  WeeklyCoverage,
  WeeklyOperatingHours,
} from "../types";
import {
  APP_STATE_VERSION,
  type PersistedAppState,
  type StateRepository,
} from "./stateRepository";

export const LOCAL_STORAGE_KEY =
  "schedule-engine:app-state";

export const LEGACY_LOCAL_STORAGE_KEY_V1 =
  "schedule-engine:app-state:v1";

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

function isCoverageRequirement(
  value: unknown
): value is CoverageRequirement {
  if (!isTimeInterval(value)) return false;

  const requirement = value as unknown as Record<
    string,
    unknown
  >;

  return (
    typeof requirement.minimumPeople === "number" &&
    Number.isInteger(requirement.minimumPeople) &&
    requirement.minimumPeople >= 0
  );
}

function isWeeklyCoverage(
  value: unknown
): value is WeeklyCoverage {
  if (!value || typeof value !== "object") return false;

  const coverage = value as Record<string, unknown>;

  return WEEKDAYS.every((weekday) => {
    const requirements = coverage[weekday];

    return (
      Array.isArray(requirements) &&
      requirements.every(isCoverageRequirement)
    );
  });
}

function isCoverageException(
  value: unknown
): value is CoverageException {
  if (!value || typeof value !== "object") return false;

  const exception = value as Record<string, unknown>;

  return (
    typeof exception.date === "string" &&
    Array.isArray(exception.requirements) &&
    exception.requirements.every(isCoverageRequirement)
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
    isWeeklyCoverage(state.weeklyCoverage) &&
    Array.isArray(state.coverageExceptions) &&
    state.coverageExceptions.every(isCoverageException)
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

function emptyWeeklyCoverage(): WeeklyCoverage {
  return WEEKDAYS.reduce(
    (coverage, weekday) => {
      coverage[weekday] = [];
      return coverage;
    },
    {} as WeeklyCoverage
  );
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
    weeklyCoverage: emptyWeeklyCoverage(),
    coverageExceptions: [],
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
    weeklyCoverage: emptyWeeklyCoverage(),
    coverageExceptions: [],
  };
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function createLocalStorageStateRepository(
  storage: KeyValueStorage
): StateRepository {
  return {
    async load() {
      const currentRaw = storage.getItem(LOCAL_STORAGE_KEY);

      if (currentRaw) {
        const parsed = parseJson(currentRaw);

        if (isPersistedAppState(parsed)) {
          return parsed;
        }

        if (isLegacyAppStateV2(parsed)) {
          const migrated = migrateV2(parsed);

          storage.setItem(
            LOCAL_STORAGE_KEY,
            JSON.stringify(migrated)
          );

          return migrated;
        }

        return null;
      }

      const legacyRaw = storage.getItem(
        LEGACY_LOCAL_STORAGE_KEY_V1
      );

      if (!legacyRaw) return null;

      const legacy = parseJson(legacyRaw);

      if (!isLegacyAppStateV1(legacy)) {
        return null;
      }

      const migrated = migrateV1(legacy);

      storage.setItem(
        LOCAL_STORAGE_KEY,
        JSON.stringify(migrated)
      );

      return migrated;
    },

    async save(state) {
      storage.setItem(
        LOCAL_STORAGE_KEY,
        JSON.stringify(state)
      );
    },
  };
}
