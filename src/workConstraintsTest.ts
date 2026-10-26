import type {
  DatedWorkShift,
  WorkConstraintConfiguration,
} from "./types";
import {
  INITIAL_WORK_CONSTRAINTS,
  getEffectiveWorkIntervals,
  validateWorkConstraints,
  type WorkViolationCode,
} from "./utils/workConstraints";

function assert(ok: boolean, message: string): void {
  if (!ok) throw new Error(message);
}

const baseline = structuredClone(INITIAL_WORK_CONSTRAINTS);
const monday = "2026-10-26";
const sunday = "2026-11-01";

function shift(
  date: string,
  personId = "a",
  start = "09:00",
  end = "18:00",
  mealStart: string | null = "13:00",
  mealEnd = "14:00"
): DatedWorkShift {
  return {
    date, personId,
    interval: { start, end },
    mealBreak: mealStart === null ? null :
      { start: mealStart, end: mealEnd },
  };
}

interface TestOptions {
  targetStart?: string;
  targetEnd?: string;
  contextStart?: string;
  contextEnd?: string;
  complete?: boolean;
  rules?: WorkConstraintConfiguration;
  timeZone?: string;
}
function check(shifts: DatedWorkShift[], options: TestOptions = {}) {
  const input = {
    timeZone: options.timeZone ?? "Atlantic/Azores",
    rules: options.rules ?? baseline,
    targetPeriod: {
      startDate: options.targetStart ?? monday,
      endDate: options.targetEnd ?? sunday,
    },
    knownSchedule: {
      startDate: options.contextStart ?? "2026-10-25",
      endDate: options.contextEnd ?? "2026-11-02",
      complete: options.complete ?? true,
      shifts,
    },
  };
  const before = JSON.stringify(input);
  const result = validateWorkConstraints(input);
  assert(JSON.stringify(input) === before, "O validador deve ser puro.");
  return result;
}

function hasCode(result: ReturnType<typeof check>, code: WorkViolationCode) {
  return result.violations.some((violation) => violation.code === code);
}

const validEight = shift(monday);
const valid = check([validEight]);
assert(valid.status === "valid" && valid.contextComplete &&
  valid.validationScope === "work_constraints_only" && valid.checkedShifts === 1,
  "8h efetivas com refeição correta e contexto completo devem validar.");
assert(valid.requiredContext?.startDate === "2026-10-25" &&
  valid.requiredContext.endDate === "2026-11-02",
  "O contexto exigido deve incluir a semana e os dias adjacentes.");
assert(JSON.stringify(getEffectiveWorkIntervals(validEight)) === JSON.stringify([
  { start: "09:00", end: "13:00" },
  { start: "14:00", end: "18:00" },
]), "Os intervalos efetivos devem excluir a refeição.");
assert(getEffectiveWorkIntervals(shift(monday, "a", "09:00", "15:00", null))
  ?.length === 1, "Sem refeição existe um só intervalo efetivo.");

assert(check([shift(monday, "a", "09:00", "15:00", null)]).status === "valid",
  "Exatamente 6h não exige refeição.");
const aboveSix = check([shift(monday, "a", "09:00", "15:01", null)]);
assert(aboveSix.status === "violations" && hasCode(aboveSix, "meal_required"),
  "6h01 sem refeição deve falhar.");

for (const [description, candidate, expectedValid] of [
  ["12:00 é início permitido", shift(monday, "a", "09:00", "18:00", "12:00", "13:00"), true],
  ["14:00 é início permitido", shift(monday, "a", "09:00", "18:00", "14:00", "15:00"), true],
  ["11:59 é demasiado cedo", shift(monday, "a", "09:00", "18:00", "11:59", "12:59"), false],
  ["14:01 é demasiado tarde", shift(monday, "a", "09:00", "18:00", "14:01", "15:01"), false],
] as const) {
  const result = check([candidate]);
  assert(expectedValid ? result.status === "valid" :
    result.status === "violations" && hasCode(result, "meal_position"),
    description);
}

assert(hasCode(check([
  shift(monday, "a", "09:00", "18:00", "13:00", "13:59"),
]), "meal_duration"), "59 minutos de refeição deve falhar.");
assert(hasCode(check([
  shift(monday, "a", "09:00", "18:00", "13:00", "14:01"),
]), "meal_duration"), "61 minutos de refeição deve falhar.");

assert(check([
  shift(monday, "a", "09:00", "16:00", "12:00", "13:00"),
]).status === "valid", "Pausa facultativa com 6h efetivas é aceite.");

