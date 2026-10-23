import type {
  OperatingHoursException,
  PresenceAssignment,
  PresenceException,
  PresenceRequirement,
  TimeInterval,
  Weekday,
  WeeklyOperatingHours,
  WeeklyPresenceRequirements,
} from "../types";
import {
  getOperatingIntervalsForDate,
  getWeekday,
  WEEKDAYS,
} from "./operatingCalendar";

export function createEmptyWeeklyPresenceRequirements():
  WeeklyPresenceRequirements {
  return WEEKDAYS.reduce((result, weekday) => {
    result[weekday] = null;
    return result;
  }, {} as WeeklyPresenceRequirements);
}

export function isPresenceRequirementValid(
  requirement: PresenceRequirement
): boolean {
  const {
    minimumDuringOperation: base,
    minimumAtOpening: opening,
    minimumAtClosing: closing,
  } = requirement;

  return (
    [base, opening, closing].every(
      (value) => Number.isInteger(value) && value >= 0
    ) &&
    opening >= base &&
    closing >= base
  );
}

export type PresenceResolution =
  | { status: "closed"; requirements: null; issues: string[] }
  | { status: "unconfigured"; requirements: null; issues: string[] }
  | { status: "invalid"; requirements: null; issues: string[] }
  | { status: "configured"; requirements: PresenceRequirement; issues: [] };

export function resolvePresenceForDate(
  date: string,
  weeklyPresenceRequirements: WeeklyPresenceRequirements,
  presenceExceptions: PresenceException[],
  weeklyOperatingHours: WeeklyOperatingHours,
  operatingExceptions: OperatingHoursException[]
): PresenceResolution {
  const operatingIntervals = getOperatingIntervalsForDate(
    date, weeklyOperatingHours, operatingExceptions
  );

  if (operatingIntervals.length === 0) {
    return { status: "closed", requirements: null, issues: [] };
  }

  const matchingExceptions = presenceExceptions.filter(
    (exception) => exception.date === date
  );

  if (matchingExceptions.length > 1) {
    return {
      status: "invalid",
      requirements: null,
      issues: [`Existem várias exceções de presença para ${date}.`],
    };
  }

  const requirements = matchingExceptions.length === 1
    ? matchingExceptions[0].requirements
    : weeklyPresenceRequirements[getWeekday(date)];

  if (requirements === null || requirements === undefined) {
    return { status: "unconfigured", requirements: null, issues: [] };
  }

  if (!isPresenceRequirementValid(requirements)) {
    return {
      status: "invalid",
      requirements: null,
      issues: [
        "Os mínimos têm de ser inteiros não negativos; abertura e fecho não podem ser inferiores ao mínimo operacional.",
      ],
    };
  }

  return { status: "configured", requirements, issues: [] };
}

type PresencePhase = "opening" | "operation" | "closing";

export interface PresenceShortage {
  phase: PresencePhase;
  interval: TimeInterval;
  required: number;
  actual: number;
}

export interface PresenceCheckResult {
  valid: boolean;
  issues: string[];
  shortages: PresenceShortage[];
}

