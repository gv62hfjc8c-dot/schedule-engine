export type Weekday =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export interface SchedulePeriod {
  startDate: string;
  endDate: string;
}

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

export interface ScheduleConfiguration {
  period: SchedulePeriod;
  weeklyOperatingHours: WeeklyOperatingHours;
  exceptions: OperatingHoursException[];
}
