import type {
  PresenceAssignment,
  PresenceRequirement,
  WeeklyOperatingHours,
} from "./types";
import {
  checkPresenceForAssignments,
  createEmptyWeeklyPresenceRequirements,
  isPresenceRequirementValid,
  resolvePresenceForDate,
} from "./utils/presence";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const operating: WeeklyOperatingHours = {
  monday: [{ start: "08:00", end: "20:00" }],
  tuesday: [{ start: "09:00", end: "13:00" }],
  wednesday: [
    { start: "08:00", end: "12:00" },
    { start: "14:00", end: "20:00" },
  ],
  thursday: [],
  friday: [],
  saturday: [],
  sunday: [],
};

const weekly = createEmptyWeeklyPresenceRequirements();
assert(
  Object.values(weekly).every((item) => item === null),
  "Novo padrão deve permanecer por configurar."
);

const requirements: PresenceRequirement = {
  minimumAtOpening: 3,
  minimumDuringOperation: 2,
  minimumAtClosing: 3,
};
weekly.monday = requirements;
weekly.tuesday = { minimumAtOpening: 2, minimumDuringOperation: 2, minimumAtClosing: 2 };
weekly.wednesday = requirements;

assert(isPresenceRequirementValid(requirements), "Regra válida recusada.");
assert(isPresenceRequirementValid({ minimumAtOpening: 0, minimumAtClosing: 0, minimumDuringOperation: 0 }), "Zero explícito deve ser válido.");
assert(!isPresenceRequirementValid({ ...requirements, minimumAtOpening: 1 }), "Abertura abaixo do mínimo base deve ser inválida.");
assert(!isPresenceRequirementValid({ ...requirements, minimumAtClosing: 1 }), "Fecho abaixo do mínimo base deve ser inválido.");
assert(!isPresenceRequirementValid({ ...requirements, minimumAtClosing: -1 }), "Negativos inválidos.");
assert(!isPresenceRequirementValid({ ...requirements, minimumAtClosing: 2.5 }), "Decimais inválidos.");

const monday = resolvePresenceForDate("2026-10-26", weekly, [], operating, []);
assert(monday.status === "configured" && monday.requirements.minimumAtOpening === 3, "Segunda deve herdar padrão.");
assert(resolvePresenceForDate("2026-10-29", weekly, [], operating, []).status === "closed", "Dia fechado não exige presença.");
assert(resolvePresenceForDate("2026-10-30", weekly, [], { ...operating, friday: [{ start: "09:00", end: "17:00" }] }, []).status === "unconfigured", "Dia aberto sem regra é incompleto.");

const exceptions = [
  { date: "2026-10-26", requirements: { minimumAtOpening: 1, minimumDuringOperation: 1, minimumAtClosing: 1 } },
];
const override = resolvePresenceForDate("2026-10-26", weekly, exceptions, operating, []);
assert(override.status === "configured" && override.requirements.minimumAtOpening === 1, "Exceção deve substituir padrão.");

assert(
  resolvePresenceForDate("2026-10-26", weekly, [{ date: "2026-10-26", requirements: null }], operating, []).status === "unconfigured",
  "Exceção nula não deve herdar o padrão."
);
assert(
  resolvePresenceForDate("2026-10-26", weekly, [...exceptions, ...exceptions], operating, []).status === "invalid",
  "Exceções duplicadas não podem ser silenciosamente ignoradas."
);
assert(
  resolvePresenceForDate("2026-10-26", weekly, exceptions, operating, [{ date: "2026-10-26", intervals: [] }]).status === "closed",
  "Fecho excecional elimina requisito operacional."
);
assert(
  resolvePresenceForDate("2026-10-26", weekly, [{ date: "2026-10-26", requirements: { ...requirements, minimumAtClosing: 1 } }], operating, []).status === "invalid",
  "Configuração de exceção incoerente deve ser inválida."
);

const people = (count: number, start: string, end: string): PresenceAssignment[] =>
  Array.from({ length: count }, (_, i) => ({
    personId: `p${i}`,
    interval: { start, end },
  }));

const eightHours = [
  ...people(3, "08:00", "16:00"),
  ...people(4, "10:00", "18:00").map((a,i) => ({ ...a, personId: `m${i}` })),
  ...people(3, "12:00", "20:00").map((a,i) => ({ ...a, personId: `f${i}` })),
];
assert(checkPresenceForAssignments(operating.monday, requirements, eightHours).valid, "Turnos sobrepostos corretos devem cumprir os mínimos.");

const noMiddle = [
  ...people(3, "08:00", "10:00"),
  ...people(3, "18:00", "20:00").map((a,i) => ({ ...a, personId: `f${i}` })),
];
const holes = checkPresenceForAssignments(operating.monday, requirements, noMiddle);
assert(!holes.valid && holes.shortages.some(s => s.phase === "operation" && s.interval.start === "10:00" && s.interval.end === "18:00"), "Buraco durante o dia deve ser detetado.");

const openShortage = checkPresenceForAssignments(operating.monday, requirements, [
  ...people(2, "08:00", "16:00"),
  ...people(3, "12:00", "20:00").map((a,i) => ({ ...a, personId: `f${i}` })),
]);
assert(!openShortage.valid && openShortage.shortages.some(s => s.phase === "opening"), "Falta na abertura deve ser detetada.");

const closeShortage = checkPresenceForAssignments(operating.monday, requirements, [
  ...people(3, "08:00", "16:00"),
  ...people(2, "12:00", "20:00").map((a,i) => ({ ...a, personId: `f${i}` })),
]);
assert(!closeShortage.valid && closeShortage.shortages.some(s => s.phase === "closing"), "Falta no fecho deve ser detetada.");

assert(
  checkPresenceForAssignments(operating.tuesday, weekly.tuesday!, people(2, "09:00", "13:00")).valid,
  "As mesmas pessoas podem satisfazer abertura, operação e fecho num dia curto."
);
assert(
  !checkPresenceForAssignments(operating.tuesday, weekly.tuesday!, [
    ...people(1, "09:00", "13:00"), ...people(1, "09:00", "13:00"),
  ]).valid,
  "Pessoa duplicada não pode contar duas vezes."
);
assert(
  !checkPresenceForAssignments(operating.wednesday, requirements, people(3, "08:00", "20:00")).valid,
  "Turno não pode atravessar encerramento operacional."
);
assert(
  checkPresenceForAssignments(operating.wednesday, requirements, [
    ...people(3, "08:00", "12:00"),
    ...people(3, "14:00", "20:00").map((a,i)=>({ ...a, personId: `f${i}` })),
  ]).valid,
  "Não deve ser exigida presença durante interrupções da operação."
);
assert(
  !checkPresenceForAssignments([{ start: "08:00", end: "20:00" }, { start: "18:00", end: "21:00" }], requirements, []).valid,
  "Operação sobreposta deve ser recusada."
);
assert(
  !checkPresenceForAssignments([{ start: "foo", end: "20:00" }], requirements, []).valid,
  "Horas inválidas devem ser recusadas."
);

console.log("Presence V0: todos os testes passaram.");
