import type {
  DatedWorkShift,
  Person,
  PersonAvailability,
  PresenceRequirement,
  TimeInterval,
  WeeklyOperatingHours,
} from "./types";
import {
  generateConstrainedPeriodSchedule,
  type GenerateConstrainedPeriodInput,
} from "./utils/constrainedPeriodGenerator";
import { createEmptyWeeklyAvailability } from "./utils/availability";
import { createEmptyWeeklyPresenceRequirements } from "./utils/presence";
import { WEEKDAYS } from "./utils/operatingCalendar";
import {
  INITIAL_WORK_CONSTRAINTS,
  validateWorkConstraints,
} from "./utils/workConstraints";
import { checkPresenceForWorkShifts } from "./utils/workCoverage";

function assert(value: boolean, label: string): void {
  if (!value) throw new Error(label);
}
function interval(start: string, end: string): TimeInterval[] {
  return [{ start, end }];
}

const mon = "2026-10-26";
const tue = "2026-10-27";
const sat = "2026-10-31";
const sun = "2026-11-01";
const nextMon = "2026-11-02";

const one: PresenceRequirement = {
  minimumAtOpening: 1, minimumDuringOperation: 1,
  minimumAtClosing: 1,
};
const centralTwo: PresenceRequirement = {
  minimumAtOpening: 1, minimumDuringOperation: 2,
  minimumAtClosing: 1,
};
function shift(
  date: string, personId: string,
  start = "09:00", end = "18:00",
  mealStart: string | null = "13:00", mealEnd = "14:00"
): DatedWorkShift {
  return {
    date, personId,
    interval: { start, end },
    mealBreak: mealStart === null ? null :
      { start: mealStart, end: mealEnd },
  };
}
function inputs(
  startDate: string,
  endDate: string,
  names: string[],
  operationByDate: Record<string, TimeInterval[]>,
  availabilityByDate: Record<string, Record<string, TimeInterval[]>>,
  requirementsByDate: Record<string, PresenceRequirement>,
  context = { startDate: "2026-10-25", endDate: "2026-11-02" },
  external: DatedWorkShift[] = []
): GenerateConstrainedPeriodInput {
  const people: Person[] = names.map(id => ({ id, name: id, active: true }));
  const weeklyOperatingHours: WeeklyOperatingHours = WEEKDAYS.reduce(
    (week, weekday) => {
      week[weekday] = [];
      return week;
    }, {} as WeeklyOperatingHours
  );
  const availabilities: PersonAvailability[] = people.map(person => ({
    personId: person.id,
    weeklyAvailability: createEmptyWeeklyAvailability(),
    exceptions: Object.entries(operationByDate).map(([date]) => ({
      date,
      intervals: availabilityByDate[date]?.[person.id] ?? [],
    })),
  }));
  return {
    startDate, endDate,
    people,
    availabilities,
    operatingCalendar: {
      weeklyOperatingHours,
      exceptions: Object.entries(operationByDate).map(([date, intervals]) => ({
        date, intervals,
      })),
    },
    workRules: { standardShiftDurationMinutes: 480 },
    presence: {
      weeklyPresenceRequirements: createEmptyWeeklyPresenceRequirements(),
      presenceExceptions: Object.entries(requirementsByDate).map(
        ([date, requirements]) => ({ date, requirements })
      ),
    },
    workConstraints: structuredClone(INITIAL_WORK_CONSTRAINTS),
    timeZone: "Atlantic/Azores",
    externalContext: {
      ...context, completeOutsideTarget: true, shifts: external,
    },
  };
}
function independentlyValidate(
  input: GenerateConstrainedPeriodInput,
  generated: DatedWorkShift[]
) {
  const work = validateWorkConstraints({
    timeZone: input.timeZone,
    rules: input.workConstraints,
    targetPeriod: { startDate: input.startDate, endDate: input.endDate },
    knownSchedule: {
      startDate: input.externalContext.startDate,
      endDate: input.externalContext.endDate,
      complete: true,
      shifts: [...input.externalContext.shifts, ...generated],
    },
  });
  assert(work.status === "valid", "Validador externo aprova o trabalho do período.");
  for (const [date, requirements] of Object.entries(
    input.presence.presenceExceptions
      .reduce<Record<string, PresenceRequirement>>((record, row) => {
        if (row.requirements !== null) record[row.date] = row.requirements;
        return record;
      }, {})
  )) {
    if (date < input.startDate || date > input.endDate) continue;
    const operating = input.operatingCalendar.exceptions.find(
      e => e.date === date
    )?.intervals ?? [];
    if (!operating.length) continue;
    assert(checkPresenceForWorkShifts(
      date, operating, requirements,
      generated.filter(s => s.date === date)
    ).valid, `Cobertura independente válida em ${date}.`);
  }
}

