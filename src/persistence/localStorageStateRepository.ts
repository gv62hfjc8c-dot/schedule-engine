import type {
  OperatingHoursException,
  OperatingInterval,
  Person,
  Weekday,
  WeeklyOperatingHours,
} from "../types";
import {
  APP_STATE_VERSION,
  type PersistedAppState,
  type StateRepository,
} from "./stateRepository";

export const LOCAL_STORAGE_KEY =
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

function isOperatingInterval(
  value: unknown
): value is OperatingInterval {
  if (!value || typeof value !== "object") return false;

  const interval = value as Record<string, unknown>;

  return (
    typeof interval.start === "string" &&
    typeof interval.end === "string"
  );
}

function isWeeklyOperatingHours(
  value: unknown
): value is WeeklyOperatingHours {
  if (!value || typeof value !== "object") return false;

  const hours = value as Record<string, unknown>;

  return WEEKDAYS.every((weekday) => {
    const intervals = hours[weekday];

    return (
      Array.isArray(intervals) &&
      intervals.every(isOperatingInterval)
    );
  });
}

function isException(
  value: unknown
): value is OperatingHoursException {
  if (!value || typeof value !== "object") return false;

  const exception = value as Record<string, unknown>;

  return (
    typeof exception.date === "string" &&
    Array.isArray(exception.intervals) &&
    exception.intervals.every(isOperatingInterval)
  );
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

export function isPersistedAppState(
  value: unknown
): value is PersistedAppState {
  if (!value || typeof value !== "object") return false;

  const state = value as Record<string, unknown>;

  return (
    state.version === APP_STATE_VERSION &&
    isWeeklyOperatingHours(state.weeklyOperatingHours) &&
    Array.isArray(state.exceptions) &&
    state.exceptions.every(isException) &&
    Array.isArray(state.people) &&
    state.people.every(isPerson)
  );
}

export function createLocalStorageStateRepository(
  storage: KeyValueStorage
): StateRepository {
  return {
    async load() {
      const raw = storage.getItem(LOCAL_STORAGE_KEY);

      if (!raw) return null;

      try {
        const parsed: unknown = JSON.parse(raw);

        return isPersistedAppState(parsed) ? parsed : null;
      } catch {
        return null;
      }
    },

    async save(state) {
      storage.setItem(
        LOCAL_STORAGE_KEY,
        JSON.stringify(state)
      );
    },
  };
}
