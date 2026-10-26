import type {
  DatedWorkShift,
  PresenceRequirement,
  TimeInterval,
} from "./types";
import {
  checkPresenceForAssignments,
  checkPresenceForWorkingIntervals,
} from "./utils/presence";
import { checkPresenceForWorkShifts } from "./utils/workCoverage";

function assert(condition: boolean, description: string): void {
  if (!condition) throw new Error(description);
}

const date = "2026-10-26";
const operating: TimeInterval[] = [{ start: "09:00", end: "18:00" }];
const one: PresenceRequirement = {
  minimumAtOpening: 1,
  minimumDuringOperation: 1,
  minimumAtClosing: 1,
};
const two: PresenceRequirement = {
  minimumAtOpening: 1,
  minimumDuringOperation: 2,
  minimumAtClosing: 1,
};

function shift(
  personId: string,
  start = "09:00",
  end = "18:00",
  mealStart: string | null = "13:00",
  mealEnd = "14:00"
): DatedWorkShift {
  return {
    date,
    personId,
    interval: { start, end },
    mealBreak: mealStart === null
      ? null
      : { start: mealStart, end: mealEnd },
  };
}

const alone = shift("a");
const original = JSON.stringify(alone);
const brokenCoverage = checkPresenceForWorkShifts(date, operating, one, [alone]);
assert(!brokenCoverage.valid && brokenCoverage.issues.length === 0,
  "Durante a refeição a cobertura deve ser insuficiente sem outro trabalhador.");
assert(brokenCoverage.shortages.some((shortage) =>
  shortage.interval.start === "13:00" &&
  shortage.interval.end === "14:00" &&
  shortage.phase === "operation" &&
  shortage.actual === 0 && shortage.required === 1
), "Detetar o intervalo exato da refeição como lacuna central 0/1.");
assert(JSON.stringify(alone) === original,
  "Validação da cobertura não pode alterar o turno original.");

const noBreak = checkPresenceForWorkShifts(
  date, operating, one, [shift("a", "09:00", "18:00", null)]
);
assert(noBreak.valid,
  "Cobertura apenas pode passar sem refeição; validação da refeição pertence às regras de trabalho.");

const staggered = checkPresenceForWorkShifts(date, operating, one, [
  shift("a", "09:00", "18:00", "12:00", "13:00"),
  shift("b", "09:00", "18:00", "13:00", "14:00"),
]);
assert(staggered.valid && staggered.shortages.length === 0,
  "Pausas desfasadas mantêm pelo menos uma pessoa em cobertura.");

const simultaneous = checkPresenceForWorkShifts(date, operating, one, [
  shift("a"),
  shift("b"),
]);
assert(!simultaneous.valid &&
  simultaneous.shortages.some((shortage) =>
    shortage.interval.start === "13:00" &&
    shortage.interval.end === "14:00" &&
    shortage.actual === 0 &&
    shortage.required === 1
  ), "Duas pessoas a almoçar ao mesmo tempo deixam a operação sem cobertura.");

const threeWorkers = checkPresenceForWorkShifts(date, operating, two, [
  shift("a", "09:00", "18:00", "13:00", "14:00"),
  shift("b", "09:00", "18:00", "14:00", "15:00"),
  shift("c", "12:00", "16:00", null),
]);
assert(threeWorkers.valid,
  "Requisito central 2 é mantido por um terceiro trabalhador durante os almoços.");

const twoNotEnough = checkPresenceForWorkShifts(date, operating, two, [
  shift("a", "09:00", "18:00", "13:00", "14:00"),
  shift("b", "09:00", "18:00", "14:00", "15:00"),
]);
assert(!twoNotEnough.valid &&
  twoNotEnough.shortages.some(s =>
    s.interval.start === "13:00" && s.interval.end === "14:00" &&
    s.actual === 1 && s.required === 2
  ) &&
  twoNotEnough.shortages.some(s =>
    s.interval.start === "14:00" && s.interval.end === "15:00" &&
    s.actual === 1 && s.required === 2
  ), "Requisito central 2 deteta lacunas durante refeições intercaladas.");

const withMoreNeeded = checkPresenceForWorkShifts(
  date,
  operating,
  { ...two, minimumDuringOperation: 3 },
  [
    shift("a"),
    shift("b", "09:00", "18:00", "12:00", "13:00"),
    shift("c", "12:00", "16:00", null),
  ]
);
assert(!withMoreNeeded.valid && withMoreNeeded.shortages.some(s =>
  s.interval.start === "13:00" && s.actual === 2 && s.required === 3
), "Cobertura deve considerar os requisitos reais mesmo com três pessoas distintas.");

