import type {
  OperatingHoursException,
  Person,
  PersonAvailability,
  PresenceException,
  WeeklyPresenceRequirements,
  WeeklyOperatingHours,
  WorkRulesConfiguration,
} from "../types";

export const APP_STATE_VERSION = 4 as const;

export interface PersistedAppState {
  version: typeof APP_STATE_VERSION;
  weeklyOperatingHours: WeeklyOperatingHours;
  exceptions: OperatingHoursException[];
  people: Person[];
  availabilities: PersonAvailability[];
  workRules: WorkRulesConfiguration;
  weeklyPresenceRequirements: WeeklyPresenceRequirements;
  presenceExceptions: PresenceException[];
}

export interface StateRepository {
  load(): Promise<PersistedAppState | null>;
  save(state: PersistedAppState): Promise<void>;
}
