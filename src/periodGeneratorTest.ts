import type {
  Person,
  PersonAvailability,
  PresenceRequirement,
  TimeInterval,
  WeeklyOperatingHours,
  WeeklyPresenceRequirements,
} from "./types";
import {
  generatePeriodSchedule,
  MAX_PERIOD_DAYS,
  type GeneratePeriodScheduleInput,
} from "./utils/periodGenerator";
import { checkPresenceForAssignments } from "./utils/presence";
import { getOperatingIntervalsForDate, getWeekday, WEEKDAYS } from "./utils/operatingCalendar";
import { getAvailabilityIntervalsForDate } from "./utils/availability";

function assert(ok: boolean, message: string): void {
  if (!ok) throw new Error(message);
}

const open = [{ start: "09:00", end: "13:00" }];
const long = [{ start: "09:00", end: "18:00" }];
const one: PresenceRequirement = {
  minimumDuringOperation: 1,
  minimumAtOpening: 1,
  minimumAtClosing: 1,
};
const twoMiddle: PresenceRequirement = {
  minimumDuringOperation: 2,
  minimumAtOpening: 1,
  minimumAtClosing: 1,
};

function weeklyHours(): WeeklyOperatingHours {
  return WEEKDAYS.reduce((result, weekday) => {
    result[weekday] = weekday === "sunday" ? [] : open;
    return result;
  }, {} as WeeklyOperatingHours);
}

function weeklyPresence(): WeeklyPresenceRequirements {
  return WEEKDAYS.reduce((result, weekday) => {
    result[weekday] = weekday === "sunday" ? null : { ...one };
    return result;
  }, {} as WeeklyPresenceRequirements);
}

function makeInput(startDate: string, endDate: string): GeneratePeriodScheduleInput {
  const availabilityDays = WEEKDAYS.reduce((result, weekday) => {
    result[weekday] = weekday === "sunday" ? [] : open;
    return result;
  }, {} as PersonAvailability["weeklyAvailability"]);

  const people: Person[] = [
    { id: "a", name: "Anabela", active: true },
    { id: "b", name: "Diogo", active: true },
    { id: "c", name: "Nélia", active: false },
  ];
  const availabilities: PersonAvailability[] = [{
    personId: "a",
    weeklyAvailability: availabilityDays,
    exceptions: [],
  }, {
    personId: "b",
    weeklyAvailability: WEEKDAYS.reduce((result, weekday) => {
      result[weekday] = [];
      return result;
    }, {} as PersonAvailability["weeklyAvailability"]),
    exceptions: [],
  }, {
    personId: "c",
    weeklyAvailability: availabilityDays,
    exceptions: [],
  }];

  return {
    startDate,
    endDate,
    people,
    availabilities,
    operatingCalendar: {
      weeklyOperatingHours: weeklyHours(),
      exceptions: [],
    },
    workRules: { standardShiftDurationMinutes: 480 },
    presence: {
      weeklyPresenceRequirements: weeklyPresence(),
      presenceExceptions: [],
    },
  };
}

const normal = makeInput("2026-10-26", "2026-11-01");
const frozenInput = JSON.stringify(normal);
const result = generatePeriodSchedule(normal);

assert(result.status === "daily_complete", "Semana comum deve ter os dias individualmente válidos.");
assert(result.validationScope === "daily_only", "O resultado não pode prometer validação semanal.");
assert(result.days.length === 7, "O intervalo inclui as duas datas extremas.");
assert(result.generatedDays === 6 && result.closedDays === 1 &&
  result.failedDays === 0, "Seis dias abertos e domingo fechado.");
assert(result.assignments.length === 6, "Seis turnos de Anabela com data.");
assert(result.assignments.every((item) =>
  item.personId === "a" &&
  item.interval.start === "09:00" && item.interval.end === "13:00"
), "Cada dia aberto deve ter um turno contínuo dentro da disponibilidade.");
assert(result.days[6].status === "closed" &&
  result.days[6].date === "2026-11-01", "Domingo fechado não deve criar turnos.");
assert(JSON.stringify(normal) === frozenInput, "A geração não pode modificar a entrada.");
assert(result.assignments.every((assignment) => {
  const intervals = getOperatingIntervalsForDate(
    assignment.date, normal.operatingCalendar.weeklyOperatingHours,
    normal.operatingCalendar.exceptions
  );
  const requirements = normal.presence.weeklyPresenceRequirements[
    getWeekday(assignment.date)
  ];
  return requirements !== null &&
    checkPresenceForAssignments(intervals, requirements, [{
      personId: assignment.personId, interval: assignment.interval,
    }]).valid &&
    getAvailabilityIntervalsForDate(
      assignment.date, normal.availabilities[0]
    ).some((available) =>
      available.start <= assignment.interval.start &&
      available.end >= assignment.interval.end
    );
}), "Cada turno publicado deve passar numa validação diária independente.");

const mixed = makeInput("2026-10-26", "2026-10-28");
mixed.operatingCalendar.exceptions.push({
  date: "2026-10-27", intervals: long,
});
mixed.presence.presenceExceptions.push({
  date: "2026-10-27", requirements: twoMiddle,
});
const mixedResult = generatePeriodSchedule(mixed);
assert(mixedResult.status === "incomplete" &&
  mixedResult.days[0].status === "generated" &&
  mixedResult.days[1].status === "insufficient_capacity" &&
  mixedResult.days[2].status === "generated",
  "Dias válidos em torno de um dia sem cobertura devem ser analisados todos.");
