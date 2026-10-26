import type {
  DatedWorkShift,
  Person,
  PersonAvailability,
  PresenceConfiguration,
  TimeInterval,
  WorkConstraintConfiguration,
} from "../types";
import type { GenerateDayScheduleInput, DayScheduleStatus } from "./dailyGenerator";
import {
  getAvailabilityIntervalsForDate,
  getSchedulableIntervalsForDate,
  isSchedulableForInterval,
} from "./availability";
import { getOperatingIntervalsForDate, getWeekday } from "./operatingCalendar";
import {
  checkPresenceAvailabilityCapacity,
  resolvePresenceForDate,
  type PresenceShortage,
} from "./presence";
import { checkPresenceForWorkShifts } from "./workCoverage";
import {
  getEffectiveWorkIntervals,
  validateWorkConstraints,
} from "./workConstraints";
import { isValidShiftDurationMinutes } from "./workRules";

/**
 * P6.3 isolated daily generator V0. Generates ONE attendance span per person
 * with an optional meal, and searches work/meal combinations simultaneously.
 *
 * NOT a period-wide certified schedule: weekly quotas and inter-day rest
 * require confirmed external context and a period-level search. The result
 * never claims to validate those rules. Legacy generators are untouched.
 */
export interface GenerateMealAwareDayInput
  extends Omit<GenerateDayScheduleInput, "workRules"> {
  workRules: GenerateDayScheduleInput["workRules"];
  workConstraints: WorkConstraintConfiguration;
  /** Explicit IANA time zone; never derive from the browser. */
  timeZone: string;
}

export interface GenerateMealAwareDayResult {
  status: DayScheduleStatus;
  validationScope: "daily_work_and_coverage_only";
  /** Published only when status is generated; all or nothing. */
  assignments: DatedWorkShift[];
  issues: string[];
  shortages: PresenceShortage[];
  exploredNodes: number;
  /** Number of distinct candidate shifts/meal combinations after filtering. */
  candidateCount: number;
}

/**
 * Shared finite search budget. Enables period-level backtracking without
 * resetting the node limit for each new day or rejected daily candidate.
 */
export interface MealAwareSearchBudget {
  maxNodes: number;
  exploredNodes: number;
  limitReached: boolean;
}

export interface MealAwareDailySearchOptions {
  budget?: MealAwareSearchBudget;
  /** Return true only if the downstream schedule can be completed. */
  acceptSolution?: (assignments: DatedWorkShift[]) => boolean;
}

interface NumericInterval {
  start: number;
  end: number;
}
interface Candidate {
  personId: string;
  start: number;
  end: number;
  mealStart: number | null;
  mealEnd: number | null;
  /** Work-only intervals for the uncovered-first search. */
  working: NumericInterval[];
}

const GRID_MINUTES = 15;
const DEFAULT_MAX_SEARCH_NODES = 50_000;

function minute(value: string): number | null {
  if (typeof value !== "string" ||
    (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) && value !== "24:00")) {
    return null;
  }
  const [hour, min] = value.split(":").map(Number);
  return hour * 60 + min;
}

