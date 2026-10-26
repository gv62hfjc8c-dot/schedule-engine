import type {
  OperatingCalendarConfiguration,
  Person,
  PersonAvailability,
  PresenceAssignment,
  PresenceConfiguration,
  TimeInterval,
  WorkRulesConfiguration,
} from "../types";
import {
  getAvailabilityIntervalsForDate,
  getSchedulableIntervalsForDate,
  isSchedulableForInterval,
} from "./availability";
import { getOperatingIntervalsForDate, getWeekday } from "./operatingCalendar";
import {
  checkPresenceAvailabilityCapacity,
  checkPresenceForAssignments,
  resolvePresenceForDate,
  type PresenceShortage,
} from "./presence";
import { isValidShiftDurationMinutes } from "./workRules";

/**
 * First scheduling engine: one date, one continuous shift per active person.
 *
 * Search is deterministic, finite and complete ONLY within the generated
 * 15-minute candidate grid plus all operational/availability/phase endpoints.
 * A "not_found" result is NOT a mathematical proof of impossibility.
 * Presence minima are hard constraints. No soft constraints are used yet.
 */
export interface GenerateDayScheduleInput {
  date: string;
  people: Person[];
  availabilities: PersonAvailability[];
  operatingCalendar: OperatingCalendarConfiguration;
  workRules: WorkRulesConfiguration;
  presence: PresenceConfiguration;
  /** Defaults to 50_000; allows callers to bound search effort. */
  maxSearchNodes?: number;
}

export type DayScheduleStatus =
  | "generated"
  | "closed"
  | "invalid_input"
  | "insufficient_capacity"
  | "not_found"
  | "search_limit";

export interface GenerateDayScheduleResult {
  status: DayScheduleStatus;
  /** Nonempty only when status is "generated". */
  assignments: PresenceAssignment[];
  issues: string[];
  /** Necessary capacity deficits, not necessarily scheduling conflicts. */
  shortages: PresenceShortage[];
  exploredNodes: number;
}

interface NumericInterval {
  start: number;
  end: number;
}

interface Candidate {
  personId: string;
  start: number;
  end: number;
}

const CANDIDATE_STEP_MINUTES = 15;
const DEFAULT_MAX_SEARCH_NODES = 50_000;

