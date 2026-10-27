import type { DatedWorkShift } from "../types";
import {
  searchMealAwareDaySchedule,
  type GenerateMealAwareDayInput,
  type MealAwareSearchBudget,
} from "./mealAwareDayGenerator";
import {
  validateWorkConstraints,
  type WorkConstraintViolation,
  type WorkValidationDateRange,
} from "./workConstraints";
import type { PresenceShortage } from "./presence";
import type { DayScheduleStatus } from "./dailyGenerator";
import { MAX_PERIOD_DAYS } from "./periodGenerator";
import { getOperatingIntervalsForDate } from "./operatingCalendar";
import { isSchedulableForInterval } from "./availability";
import { checkPresenceForWorkShifts } from "./workCoverage";
import { getPresencePhaseWindows, resolvePresenceForDate } from "./presence";

/**
 * A caller must explicitly attest that all assignments AND confirmed
 * non-working dates OUTSIDE the generated period are known within this
 * date interval. The engine fills the target period itself; a list of
 * external shifts alone NEVER proves it is complete.
 */
export interface ConfirmedExternalWorkContext extends WorkValidationDateRange {
  completeOutsideTarget: boolean;
  shifts: DatedWorkShift[];
}

export interface GenerateConstrainedPeriodInput
  extends Omit<GenerateMealAwareDayInput, "date"> {
  startDate: string;
  endDate: string;
  externalContext: ConfirmedExternalWorkContext;
  /**
   * Global search budget, not a fresh daily budget. The default is 50k
   * explored nodes for ALL dates and rejected/backtracked alternatives.
   */
  maxSearchNodes?: number;
}

export type ConstrainedPeriodStatus =
  | "generated"
  | "incomplete"
  | "incomplete_context"
  | "invalid_input"
  | "search_limit";

export interface ConstrainedPeriodDayDiagnostic {
  date: string;
  /** Null means this day could not be reached during bounded search. */
  lastDailyStatus: DayScheduleStatus | null;
  attempts: number;
  rejectedByWorkRules: number;
  foundAssignments: number;
  issues: string[];
  shortages: PresenceShortage[];
}

export interface GenerateConstrainedPeriodResult {
  status: ConstrainedPeriodStatus;
  /** Only status=generated certifies both work rules and daily coverage. */
  validationScope: "period_work_and_coverage_when_generated";
  assignments: DatedWorkShift[];
  days: ConstrainedPeriodDayDiagnostic[];
  issues: string[];
  requiredContext: WorkValidationDateRange | null;
  workViolations: WorkConstraintViolation[];
  exploredNodes: number;
  rejectedByWorkRules: number;
}

const DAY = 86_400_000;
const DEFAULT_GLOBAL_MAX_NODES = 50_000;