function clock(value: number): string {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function numeric(value: TimeInterval): NumericInterval | null {
  const start = minute(value?.start);
  const end = minute(value?.end);
  if (start === null || end === null || start >= end || start === 1440) {
    return null;
  }
  return { start, end };
}

function readIntervals(
  source: TimeInterval[],
  label: string,
  issues: string[]
): NumericInterval[] {
  const parsed = source.map(numeric);
  if (parsed.some((interval) => interval === null)) {
    issues.push(`${label}: intervalo horário inválido.`);
  }
  const valid = parsed.filter(
    (interval): interval is NumericInterval => interval !== null
  ).sort((a, b) => a.start - b.start);
  if (valid.some((interval, index) =>
    index > 0 && interval.start < valid[index - 1].end
  )) {
    issues.push(`${label}: intervalos sobrepostos.`);
  }
  return valid;
}

function reject(issues: string[]): GenerateMealAwareDayResult {
  return {
    status: "invalid_input",
    validationScope: "daily_work_and_coverage_only",
    assignments: [],
    issues,
    shortages: [],
    exploredNodes: 0,
    candidateCount: 0,
  };
}

function duplicateDate(entries: { date: string }[], date: string): boolean {
  return entries.filter((entry) => entry.date === date).length > 1;
}

function toShift(date: string, candidate: Candidate): DatedWorkShift {
  return {
    date,
    personId: candidate.personId,
    interval: { start: clock(candidate.start), end: clock(candidate.end) },
    mealBreak: candidate.mealStart === null || candidate.mealEnd === null
      ? null
      : { start: clock(candidate.mealStart), end: clock(candidate.mealEnd) },
  };
}

function gridAndExact(
  lower: number,
  upper: number,
  extra: number[]
): number[] {
  const values = new Set([lower, upper]);
  for (
    let value = Math.ceil(lower / GRID_MINUTES) * GRID_MINUTES;
    value <= upper;
    value += GRID_MINUTES
  ) {
    values.add(value);
  }
  for (const value of extra) {
    if (value >= lower && value <= upper) values.add(value);
  }
  return [...values].sort((a, b) => a - b);
}

/**
 * Candidate attendance duration is based on the STANDARD effective shift.
 * A meal is added outside these effective hours. When an operating interval
 * is too short for the standard shift plus meal, the effective work interval
 * is shortened; availability alone does not shorten the standard shift V0.
 *
 * If the operating interval is too short to fit a mandatory meal, we allow
 * at most the no-meal threshold of effective work instead.
 *
 * Finite candidate grid: 15m plus exact operation/availability/phase edges.
 * Does NOT claim global search completeness outside that grid.
 */
function createCandidates(
  date: string,
  personId: string,
  operating: NumericInterval[],
  schedulable: NumericInterval[],
  standardMinutes: number,
  constraints: WorkConstraintConfiguration,
  firstOpening: number,
  lastClosing: number
): Candidate[] {
  const result = new Map<string, Candidate>();
  const meal = constraints.mealBreak;
  const target = Math.min(
    standardMinutes,
    constraints.maximumDailyEffectiveMinutes,
    constraints.maximumWeeklyEffectiveMinutes
  );
  const phases = [firstOpening + 30, lastClosing - 30];

  for (const operation of operating) {
    const operatingDuration = operation.end - operation.start;
    const effectiveWithMeal = Math.min(
      target, operatingDuration - meal.durationMinutes
    );
    const withMeal =
      target > meal.requiredAboveEffectiveMinutes &&
      effectiveWithMeal > meal.requiredAboveEffectiveMinutes &&
      effectiveWithMeal > meal.earliestStartAfterWorkMinutes &&
      meal.earliestStartAfterWorkMinutes <= meal.latestStartAfterWorkMinutes;
    const effectiveMinutes = withMeal
      ? effectiveWithMeal
      : Math.min(target, operatingDuration, meal.requiredAboveEffectiveMinutes);
    if (effectiveMinutes <= 0) continue;
    const span = effectiveMinutes + (withMeal ? meal.durationMinutes : 0);

    for (const allowed of schedulable) {
      const first = Math.max(operation.start, allowed.start);
      const last = Math.min(operation.end, allowed.end) - span;
      if (last < first) continue;

      const starts = gridAndExact(first, last, [
        operation.start, operation.end - span,
        allowed.start, allowed.end - span,
        ...phases.flatMap((edge) => [edge, edge - span]),
      ]);
      const mealOffsets = withMeal
        ? gridAndExact(
            meal.earliestStartAfterWorkMinutes,
            Math.min(meal.latestStartAfterWorkMinutes, effectiveMinutes - 1),
            []
          )
        : [0];

      for (const start of starts) {
        for (const mealOffset of mealOffsets) {
          const mealStart = withMeal ? start + mealOffset : null;
          const mealEnd = withMeal && mealStart !== null
            ? mealStart + meal.durationMinutes : null;
          const candidate: Candidate = {
            personId,
            start,
            end: start + span,
            mealStart,
            mealEnd,
            working: mealStart === null || mealEnd === null
              ? [{ start, end: start + span }]
              : [{ start, end: mealStart }, { start: mealEnd, end: start + span }],
          };
          result.set(
            `${start}-${candidate.end}-${mealStart ?? "none"}`,
            candidate
          );
        }
      }
    }
  }
  return [...result.values()].sort(
    (a, b) => a.start - b.start ||
      (a.mealStart ?? -1) - (b.mealStart ?? -1) || a.end - b.end
  );
}

function candidateValidForDailyWork(
  date: string,
  candidate: Candidate,
  constraints: WorkConstraintConfiguration,
  timeZone: string
): boolean {
  const workCheck = validateWorkConstraints({
    timeZone,
    rules: constraints,
    targetPeriod: { startDate: date, endDate: date },
    knownSchedule: {
      startDate: date,
      endDate: date,
      complete: false,
      shifts: [toShift(date, candidate)],
    },
  });
  // Deliberately incomplete: the complete week and adjacent shifts cannot
  // be asserted here. Only locally verified candidates may be searched.
  return workCheck.status === "incomplete_context" &&
    workCheck.violations.length === 0 && workCheck.issues.length === 1;
}

export function searchMealAwareDaySchedule(
  input: GenerateMealAwareDayInput,
  options: MealAwareDailySearchOptions = {}
): GenerateMealAwareDayResult {
  const issues: string[] = [];
  const limit = input.maxSearchNodes ?? DEFAULT_MAX_SEARCH_NODES;
  const budget = options.budget ?? {
    maxNodes: limit,
    exploredNodes: 0,
    limitReached: false,
  };
  const startingNodes = budget.exploredNodes;
  if (!Number.isSafeInteger(budget.maxNodes) || budget.maxNodes <= 0 ||
      !Number.isSafeInteger(budget.exploredNodes) || budget.exploredNodes < 0 ||
      typeof budget.limitReached !== "boolean") {
    issues.push("O orçamento de pesquisa deve ser válido.");
  }
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    issues.push("O limite de pesquisa deve ser um inteiro positivo.");
  }
  if (!isValidShiftDurationMinutes(input.workRules?.standardShiftDurationMinutes ?? null)) {
    issues.push("A duração padrão do turno não está configurada ou é inválida.");
  }
  const people: Person[] = input.people ?? [];
  const availabilities: PersonAvailability[] = input.availabilities ?? [];
  if (new Set(people.map(p => p.id)).size !== people.length ||
      people.some(p => !p.id?.trim())) {
    issues.push("As pessoas devem ter identificadores únicos e não vazios.");
  }
  if (new Set(availabilities.map(p => p.personId)).size !== availabilities.length) {
    issues.push("Há disponibilidades duplicadas para uma pessoa.");
  }
  if (availabilities.some(entry =>
    !people.some(person => person.id === entry.personId)
  )) {
    issues.push("Existe disponibilidade de uma pessoa desconhecida.");
  }
  if (duplicateDate(input.operatingCalendar.exceptions, input.date)) {
    issues.push("Existem exceções duplicadas do calendário para esta data.");
  }
  if (duplicateDate(input.presence.presenceExceptions, input.date)) {
    issues.push("Existem exceções duplicadas de presença para esta data.");
  }
  for (const entry of availabilities) {
    if (duplicateDate(entry.exceptions, input.date)) {
      issues.push(`Existem exceções de disponibilidade duplicadas para ${entry.personId}.`);
    }
  }

  // Pure work validator also validates the IANA zone and all rule parameters.
  // It NEVER certifies an empty external context; we only use input diagnostics.
  const probe = validateWorkConstraints({
    timeZone: input.timeZone,
    rules: input.workConstraints,
    targetPeriod: { startDate: input.date, endDate: input.date },
    knownSchedule: {
      startDate: input.date,
      endDate: input.date,
      complete: false,
      shifts: [],
    },
  });
  if (probe.status === "invalid_input") issues.push(...probe.issues);
  if (issues.length > 0) return reject(issues);

  let operatingIntervals: TimeInterval[];
  let presence: ReturnType<typeof resolvePresenceForDate>;
  try {
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
    return reject(["Data inválida ou configuração semanal incompleta."]);
  }
  const operating = readIntervals(
    operatingIntervals, "Calendário operacional", issues
  );
  if (issues.length > 0) return reject(issues);
  if (operating.length === 0) {
    return {
      status: "closed",
      validationScope: "daily_work_and_coverage_only",
      assignments: [],
      issues: [],
      shortages: [],
      exploredNodes: 0,
      candidateCount: 0,
    };
  }
  if (presence.status !== "configured") {
    return reject(
      presence.issues.length
        ? presence.issues
        : ["Os requisitos mínimos de presença não estão configurados."]
    );
  }

  const active = people.filter(person => person.active)
    .sort((a, b) => a.id.localeCompare(b.id, "en"));
  const effectiveAvailability = new Map<string, NumericInterval[]>();
  for (const person of active) {
    const entry = availabilities.find(item => item.personId === person.id);
    if (!entry) {
      effectiveAvailability.set(person.id, []);
      continue;
    }
    const raw = getAvailabilityIntervalsForDate(input.date, entry);
    readIntervals(raw, `Disponibilidade de ${person.id}`, issues);
    if (issues.length > 0) continue;
    const effective = getSchedulableIntervalsForDate(
      input.date, entry,
      input.operatingCalendar.weeklyOperatingHours,
      input.operatingCalendar.exceptions
    );
    effectiveAvailability.set(
      person.id,
      readIntervals(
        effective, `Disponibilidade operacional de ${person.id}`, issues
      )
    );
  }
  if (issues.length > 0) return reject(issues);

  const requirements = presence.requirements;
  const capacity = checkPresenceAvailabilityCapacity(
    operatingIntervals,
    requirements,
    active.map(person =>
      (effectiveAvailability.get(person.id) ?? []).map(value => ({
        start: clock(value.start), end: clock(value.end),
      }))
    )
  );
  if (capacity.issues.length > 0) return reject(capacity.issues);
  if (!capacity.valid) {
    return {
      status: "insufficient_capacity",
      validationScope: "daily_work_and_coverage_only",
      assignments: [],
      issues: ["Existem intervalos sem pessoas disponíveis suficientes."],
      shortages: capacity.shortages,
      exploredNodes: 0,
      candidateCount: 0,
    };
  }

  const standard = input.workRules.standardShiftDurationMinutes;
  if (standard === null) return reject(["Duração padrão não configurada."]);
  const candidates = active.flatMap(person => createCandidates(
    input.date,
    person.id,
    operating,
    effectiveAvailability.get(person.id) ?? [],
    standard,
    input.workConstraints,
    operating[0].start,
    operating[operating.length - 1].end
  )).filter(candidate => candidateValidForDailyWork(
    input.date, candidate, input.workConstraints, input.timeZone
  ));
  candidates.sort((a, b) =>
    a.personId.localeCompare(b.personId, "en") ||
    a.start - b.start ||
    (a.mealStart ?? -1) - (b.mealStart ?? -1) ||
    a.end - b.end
  );

  const search = (
    selected: Candidate[],
    used: Set<string>,
    maxPeople: number
  ): Candidate[] | null => {
    if (budget.limitReached ||
        budget.exploredNodes >= budget.maxNodes) {
      budget.limitReached = true;
      return null;
    }
    budget.exploredNodes++;

    const coverage = checkPresenceForWorkShifts(
      input.date,
      operatingIntervals,
      requirements,
      selected.map(candidate => toShift(input.date, candidate))
    );
    if (coverage.issues.length > 0) {
      throw new Error(`Erro interno de cobertura: ${coverage.issues.join(" ")}`);
    }
    if (coverage.valid) {
      const assignments = selected.map(candidate =>
        toShift(input.date, candidate)
      ).sort((a, b) => a.personId.localeCompare(b.personId, "en"));
      return !options.acceptSolution || options.acceptSolution(assignments)
        ? selected : null;
    }
    if (selected.length >= maxPeople) return null;

    const uncoveredStart = minute(coverage.shortages[0].interval.start);
    if (uncoveredStart === null) throw new Error("Falha interna de cobertura.");
    for (const candidate of candidates) {
      if (used.has(candidate.personId)) continue;
      if (!candidate.working.some(interval =>
        interval.start <= uncoveredStart && interval.end > uncoveredStart
      )) continue;
      const next = new Set(used);
      next.add(candidate.personId);
      const solution = search([...selected, candidate], next, maxPeople);
      if (solution) return solution;
      if (budget.limitReached) return null;
    }
    return null;
  };

  let solution: Candidate[] | null = null;
  for (let count = 0; count <= active.length; count++) {
    solution = search([], new Set<string>(), count);
    if (solution || budget.limitReached) break;
  }
  if (!solution) {
    return {
      status: budget.limitReached ? "search_limit" : "not_found",
      validationScope: "daily_work_and_coverage_only",
      assignments: [],
      issues: [
        budget.limitReached
          ? "A pesquisa atingiu o limite de nós antes de encontrar uma solução."
          : "Não foi encontrada solução entre os turnos com refeições candidatos.",
        "Isto não demonstra impossibilidade fora da grelha de pesquisa V0.",
      ],
      shortages: [],
      exploredNodes: budget.exploredNodes - startingNodes,
      candidateCount: candidates.length,
    };
  }

  const assignments = solution.map(candidate => toShift(input.date, candidate))
    .sort((a, b) => a.personId.localeCompare(b.personId, "en"));
  const finalCoverage = checkPresenceForWorkShifts(
    input.date, operatingIntervals, requirements, assignments
  );
  const finalWork = validateWorkConstraints({
    timeZone: input.timeZone,
    rules: input.workConstraints,
    targetPeriod: { startDate: input.date, endDate: input.date },
    knownSchedule: {
      startDate: input.date,
      endDate: input.date,
      complete: false,
      shifts: assignments,
    },
  });
  // The incomplete-context outcome is EXPECTED for a single-day generator;
  // it is never represented as period-wide work constraint certification.
  if (!finalCoverage.valid ||
      finalWork.status !== "incomplete_context" ||
      finalWork.violations.length > 0 ||
      assignments.some(assignment => {
        const entry = availabilities.find(
          availability => availability.personId === assignment.personId
        );
        return !entry || !isSchedulableForInterval(
          input.date, assignment.interval, entry,
          input.operatingCalendar.weeklyOperatingHours,
          input.operatingCalendar.exceptions
        ) || !getEffectiveWorkIntervals(assignment);
      })) {
    throw new Error("O gerador produziu um horário diário não válido.");
  }
  return {
    status: "generated",
    validationScope: "daily_work_and_coverage_only",
    assignments,
    issues: [],
    shortages: [],
    exploredNodes: budget.exploredNodes - startingNodes,
    candidateCount: candidates.length,
  };
}

/** Backward-compatible one-day entrypoint; period search uses a visitor. */
export function generateMealAwareDaySchedule(
  input: GenerateMealAwareDayInput
): GenerateMealAwareDayResult {
  return searchMealAwareDaySchedule(input);
}
