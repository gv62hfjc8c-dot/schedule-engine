import type {
  GenerateDayScheduleInput,
} from "./utils/dailyGenerator";
import { generateDaySchedule } from "./utils/dailyGenerator";
import {
  checkPresenceForAssignments,
  createEmptyWeeklyPresenceRequirements,
} from "./utils/presence";
import { createEmptyWeeklyAvailability } from "./utils/availability";
import type {
  Person, PersonAvailability, PresenceRequirement, TimeInterval,
  WeeklyOperatingHours,
} from "./types";
import { WEEKDAYS } from "./utils/operatingCalendar";

function assert(ok: boolean, reason: string): void {
  if (!ok) throw new Error(reason);
}
function interval(start: string, end: string): TimeInterval[] {
  return [{ start, end }];
}
function inputFor(
  date: string, operation: TimeInterval[], ids: string[],
  allowed: Record<string, TimeInterval[]>,
  requirements: PresenceRequirement, duration = 480
): GenerateDayScheduleInput {
  const people: Person[] = ids.map((id) => ({ id, name: id, active: true }));
  const availabilities: PersonAvailability[] = people.map((person) => ({
    personId: person.id,
    weeklyAvailability: createEmptyWeeklyAvailability(),
    exceptions: [{ date, intervals: allowed[person.id] ?? [] }],
  }));
  return {
    date, people, availabilities,
    operatingCalendar: {
      weeklyOperatingHours: Object.fromEntries(
        WEEKDAYS.map((day) => [day, []])
      ) as WeeklyOperatingHours,
      exceptions: [{ date, intervals: operation }],
    },
    workRules: { standardShiftDurationMinutes: duration },
    presence: {
      weeklyPresenceRequirements: createEmptyWeeklyPresenceRequirements(),
      presenceExceptions: [{ date, requirements }],
    },
  };
}

const date = "2026-10-26";
const oneTwoOne: PresenceRequirement = {
  minimumAtOpening: 1, minimumDuringOperation: 2, minimumAtClosing: 1,
};
const twoTwoTwo: PresenceRequirement = {
  minimumAtOpening: 2, minimumDuringOperation: 2, minimumAtClosing: 2,
};

const three = inputFor(
  date, interval("09:00", "18:00"), ["c", "a", "b"],
  {
    a: interval("09:00", "18:00"),
    b: interval("09:00", "18:00"),
    c: interval("09:00", "18:00"),
  }, oneTwoOne
);
const solved = generateDaySchedule(three);
assert(solved.status === "generated", "Três pessoas devem cobrir 1/2/1.");
assert(solved.assignments.length === 3, "Três turnos de 8 horas são necessários.");
assert(checkPresenceForAssignments(
  three.operatingCalendar.exceptions[0].intervals,
  oneTwoOne, solved.assignments
).valid, "O validador independente deve aprovar a solução.");
assert(solved.assignments.every((item) => {
  const minutes = (clock: string) => {
    const [h, m] = clock.split(":").map(Number);
    return h * 60 + m;
  };
  return minutes(item.interval.end) - minutes(item.interval.start) === 480;
}), "A duração dos turnos tem de ser exatamente 8 horas.");

const two = inputFor(
  date, interval("09:00", "18:00"), ["a", "b"],
  { a: interval("09:00", "18:00"), b: interval("09:00", "18:00") },
  oneTwoOne
);
const noSolution = generateDaySchedule(two);
assert(noSolution.status === "not_found", "Dois turnos de 8h não cobrem 1/2/1.");
assert(noSolution.assignments.length === 0, "Não publicar solução parcial.");
assert(noSolution.issues.some((issue) => issue.includes("não demonstra")),
  "Não confundir pesquisa discreta com prova de impossibilidade.");

const nineHours = generateDaySchedule({
  ...two, workRules: { standardShiftDurationMinutes: 540 },
});
assert(nineHours.status === "generated" &&
  nineHours.assignments.length === 2, "Dois turnos de 9h devem bastar.");

const short = inputFor(
  date, interval("09:00", "13:00"), ["a", "b"],
  { a: interval("09:00", "13:00"), b: interval("09:00", "13:00") },
  twoTwoTwo
);
const shortResult = generateDaySchedule(short);
assert(shortResult.status === "generated" &&
  shortResult.assignments.length === 2 &&
  shortResult.assignments.every((a) => a.interval.start === "09:00" &&
    a.interval.end === "13:00"), "Dia curto reduz turno à operação.");

const overlap = inputFor(
  date, interval("09:00", "09:45"), ["a", "b"],
  { a: interval("09:00", "09:45"), b: interval("09:00", "09:45") },
  { minimumAtOpening: 1, minimumDuringOperation: 3, minimumAtClosing: 2 }
);
assert(generateDaySchedule(overlap).status === "generated",
  "Dia de 45 minutos não exige mínimo central inexistente.");

