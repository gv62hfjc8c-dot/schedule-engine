import type {
  OperatingHoursException,
  OperatingInterval,
  Weekday,
  WeeklyOperatingHours,
} from "../types";

export const WEEKDAYS: Weekday[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

const WEEKDAY_BY_UTC_DAY: Weekday[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

function parseDate(date: string): Date {
  const parsed = new Date(`${date}T00:00:00Z`);

  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  ) {
    throw new Error(`Data inválida: ${date}`);
  }

  return parsed;
}

export function getWeekday(date: string): Weekday {
  return WEEKDAY_BY_UTC_DAY[parseDate(date).getUTCDay()];
}

export function getOperatingIntervalsForDate(
  date: string,
  weeklyOperatingHours: WeeklyOperatingHours,
  exceptions: OperatingHoursException[]
): OperatingInterval[] {
  const exception = exceptions.find(
    (candidate) => candidate.date === date
  );

  if (exception) {
    return exception.intervals;
  }

  return weeklyOperatingHours[getWeekday(date)];
}