// The first daily arrangement uses A on Monday and violates A's
// 11h minimum rest into Tuesday. The period search MUST backtrack
// and choose B on Monday, even though A has valid daily coverage.
const restInput = inputs(mon, tue, ["a", "b"],
  { [mon]: interval("16:00", "22:00"), [tue]: interval("08:00", "12:00") },
  {
    [mon]: { a: interval("16:00", "22:00"), b: interval("16:00", "22:00") },
    [tue]: { a: interval("08:00", "12:00") },
  },
  { [mon]: one, [tue]: one }
);
const original = JSON.stringify(restInput);
const restResult = generateConstrainedPeriodSchedule(restInput);
assert(JSON.stringify(restInput) === original,
  "Gerador de períodos não pode mutar os dados de entrada.");
assert(restResult.status === "generated" &&
  restResult.assignments.length === 2,
  "Pesquisar uma alternativa anterior para cumprir descanso entre dias.");
assert(restResult.assignments.some(s => s.date === mon && s.personId === "b") &&
  restResult.assignments.some(s => s.date === tue && s.personId === "a"),
  "O motor escolhe B na segunda e A na terça, não a primeira solução diária.");
assert(restResult.rejectedByWorkRules > 0 &&
  restResult.exploredNodes > 0,
  "O backtracking contabiliza descartes por hard constraints e nós.");
assert(restResult.validationScope === "period_work_and_coverage_when_generated",
  "Não confundir a nova validação global com a antiga daily_only.");
independentlyValidate(restInput, restResult.assignments);
assert(restResult.days.length === 2 &&
  restResult.days.every(row => row.lastDailyStatus === "generated"),
  "Diagnósticos apresentam os dois dias concluídos.");

const reversed = {
  ...restInput,
  people: [...restInput.people].reverse(),
  availabilities: [...restInput.availabilities].reverse(),
};
assert(JSON.stringify(generateConstrainedPeriodSchedule(reversed)) ===
  JSON.stringify(restResult),
  "A pesquisa deve ser determinística apesar da ordem de entrada.");

const noAlternative = inputs(mon, tue, ["a"],
  { [mon]: interval("16:00", "22:00"), [tue]: interval("08:00", "12:00") },
  {
    [mon]: { a: interval("16:00", "22:00") },
    [tue]: { a: interval("08:00", "12:00") },
  },
  { [mon]: one, [tue]: one }
);
const impossibleRest = generateConstrainedPeriodSchedule(noAlternative);
assert(impossibleRest.status === "incomplete" &&
  impossibleRest.assignments.length === 0 &&
  impossibleRest.workViolations.some(v => v.code === "minimum_rest"),
  "Sem pessoa alternativa, não publicar período com descanso insuficiente.");

const weekWorked = ["2026-10-26", "2026-10-27", "2026-10-28",
  "2026-10-29", "2026-10-30"].map(date => shift(date, "a"));
const weeklyInput = inputs(sat, sat, ["a", "b"],
  { [sat]: interval("09:00", "13:00") },
  { [sat]: { a: interval("09:00", "13:00"), b: interval("09:00", "13:00") } },
  { [sat]: one }, undefined, weekWorked
);
const weekly = generateConstrainedPeriodSchedule(weeklyInput);
assert(weekly.status === "generated" &&
  weekly.assignments.length === 1 &&
  weekly.assignments[0].personId === "b" &&
  weekly.rejectedByWorkRules > 0,
  "A já trabalhou 40h; pesquisa B para sábado sem ultrapassar o limite semanal.");
independentlyValidate(weeklyInput, weekly.assignments);

const sameWeeklyTooFew = inputs(sat, sat, ["a"],
  { [sat]: interval("09:00", "13:00") },
  { [sat]: { a: interval("09:00", "13:00") } },
  { [sat]: one }, undefined, weekWorked
);
const rejectedWeekly = generateConstrainedPeriodSchedule(sameWeeklyTooFew);
assert(rejectedWeekly.status === "incomplete" &&
  !rejectedWeekly.assignments.length &&
  rejectedWeekly.workViolations.some(v => v.code === "weekly_limit"),
  "Sem alternativa não publicar 44h na semana.");

