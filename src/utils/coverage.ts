import type {
  CoverageException,
  CoverageRequirement,
  OperatingHoursException,
  TimeInterval,
  Weekday,
  WeeklyCoverage,
  WeeklyOperatingHours,
} from "../types";
import {
  getOperatingIntervalsForDate,
  getWeekday,
  WEEKDAYS,
} from "./operatingCalendar";

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

export function createEmptyWeeklyCoverage(): WeeklyCoverage {
  return WEEKDAYS.reduce(
    (coverage, weekday) => {
      coverage[weekday] = [];
      return coverage;
    },
    {} as WeeklyCoverage
  );
}

export function getCoverageRequirementsForDate(
  date: string,
  weeklyCoverage: WeeklyCoverage,
  exceptions: CoverageException[]
): CoverageRequirement[] {
  const exception = exceptions.find(
    (candidate) => candidate.date === date
  );

  if (exception) {
    return exception.requirements;
  }

  return weeklyCoverage[getWeekday(date)];
}

export function getRequiredPeopleAt(
  date: string,
  time: string,
  weeklyCoverage: WeeklyCoverage,
  exceptions: CoverageException[]
): number | null {
  const minute = timeToMinutes(time);

  const matches = getCoverageRequirementsForDate(
    date,
    weeklyCoverage,
    exceptions
  ).filter((requirement) => {
    const start = timeToMinutes(requirement.start);
    const end = timeToMinutes(requirement.end);

    return minute >= start && minute < end;
  });

  if (matches.length !== 1) {
    return null;
  }

  return matches[0].minimumPeople;
}

export function isCoverageRequirementValid(
  requirement: CoverageRequirement
): boolean {
  return (
    Number.isInteger(requirement.minimumPeople) &&
    requirement.minimumPeople >= 0 &&
    timeToMinutes(requirement.end) >
      timeToMinutes(requirement.start)
  );
}

export function isCoverageRequirementWithinOperation(
  requirement: CoverageRequirement,
  operatingIntervals: TimeInterval[]
): boolean {
  if (!isCoverageRequirementValid(requirement)) {
    return false;
  }

  const start = timeToMinutes(requirement.start);
  const end = timeToMinutes(requirement.end);

  return operatingIntervals.some((operatingInterval) => {
    const operatingStart = timeToMinutes(
      operatingInterval.start
    );
    const operatingEnd = timeToMinutes(operatingInterval.end);

    return start >= operatingStart && end <= operatingEnd;
  });
}

export function hasOverlappingCoverage(
  requirements: CoverageRequirement[]
): boolean {
  const sorted = [...requirements].sort(
    (a, b) =>
      timeToMinutes(a.start) - timeToMinutes(b.start)
  );

  return sorted.some((requirement, index) => {
    const next = sorted[index + 1];

    if (!next) return false;

    return (
      timeToMinutes(requirement.end) >
      timeToMinutes(next.start)
    );
  });
}

export function getCoverageGaps(
  operatingIntervals: TimeInterval[],
  requirements: CoverageRequirement[]
): TimeInterval[] {
  const validRequirements = requirements
    .filter((requirement) =>
      isCoverageRequirementWithinOperation(
        requirement,
        operatingIntervals
      )
    )
    .sort(
      (a, b) =>
        timeToMinutes(a.start) - timeToMinutes(b.start)
    );

  const gaps: TimeInterval[] = [];

  for (const operatingInterval of operatingIntervals) {
    const operatingStart = timeToMinutes(
      operatingInterval.start
    );
    const operatingEnd = timeToMinutes(
      operatingInterval.end
    );

    let cursor = operatingStart;

    for (const requirement of validRequirements) {
      const requirementStart = timeToMinutes(
        requirement.start
      );
      const requirementEnd = timeToMinutes(
        requirement.end
      );

      if (
        requirementEnd <= operatingStart ||
        requirementStart >= operatingEnd
      ) {
        continue;
      }

      if (requirementStart > cursor) {
        gaps.push({
          start: minutesToTime(cursor),
          end: minutesToTime(requirementStart),
        });
      }

      cursor = Math.max(cursor, requirementEnd);

      if (cursor >= operatingEnd) {
        break;
      }
    }

    if (cursor < operatingEnd) {
      gaps.push({
        start: minutesToTime(cursor),
        end: minutesToTime(operatingEnd),
      });
    }
  }

  return gaps;
}

export function getCoverageGapsForDate(
  date: string,
  weeklyCoverage: WeeklyCoverage,
  coverageExceptions: CoverageException[],
  weeklyOperatingHours: WeeklyOperatingHours,
  operatingExceptions: OperatingHoursException[]
): TimeInterval[] {
  return getCoverageGaps(
    getOperatingIntervalsForDate(
      date,
      weeklyOperatingHours,
      operatingExceptions
    ),
    getCoverageRequirementsForDate(
      date,
      weeklyCoverage,
      coverageExceptions
    )
  );
}

export function setWeeklyCoverage(
  weeklyCoverage: WeeklyCoverage,
  weekday: Weekday,
  requirements: CoverageRequirement[]
): WeeklyCoverage {
  return {
    ...weeklyCoverage,
    [weekday]: requirements,
  };
}
