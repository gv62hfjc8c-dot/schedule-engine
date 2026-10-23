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
