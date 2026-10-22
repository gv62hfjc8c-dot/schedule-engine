export type Weekday =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export interface OperatingInterval {
  start: string;
  end: string;
}

export type WeeklyOperatingHours = Record<
  Weekday,
  OperatingInterval[]
>;

export interface OperatingHoursException {
  date: string;
  intervals: OperatingInterval[];
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
