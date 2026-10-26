export type Weekday =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export interface TimeInterval {
  start: string;
  end: string;
}

export type OperatingInterval = TimeInterval;

export type WeeklyOperatingHours = Record<
  Weekday,
  TimeInterval[]
>;

export interface OperatingHoursException {
  date: string;
  intervals: TimeInterval[];
}

export interface OperatingCalendarConfiguration {
  weeklyOperatingHours: WeeklyOperatingHours;
  exceptions: OperatingHoursException[];
}

export interface Person {
  id: string;
  name: string;
  active: boolean;
}

export type WeeklyAvailability = Record<
  Weekday,
  TimeInterval[]
>;

export interface AvailabilityException {
  date: string;
  intervals: TimeInterval[];
}

export interface PersonAvailability {
  personId: string;
  weeklyAvailability: WeeklyAvailability;
  exceptions: AvailabilityException[];
}

export interface WorkRulesConfiguration {
  standardShiftDurationMinutes: number | null;
}

/**
 * Independent hard minimums for the first 30 minutes of opening, the central
 * operating window, and the final 30 minutes before closing. These are
 * minimums, not targets or maxima. Values like 1 / 2 / 1 are valid.
 */
export interface PresenceRequirement {
  minimumDuringOperation: number;
  minimumAtOpening: number;
  minimumAtClosing: number;
}

/** null means explicitly unconfigured, unlike an all-zero requirement. */
export type WeeklyPresenceRequirements = Record<
  Weekday,
  PresenceRequirement | null
>;

export interface PresenceException {
  date: string;
  /** Replaces that date's weekly rule; null means unconfigured. */
  requirements: PresenceRequirement | null;
}

export interface PresenceConfiguration {
  weeklyPresenceRequirements: WeeklyPresenceRequirements;
  presenceExceptions: PresenceException[];
}

/** One continuous assignment for a person on a given day. */
export interface PresenceAssignment {
  personId: string;
  interval: TimeInterval;
}

/**
 * P6.3: effective working minutes EXCLUDE the uninterrupted meal break.
 * A shift still has one continuous attendance span, with at most one meal.
 * This is an additive model; legacy PresenceAssignment is not migrated yet.
 */
export interface MealBreakConstraint {
  /** A meal is mandatory strictly ABOVE this many effective working minutes. */
  requiredAboveEffectiveMinutes: number;
  /** Exactly this many consecutive clock minutes, unpaid/non-working in V0. */
  durationMinutes: number;
  /** Inclusive bounds measured in EFFECTIVE work before the meal begins. */
  earliestStartAfterWorkMinutes: number;
  latestStartAfterWorkMinutes: number;
}

export interface WorkConstraintConfiguration {
  mealBreak: MealBreakConstraint;
  minimumRestBetweenShiftsMinutes: number;
  maximumDailyEffectiveMinutes: number;
  maximumWeeklyEffectiveMinutes: number;
}

/**
 * A dated attendance span (same civil day; no overnight shifts in this V0).
 * The meal is a gap INSIDE the span and does not cover operational presence.
 * null explicitly means no meal break.
 */
export interface DatedWorkShift {
  date: string;
  personId: string;
  interval: TimeInterval;
  mealBreak: TimeInterval | null;
}
