import type {
  OperatingHoursException,
  Person,
  PersonAvailability,
  PresenceException,
  WeeklyPresenceRequirements,
  WeeklyOperatingHours,
  WorkRulesConfiguration,
} from "../types";
import type {AccountingCycleDays,OnboardingConfiguration} from "../utils/accountingCycleConfiguration";

export const APP_STATE_VERSION = 4 as const;

export interface PersistedAppState {
  version: typeof APP_STATE_VERSION;
  /** Optional for backwards compatibility with original v4 records. */
  operationTimeZone?: string;
  /** Optional fixed anchor for accounting cycles of 28 civil days. */
  cycleAnchorDate?: string;
  /** Optional cycle duration; legacy records with only an anchor imply 28 days. */
  accountingCycleDays?: AccountingCycleDays;
  /** Explicit confirmations, optional in historical v4 snapshots. */
  onboarding?: OnboardingConfiguration;
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
  save(state: PersistedAppState): Promise<void | PersistedAppState>;
}
