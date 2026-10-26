import type {
  DatedWorkShift,
  Person,
  PersonAvailability,
  PresenceRequirement,
  TimeInterval,
  WeeklyOperatingHours,
  WorkConstraintConfiguration,
} from "./types";
import { WEEKDAYS } from "./utils/operatingCalendar";
import { createEmptyWeeklyAvailability } from "./utils/availability";
import { createEmptyWeeklyPresenceRequirements } from "./utils/presence";
import { checkPresenceForWorkShifts } from "./utils/workCoverage";
import {
  INITIAL_WORK_CONSTRAINTS,
  getEffectiveWorkIntervals,
  validateWorkConstraints,
} from "./utils/workConstraints";
import {
  generateMealAwareDaySchedule,
  type GenerateMealAwareDayInput,
} from "./utils/mealAwareDayGenerator";

function assert(ok: boolean, description: string): void {
  if (!ok) throw new Error(description);
}
function interval(start: string, end: string): TimeInterval[] {
  return [{ start, end }];
}

const date = "2026-10-26";
const one: PresenceRequirement = {
  minimumAtOpening: 1, minimumDuringOperation: 1, minimumAtClosing: 1,
};
const two: PresenceRequirement = {
  minimumAtOpening: 1, minimumDuringOperation: 2, minimumAtClosing: 1,
};

function inputFor(
  date: string,
  operation: TimeInterval[],
  ids: string[],
  allowed: Record<string, TimeInterval[]>,
  requirements: PresenceRequirement,
  duration = 480,
  rules: WorkConstraintConfiguration = INITIAL_WORK_CONSTRAINTS
): GenerateMealAwareDayInput {
  const people: Person[] = ids.map(id => ({
    id, name: id, active: true,
  }));
  const availabilities: PersonAvailability[] = people.map(person => ({
    personId: person.id,
    weeklyAvailability: createEmptyWeeklyAvailability(),
    exceptions: [{ date, intervals: allowed[person.id] ?? [] }],
  }));
  const weeklyOperatingHours = WEEKDAYS.reduce((week, weekday) => {
    week[weekday] = [];
    return week;
  }, {} as WeeklyOperatingHours);

  return {
    date,
    people,
    availabilities,
    operatingCalendar: {
      weeklyOperatingHours,
      exceptions: [{ date, intervals: operation }],
    },
    workRules: { standardShiftDurationMinutes: duration },
    presence: {
      weeklyPresenceRequirements: createEmptyWeeklyPresenceRequirements(),
      presenceExceptions: [{ date, requirements }],
    },
    workConstraints: structuredClone(rules),
    timeZone: "Atlantic/Azores",
  };
}

function assertDailyValid(
  input: GenerateMealAwareDayInput,
  assignments: DatedWorkShift[]
): void {
  const operation = input.operatingCalendar.exceptions[0].intervals;
  const requirements = input.presence.presenceExceptions[0].requirements;
  if (requirements === null) throw new Error("Caso de teste sem presença configurada.");
  assert(checkPresenceForWorkShifts(
    input.date, operation, requirements, assignments
  ).valid, "Validação independente confirma cobertura com refeições.");

  const work = validateWorkConstraints({
    timeZone: input.timeZone,
    rules: input.workConstraints,
    targetPeriod: { startDate: input.date, endDate: input.date },
    knownSchedule: {
      startDate: input.date, endDate: input.date,
      complete: false, shifts: assignments,
    },
  });
  assert(work.status === "incomplete_context" &&
    work.violations.length === 0,
    "A solução diária cumpre regras locais mas NÃO certifica contexto semanal.");
  for (const shift of assignments) {
    assert(getEffectiveWorkIntervals(shift) !== null,
      "Turno publicado tem intervalos efetivos válidos.");
  }
}

const fullDay = inputFor(
  date, interval("09:00", "18:00"),
  ["a", "b"],
  { a: interval("09:00", "18:00"), b: interval("09:00", "18:00") },
  one
);
const snapshot = JSON.stringify(fullDay);
const generated = generateMealAwareDaySchedule(fullDay);
assert(JSON.stringify(fullDay) === snapshot,
  "A geração deve ser determinística sem mutar os dados de entrada.");