function minute(time: string): number | null {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) && time !== "24:00") {
    return null;
  }

  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function time(value: number): string {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

interface NumericInterval {
  start: number;
  end: number;
}

function parseInterval(value: TimeInterval): NumericInterval | null {
  const start = minute(value.start);
  const end = minute(value.end);

  if (start === null || end === null || end <= start || start === 1440) {
    return null;
  }

  return { start, end };
}

/**
 * Pure validation of an already-proposed day's presence. This does not
 * generate assignments and does not claim work-rule or availability validity.
 *
 * Boundaries are [start, end). A person is counted once, both at opening and
 * at closing where their single continuous assignment spans the full day.
 */
export function checkPresenceForAssignments(
  operatingIntervals: TimeInterval[],
  requirements: PresenceRequirement,
  assignments: PresenceAssignment[]
): PresenceCheckResult {
  const issues: string[] = [];

  if (!isPresenceRequirementValid(requirements)) {
    issues.push("Requisitos de presença inválidos.");
  }

  const operation = operatingIntervals.map(parseInterval);

  if (operation.some((interval) => interval === null)) {
    issues.push("O calendário operacional contém intervalos inválidos.");
  }

  const validOperation = operation.filter(
    (interval): interval is NumericInterval => interval !== null
  ).sort((a, b) => a.start - b.start);

  if (validOperation.length === 0) {
    issues.push("Não existe operação aberta a validar.");
  }

  for (let i = 1; i < validOperation.length; i++) {
    if (validOperation[i].start < validOperation[i - 1].end) {
      issues.push("O calendário operacional tem intervalos sobrepostos.");
      break;
    }
  }

  const seen = new Set<string>();
  const assigned: NumericInterval[] = [];
  for (const assignment of assignments) {
    const range = parseInterval(assignment.interval);

    if (!assignment.personId.trim()) {
      issues.push("Uma atribuição não tem identificador de pessoa.");
    } else if (seen.has(assignment.personId)) {
      issues.push(`A pessoa ${assignment.personId} tem mais de um turno no dia.`);
    }

    seen.add(assignment.personId);

    if (!range) {
      issues.push("Uma atribuição contém um intervalo inválido.");
    } else if (!validOperation.some(
      (interval) => range.start >= interval.start && range.end <= interval.end
    )) {
      issues.push("Uma atribuição ultrapassa o funcionamento contínuo.");
    } else {
      assigned.push(range);
    }
  }

  if (issues.length > 0) {
    return { valid: false, issues, shortages: [] };
  }

  const shortages: PresenceShortage[] = [];
  const firstStart = validOperation[0].start;
  const lastEnd = validOperation[validOperation.length - 1].end;

  for (const interval of validOperation) {
    const edges = new Set<number>([interval.start, interval.end]);

    for (const shift of assigned) {
      if (shift.start > interval.start && shift.start < interval.end) {
        edges.add(shift.start);
      }
      if (shift.end > interval.start && shift.end < interval.end) {
        edges.add(shift.end);
      }
    }

    const sortedEdges = [...edges].sort((a, b) => a - b);
    for (let index = 0; index < sortedEdges.length - 1; index++) {
      const start = sortedEdges[index];
      const end = sortedEdges[index + 1];
      const actual = assigned.filter(
        (shift) => shift.start <= start && shift.end > start
      ).length;

      let required = requirements.minimumDuringOperation;
      let phase: PresencePhase = "operation";

      if (start === firstStart &&
          requirements.minimumAtOpening > required) {
        required = requirements.minimumAtOpening;
        phase = "opening";
      }

      if (end === lastEnd &&
          requirements.minimumAtClosing > required) {
        required = requirements.minimumAtClosing;
        phase = "closing";
      }

      if (actual < required) {
        shortages.push({
          phase,
          interval: { start: time(start), end: time(end) },
          required,
          actual,
        });
      }
    }
  }

  return { valid: shortages.length === 0, issues: [], shortages };
}

/**
 * Necessary-condition check, not a scheduling feasibility proof:
 * at every instant of operation, enough distinct people must be available.
 * A successful result does NOT prove that valid continuous shifts exist.
 * Each entry in availabilityByPerson belongs to one distinct active person.
 */
export function checkPresenceAvailabilityCapacity(
  operatingIntervals: TimeInterval[],
  requirements: PresenceRequirement,
  availabilityByPerson: TimeInterval[][]
): PresenceCheckResult {
  const issues: string[] = [];
  if (!isPresenceRequirementValid(requirements)) {
    issues.push("Requisitos de presença inválidos.");
  }

  const operation = operatingIntervals.map(parseInterval);
  if (operation.some((item) => item === null)) {
    issues.push("Operação contém intervalos inválidos.");
  }
  const validOperation = operation.filter(
    (item): item is NumericInterval => item !== null
  ).sort((a, b) => a.start - b.start);

  if (validOperation.length === 0) {
    issues.push("Não existe operação aberta a verificar.");
  }
  for (let index = 1; index < validOperation.length; index++) {
    if (validOperation[index].start < validOperation[index - 1].end) {
      issues.push("Os intervalos operacionais sobrepõem-se.");
      break;
    }
  }

  const available = availabilityByPerson.map((intervals) =>
    intervals.map(parseInterval)
  );

  if (available.some((intervals) => intervals.some((item) => item === null))) {
    issues.push("Uma disponibilidade contém um intervalo inválido.");
  }

  if (issues.length > 0) {
    return { valid: false, issues, shortages: [] };
  }

  const numericAvailability: NumericInterval[][] = available.map(
    (intervals) => intervals.filter(
      (item): item is NumericInterval => item !== null
    )
  );
  const shortages: PresenceShortage[] = [];
  const firstStart = validOperation[0].start;
  const lastEnd = validOperation[validOperation.length - 1].end;

  for (const interval of validOperation) {
    const edges = new Set<number>([interval.start, interval.end]);

    for (const personIntervals of numericAvailability) {
      for (const availableInterval of personIntervals) {
        if (availableInterval.start > interval.start &&
            availableInterval.start < interval.end) {
          edges.add(availableInterval.start);
        }
        if (availableInterval.end > interval.start &&
            availableInterval.end < interval.end) {
          edges.add(availableInterval.end);
        }
      }
    }

    const sortedEdges = [...edges].sort((a, b) => a - b);
    for (let i = 0; i < sortedEdges.length - 1; i++) {
      const start = sortedEdges[i];
      const end = sortedEdges[i + 1];
      const actual = numericAvailability.filter(
        (personIntervals) => personIntervals.some(
          (availableInterval) =>
            availableInterval.start <= start &&
            availableInterval.end >= end
        )
      ).length;

      let required = requirements.minimumDuringOperation;
      let phase: PresencePhase = "operation";

      if (start === firstStart &&
          requirements.minimumAtOpening > required) {
        required = requirements.minimumAtOpening;
        phase = "opening";
      }

      if (end === lastEnd &&
          requirements.minimumAtClosing > required) {
        required = requirements.minimumAtClosing;
        phase = "closing";
      }

      if (actual < required) {
        shortages.push({
          phase,
          interval: { start: time(start), end: time(end) },
          required,
          actual,
        });
      }
    }
  }

  return { valid: shortages.length === 0, issues: [], shortages };
}