const overDay = check([shift(monday, "a", "09:00", "19:00")]);
assert(hasCode(overDay, "daily_limit") &&
  overDay.violations.find(v => v.code === "daily_limit")?.actualMinutes === 540,
  "9 horas efetivas ultrapassam o limite diário.");

const weekdays = [
  "2026-10-26", "2026-10-27", "2026-10-28",
  "2026-10-29", "2026-10-30",
];
const fiveDays = weekdays.map((date) => shift(date));
assert(check(fiveDays).status === "valid", "5x8h = 40h semanais.");
const sixDays = [...fiveDays, shift("2026-10-31")];
const overWeek = check(sixDays);
assert(overWeek.status === "violations" && hasCode(overWeek, "weekly_limit") &&
  overWeek.violations.find(v => v.code === "weekly_limit")?.actualMinutes === 2880,
  "6x8h = 48h e ultrapassa as 40h semanais.");

assert(check(fiveDays, {
  targetStart: "2026-10-28", targetEnd: "2026-10-30",
}).status === "valid", "Horas anteriores ao período entram na soma semanal.");
assert(hasCode(check(sixDays, {
  targetStart: "2026-10-28", targetEnd: "2026-10-30",
}), "weekly_limit"), "Horas posteriores ao período entram na soma semanal.");

const invalidExternalMeal = check([
  shift(monday, "a", "09:00", "18:00", null),
  shift("2026-10-28"),
], {
  targetStart: "2026-10-28", targetEnd: "2026-10-28",
});
assert(hasCode(invalidExternalMeal, "meal_required"),
  "A refeição inválida num turno exterior da mesma semana deve ser detetada.");

const invalidExternalDaily = check([
  shift(monday, "a", "09:00", "19:00"),
  shift("2026-10-28"),
], {
  targetStart: "2026-10-28", targetEnd: "2026-10-28",
});
assert(hasCode(invalidExternalDaily, "daily_limit"),
  "Turnos exteriores que condicionam a semana também têm de ser válidos.");

const weekBoundary = check([
  shift(sunday), shift("2026-11-02"),
], {
  targetStart: sunday, targetEnd: "2026-11-02",
  contextStart: "2026-10-25", contextEnd: "2026-11-09",
});
assert(weekBoundary.status === "valid",
  "Domingo e segunda são semanas diferentes; descanso mantém-se.");

const restTen = check([
  shift(monday, "a", "13:00", "22:00", "17:00", "18:00"),
  shift("2026-10-27", "a", "08:00", "17:00", "12:00", "13:00"),
]);
assert(hasCode(restTen, "minimum_rest") &&
  restTen.violations.find(v => v.code === "minimum_rest")?.actualMinutes === 600,
  "Descanso de 10h entre jornadas deve falhar.");

const elevenShifts = [
  shift(monday, "a", "13:00", "22:00", "17:00", "18:00"),
  shift("2026-10-27", "a", "09:00", "18:00"),
];
assert(check(elevenShifts).status === "valid",
  "Descanso exato de 11h é suficiente.");
const twelveHourRule = structuredClone(baseline);
twelveHourRule.minimumRestBetweenShiftsMinutes = 720;
assert(hasCode(check(elevenShifts, { rules: twelveHourRule }), "minimum_rest"),
  "Um descanso configurado de 12h reprova 11h.");

assert(hasCode(check([
  shift("2026-10-25", "a", "13:00", "22:00", "17:00", "18:00"),
  shift(monday, "a", "08:00", "17:00", "12:00", "13:00"),
], { targetStart: monday, targetEnd: monday }), "minimum_rest"),
  "Verificar descanso desde a semana anterior.");

assert(hasCode(check([
  shift(sunday, "a", "13:00", "22:00", "17:00", "18:00"),
  shift("2026-11-02", "a", "08:00", "17:00", "12:00", "13:00"),
], { targetStart: sunday, targetEnd: sunday }), "minimum_rest"),
  "Verificar descanso para o dia posterior ao período.");

const unknownWeek = check([shift("2026-10-28")], {
  targetStart: "2026-10-28", targetEnd: "2026-10-29",
  contextStart: "2026-10-28", contextEnd: "2026-10-29",
});
assert(unknownWeek.status === "incomplete_context" &&
  !unknownWeek.contextComplete && unknownWeek.violations.length === 0 &&
  unknownWeek.requiredContext?.startDate === "2026-10-26" &&
  unknownWeek.requiredContext?.endDate === "2026-11-01",
  "Não certificar cumprimento semanal sem toda a semana conhecida.");