assert(mixedResult.assignments.length === 0,
  "Nenhum horário de período incompleto pode ser publicado.");
assert(mixedResult.generatedDays === 2 && mixedResult.failedDays === 1,
  "A contagem dos dias deve preservar sucesso e falha por data.");
assert(mixedResult.days[1].shortages.some((s) =>
  s.phase === "operation" && s.interval.start === "09:30" &&
  s.actual === 1 && s.required === 2
), "Diagnóstico deve preservar a insuficiência do dia específico.");

const twoEight = makeInput("2026-10-26", "2026-10-27");
twoEight.operatingCalendar.exceptions.push({
  date: "2026-10-27", intervals: long,
});
twoEight.presence.presenceExceptions.push({
  date: "2026-10-27", requirements: twoMiddle,
});
twoEight.availabilities[0].exceptions.push({
  date: "2026-10-27", intervals: long,
});
twoEight.availabilities[1].exceptions.push({
  date: "2026-10-27", intervals: long,
});
const twoEightResult = generatePeriodSchedule(twoEight);
assert(twoEightResult.status === "incomplete" &&
  twoEightResult.days[1].status === "not_found" &&
  twoEightResult.assignments.length === 0,
  "Duas pessoas com 8h cada não satisfazem 1/2/1 num dia de 9h.");
assert(twoEightResult.issues.some((issue) => issue.includes("Não foi publicado")),
  "Os diagnósticos devem explicar a ausência do horário agregado.");

const exception = makeInput("2026-10-26", "2026-10-28");
exception.operatingCalendar.exceptions.push({
  date: "2026-10-27", intervals: [],
});
const exceptionResult = generatePeriodSchedule(exception);
assert(exceptionResult.status === "daily_complete" &&
  exceptionResult.closedDays === 1 &&
  exceptionResult.generatedDays === 2 &&
  exceptionResult.assignments.every((a) => a.date !== "2026-10-27"),
  "Fecho excecional tem precedência sobre a semana padrão.");

const duplicate = makeInput("2026-10-26", "2026-10-28");
duplicate.presence.presenceExceptions.push(
  { date: "2026-10-27", requirements: one },
  { date: "2026-10-27", requirements: one }
);
const duplicateResult = generatePeriodSchedule(duplicate);
assert(duplicateResult.status === "incomplete" &&
  duplicateResult.days[1].status === "invalid_input",
  "Exceções duplicadas devem aparecer no diagnóstico da data.");

const unconfigured = makeInput("2026-10-26", "2026-10-27");
unconfigured.presence.weeklyPresenceRequirements.tuesday = null;
const missing = generatePeriodSchedule(unconfigured);
assert(missing.status === "incomplete" &&
  missing.days[1].status === "invalid_input" &&
  missing.assignments.length === 0,
  "Presença não configurada impede publicar o período.");

const crossed = makeInput("2026-12-31", "2027-01-02");
const crossedResult = generatePeriodSchedule(crossed);
assert(crossedResult.status === "daily_complete" &&
  crossedResult.days.map((d) => d.date).join(",") ===
  "2026-12-31,2027-01-01,2027-01-02",
  "Mudança de mês e ano deve preservar todos os dias locais.");

const leap = makeInput("2028-02-28", "2028-03-01");
const leapResult = generatePeriodSchedule(leap);
assert(leapResult.days.map((d) => d.date).join(",") ===
  "2028-02-28,2028-02-29,2028-03-01",
  "Anos bissextos devem incluir 29 de fevereiro.");

const dst = makeInput("2027-03-27", "2027-03-30");
const dstResult = generatePeriodSchedule(dst);
assert(dstResult.days.map((d) => d.date).join(",") ===
  "2027-03-27,2027-03-28,2027-03-29,2027-03-30",
  "Mudança de hora não pode saltar nem duplicar datas civis.");

const invalidDate = generatePeriodSchedule(makeInput("2026-02-30", "2026-03-02"));
assert(invalidDate.status === "invalid_input" &&
  invalidDate.days.length === 0 && invalidDate.assignments.length === 0,
  "Datas civis inválidas não devem iniciar geração.");

const reversed = generatePeriodSchedule(makeInput("2026-11-02", "2026-11-01"));
assert(reversed.status === "invalid_input", "Datas invertidas devem ser recusadas.");

const max = generatePeriodSchedule(makeInput("2026-10-26", "2026-11-08"));
assert(max.days.length === MAX_PERIOD_DAYS &&
  max.status === "daily_complete", "O limite inclusivo de 14 dias deve ser válido.");

const tooMany = generatePeriodSchedule(makeInput("2026-10-26", "2026-11-09"));
assert(tooMany.status === "invalid_input" &&
  tooMany.days.length === 0 && tooMany.assignments.length === 0,
  "Um período maior do que 14 dias deve falhar antes da pesquisa.");

const limited = generatePeriodSchedule({
  ...makeInput("2026-10-26", "2026-10-27"),
  maxSearchNodes: 1,
});
assert(limited.status === "incomplete" &&
  limited.days.every((d) => d.status === "search_limit") &&
  limited.assignments.length === 0,
  "Limite diário de pesquisa deve preservar diagnósticos, sem publicar parcial.");

const allClosed = makeInput("2026-11-01", "2026-11-01");
const closedResult = generatePeriodSchedule(allClosed);
assert(closedResult.status === "daily_complete" &&
  closedResult.closedDays === 1 &&
  closedResult.assignments.length === 0,
  "Período inteiramente fechado pode ser completo com zero turnos.");

console.log("Period Generator V0: todos os testes passaram.");