const plainShifts = [
  shift("a", "09:00", "18:00", null),
  shift("b", "10:00", "17:00", null),
];
const legacy = checkPresenceForAssignments(
  operating, two,
  plainShifts.map(s => ({ personId: s.personId, interval: s.interval }))
);
const newChecker = checkPresenceForWorkShifts(date, operating, two, plainShifts);
assert(JSON.stringify(legacy) === JSON.stringify(newChecker),
  "Sem refeições, cobertura com segmentos deve igualar exatamente o validador existente.");

const onlyOpening = checkPresenceForWorkShifts(
  date,
  [{ start: "09:00", end: "09:45" }],
  { minimumAtOpening: 2, minimumDuringOperation: 1, minimumAtClosing: 2 },
  [shift("a", "09:00", "09:45", "09:10", "09:20")]
);
assert(!onlyOpening.valid && onlyOpening.shortages.some(s =>
  s.interval.start === "09:10" &&
  s.required === 2 && s.actual === 0
), "Os mínimos de abertura/fecho sobrepostos respeitam a pausa.");

const shortDay = checkPresenceForWorkShifts(
  date,
  [{ start: "09:00", end: "13:00" }],
  { ...one },
  [shift("a", "09:00", "13:00", null)]
);
assert(shortDay.valid, "Dia de quatro horas sem refeição pode cumprir 1/1/1.");

const duplicate = checkPresenceForWorkShifts(date, operating, one, [
  shift("a"), shift("a", "11:00", "16:00", null),
]);
assert(!duplicate.valid &&
  duplicate.issues.some(s => s.includes("mais de um turno")),
  "A mesma pessoa não pode ter dois turnos no dia.");

const wrongDate: DatedWorkShift = { ...alone, date: "2026-10-27" };
assert(!checkPresenceForWorkShifts(date, operating, one, [wrongDate]).valid,
  "O validador deve rejeitar turnos de outra data.");

assert(!checkPresenceForWorkShifts("2026-02-30", operating, one, [alone]).valid,
  "A data civil deve ser válida.");

assert(!checkPresenceForWorkShifts(
  date, operating, one,
  [shift("a", "09:00", "18:00", "08:00", "09:00")]
).valid, "A pausa não pode ocorrer antes do turno.");

assert(!checkPresenceForWorkShifts(
  date, operating, one,
  [shift("a", "09:00", "18:00", "13:00", "13:00")]
).valid, "Uma pausa sem duração deve ser recusada.");

assert(!checkPresenceForWorkShifts(
  date,
  [{ start: "09:00", end: "12:00" }, { start: "13:00", end: "18:00" }],
  one,
  [shift("a", "09:00", "18:00", "12:00", "13:00")]
).valid, "Um turno não pode atravessar interrupção operacional usando almoço.");

assert(!checkPresenceForWorkShifts(date, [], one, [alone]).valid,
  "Não é permitido escalar pessoas num dia fechado.");

assert(!checkPresenceForWorkShifts(date, [], one, []).valid,
  "O verificador de cobertura necessita de um intervalo operacional aberto.");

const zero: PresenceRequirement = {
  minimumAtOpening: 0,
  minimumDuringOperation: 0,
  minimumAtClosing: 0,
};
assert(checkPresenceForWorkShifts(date, operating, zero, []).valid,
  "Mínimos explícitos zero não requerem atribuições.");

const overlapSamePerson = checkPresenceForWorkingIntervals(
  operating, one, [{
    personId: "a",
    intervals: [
      { start: "09:00", end: "14:00" },
      { start: "13:00", end: "18:00" },
    ],
  }]
);
assert(!overlapSamePerson.valid &&
  overlapSamePerson.issues.some(s => s.includes("sobrepostos")),
  "Intervalos da mesma pessoa não podem sobrepor-se nem contar duas vezes.");

const repeatPerson = checkPresenceForWorkingIntervals(
  operating, one, [
    { personId: "a", intervals: [{ start: "09:00", end: "13:00" }] },
    { personId: "a", intervals: [{ start: "13:00", end: "18:00" }] },
  ]
);
assert(!repeatPerson.valid &&
  repeatPerson.issues.some(s => s.includes("duplicados")),
  "Cada pessoa deve ter um só grupo de intervalos.");

assert(!checkPresenceForWorkingIntervals(
  operating, one,
  [{ personId: "a", intervals: [{ start: "08:00", end: "18:00" }] }]
).valid, "Os segmentos efetivos devem ficar dentro da operação.");

console.log("Work Coverage V0: todos os testes passaram.");
