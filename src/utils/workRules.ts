import type {
  OperatingHoursException,
  PersonAvailability,
  TimeInterval,
  WeeklyOperatingHours,
} from "../types";
import {
  isSchedulableForInterval,
} from "./availability";

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

export function isValidShiftDurationMinutes(
  durationMinutes: number | null
): durationMinutes is number {
  return (
    durationMinutes !== null &&
    Number.isInteger(durationMinutes) &&
    durationMinutes > 0
  );
}

export function getIntervalDurationMinutes(
  interval: TimeInterval
): number {
  return (
    timeToMinutes(interval.end) -
    timeToMinutes(interval.start)
  );
}

export function isShiftWithinOperation(
  shift: TimeInterval,
  operatingIntervals: TimeInterval[]
): boolean {
  const shiftStart = timeToMinutes(shift.start);
  const shiftEnd = timeToMinutes(shift.end);

  if (shiftEnd <= shiftStart) {
    return false;
  }

  return operatingIntervals.some((interval) => {
    const start = timeToMinutes(interval.start);
    const end = timeToMinutes(interval.end);

    return shiftStart >= start && shiftEnd <= end;
  });
}

export function createOpeningShift(
  operatingIntervals: TimeInterval[],
  durationMinutes: number
): TimeInterval | null {
  if (!isValidShiftDurationMinutes(durationMinutes)) {
    return null;
  }

  const firstInterval = [...operatingIntervals].sort(
    (a, b) =>
      timeToMinutes(a.start) - timeToMinutes(b.start)
  )[0];

  if (!firstInterval) {
    return null;
  }

  const start = timeToMinutes(firstInterval.start);
  const end = start + durationMinutes;

  if (end > timeToMinutes(firstInterval.end)) {
    return null;
  }

  return {
    start: firstInterval.start,
    end: minutesToTime(end),
  };
}

export function createClosingShift(
  operatingIntervals: TimeInterval[],
  durationMinutes: number
): TimeInterval | null {
  if (!isValidShiftDurationMinutes(durationMinutes)) {
    return null;
  }

  const lastInterval = [...operatingIntervals].sort(
    (a, b) =>
      timeToMinutes(a.end) - timeToMinutes(b.end)
  ).at(-1);

  if (!lastInterval) {
    return null;
  }

  const end = timeToMinutes(lastInterval.end);
  const start = end - durationMinutes;

  if (start < timeToMinutes(lastInterval.start)) {
    return null;
  }

  return {
    start: minutesToTime(start),
    end: lastInterval.end,
  };
}

export function canPersonWorkContinuousShift(
  date: string,
  shift: TimeInterval,
  availability: PersonAvailability,
  weeklyOperatingHours: WeeklyOperatingHours,
  operatingExceptions: OperatingHoursException[]
): boolean {
  return isSchedulableForInterval(
    date,
    shift,
    availability,
    weeklyOperatingHours,
    operatingExceptions
  );
}
