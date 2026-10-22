import type {
  OperatingHoursException,
  Person,
  PersonAvailability,
  WeeklyOperatingHours,
} from "../types";

export const APP_STATE_VERSION = 2 as const;

export interface PersistedAppState {
  version: typeof APP_STATE_VERSION;
  weeklyOperatingHours: WeeklyOperatingHours;
  exceptions: OperatingHoursException[];
  people: Person[];
  availabilities: PersonAvailability[];
}

export interface StateRepository {
  load(): Promise<PersistedAppState | null>;
  save(state: PersistedAppState): Promise<void>;
}