const previousDay = inputs(tue, tue, ["a"],
  { [tue]: interval("08:00", "12:00") },
  { [tue]: { a: interval("08:00", "12:00") } },
  { [tue]: one }, undefined,
  [shift(mon, "a", "16:00", "22:00", null)]
);
const blockedPrevious = generateConstrainedPeriodSchedule(previousDay);
assert(blockedPrevious.status === "incomplete" &&
  blockedPrevious.workViolations.some(v => v.code === "minimum_rest"),
  "O descanso anterior ao período usa turnos exteriores confirmados.");

const afterDay = inputs(mon, mon, ["a"],
  { [mon]: interval("16:00", "22:00") },
  { [mon]: { a: interval("16:00", "22:00") } },
  { [mon]: one }, undefined,
  [shift(tue, "a", "08:00", "12:00", null)]
);
const blockedAfter = generateConstrainedPeriodSchedule(afterDay);
assert(blockedAfter.status === "incomplete" &&
  blockedAfter.workViolations.some(v => v.code === "minimum_rest"),
  "O descanso para o dia seguinte ao período também é validado.");

const futureWeekWorked = ["2026-10-27", "2026-10-28", "2026-10-29",
  "2026-10-30", "2026-10-31"].map(date => shift(date, "a"));
const futureWeek = inputs(mon, mon, ["a", "b"],
  { [mon]: interval("09:00", "13:00") },
  { [mon]: {
    a: interval("09:00", "13:00"),
    b: interval("09:00", "13:00"),
  } },
  { [mon]: one }, undefined, futureWeekWorked
);
const futureWeekResult = generateConstrainedPeriodSchedule(futureWeek);
assert(futureWeekResult.status === "generated" &&
  futureWeekResult.assignments.length === 1 &&
  futureWeekResult.assignments[0].personId === "b",
  "40h já conhecidas após o período impedem escalar A na segunda.");
independentlyValidate(futureWeek, futureWeekResult.assignments);

const sundayBefore = inputs(mon, mon, ["a", "b"],
  { [mon]: interval("08:00", "12:00") },
  { [mon]: {
    a: interval("08:00", "12:00"),
    b: interval("08:00", "12:00"),
  } },
  { [mon]: one }, undefined,
  [shift("2026-10-25", "a", "16:00", "22:00", null)]
);
const sundayBeforeResult = generateConstrainedPeriodSchedule(sundayBefore);
assert(sundayBeforeResult.status === "generated" &&
  sundayBeforeResult.assignments[0].personId === "b",
  "Descanso entre domingo anterior e segunda do período exige B.");
independentlyValidate(sundayBefore, sundayBeforeResult.assignments);

const illegalKnownWeek = inputs(sun, sun, ["b"],
  { [sun]: interval("09:00", "13:00") },
  { [sun]: { b: interval("09:00", "13:00") } },
  { [sun]: one }, undefined,
  [...weekWorked, shift(sat, "a")]
);
const invalidKnownWeek = generateConstrainedPeriodSchedule(illegalKnownWeek);
assert(invalidKnownWeek.status === "invalid_input" &&
  invalidKnownWeek.workViolations.some(v => v.code === "weekly_limit"),
  "Contexto externo que já ultrapassa 40h deve ser recusado antes da pesquisa.");

const malformedExternal = structuredClone(restInput);
malformedExternal.externalContext.shifts.push(null as unknown as DatedWorkShift);
assert(generateConstrainedPeriodSchedule(malformedExternal).status === "invalid_input",
  "Um turno exterior malformado deve devolver invalid_input, não lançar exceção.");

const wrongOutside = structuredClone(restInput);
wrongOutside.externalContext.completeOutsideTarget = false;
const incomplete = generateConstrainedPeriodSchedule(wrongOutside);
assert(incomplete.status === "incomplete_context" &&
  !incomplete.assignments.length &&
  incomplete.requiredContext?.startDate === "2026-10-25",
  "Falta de confirmação explícita não pode produzir horário certificado.");

const tooShortOutside = structuredClone(restInput);
tooShortOutside.externalContext.startDate = mon;
tooShortOutside.externalContext.endDate = tue;
const shortContext = generateConstrainedPeriodSchedule(tooShortOutside);
assert(shortContext.status === "incomplete_context" &&
  !shortContext.assignments.length,
  "É obrigatório contexto completo de semanas e dias adjacentes.");

const insideContext = structuredClone(restInput);
insideContext.externalContext.shifts.push(
  shift(mon, "a", "16:00", "22:00", null)
);
assert(generateConstrainedPeriodSchedule(insideContext).status === "invalid_input",
  "Turnos fixos interiores exigem um modelo próprio e são rejeitados.");