assert(generated.status === "generated",
  "Duas pessoas com refeições desfasadas cobrem operação de nove horas.");
assert(generated.validationScope === "daily_work_and_coverage_only",
  "A geração não deve afirmar que validou limites entre dias.");
assert(generated.assignments.length === 2,
  "Precisamente duas pessoas necessárias para cobrir uma pausa.");
assert(generated.assignments.every(shift =>
  shift.mealBreak !== null &&
  shift.interval.start === "09:00" &&
  shift.interval.end === "18:00"
), "8 horas efetivas exigem uma hora adicional de permanência.");
assert(generated.assignments[0].mealBreak?.start !==
  generated.assignments[1].mealBreak?.start,
  "Refeições de duas pessoas devem ser desfasadas para garantir cobertura.");
assertDailyValid(fullDay, generated.assignments);
assert(generated.candidateCount > 0 && generated.exploredNodes > 0,
  "A pesquisa deve declarar número de candidatos e nós explorados.");

const reversed = {
  ...fullDay,
  people: [...fullDay.people].reverse(),
  availabilities: [...fullDay.availabilities].reverse(),
};
assert(JSON.stringify(generateMealAwareDaySchedule(reversed)) ===
  JSON.stringify(generated),
  "A solução deve manter-se estável independentemente da ordem de pessoas.");

const insufficientBreakCoverage = inputFor(
  date, interval("09:00", "18:00"), ["a"],
  { a: interval("09:00", "18:00") }, one
);
const justOne = generateMealAwareDaySchedule(insufficientBreakCoverage);
assert(justOne.status === "not_found" &&
  justOne.assignments.length === 0,
  "Uma pessoa sozinha não pode cobrir obrigatoriamente a própria refeição.");

const centralTwo = inputFor(
  date, interval("09:00", "18:00"),
  ["a", "b", "c"],
  {
    a: interval("09:00", "18:00"),
    b: interval("09:00", "18:00"),
    c: interval("09:00", "18:00"),
  },
  two
);
const three = generateMealAwareDaySchedule(centralTwo);
assert(three.status === "generated" && three.assignments.length === 3,
  "Três pessoas conseguem cobrir mínimos 1/2/1 com pausas.");
assertDailyValid(centralTwo, three.assignments);

const twoCentral = inputFor(
  date, interval("09:00", "18:00"), ["a", "b"],
  {
    a: interval("09:00", "18:00"),
    b: interval("09:00", "18:00"),
  },
  two
);
const impossibleTwo = generateMealAwareDaySchedule(twoCentral);
assert(impossibleTwo.status === "not_found" && !impossibleTwo.assignments.length,
  "Mínimo 2 durante todo o centro com só duas pessoas e refeições é impossível.");

const shortDay = inputFor(
  date, interval("09:00", "13:00"),
  ["a"], { a: interval("09:00", "13:00") }, one
);
const shortResult = generateMealAwareDaySchedule(shortDay);
assert(shortResult.status === "generated" &&
  shortResult.assignments.length === 1 &&
  shortResult.assignments[0].mealBreak === null &&
  shortResult.assignments[0].interval.end === "13:00",
  "Operação curta de 4h utiliza turno sem refeição e não prolonga presença.");
assertDailyValid(shortDay, shortResult.assignments);

const exactlySix = inputFor(
  date, interval("09:00", "15:00"),
  ["a"], { a: interval("09:00", "15:00") }, one
);
const six = generateMealAwareDaySchedule(exactlySix);
assert(six.status === "generated" && six.assignments[0].mealBreak === null,
  "Exatamente 6 horas efetivas não exigem refeição.");

const sevenAndHalf = inputFor(
  date, interval("09:00", "16:30"),
  ["a", "b"],
  {
    a: interval("09:00", "16:30"),
    b: interval("09:00", "16:30"),
  }, one
);
const sevenAndHalfResult = generateMealAwareDaySchedule(sevenAndHalf);
assert(sevenAndHalfResult.status === "generated" &&
  sevenAndHalfResult.assignments.every(s => s.mealBreak !== null),
  "7h30 de operação admite turnos de 6h30 efetivas e refeição de 1h.");