function civilDate(value: string): number | null {
  if (typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
    ? null : date.getTime();
}

function dayString(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

function isWithin(day: string, startDate: string, endDate: string): boolean {
  return day >= startDate && day <= endDate;
}

function resultWith(
  status: ConstrainedPeriodStatus,
  issues: string[],
  days: ConstrainedPeriodDayDiagnostic[] = [],
  requiredContext: WorkValidationDateRange | null = null,
  workViolations: WorkConstraintViolation[] = [],
  exploredNodes = 0,
  rejectedByWorkRules = 0
): GenerateConstrainedPeriodResult {
  return {
    status,
    validationScope: "period_work_and_coverage_when_generated",
    assignments: [],
    days,
    issues,
    requiredContext,
    workViolations,
    exploredNodes,
    rejectedByWorkRules,
  };
}


/**
 * Conservative weekly capacity lower bound. Each required person-minute
 * must be supplied by one person's effective work minute. This ignores
 * availability, meal placement and rest, so it can only PROVE infeasibility
 * when demand already exceeds the maximum possible weekly supply.
 * Ambiguous or invalid operational input falls through to normal validation.
 */
function provenWeeklyCapacityShortage(
  input: GenerateConstrainedPeriodInput,
  dates: string[]
): string | null {
  try {
    const maxWeekly = input.workConstraints.maximumWeeklyEffectiveMinutes;
    if (!Number.isSafeInteger(maxWeekly) || maxWeekly < 0 ||
        !Array.isArray(input.people)) return null;
    const activeIds = new Set(input.people.filter(p => p?.active).map(p => p.id));
    // Preserve existing daily shortage diagnostics when nobody is active.
    if (activeIds.size === 0) return null;
    const supply = activeIds.size * maxWeekly;
    const byWeek = new Map<string, number>();
    const mins = (value: string) => {
      const [h, m] = value.split(":").map(Number);
      return h * 60 + m;
    };
    for (const date of dates) {
      const intervals = getOperatingIntervalsForDate(
        date, input.operatingCalendar.weeklyOperatingHours,
        input.operatingCalendar.exceptions
      );
      if (!intervals.length) continue;
      const resolved = resolvePresenceForDate(
        date, input.presence.weeklyPresenceRequirements,
        input.presence.presenceExceptions,
        input.operatingCalendar.weeklyOperatingHours,
        input.operatingCalendar.exceptions
      );
      if (resolved.status !== "configured") return null;
      const windows = getPresencePhaseWindows(intervals);
      if (!windows) return null;
      // Overlapping opening/closing windows on short days cannot be
      // summed safely. Leave them to the exact daily validator.
      const all = [...windows.opening, ...windows.central, ...windows.closing];
      const ordered = all.map(w => [mins(w.start), mins(w.end)]).sort((a,b) => a[0]-b[0]);
      if (ordered.some((w,i) => !Number.isFinite(w[0]) ||
          !Number.isFinite(w[1]) || w[1] <= w[0] ||
          (i > 0 && w[0] < ordered[i-1][1]))) return null;
      const r = resolved.requirements;
      const demand =
        windows.opening.reduce((n,w) => n + (mins(w.end)-mins(w.start))*r.minimumAtOpening,0) +
        windows.central.reduce((n,w) => n + (mins(w.end)-mins(w.start))*r.minimumDuringOperation,0) +
        windows.closing.reduce((n,w) => n + (mins(w.end)-mins(w.start))*r.minimumAtClosing,0);
      const ms = Date.parse(date+"T00:00:00Z");
      const weekday = new Date(ms).getUTCDay();
      const monday = dayString(ms - ((weekday+6)%7)*DAY);
      byWeek.set(monday, (byWeek.get(monday) ?? 0) + demand);
    }
    for (const [monday, needed] of byWeek) {
      if (needed > supply) {
        return `Semana de ${monday}: a cobertura exige pelo menos ${needed} minutos efetivos, mas ${activeIds.size} pessoas ativas só podem fornecer até ${supply} minutos semanais. Inviabilidade comprovada por capacidade.`;
      }
    }
  } catch {
    // Never use the shortcut to assert validity or mask invalid inputs.
  }
  return null;
}



/**
 * Improvement phase after a certified feasible period. Extend existing
 * attendance spans on the 15-minute grid while preserving ALL hard rules.
 * Never removes coverage or assignments. This is a bounded local improvement,
 * NOT a proof of globally optimal hours.
 */
function improveWeeklyHours(
  input: GenerateConstrainedPeriodInput,
  base: DatedWorkShift[],
  external: DatedWorkShift[],
  knownStart: string,
  knownEnd: string
): DatedWorkShift[] {
  const schedule = base.map(s => ({
    ...s, interval: { ...s.interval },
    mealBreak: s.mealBreak ? { ...s.mealBreak } : null,
  }));
  const mins = (value: string) => {
    const [h, m] = value.split(":").map(Number);
    return h * 60 + m;
  };
  const time = (value: number) =>
    `${String(Math.floor(value / 60)).padStart(2,"0")}:${String(value % 60).padStart(2,"0")}`;
  const effective = (s: DatedWorkShift) =>
    mins(s.interval.end) - mins(s.interval.start) -
      (s.mealBreak ? mins(s.mealBreak.end) - mins(s.mealBreak.start) : 0);
  const weeklyLimit = input.workConstraints.maximumWeeklyEffectiveMinutes;
  const meal = input.workConstraints.mealBreak;
  const weeks = (date: string) => {
    const d = new Date(date + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - (d.getUTCDay()+6)%7);
    return d.toISOString().slice(0,10);
  };
  const dateValid = (date: string) => {
    const operation = getOperatingIntervalsForDate(date,
      input.operatingCalendar.weeklyOperatingHours,
      input.operatingCalendar.exceptions);
    const presence = resolvePresenceForDate(date,
      input.presence.weeklyPresenceRequirements,
      input.presence.presenceExceptions,
      input.operatingCalendar.weeklyOperatingHours,
      input.operatingCalendar.exceptions);
    return presence.status === "configured" &&
      checkPresenceForWorkShifts(date, operation, presence.requirements,
        schedule.filter(s => s.date === date)).valid;
  };
  const valid = (date: string) =>
    dateValid(date) &&
    validateWorkConstraints({
      timeZone: input.timeZone,
      rules: input.workConstraints,
      targetPeriod: { startDate: input.startDate, endDate: input.endDate },
      knownSchedule: {
        startDate: knownStart, endDate: knownEnd, complete: true,
        shifts: [...external, ...schedule],
      },
    }).status === "valid";

  // Aim for the weekly cap in this experiment. Bound candidate evaluation
  // to prevent unbounded work outside the backtracking budget.
  let evaluations = 0;
  for (let round = 0; round < 2; round++) {
    let changed = false;
    for (let i = schedule.length - 1; i >= 0; i--) {
      const original = schedule[i];
      const personHours = schedule.filter(s =>
        s.personId === original.personId && weeks(s.date) === weeks(original.date)
      ).reduce((n,s) => n + effective(s),0) +
        external.filter(s => s.personId === original.personId &&
          weeks(s.date) === weeks(original.date)).reduce((n,s)=>n+effective(s),0);
      const availableHours = Math.min(weeklyLimit - personHours,
        input.workConstraints.maximumDailyEffectiveMinutes - effective(original));
      if (availableHours < 15) continue;
      const availability = input.availabilities.find(a =>
        a.personId === original.personId);
      if (!availability) continue;
      const earliest = Math.max(0, mins(original.interval.start) - availableHours);
      const latest = Math.min(1440, mins(original.interval.end) + availableHours);
      const proposals: DatedWorkShift[] = [];
      for (let start = Math.ceil(earliest/15)*15;
        start <= mins(original.interval.start); start += 15) {
        for (let end = Math.ceil(mins(original.interval.end)/15)*15;
          end <= latest; end += 15) {
          const duration = end - start;
          if (duration <= mins(original.interval.end)-mins(original.interval.start)) continue;
          const limit = Math.min(weeklyLimit - personHours + effective(original),
            input.workConstraints.maximumDailyEffectiveMinutes);
          if (duration <= meal.requiredAboveEffectiveMinutes && duration <= limit) {
            proposals.push({...original, interval:{start:time(start),end:time(end)},mealBreak:null});
          }
          const work = duration - meal.durationMinutes;
          if (work > meal.requiredAboveEffectiveMinutes && work <= limit) {
            for (let offset = meal.earliestStartAfterWorkMinutes;
              offset <= Math.min(meal.latestStartAfterWorkMinutes, work - 1);
              offset += 15) {
              proposals.push({...original,
                interval:{start:time(start),end:time(end)},
                mealBreak:{start:time(start+offset),
                  end:time(start+offset+meal.durationMinutes)}});
            }
          }
        }
      }
      proposals.sort((a,b) => effective(b)-effective(a));
      let selected: DatedWorkShift | null = null;
      for (const proposed of proposals) {
        if (++evaluations > 12000) break;
        if (!isSchedulableForInterval(original.date,proposed.interval,
          availability,input.operatingCalendar.weeklyOperatingHours,
          input.operatingCalendar.exceptions)) continue;
        schedule[i] = proposed;
        if (valid(original.date)) { selected = proposed; break; }
      }
      schedule[i] = selected ?? original;
      if (selected) changed = true;
    }
    if (!changed || evaluations > 12000) break;
  }

  // P6.3 PR #26: fill missing person-days only after extending existing
  // shifts. Every extra candidate is checked against availability, daily
  // coverage and the COMPLETE work schedule, including external shifts.
  // Prefer the largest usable effective duration without claiming optimality.
  const dates = Array.from(new Set(base.map(s => s.date))).sort();
  for (const date of dates) {
    if (evaluations >= 12000) break;
    const operation = getOperatingIntervalsForDate(date,
      input.operatingCalendar.weeklyOperatingHours,
      input.operatingCalendar.exceptions);
    for (const person of input.people.filter(p => p.active)) {
      if (evaluations >= 12000) break;
      if (schedule.some(s => s.date === date && s.personId === person.id)) continue;
      const availability = input.availabilities.find(a => a.personId === person.id);
      if (!availability) continue;
      const personHours = [...schedule, ...external].filter(s =>
        s.personId === person.id && weeks(s.date) === weeks(date)
      ).reduce((total, shift) => total + effective(shift), 0);
      const remaining = Math.min(weeklyLimit - personHours,
        input.workConstraints.maximumDailyEffectiveMinutes);
      if (remaining < 15) continue;
      let added = false;
      for (const period of operation) {
        if (added || evaluations >= 12000) break;
        const open = mins(period.start);
        const close = mins(period.end);
        const maxEffective = Math.min(remaining, close - open);
        for (let work = Math.floor(maxEffective / 15) * 15;
          work >= 15 && !added && evaluations < 12000; work -= 15) {
          const needsMeal = work > meal.requiredAboveEffectiveMinutes;
          const span = work + (needsMeal ? meal.durationMinutes : 0);
          if (span > close - open) continue;
          for (let start = open; start + span <= close && !added &&
            evaluations < 12000; start += 15) {
            const mealOffsets = needsMeal
              ? Array.from({length: Math.max(0, Math.floor(
                  (Math.min(meal.latestStartAfterWorkMinutes, work - 1) -
                    meal.earliestStartAfterWorkMinutes) / 15) + 1)},
                  (_, i) => meal.earliestStartAfterWorkMinutes + 15*i)
              : [0];
            for (const offset of mealOffsets) {
              if (++evaluations > 12000) break;
              const candidate: DatedWorkShift = {
                date, personId: person.id,
                interval: {start: time(start), end: time(start + span)},
                mealBreak: needsMeal
                  ? {start: time(start + offset),
                    end: time(start + offset + meal.durationMinutes)}
                  : null,
              };
              if (!isSchedulableForInterval(date, candidate.interval,
                availability, input.operatingCalendar.weeklyOperatingHours,
                input.operatingCalendar.exceptions)) continue;
              schedule.push(candidate);
              if (valid(date)) {added = true; break;}
              schedule.pop();
            }
          }
        }
      }
    }
  }
  return schedule;
}

/**
 * Backtracks ACROSS dates. It does not fix the first valid daily solution
 * and only reject the final period: a daily accepted candidate is passed
 * to a visitor that must also solve the remaining dates.
 *
 * Before publishing a period, the independent work validator checks the
 * COMPLETE schedule (known external shifts + all generated target shifts)
 * and the daily generator has certified coverage for each open day.
 */
export function generateConstrainedPeriodSchedule(
  input: GenerateConstrainedPeriodInput
): GenerateConstrainedPeriodResult {
  const start = civilDate(input.startDate);
  const end = civilDate(input.endDate);
  if (start === null || end === null || start > end) {
    return resultWith("invalid_input", [
      "O período deve ter datas civis válidas, inicial anterior ou igual à final.",
    ]);
  }
  const dayCount = (end - start) / DAY + 1;
  if (dayCount > MAX_PERIOD_DAYS) {
    return resultWith("invalid_input", [
      `O gerador de períodos suporta até ${MAX_PERIOD_DAYS} dias consecutivos.`,
    ]);
  }

  const maxNodes = input.maxSearchNodes ?? DEFAULT_GLOBAL_MAX_NODES;
  if (!Number.isSafeInteger(maxNodes) || maxNodes < 1) {
    return resultWith("invalid_input", [
      "O limite global de pesquisa deve ser um inteiro positivo.",
    ]);
  }

  if (!input.externalContext ||
      typeof input.externalContext.completeOutsideTarget !== "boolean") {
    return resultWith("invalid_input", [
      "É obrigatória a declaração explícita do contexto exterior ao período.",
    ]);
  }
  if (!Array.isArray(input.externalContext.shifts)) {
    return resultWith("invalid_input", [
      "É obrigatória uma lista de turnos exteriores conhecidos.",
    ]);
  }

  // The first version does not support pre-assigned/fixed shifts INSIDE
  // the target period. They need a separate constraint model.
  if (input.externalContext.shifts.some(shift =>
    typeof shift?.date === "string" &&
    isWithin(shift.date, input.startDate, input.endDate)
  )) {
    return resultWith("invalid_input", [
      "O contexto exterior não pode conter turnos dentro do período gerado.",
    ]);
  }

  const target = { startDate: input.startDate, endDate: input.endDate };
  const outside = input.externalContext;
  // Validate untrusted schedule structure through the work validator
  // below, not through a sorting function that could throw on bad data.
  const externalShifts = [...outside.shifts].sort(
    (a, b) => (a?.date ?? "").localeCompare(b?.date ?? "") ||
      (a?.personId ?? "").localeCompare(b?.personId ?? "", "en") ||
      (a?.interval?.start ?? "").localeCompare(b?.interval?.start ?? "")
  );
  const knownSchedule = (shifts: DatedWorkShift[], complete: boolean) => ({
    startDate: outside.startDate,
    endDate: outside.endDate,
    complete,
    shifts: [...externalShifts, ...shifts],
  });

  // First validate the rules, IANA zone and outer date range. With an
  // explicitly incomplete schedule the validator NEVER asserts global
  // validity. We do not infer unlisted shifts are absent.
  const initial = validateWorkConstraints({
    timeZone: input.timeZone,
    rules: input.workConstraints,
    targetPeriod: target,
    knownSchedule: knownSchedule([], false),
  });
  if (initial.status === "invalid_input") {
    return resultWith(
      "invalid_input", initial.issues, [],
      initial.requiredContext, initial.violations
    );
  }
  const required = initial.requiredContext;
  if (!required) {
    return resultWith("invalid_input", ["Não foi possível calcular o contexto necessário."]);
  }
  if (!outside.completeOutsideTarget ||
      outside.startDate > required.startDate ||
      outside.endDate < required.endDate) {
    return resultWith("incomplete_context", [
      `É necessário confirmar todos os turnos e ausências exteriores ao período entre ${required.startDate} e ${required.endDate}.`,
    ], [], required);
  }
  if (initial.violations.length > 0) {
    return resultWith(
      "invalid_input",
      ["O contexto exterior conhecido já viola regras obrigatórias de trabalho."],
      [], required, initial.violations
    );
  }

  const dates = Array.from(
    { length: dayCount },
    (_, index) => dayString(start + index * DAY)
  );
  const shortage = provenWeeklyCapacityShortage(input, dates);
  if (shortage) {
    return resultWith("incomplete", [
      shortage,
      "O diagnóstico é um limite inferior comprovado; nenhuma pesquisa foi necessária.",
    ], [], required);
  }
  const diagnostics: ConstrainedPeriodDayDiagnostic[] = dates.map(date => ({
    date,
    lastDailyStatus: null,
    attempts: 0,
    rejectedByWorkRules: 0,
    foundAssignments: 0,
    issues: [],
    shortages: [],
  }));
  const budget: MealAwareSearchBudget = {
    maxNodes,
    exploredNodes: 0,
    limitReached: false,
  };
  const selected: DatedWorkShift[] = [];
  let accepted: DatedWorkShift[] | null = null;
  let rejectedByWorkRules = 0;
  let lastWorkViolations: WorkConstraintViolation[] = [];
  let invalidInternalResult: string | null = null;

  const checkPartial = (added: DatedWorkShift[]): boolean => {
    const result = validateWorkConstraints({
      timeZone: input.timeZone,
      rules: input.workConstraints,
      targetPeriod: target,
      knownSchedule: knownSchedule([...selected, ...added], false),
    });
    if (result.status === "invalid_input") {
      invalidInternalResult =
        `Erro ao validar candidatos: ${result.issues.join(" ")}`;
      return false;
    }
    if (result.violations.length > 0) {
      rejectedByWorkRules++;
      lastWorkViolations = result.violations;
      return false;
    }
    return true;
  };

  const searchDate = (index: number): boolean => {
    if (invalidInternalResult || budget.limitReached) return false;
    if (index === dates.length) {
      const checked = validateWorkConstraints({
        timeZone: input.timeZone,
        rules: input.workConstraints,
        targetPeriod: target,
        knownSchedule: knownSchedule(selected, true),
      });
      if (checked.status !== "valid") {
        if (checked.status === "invalid_input" ||
            checked.status === "incomplete_context") {
          invalidInternalResult = checked.issues.join(" ") ||
            "Falha na validação final do contexto.";
        } else {
          rejectedByWorkRules++;
          lastWorkViolations = checked.violations;
        }
        return false;
      }
      accepted = [...selected];
      return true;
    }

    const diagnostic = diagnostics[index];
    diagnostic.attempts++;
    const dayInput: GenerateMealAwareDayInput = {
      date: dates[index],
      people: input.people,
      availabilities: input.availabilities,
      operatingCalendar: input.operatingCalendar,
      workRules: input.workRules,
      presence: input.presence,
      workConstraints: input.workConstraints,
      timeZone: input.timeZone,
      maxSearchNodes: maxNodes,
    };

    const dayResult = searchMealAwareDaySchedule(dayInput, {
      budget,
      flexibleDurations: true,
      acceptSolution: (assignments) => {
        if (!checkPartial(assignments)) {
          diagnostic.rejectedByWorkRules++;
          return false;
        }
        selected.push(...assignments);
        const completed = searchDate(index + 1);
        selected.splice(selected.length - assignments.length, assignments.length);
        return completed;
      },
    });
    diagnostic.lastDailyStatus = dayResult.status;
    diagnostic.issues = dayResult.issues;
    diagnostic.shortages = dayResult.shortages;
    diagnostic.foundAssignments = dayResult.assignments.length;

    if (dayResult.status === "generated") return true;
    if (dayResult.status === "closed") return searchDate(index + 1);
    if (dayResult.status === "invalid_input") {
      invalidInternalResult = dayResult.issues.join(" ");
    }
    return false;
  };

  const found = searchDate(0);
  if (invalidInternalResult) {
    return resultWith(
      "invalid_input", [invalidInternalResult], diagnostics,
      required, lastWorkViolations, budget.exploredNodes, rejectedByWorkRules
    );
  }
  if (found && accepted !== null) {
    const assignments: DatedWorkShift[] = improveWeeklyHours(input, accepted,
      externalShifts, outside.startDate, outside.endDate);
    return {
      status: "generated",
      validationScope: "period_work_and_coverage_when_generated",
      assignments: [...assignments].sort(
        (a, b) => a.date.localeCompare(b.date) ||
          a.personId.localeCompare(b.personId, "en")
      ),
      days: diagnostics,
      issues: [],
      requiredContext: required,
      workViolations: [],
      exploredNodes: budget.exploredNodes,
      rejectedByWorkRules,
    };
  }

  if (budget.limitReached) {
    return resultWith(
      "search_limit", [
        "A pesquisa global atingiu o limite de nós antes de encontrar um horário de período válido.",
        "Não foi demonstrada a impossibilidade fora da pesquisa limitada.",
      ], diagnostics, required, lastWorkViolations,
      budget.exploredNodes, rejectedByWorkRules
    );
  }
  return resultWith(
    "incomplete", [
      "Não foi encontrado um período que cumpra simultaneamente cobertura, refeições, descanso e horas de trabalho.",
      "Não foi demonstrada a impossibilidade fora do espaço de candidatos V0.",
    ], diagnostics, required, lastWorkViolations,
    budget.exploredNodes, rejectedByWorkRules
  );
}
