import type {
  CoverageException,
  OperatingHoursException,
  Person,
  PersonAvailability,
  WeeklyCoverage,
  WeeklyOperatingHours,
} from "../types";

export const APP_STATE_VERSION = 3 as const;

export interface PersistedAppState {
  version: typeof APP_STATE_VERSION;
  weeklyOperatingHours: WeeklyOperatingHours;
  exceptions: OperatingHoursException[];
  people: Person[];
  availabilities: PersonAvailability[];
  weeklyCoverage: WeeklyCoverage;
  coverageExceptions: CoverageException[];
}

export interface StateRepository {
  load(): Promise<PersistedAppState | null>;
  save(state: PersistedAppState): Promise<void>;
}
