import type {
  AvailabilityException,
  PersonAvailability,
  TimeInterval,
  Weekday,
  WeeklyAvailability,
} from "../types";
import {
  getOperatingIntervalsForDate,
  getWeekday,
  WEEKDAYS,
} from "./operatingCalendar";
import type {
  OperatingHoursException,
  WeeklyOperatingHours,
} from "../types";

export function createEmptyWeeklyAvailability(): WeeklyAvailability {
  return WEEKDAYS.reduce(
    (availability, weekday) => {
      availability[weekday] = [];
      return availability;
    },
    {} as WeeklyAvailability
  );
}

export function createPersonAvailability(
  personId: string
): PersonAvailability {
  return {
    personId,
    weeklyAvailability: createEmptyWeeklyAvailability(),
    exceptions: [],
  };
}

export function getAvailabilityIntervalsForDate(
  date: string,
  availability: PersonAvailability
): TimeInterval[] {
  const exception = availability.exceptions.find(
    (candidate) => candidate.date === date
  );

  if (exception) {
    return exception.intervals;
  }

  return availability.weeklyAvailability[getWeekday(date)];
}

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export function intersectIntervals(
  first: TimeInterval[],
  second: TimeInterval[]
): TimeInterval[] {
  const intersections: TimeInterval[] = [];

  for (const left of first) {
    for (const right of second) {
      const startMinutes = Math.max(
        timeToMinutes(left.start),
        timeToMinutes(right.start)
      );
      const endMinutes = Math.min(
        timeToMinutes(left.end),
        timeToMinutes(right.end)
      );

      if (endMinutes > startMinutes) {
        const toTime = (minutes: number) =>
          `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(
            minutes % 60
          ).padStart(2, "0")}`;

        intersections.push({
          start: toTime(startMinutes),
          end: toTime(endMinutes),
        });
      }
    }
  }

  return intersections;
}

export function getSchedulableIntervalsForDate(
  date: string,
  availability: PersonAvailability,
  weeklyOperatingHours: WeeklyOperatingHours,
  operatingExceptions: OperatingHoursException[]
): TimeInterval[] {
  return intersectIntervals(
    getAvailabilityIntervalsForDate(date, availability),
    getOperatingIntervalsForDate(
      date,
      weeklyOperatingHours,
      operatingExceptions
    )
  );
}

export function isSchedulableForInterval(
  date: string,
  interval: TimeInterval,
  availability: PersonAvailability,
  weeklyOperatingHours: WeeklyOperatingHours,
  operatingExceptions: OperatingHoursException[]
): boolean {
  const requestedStart = timeToMinutes(interval.start);
  const requestedEnd = timeToMinutes(interval.end);

  if (requestedEnd <= requestedStart) {
    return false;
  }

  return getSchedulableIntervalsForDate(
    date,
    availability,
    weeklyOperatingHours,
    operatingExceptions
  ).some((schedulable) => {
    const schedulableStart = timeToMinutes(schedulable.start);
    const schedulableEnd = timeToMinutes(schedulable.end);

    return (
      requestedStart >= schedulableStart &&
      requestedEnd <= schedulableEnd
    );
  });
}

export function isAvailableForInterval(
  date: string,
  interval: TimeInterval,
  availability: PersonAvailability
): boolean {
  const requestedStart = timeToMinutes(interval.start);
  const requestedEnd = timeToMinutes(interval.end);

  if (requestedEnd <= requestedStart) {
    return false;
  }

  return getAvailabilityIntervalsForDate(
    date,
    availability
  ).some((available) => {
    const availableStart = timeToMinutes(available.start);
    const availableEnd = timeToMinutes(available.end);

    return (
      requestedStart >= availableStart &&
      requestedEnd <= availableEnd
    );
  });
}

export function setWeeklyAvailability(
  availability: PersonAvailability,
  weekday: Weekday,
  intervals: TimeInterval[]
): PersonAvailability {
  return {
    ...availability,
    weeklyAvailability: {
      ...availability.weeklyAvailability,
      [weekday]: intervals,
    },
  };
}

export function setAvailabilityExceptions(
  availability: PersonAvailability,
  exceptions: AvailabilityException[]
): PersonAvailability {
  return {
    ...availability,
    exceptions,
  };
}