const split = inputFor(
  date, [{ start: "08:00", end: "12:00" }, { start: "14:00", end: "20:00" }],
  ["a", "b", "c", "d"],
  {
    a: interval("08:00", "12:00"), b: interval("08:00", "12:00"),
    c: interval("14:00", "20:00"), d: interval("14:00", "20:00"),
  }, oneTwoOne
);
const splitResult = generateDaySchedule(split);
assert(splitResult.status === "generated" &&
  splitResult.assignments.length === 4 &&
  splitResult.assignments.every((a) =>
    a.interval.end <= "12:00" || a.interval.start >= "14:00"
  ), "Operação partida deve ser coberta sem atravessar fecho.");

const missing = generateDaySchedule(inputFor(
  date, interval("09:00", "18:00"), ["a"],
  { a: interval("09:00", "18:00") }, oneTwoOne
));
assert(missing.status === "insufficient_capacity" &&
  missing.shortages.some((s) => s.phase === "operation" &&
    s.actual === 1 && s.required === 2),
  "Falta de disponibilidade é diferente de falha da pesquisa.");

const archived = generateDaySchedule({
  ...short, people: short.people.map((p) =>
    p.id === "b" ? { ...p, active: false } : p
  ),
});
assert(archived.status === "insufficient_capacity",
  "Pessoas arquivadas não podem contar.");

const closed = generateDaySchedule({
  ...short, operatingCalendar: {
    ...short.operatingCalendar, exceptions: [{ date, intervals: [] }],
  },
});
assert(closed.status === "closed" && closed.assignments.length === 0,
  "Dia fechado não origina turnos.");

const zero = generateDaySchedule(inputFor(
  date, interval("09:00", "18:00"), ["a"],
  { a: interval("09:00", "18:00") },
  { minimumAtOpening: 0, minimumDuringOperation: 0, minimumAtClosing: 0 }
));
assert(zero.status === "generated" && zero.assignments.length === 0,
  "Mínimos zero permitem solução vazia.");

const unconfigured = generateDaySchedule({
  ...short, presence: {
    ...short.presence, presenceExceptions: [{ date, requirements: null }],
  },
});
assert(unconfigured.status === "invalid_input",
  "Sem mínimos configurados deve dar erro de entrada.");

const badDuration = generateDaySchedule({
  ...short, workRules: { standardShiftDurationMinutes: null },
});
assert(badDuration.status === "invalid_input",
  "Sem duração configurada deve dar erro de entrada.");

const duplicate = generateDaySchedule({
  ...short, people: [...short.people, short.people[0]],
});
assert(duplicate.status === "invalid_input", "IDs duplicados são inválidos.");

const badTime = generateDaySchedule({
  ...short, operatingCalendar: {
    ...short.operatingCalendar,
    exceptions: [{ date, intervals: interval("09:xx", "13:00") }],
  },
});
assert(badTime.status === "invalid_input", "Horas inválidas são recusadas.");

const badDate = generateDaySchedule({ ...short, date: "2026-02-30" });
assert(badDate.status === "invalid_input", "Datas impossíveis são recusadas.");

const duplicatedExceptions = generateDaySchedule({
  ...short, presence: {
    ...short.presence,
    presenceExceptions: [
      ...short.presence.presenceExceptions,
      ...short.presence.presenceExceptions,
    ],
  },
});
assert(duplicatedExceptions.status === "invalid_input",
  "Exceções duplicadas não podem ser ignoradas.");

const limited = generateDaySchedule({ ...three, maxSearchNodes: 1 });
assert(limited.status === "search_limit" &&
  limited.assignments.length === 0 && limited.exploredNodes === 1,
  "Limite de pesquisa não pode publicar solução parcial.");

const reordered = generateDaySchedule({
  ...three, people: [...three.people].reverse(),
  availabilities: [...three.availabilities].reverse(),
});
assert(JSON.stringify(reordered.assignments) ===
  JSON.stringify(solved.assignments),
  "Resultado não pode depender da ordem dos colaboradores.");

const minuteSpecific = generateDaySchedule(inputFor(
  date, interval("09:00", "13:00"), ["a", "b"],
  {
    a: interval("09:00", "13:00"),
    b: interval("09:07", "13:00"),
  },
  { minimumAtOpening: 2, minimumDuringOperation: 2, minimumAtClosing: 2 }
));
assert(minuteSpecific.status === "insufficient_capacity",
  "Disponibilidade ao minuto não pode ser arredondada.");

console.log("Daily Generator V0: todos os testes passaram.");