const notCertified = check([shift(monday)], { complete: false });
assert(notCertified.status === "incomplete_context",
  "Contexto sem confirmação explícita de completude não pode ser válido.");

const violationAndUnknown = check([
  shift("2026-10-28", "a", "09:00", "19:00"),
], {
  targetStart: "2026-10-28", targetEnd: "2026-10-28",
  contextStart: "2026-10-28", contextEnd: "2026-10-28",
  complete: false,
});
assert(violationAndUnknown.status === "violations" &&
  !violationAndUnknown.contextComplete && hasCode(violationAndUnknown, "daily_limit"),
  "Uma violação conhecida mantém-se mesmo com contexto incompleto.");

const duplicated = check([shift(monday), shift(monday, "a", "10:00", "19:00")]);
assert(hasCode(duplicated, "multiple_daily_shifts"),
  "A política mantém apenas um turno por pessoa e dia.");

assert(check([shift(monday, "b")]).status === "valid",
  "Identificadores de pessoa são tratados sem dependência de UI.");

assert(check([shift(monday, "a", "22:00", "06:00", null)]).status === "invalid_input",
  "Turnos que atravessam a meia-noite ficam fora do modelo V0.");

assert(check([shift(monday, "a", "09:00", "18:00", "08:00", "09:00")])
  .status === "invalid_input",
  "A pausa de refeição nunca pode começar fora do turno.");

assert(check([shift("2026-02-30")]).status === "invalid_input",
  "Datas civis inválidas devem ser recusadas.");

assert(check([shift(monday)], {
  targetStart: "2026-11-02", targetEnd: monday,
}).status === "invalid_input", "Datas de período invertidas devem falhar.");

const badRules = structuredClone(baseline);
badRules.maximumWeeklyEffectiveMinutes = -1;
assert(check([shift(monday)], { rules: badRules }).status === "invalid_input",
  "Regras com limites negativos devem ser recusadas.");

const yearEnd = check([
  shift("2026-12-31"),
  shift("2027-01-01"),
], {
  targetStart: "2026-12-31", targetEnd: "2027-01-01",
  contextStart: "2026-12-27", contextEnd: "2027-01-04",
});
assert(yearEnd.status === "valid",
  "Passagem de ano mantém a semana civil e a contagem de horas.");

const dst = check([shift("2027-03-29")], {
  targetStart: "2027-03-29", targetEnd: "2027-03-29",
  contextStart: "2027-03-28", contextEnd: "2027-04-05",
});
assert(dst.status === "valid",
  "Contexto por datas civis não pode depender da mudança de hora.");


const dstRest = check([
  shift("2027-03-27", "a", "11:00", "20:00", "15:00", "16:00"),
  shift("2027-03-28", "a", "07:00", "16:00", "11:00", "12:00"),
], {
  targetStart: "2027-03-27", targetEnd: "2027-03-28",
  contextStart: "2027-03-21", contextEnd: "2027-03-29",
  timeZone: "Europe/Lisbon",
});
assert(hasCode(dstRest, "minimum_rest") &&
  dstRest.violations.find(v => v.code === "minimum_rest")?.actualMinutes === 600,
  "11h nominais na transição de primavera são apenas 10h reais.");

const missingSpringHour = check([
  shift("2027-03-28", "a", "01:30", "05:30", null),
], {
  targetStart: "2027-03-28", targetEnd: "2027-03-28",
  contextStart: "2027-03-21", contextEnd: "2027-03-29",
  timeZone: "Europe/Lisbon",
});
assert(missingSpringHour.status === "invalid_input",
  "Horas locais inexistentes na mudança para verão têm de ser recusadas.");

const repeatedFallHour = check([
  shift("2027-10-31", "a", "01:30", "05:30", null),
], {
  targetStart: "2027-10-31", targetEnd: "2027-10-31",
  contextStart: "2027-10-24", contextEnd: "2027-11-01",
  timeZone: "Europe/Lisbon",
});
assert(repeatedFallHour.status === "invalid_input",
  "Horas locais ambíguas na mudança para inverno têm de ser recusadas.");

assert(check([shift(monday)], { timeZone: "Mars/Phobos" }).status === "invalid_input",
  "Um fuso IANA inválido impede certificação do descanso.");

assert(check([]).status === "valid",
  "Ausência confirmada de turnos pode ser validada apenas quanto a regras de trabalho.");

console.log("Work Constraints V0: todos os testes passaram.");
