import type {
  AvailabilityException,
  PersonAvailability,
  TimeInterval,
  Weekday,
  WeeklyAvailability,
} from "../types";
import { getWeekday, WEEKDAYS } from "./operatingCalendar";

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