assertDailyValid(sevenAndHalf, sevenAndHalfResult.assignments);

const closed = inputFor(date, [], ["a"], { a: [] }, one);
const closedResult = generateMealAwareDaySchedule(closed);
assert(closedResult.status === "closed" &&
  closedResult.assignments.length === 0 && closedResult.exploredNodes === 0,
  "Dia fechado não gera turnos nem pesquisa.");

const noPeople = inputFor(date, interval("09:00", "18:00"), [], {}, one);
const missingCapacity = generateMealAwareDaySchedule(noPeople);
assert(missingCapacity.status === "insufficient_capacity" &&
  missingCapacity.assignments.length === 0 &&
  missingCapacity.shortages.length > 0,
  "Escassez de pessoas disponíveis é detetada antes da pesquisa.");

const searchLimited = generateMealAwareDaySchedule({
  ...fullDay, maxSearchNodes: 1,
});
assert(searchLimited.status === "search_limit" &&
  searchLimited.assignments.length === 0 &&
  searchLimited.exploredNodes === 1,
  "Limite de nós interrompe a pesquisa sem publicar soluções parciais.");

assert(generateMealAwareDaySchedule({
  ...fullDay, maxSearchNodes: 0,
}).status === "invalid_input",
"Limite de nós não positivo deve falhar.");

assert(generateMealAwareDaySchedule({
  ...fullDay, timeZone: "Invalid/Nowhere",
}).status === "invalid_input",
"Fuso IANA inválido deve falhar.");

const noDuration = structuredClone(fullDay);
noDuration.workRules.standardShiftDurationMinutes = null;
assert(generateMealAwareDaySchedule(noDuration).status === "invalid_input",
  "Duração padrão em falta torna o input inválido.");

const duplicates = structuredClone(fullDay);
duplicates.people.push({ ...duplicates.people[0] });
assert(generateMealAwareDaySchedule(duplicates).status === "invalid_input",
  "Identificadores de pessoas duplicados não são permitidos.");

const archived = structuredClone(fullDay);
archived.people[0].active = false;
const archivedResult = generateMealAwareDaySchedule(archived);
assert(archivedResult.status === "not_found" &&
  archivedResult.assignments.length === 0,
  "Pessoa arquivada não pode satisfazer a necessidade de almoço.");

const constrained = structuredClone(fullDay);
constrained.workConstraints.maximumDailyEffectiveMinutes = 360;
const constrainedResult = generateMealAwareDaySchedule(constrained);
assert(constrainedResult.status === "generated" &&
  constrainedResult.assignments.length === 2,
  "Limite diário de 6h requer dois turnos curtos para cobrir 9h.");
assert(constrainedResult.assignments.every(s => s.mealBreak === null),
  "Com máximo de 6h efetivas, não há refeição obrigatória.");
assertDailyValid(constrained, constrainedResult.assignments);

const brokenAvailability = structuredClone(fullDay);
brokenAvailability.availabilities[0].exceptions.push(
  brokenAvailability.availabilities[0].exceptions[0]
);
assert(generateMealAwareDaySchedule(brokenAvailability).status === "invalid_input",
  "Exceções de disponibilidade duplicadas devem ser recusadas.");

const splitOperation = inputFor(
  date,
  [{ start: "09:00", end: "13:00" },
   { start: "14:00", end: "18:00" }],
  ["a", "b"],
  {
    a: [{ start: "09:00", end: "13:00" },
        { start: "14:00", end: "18:00" }],
    b: [{ start: "09:00", end: "13:00" },
        { start: "14:00", end: "18:00" }],
  },
  one
);
const splitResult = generateMealAwareDaySchedule(splitOperation);
assert(splitResult.status === "generated" &&
  splitResult.assignments.every(s => s.mealBreak === null),
  "Intervalos separados de operação curta geram turnos sem refeição.");
assert(splitResult.assignments.every(s =>
  s.interval.end === "13:00" || s.interval.start === "14:00"
), "Um turno não atravessa o encerramento intermédio.");
assertDailyValid(splitOperation, splitResult.assignments);

console.log("Meal-aware Day Generator V0: todos os testes passaram.");