const unknownTimeZone = { ...restInput, timeZone: "Moon/SeaOfTranquility" };
assert(generateConstrainedPeriodSchedule(unknownTimeZone).status === "invalid_input",
  "O fuso IANA explícito tem de ser válido.");

const limited = { ...restInput, maxSearchNodes: 1 };
const limitedResult = generateConstrainedPeriodSchedule(limited);
assert(limitedResult.status === "search_limit" &&
  limitedResult.exploredNodes === 1 &&
  limitedResult.assignments.length === 0,
  "O limite global aplica-se a toda a pesquisa e não reinicia diariamente.");

const noStaff = inputs(mon, mon, [],
  { [mon]: interval("09:00", "18:00") }, { [mon]: {} }, { [mon]: one }
);
const shortage = generateConstrainedPeriodSchedule(noStaff);
assert(shortage.status === "incomplete" &&
  !shortage.assignments.length &&
  shortage.days[0].lastDailyStatus === "insufficient_capacity",
  "Falta de pessoas suficientes não pode publicar período parcial.");

const withMeal = inputs(mon, mon, ["a", "b"],
  { [mon]: interval("09:00", "18:00") },
  { [mon]: {
    a: interval("09:00", "18:00"),
    b: interval("09:00", "18:00"),
  } },
  { [mon]: one }
);
const mealSchedule = generateConstrainedPeriodSchedule(withMeal);
assert(mealSchedule.status === "generated" &&
  mealSchedule.assignments.length === 2 &&
  mealSchedule.assignments.every(s => s.mealBreak !== null),
  "O período de um dia combina refeições desfasadas e contexto semanal completo.");
independentlyValidate(withMeal, mealSchedule.assignments);

const central = inputs(mon, mon, ["a", "b", "c"],
  { [mon]: interval("09:00", "18:00") },
  { [mon]: {
    a: interval("09:00", "18:00"),
    b: interval("09:00", "18:00"),
    c: interval("09:00", "18:00"),
  } },
  { [mon]: centralTwo }
);
const centralResult = generateConstrainedPeriodSchedule(central);
assert(centralResult.status === "generated" &&
  centralResult.assignments.length === 3,
  "Mínimo central 2 mantido com três pessoas a fazer refeições.");
independentlyValidate(central, centralResult.assignments);

const acrossSunday = inputs(sun, nextMon, ["a", "b"],
  { [sun]: interval("16:00", "22:00"), [nextMon]: interval("08:00", "12:00") },
  {
    [sun]: { a: interval("16:00", "22:00"), b: interval("16:00", "22:00") },
    [nextMon]: { a: interval("08:00", "12:00") },
  }, { [sun]: one, [nextMon]: one },
  { startDate: "2026-10-25", endDate: "2026-11-09" }
);
const crossed = generateConstrainedPeriodSchedule(acrossSunday);
assert(crossed.status === "generated" &&
  crossed.assignments.some(s => s.date === sun && s.personId === "b"),
  "O descanso continua obrigatório de domingo para segunda entre semanas.");
independentlyValidate(acrossSunday, crossed.assignments);

const closed14 = inputs("2026-10-26", "2026-11-08", [],
  {}, {}, {}, { startDate: "2026-10-25", endDate: "2026-11-09" }
);
const closedResult = generateConstrainedPeriodSchedule(closed14);
assert(closedResult.status === "generated" &&
  closedResult.assignments.length === 0 &&
  closedResult.days.length === 14 &&
  closedResult.days.every(day => day.lastDailyStatus === "closed"),
  "Catorze dias consecutivos fechados aceites com contexto completo.");

const tooLong = { ...closed14, endDate: "2026-11-09" };
assert(generateConstrainedPeriodSchedule(tooLong).status === "invalid_input",
  "Quinze dias excedem o horizonte V0.");
assert(generateConstrainedPeriodSchedule({
  ...closed14, startDate: "2026-11-08", endDate: "2026-10-26",
}).status === "invalid_input",
  "Datas inversas devem ser rejeitadas.");

const badKnown = structuredClone(restInput);
badKnown.externalContext.shifts.push(
  shift("2026-10-25", "a", "23:00", "07:00", null)
);
assert(generateConstrainedPeriodSchedule(badKnown).status === "invalid_input",
  "Contexto exterior estruturalmente inválido é rejeitado.");

console.log("Constrained Period Generator V0: todos os testes passaram.");
