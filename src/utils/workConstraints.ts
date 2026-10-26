import type {
  DatedWorkShift,
  TimeInterval,
  WorkConstraintConfiguration,
} from "../types";

/** Confirmed initial P6.3 policy. Callers may supply other valid values. */
export const INITIAL_WORK_CONSTRAINTS: WorkConstraintConfiguration = {
  mealBreak: {
    requiredAboveEffectiveMinutes: 360,
    durationMinutes: 60,
    earliestStartAfterWorkMinutes: 180,
    latestStartAfterWorkMinutes: 300,
  },
  minimumRestBetweenShiftsMinutes: 660,
  maximumDailyEffectiveMinutes: 480,
  maximumWeeklyEffectiveMinutes: 2400,
};

const DAY = 86_400_000;

export type WorkViolationCode =
  | "meal_required"
  | "meal_duration"
  | "meal_position"
  | "daily_limit"
  | "weekly_limit"
  | "minimum_rest"
  | "multiple_daily_shifts";

export interface WorkConstraintViolation {
  code: WorkViolationCode;
  personId: string;
  date: string;
  relatedDate?: string;
  actualMinutes?: number;
  requiredMinutes?: number;
  message: string;
}

export interface WorkValidationDateRange {
  startDate: string;
  endDate: string;
}

export interface KnownWorkSchedule extends WorkValidationDateRange {
  /**
   * Explicit declaration from the caller: EVERY assignment (or confirmed
   * absence of assignments) is known between these dates, inclusive.
   * A collection of generated shifts alone is NOT enough to assert this.
   */
  complete: boolean;
  shifts: DatedWorkShift[];
}

export interface ValidateWorkConstraintsInput {
  /** Required IANA zone to measure REAL elapsed rest across DST changes. */
  timeZone: string;
  rules: WorkConstraintConfiguration;
  targetPeriod: WorkValidationDateRange;
  knownSchedule: KnownWorkSchedule;
}

export type WorkValidationStatus =
  | "valid"
  | "violations"
  | "incomplete_context"
  | "invalid_input";

export interface ValidateWorkConstraintsResult {
  status: WorkValidationStatus;
  /** true only when the relevant weekly and adjacent-day context is complete. */
  contextComplete: boolean;
  /** A valid result certifies ONLY the listed work constraints, not coverage. */
  validationScope: "work_constraints_only";
  requiredContext: WorkValidationDateRange | null;
  checkedShifts: number;
  issues: string[];
  violations: WorkConstraintViolation[];
}

interface ParsedShift {
  original: DatedWorkShift;
  dateMs: number;
  start: number;
  end: number;
  effectiveMinutes: number;
  mealMinutes: number;
  workBeforeMealMinutes: number;
  absoluteStart: number;
  absoluteEnd: number;
}

function civilDateMs(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== value) return null;
  return parsed.getTime();
}