function minute(value: string): number | null {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) && value !== "24:00") {
    return null;
  }
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function clock(value: number): string {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function numeric(interval: TimeInterval): NumericInterval | null {
  const start = minute(interval.start);
  const end = minute(interval.end);
  if (start === null || end === null || start >= end || start === 1440) {
    return null;
  }
  return { start, end };
}

function asTimeInterval(value: NumericInterval): TimeInterval {
  return { start: clock(value.start), end: clock(value.end) };
}

function bad(issues: string[]): GenerateDayScheduleResult {
  return {
    status: "invalid_input",
    assignments: [],
    issues,
    shortages: [],
    exploredNodes: 0,
  };
}

function duplicateDate(exceptions: { date: string }[], date: string): boolean {
  return exceptions.filter((exception) => exception.date === date).length > 1;
}

function sortedAndValidated(
  intervals: TimeInterval[],
  label: string,
  issues: string[]
): NumericInterval[] {
  const parsed = intervals.map(numeric);
  if (parsed.some((interval) => interval === null)) {
    issues.push(`${label}: intervalo horário inválido.`);
  }
  const valid = parsed.filter(
    (interval): interval is NumericInterval => interval !== null
  ).sort((a, b) => a.start - b.start);
  if (valid.some(
    (interval, index) => index > 0 && interval.start < valid[index - 1].end
  )) {
    issues.push(`${label}: intervalos sobrepostos.`);
  }
  return valid;
}

function toAssignment(candidate: Candidate): PresenceAssignment {
  return {
    personId: candidate.personId,
    interval: { start: clock(candidate.start), end: clock(candidate.end) },
  };
}

/**
 * Candidate starts are a 15-minute grid, plus exact availability, operation
 * and phase endpoints (including start positions obtained by subtracting
 * the shift duration). The window length is the standard shift duration,
 * shortened only when the OPERATING interval itself is shorter.
 */
function createCandidates(
  personId: string,
  operating: NumericInterval[],
  schedulable: NumericInterval[],
  standardDuration: number,
  firstOpening: number,
  lastClosing: number
): Candidate[] {
  const result = new Map<string, Candidate>();
  const phaseEdges = [firstOpening + 30, lastClosing - 30];

  for (const operation of operating) {
    const duration = Math.min(
      standardDuration, operation.end - operation.start
    );

    for (const allowed of schedulable) {
      const earliest = Math.max(operation.start, allowed.start);
      const latest = Math.min(operation.end, allowed.end) - duration;
      if (latest < earliest) continue;

      const starts = new Set<number>([earliest, latest]);
      for (
        let start = Math.ceil(earliest / CANDIDATE_STEP_MINUTES) *
          CANDIDATE_STEP_MINUTES;
        start <= latest;
        start += CANDIDATE_STEP_MINUTES
      ) {
        starts.add(start);
      }
      for (const edge of [
        operation.start,
        operation.end,
        allowed.start,
        allowed.end,
        ...phaseEdges,
      ]) {
        starts.add(edge);
        starts.add(edge - duration);
      }

      for (const start of starts) {
        if (start < earliest || start > latest) continue;
        const candidate = { personId, start, end: start + duration };
        result.set(`${start}-${candidate.end}`, candidate);
      }
    }
  }

  return [...result.values()].sort(
    (a, b) => a.start - b.start || a.end - b.end
  );
}

export function generateDaySchedule(
  input: GenerateDayScheduleInput
): GenerateDayScheduleResult {
  const issues: string[] = [];
  const limit = input.maxSearchNodes ?? DEFAULT_MAX_SEARCH_NODES;

  if (!Number.isSafeInteger(limit) || limit <= 0) {
    issues.push("O limite de pesquisa deve ser um inteiro positivo.");
  }
  if (!isValidShiftDurationMinutes(
    input.workRules.standardShiftDurationMinutes
  )) {
    issues.push("A duração padrão do turno não está configurada ou é inválida.");
  }
  if (new Set(input.people.map((person) => person.id)).size !==
      input.people.length ||
      input.people.some((person) => !person.id.trim())) {
    issues.push("As pessoas devem ter identificadores únicos e não vazios.");
  }
  if (new Set(input.availabilities.map((entry) => entry.personId)).size !==
      input.availabilities.length) {
    issues.push("Há disponibilidades duplicadas para uma pessoa.");
  }
  if (input.availabilities.some(
    (entry) => !input.people.some((person) => person.id === entry.personId)
  )) {
    issues.push("Existe disponibilidade de uma pessoa desconhecida.");
  }
  if (duplicateDate(input.operatingCalendar.exceptions, input.date)) {
    issues.push("Existem exceções duplicadas do calendário para esta data.");
  }
  if (duplicateDate(input.presence.presenceExceptions, input.date)) {
    issues.push("Existem exceções duplicadas de presença para esta data.");
  }
  for (const entry of input.availabilities) {
    if (duplicateDate(entry.exceptions, input.date)) {
      issues.push(`Existem exceções de disponibilidade duplicadas para ${entry.personId}.`);
    }
  }

  let operatingIntervals: TimeInterval[];
  let presence: ReturnType<typeof resolvePresenceForDate>;
  try {
    // Date-specific exceptions would otherwise bypass the calendar's date parser.
    getWeekday(input.date);
    operatingIntervals = getOperatingIntervalsForDate(
      input.date,
      input.operatingCalendar.weeklyOperatingHours,
      input.operatingCalendar.exceptions
    );
    presence = resolvePresenceForDate(
      input.date,
      input.presence.weeklyPresenceRequirements,
      input.presence.presenceExceptions,
      input.operatingCalendar.weeklyOperatingHours,
      input.operatingCalendar.exceptions
    );
  } catch {
    issues.push("Data inválida ou configuração semanal incompleta.");
    return bad(issues);
  }

  const operating = sortedAndValidated(
    operatingIntervals, "Calendário operacional", issues
  );
  if (issues.length > 0) return bad(issues);
  if (operating.length === 0) {
    return {
      status: "closed", assignments: [], issues: [], shortages: [],
      exploredNodes: 0,
    };
  }

  if (presence.status !== "configured") {
    return bad(
      presence.issues.length
        ? presence.issues
        : ["Os requisitos mínimos de presença não estão configurados."]
    );
  }

  const activePeople = input.people.filter((person) => person.active)
    .sort((a, b) => a.id.localeCompare(b.id, "en"));
  const effectiveAvailability = new Map<string, NumericInterval[]>();

  for (const person of activePeople) {
    const entry = input.availabilities.find(
      (candidate) => candidate.personId === person.id
    );
    if (!entry) {
      effectiveAvailability.set(person.id, []);
      continue;
    }
    const raw = getAvailabilityIntervalsForDate(input.date, entry);
    sortedAndValidated(raw, `Disponibilidade de ${person.id}`, issues);
    if (issues.length > 0) continue;
    const effective = getSchedulableIntervalsForDate(
      input.date,
      entry,
      input.operatingCalendar.weeklyOperatingHours,
      input.operatingCalendar.exceptions
    );
    effectiveAvailability.set(
      person.id,
      sortedAndValidated(
        effective, `Disponibilidade operacional de ${person.id}`, issues
      )
    );
  }
  if (issues.length > 0) return bad(issues);

  const requirements = presence.requirements;
  const capacity = checkPresenceAvailabilityCapacity(
    operatingIntervals,
    requirements,
    activePeople.map((person) =>
      (effectiveAvailability.get(person.id) ?? []).map(asTimeInterval)
    )
  );
  if (capacity.issues.length > 0) return bad(capacity.issues);
  if (!capacity.valid) {
    return {
      status: "insufficient_capacity",
      assignments: [],
      issues: ["Existem intervalos sem pessoas disponíveis suficientes."],
      shortages: capacity.shortages,
      exploredNodes: 0,
    };
  }

  const firstOpening = operating[0].start;
  const lastClosing = operating[operating.length - 1].end;
  const duration = input.workRules.standardShiftDurationMinutes;
  // Validated above, but TypeScript needs a narrow non-null reference.
  if (duration === null) return bad(["Duração padrão não configurada."]);

  const candidates = activePeople.flatMap((person) =>
    createCandidates(
      person.id,
      operating,
      effectiveAvailability.get(person.id) ?? [],
      duration,
      firstOpening,
      lastClosing
    )
  );
  // Stable output does not depend on people/availability array order.
  candidates.sort(
    (a, b) =>
      a.personId.localeCompare(b.personId, "en") ||
      a.start - b.start ||
      a.end - b.end
  );

  let exploredNodes = 0;
  let limitReached = false;

  // Iterative deepening finds a solution using the fewest people, within
  // the finite candidate set. It is NOT an optimization for fair distribution.
  const search = (
    selected: Candidate[],
    used: Set<string>,
    maxAssignments: number
  ): Candidate[] | null => {
    if (exploredNodes >= limit) {
      limitReached = true;
      return null;
    }
    exploredNodes += 1;

    const check = checkPresenceForAssignments(
      operatingIntervals,
      requirements,
      selected.map(toAssignment)
    );
    if (check.issues.length > 0) {
      // Generated candidates must never violate structural constraints.
      throw new Error(`Erro interno do gerador: ${check.issues.join(" ")}`);
    }
    if (check.valid) return selected;
    if (selected.length >= maxAssignments) return null;

    const uncoveredStart = minute(check.shortages[0].interval.start);
    if (uncoveredStart === null) {
      throw new Error("Intervalo de presença inválido no validador.");
    }
    for (const candidate of candidates) {
      if (used.has(candidate.personId)) continue;
      if (candidate.start > uncoveredStart ||
          candidate.end <= uncoveredStart) continue;
      const next = new Set(used);
      next.add(candidate.personId);
      const solution = search([...selected, candidate], next, maxAssignments);
      if (solution) return solution;
      if (limitReached) return null;
    }
    return null;
  };

  let solution: Candidate[] | null = null;
  for (let count = 0; count <= activePeople.length; count++) {
    solution = search([], new Set<string>(), count);
    if (solution || limitReached) break;
  }

  if (solution) {
    const assignments = solution.map(toAssignment).sort(
      (a, b) => a.personId.localeCompare(b.personId, "en")
    );
    // Final, independent hard-constraint guard (never trust search alone).
    const checked = checkPresenceForAssignments(
      operatingIntervals, requirements, assignments
    );
    if (!checked.valid || assignments.some((assignment) => {
      const entry = input.availabilities.find(
        (item) => item.personId === assignment.personId
      );
      return !entry || !isSchedulableForInterval(
        input.date, assignment.interval, entry,
        input.operatingCalendar.weeklyOperatingHours,
        input.operatingCalendar.exceptions
      );
    })) {
      throw new Error("O gerador produziu uma atribuição não válida.");
    }

    return {
      status: "generated",
      assignments,
      issues: [],
      shortages: [],
      exploredNodes,
    };
  }
  return {
    status: limitReached ? "search_limit" : "not_found",
    assignments: [],
    issues: [
      limitReached
        ? "A pesquisa atingiu o limite de nós antes de encontrar solução."
        : "Não foi encontrada solução entre os turnos candidatos V0.",
      "Isto não demonstra impossibilidade fora do espaço de pesquisa V0.",
    ],
    shortages: [],
    exploredNodes,
  };
}
