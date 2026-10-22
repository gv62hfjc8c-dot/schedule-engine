import type {
  OperatingHoursException,
  Person,
  WeeklyOperatingHours,
} from "../types";

export const APP_STATE_VERSION = 1 as const;

export interface PersistedAppState {
  version: typeof APP_STATE_VERSION;
  weeklyOperatingHours: WeeklyOperatingHours;
  exceptions: OperatingHoursException[];
  people: Person[];
}

export interface StateRepository {
  load(): Promise<PersistedAppState | null>;
  save(state: PersistedAppState): Promise<void>;
}