function dateKey(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

function mondayOf(value: number): number {
  const day = new Date(value).getUTCDay();
  return value - ((day + 6) % 7) * DAY;
}

function minute(value: string): number | null {
  if (value === "24:00") return 1440;
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

/**
 * Reconstruct a local wall-clock timestamp as a UTC-shaped value. We do NOT
 * interpret the wall clock as UTC; this is only an offset calculation.
 */
function localAsNaiveUtc(instant: number, formatter: Intl.DateTimeFormat): number {
  const parts = formatter.formatToParts(new Date(instant));
  const number = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    if (!part) throw new Error("Fuso horário sem componente temporal esperada.");
    return Number(part.value);
  };
  return Date.UTC(
    number("year"), number("month") - 1, number("day"),
    number("hour"), number("minute")
  );
}

/**
 * Resolve an unambiguous civil clock time in the configured IANA zone.
 * Nonexistent (spring-forward) or ambiguous (fall-back) clock times return
 * null: a caller needs an explicit disambiguation policy before scheduling.
 */
function resolveLocalClock(
  dateMs: number,
  minuteOfDay: number,
  formatter: Intl.DateTimeFormat
): number | null {
  const naive = dateMs + minuteOfDay * 60_000;
  const offsets = new Set<number>();
  for (const hours of [-36, -12, 0, 12, 36]) {
    const probe = naive + hours * 3_600_000;
    offsets.add(localAsNaiveUtc(probe, formatter) - probe);
  }
  const matches = new Set<number>();
  for (const offset of offsets) {
    const candidate = naive - offset;
    if (localAsNaiveUtc(candidate, formatter) === naive) {
      matches.add(candidate);
    }
  }
  return matches.size === 1 ? [...matches][0] : null;
}

function positive(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function nonNegative(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function validRules(rules: WorkConstraintConfiguration): boolean {
  const meal = rules?.mealBreak;
  return !!meal &&
    positive(rules.minimumRestBetweenShiftsMinutes) &&
    positive(rules.maximumDailyEffectiveMinutes) &&
    positive(rules.maximumWeeklyEffectiveMinutes) &&
    nonNegative(meal.requiredAboveEffectiveMinutes) &&
    positive(meal.durationMinutes) &&
    nonNegative(meal.earliestStartAfterWorkMinutes) &&
    nonNegative(meal.latestStartAfterWorkMinutes) &&
    meal.earliestStartAfterWorkMinutes <= meal.latestStartAfterWorkMinutes;
}

function invalid(issues: string[], requiredContext: WorkValidationDateRange | null = null): ValidateWorkConstraintsResult {
  return {
    status: "invalid_input",
    contextComplete: false,
    validationScope: "work_constraints_only",
    requiredContext,
    checkedShifts: 0,
    issues,
    violations: [],
  };
}

/**
 * Work segments exclude the meal break. The helper only checks the
 * structural placement of the break, NOT the meal policy or coverage.
 * Use after validating the shift and all constraints.
 */
export function getEffectiveWorkIntervals(shift: DatedWorkShift): TimeInterval[] | null {
  const start = minute(shift.interval?.start);
  const end = minute(shift.interval?.end);
  if (start === null || end === null || start >= end || start === 1440) {
    return null;
  }
  if (shift.mealBreak === null) return [{ ...shift.interval }];
  if (!shift.mealBreak) return null;
  const mealStart = minute(shift.mealBreak.start);
  const mealEnd = minute(shift.mealBreak.end);
  if (mealStart === null || mealEnd === null ||
      mealStart <= start || mealEnd >= end || mealEnd <= mealStart) {
    return null;
  }
  return [
    { start: shift.interval.start, end: shift.mealBreak.start },
    { start: shift.mealBreak.end, end: shift.interval.end },
  ];
}

function addViolation(
  violations: WorkConstraintViolation[],
  code: WorkViolationCode,
  shift: DatedWorkShift,
  message: string,
  details: Partial<WorkConstraintViolation> = {}
): void {
  violations.push({
    code,
    personId: shift.personId,
    date: shift.date,
    message,
    ...details,
  });
}

/**
 * Pure validator. Only checks work rules against a DATED shift sequence.
 * It does NOT verify personnel eligibility, opening hours or coverage:
 * coverage must be checked separately against getEffectiveWorkIntervals().
 *
 * 'valid' is impossible without an explicit COMPLETE schedule context
 * covering every relevant Monday-Sunday week AND the days adjacent to the
 * target period, so unseen shifts are never assumed to be absent.
 */
export function validateWorkConstraints(
  input: ValidateWorkConstraintsInput
): ValidateWorkConstraintsResult {
  const issues: string[] = [];
  const start = civilDateMs(input.targetPeriod?.startDate);
  const end = civilDateMs(input.targetPeriod?.endDate);
  const knownStart = civilDateMs(input.knownSchedule?.startDate);
  const knownEnd = civilDateMs(input.knownSchedule?.endDate);

  if (start === null || end === null || start > end) {
    issues.push("Período-alvo inválido: indicar datas civis por ordem crescente.");
  }
  if (knownStart === null || knownEnd === null || knownStart > knownEnd) {
    issues.push("Intervalo de contexto conhecido inválido.");
  }
  if (!validRules(input.rules)) {
    issues.push("Regras de refeição, descanso ou limites de trabalho inválidas.");
  }
  if (!Array.isArray(input.knownSchedule?.shifts)) {
    issues.push("A lista de turnos conhecidos é obrigatória.");
  }
  if (typeof input.knownSchedule?.complete !== "boolean") {
    issues.push("A completude do contexto deve ser declarada explicitamente.");
  }

  let formatter: Intl.DateTimeFormat | null = null;
  try {
    if (!input.timeZone?.trim()) throw new Error("Fuso horário em falta.");
    formatter = new Intl.DateTimeFormat("en-GB-u-ca-gregory-nu-latn", {
      timeZone: input.timeZone,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    issues.push("É obrigatório um fuso horário IANA válido.");
  }
  if (issues.length || formatter === null ||
      start === null || end === null ||
      knownStart === null || knownEnd === null) {
    return invalid(issues);
  }

  // Full calendar weeks plus one day either side for inter-jornada rest.
  const requiredStart = Math.min(mondayOf(start), start - DAY);
  const requiredEnd = Math.max(mondayOf(end) + 6 * DAY, end + DAY);
  const requiredContext = {
    startDate: dateKey(requiredStart),
    endDate: dateKey(requiredEnd),
  };
  const contextComplete = input.knownSchedule.complete &&
    knownStart <= requiredStart && knownEnd >= requiredEnd;

  const parsed: ParsedShift[] = [];
  for (const [index, shift] of input.knownSchedule.shifts.entries()) {
    const shiftDate = civilDateMs(shift?.date);
    const startMinute = minute(shift?.interval?.start);
    const endMinute = minute(shift?.interval?.end);
    if (!shift?.personId?.trim() || shiftDate === null ||
        startMinute === null || endMinute === null ||
        startMinute >= endMinute || startMinute === 1440 ||
        shiftDate < knownStart || shiftDate > knownEnd ||
        (shift.mealBreak !== null && !shift.mealBreak)) {
      issues.push(`Turno ${index + 1}: pessoa, data, intervalo ou refeição inválidos.`);
      continue;
    }
    const work = getEffectiveWorkIntervals(shift);
    if (!work) {
      issues.push(`Turno ${index + 1}: a refeição deve ficar integralmente no interior do turno.`);
      continue;
    }
    const mealStart = shift.mealBreak ? minute(shift.mealBreak.start) : null;
    const mealEnd = shift.mealBreak ? minute(shift.mealBreak.end) : null;
    const absoluteStart = resolveLocalClock(shiftDate, startMinute, formatter);
    const absoluteEnd = resolveLocalClock(shiftDate, endMinute, formatter);
    const absoluteMealStart = mealStart !== null
      ? resolveLocalClock(shiftDate, mealStart, formatter) : null;
    const absoluteMealEnd = mealEnd !== null
      ? resolveLocalClock(shiftDate, mealEnd, formatter) : null;
    if (absoluteStart === null || absoluteEnd === null ||
        absoluteEnd <= absoluteStart ||
        (shift.mealBreak && (absoluteMealStart === null ||
          absoluteMealEnd === null || absoluteMealStart <= absoluteStart ||
          absoluteMealEnd >= absoluteEnd ||
          absoluteMealEnd <= absoluteMealStart))) {
      issues.push(`Turno ${index + 1}: hora local inexistente, ambígua ou incoerente no fuso configurado.`);
      continue;
    }
    const mealMinutes = absoluteMealStart !== null && absoluteMealEnd !== null
      ? (absoluteMealEnd - absoluteMealStart) / 60_000 : 0;
    const workingBeforeMeal = absoluteMealStart !== null
      ? (absoluteMealStart - absoluteStart) / 60_000 : 0;
    parsed.push({
      original: shift,
      dateMs: shiftDate,
      start: startMinute,
      end: endMinute,
      effectiveMinutes: (absoluteEnd - absoluteStart) / 60_000 - mealMinutes,
      mealMinutes,
      workBeforeMealMinutes: workingBeforeMeal,
      absoluteStart,
      absoluteEnd,
    });
  }
  if (issues.length) return invalid(issues, requiredContext);

  const violations: WorkConstraintViolation[] = [];
  const byPersonDay = new Map<string, ParsedShift[]>();
  const byPersonWeek = new Map<string, ParsedShift[]>();
  const byPerson = new Map<string, ParsedShift[]>();

  const firstRelevantWeek = mondayOf(start);
  const lastRelevantWeek = mondayOf(end);

  for (const shift of parsed) {
    const { original, dateMs, effectiveMinutes } = shift;
    const week = mondayOf(dateMs);
    // Meal/daily validity of external shifts in an affected calendar week
    // matters: invalid outside shifts must not undercount the weekly total.
    const inAffectedWeek = week >= firstRelevantWeek &&
      week <= lastRelevantWeek;
    const personDay = `${original.personId}| ${original.date}`;
    const personWeek = `${original.personId}| ${dateKey(mondayOf(dateMs))}`;

    byPersonDay.set(personDay, [...(byPersonDay.get(personDay) ?? []), shift]);
    byPersonWeek.set(personWeek, [...(byPersonWeek.get(personWeek) ?? []), shift]);
    byPerson.set(original.personId, [...(byPerson.get(original.personId) ?? []), shift]);

    if (!inAffectedWeek) continue;

    if (original.mealBreak) {
      if (shift.mealMinutes !== input.rules.mealBreak.durationMinutes) {
        addViolation(
          violations, "meal_duration", original,
          "A pausa tem uma duração diferente da regra obrigatória.",
          { actualMinutes: shift.mealMinutes,
            requiredMinutes: input.rules.mealBreak.durationMinutes }
        );
      }
      const workingBeforeMeal = shift.workBeforeMealMinutes;
      if (workingBeforeMeal < input.rules.mealBreak.earliestStartAfterWorkMinutes ||
          workingBeforeMeal > input.rules.mealBreak.latestStartAfterWorkMinutes) {
        addViolation(
          violations, "meal_position", original,
          "A pausa começa fora da janela permitida de trabalho efetivo.",
          { actualMinutes: workingBeforeMeal }
        );
      }
    } else if (effectiveMinutes > input.rules.mealBreak.requiredAboveEffectiveMinutes) {
      addViolation(
        violations, "meal_required", original,
        "A duração efetiva exige uma pausa de refeição.",
        { actualMinutes: effectiveMinutes,
          requiredMinutes: input.rules.mealBreak.requiredAboveEffectiveMinutes }
      );
    }

    if (effectiveMinutes > input.rules.maximumDailyEffectiveMinutes) {
      addViolation(
        violations, "daily_limit", original,
        "Ultrapassado o limite diário de trabalho efetivo.",
        { actualMinutes: effectiveMinutes,
          requiredMinutes: input.rules.maximumDailyEffectiveMinutes }
      );
    }
  }

  for (const shifts of byPersonDay.values()) {
    if (shifts.length <= 1) continue;
    const first = shifts[0].original;
    const week = mondayOf(shifts[0].dateMs);
    if (week >= firstRelevantWeek && week <= lastRelevantWeek) {
      addViolation(
        violations, "multiple_daily_shifts", first,
        "Existe mais do que um turno para a mesma pessoa nesta data."
      );
    }
  }

  for (const shifts of byPersonWeek.values()) {
    const week = mondayOf(shifts[0].dateMs);
    if (week > end || week + 6 * DAY < start) continue;
    const total = shifts.reduce((sum, shift) => sum + shift.effectiveMinutes, 0);
    if (total > input.rules.maximumWeeklyEffectiveMinutes) {
      addViolation(
        violations, "weekly_limit", shifts[0].original,
        `Limite semanal excedido na semana de ${dateKey(week)}.`,
        { date: dateKey(week), actualMinutes: total,
          requiredMinutes: input.rules.maximumWeeklyEffectiveMinutes }
      );
    }
  }

  for (const shifts of byPerson.values()) {
    const ordered = [...shifts].sort(
      (a, b) => a.absoluteStart - b.absoluteStart
    );
    for (let i = 1; i < ordered.length; i++) {
      const before = ordered[i - 1];
      const after = ordered[i];
      if (!((before.dateMs >= start && before.dateMs <= end) ||
            (after.dateMs >= start && after.dateMs <= end))) {
        continue;
      }
      // Same-day duplicates are already reported as multiple_daily_shifts.
      if (before.dateMs === after.dateMs) continue;
      const rest = (after.absoluteStart - before.absoluteEnd) / 60_000;
      if (rest < input.rules.minimumRestBetweenShiftsMinutes) {
        addViolation(
          violations, "minimum_rest", after.original,
          `Descanso insuficiente após o turno de ${before.original.date}.`,
          { relatedDate: before.original.date, actualMinutes: rest,
            requiredMinutes: input.rules.minimumRestBetweenShiftsMinutes }
        );
      }
    }
  }

  if (!contextComplete) {
    issues.push(
      `Contexto incompleto: confirmar todas as atribuições e ausências de ${requiredContext.startDate} até ${requiredContext.endDate}.`
    );
  }

  return {
    status: violations.length > 0
      ? "violations"
      : contextComplete ? "valid" : "incomplete_context",
    contextComplete,
    validationScope: "work_constraints_only",
    requiredContext,
    checkedShifts: parsed.length,
    issues,
    violations,
  };
}
