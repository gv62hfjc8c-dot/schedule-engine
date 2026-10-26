import type {
  PresenceAssignment,
  PresenceRequirement,
  WeeklyOperatingHours,
} from "./types";
import {
  checkPresenceForAssignments,
  checkPresenceAvailabilityCapacity,
  createEmptyWeeklyPresenceRequirements,
  getPresencePhaseWindows,
  PRESENCE_EDGE_WINDOW_MINUTES,
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
assert(isPresenceRequirementValid({ ...requirements, minimumAtOpening: 1 }), "Abertura pode exigir menos do que o período central.");
assert(isPresenceRequirementValid({ ...requirements, minimumAtClosing: 1 }), "Fecho pode exigir menos do que o período central.");
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
  resolvePresenceForDate("2026-10-26", weekly, [{ date: "2026-10-26", requirements: { ...requirements, minimumAtClosing: 1 } }], operating, []).status === "configured",
  "Exceção 1/2/3 com fecho inferior ao centro deve ser válida."
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


const capacityOpeningShort = checkPresenceAvailabilityCapacity(
  operating.monday,
  requirements,
  [
    [{ start: "08:00", end: "16:00" }],
    [{ start: "08:00", end: "16:00" }],
    [{ start: "12:00", end: "20:00" }],
    [{ start: "12:00", end: "20:00" }],
    [{ start: "12:00", end: "20:00" }],
  ]
);
assert(
  !capacityOpeningShort.valid &&
  capacityOpeningShort.shortages.some((item) => item.phase === "opening" && item.actual === 2),
  "Capacidade insuficiente na abertura deve ser detetada."
);

const capacityMiddleShort = checkPresenceAvailabilityCapacity(
  operating.monday,
  requirements,
  [
    [{ start: "08:00", end: "10:00" }],
    [{ start: "08:00", end: "10:00" }],
    [{ start: "08:00", end: "10:00" }],
    [{ start: "18:00", end: "20:00" }],
    [{ start: "18:00", end: "20:00" }],
    [{ start: "18:00", end: "20:00" }],
  ]
);
assert(
  !capacityMiddleShort.valid &&
  capacityMiddleShort.shortages.some((item) => item.phase === "operation"),
  "Capacidade insuficiente no período central deve ser detetada."
);

const capacityDayShort = checkPresenceAvailabilityCapacity(
  operating.tuesday,
  weekly.tuesday!,
  [
    [{ start: "09:00", end: "13:00" }],
    [{ start: "09:00", end: "11:00" }, { start: "11:00", end: "13:00" }],
  ]
);
assert(
  capacityDayShort.valid,
  "Pessoas disponíveis em todo o dia curto podem cobrir os extremos sem duplicar contagem."
);
assert(
  !checkPresenceAvailabilityCapacity(operating.tuesday, weekly.tuesday!, [
    [{ start: "09:00", end: "13:00" }],
  ]).valid,
  "Uma só pessoa não pode satisfazer mínimo de duas em simultâneo."
);

// Independent 30-minute phases: 09:00–09:30, 09:30–17:30, 17:30–18:00.
const oneTwoOne: PresenceRequirement = {
  minimumAtOpening: 1,
  minimumDuringOperation: 2,
  minimumAtClosing: 1,
};
const nineToSix = [{ start: "09:00", end: "18:00" }];
assert(PRESENCE_EDGE_WINDOW_MINUTES === 30, "Cada extremo deve ocupar 30 minutos.");
assert(isPresenceRequirementValid(oneTwoOne), "1/2/1 é configuração válida.");
const phases = getPresencePhaseWindows(nineToSix);
assert(
  JSON.stringify(phases) === JSON.stringify({
    opening: [{ start: "09:00", end: "09:30" }],
    central: [{ start: "09:30", end: "17:30" }],
    closing: [{ start: "17:30", end: "18:00" }],
  }),
  "Os três períodos têm de coincidir exatamente com as fronteiras definidas."
);
const phasedAssignments: PresenceAssignment[] = [
  { personId: "ana", interval: { start: "09:00", end: "17:30" } },
  { personId: "bruno", interval: { start: "09:30", end: "18:00" } },
];
assert(
  checkPresenceForAssignments(nineToSix, oneTwoOne, phasedAssignments).valid,
  "1/2/1: duas pessoas no centro, uma na abertura e outra no fecho são suficientes."
);
assert(
  checkPresenceAvailabilityCapacity(
    nineToSix, oneTwoOne, phasedAssignments.map((a) => [a.interval])
  ).valid,
  "A pré-verificação tem de usar as mesmas três janelas que o validador."
);

const centralShortage = checkPresenceForAssignments(nineToSix, oneTwoOne, [
  { personId: "ana", interval: { start: "09:00", end: "18:00" } },
]);
assert(
  !centralShortage.valid &&
  centralShortage.shortages.length === 1 &&
  centralShortage.shortages[0].phase === "operation" &&
  centralShortage.shortages[0].interval.start === "09:30" &&
  centralShortage.shortages[0].interval.end === "17:30" &&
  centralShortage.shortages[0].required === 2,
  "O centro não pode exigir 2 pessoas na abertura/fecho, nem aceitar 1 no centro."
);
const centralCapacityShortage = checkPresenceAvailabilityCapacity(
  nineToSix,
  oneTwoOne,
  [[{ start: "09:00", end: "18:00" }]]
);
assert(
  centralCapacityShortage.shortages.length === 1 &&
  centralCapacityShortage.shortages[0].phase === "operation" &&
  centralCapacityShortage.shortages[0].interval.start === "09:30" &&
  centralCapacityShortage.shortages[0].interval.end === "17:30",
  "A capacidade insuficiente deve ser reportada apenas no período central."
);

const earlyMiddleShortage = checkPresenceAvailabilityCapacity(
  nineToSix,
  oneTwoOne,
  [
    [{ start: "09:00", end: "18:00" }],
    [{ start: "09:45", end: "17:30" }],
  ]
);
assert(
  !earlyMiddleShortage.valid &&
  earlyMiddleShortage.shortages[0].phase === "operation" &&
  earlyMiddleShortage.shortages[0].interval.start === "09:30" &&
  earlyMiddleShortage.shortages[0].interval.end === "09:45",
  "A pré-verificação tem de detetar uma lacuna parcial após as 09:30."
);

// Split operating days preserve closed gaps and only use the outermost edges.
const splitPhases = getPresencePhaseWindows(operating.wednesday);
assert(
  JSON.stringify(splitPhases) === JSON.stringify({
    opening: [{ start: "08:00", end: "08:30" }],
    central: [
      { start: "08:30", end: "12:00" },
      { start: "14:00", end: "19:30" },
    ],
    closing: [{ start: "19:30", end: "20:00" }],
  }),
  "Em operações partidas, apenas o primeiro e o último extremo são especiais."
);
assert(
  checkPresenceForAssignments(operating.wednesday, oneTwoOne, [
    { personId: "a", interval: { start: "08:00", end: "12:00" } },
    { personId: "b", interval: { start: "08:30", end: "12:00" } },
    { personId: "c", interval: { start: "14:00", end: "20:00" } },
    { personId: "d", interval: { start: "14:00", end: "19:30" } },
  ]).valid,
  "Dois períodos abertos podem ser cobertos sem exigir presença no intervalo fechado."
);

// For days shorter than 60 minutes the opening and closing windows overlap.
// The stronger of their two hard minima applies; never use the central value
// in minutes that belong to an edge window.
const shortOperating = [{ start: "09:00", end: "09:45" }];
const shortRequirements: PresenceRequirement = {
  minimumAtOpening: 1,
  minimumDuringOperation: 3,
  minimumAtClosing: 2,
};
const shortPhases = getPresencePhaseWindows(shortOperating);
assert(
  JSON.stringify(shortPhases) === JSON.stringify({
    opening: [{ start: "09:00", end: "09:30" }],
    central: [],
    closing: [{ start: "09:15", end: "09:45" }],
  }),
  "Em dias curtos, os extremos podem sobrepor-se sem existir centro."
);
const shortCheck = checkPresenceForAssignments(shortOperating, shortRequirements, [
  { personId: "a", interval: { start: "09:00", end: "09:45" } },
]);
assert(
  !shortCheck.valid &&
  shortCheck.shortages.every((shortage) => shortage.required === 2) &&
  shortCheck.shortages[0].interval.start === "09:15" &&
  shortCheck.shortages[0].interval.end === "09:30",
  "Na sobreposição, aplica-se o máximo dos mínimos de abertura e fecho."
);
assert(
  checkPresenceForAssignments(shortOperating, shortRequirements, [
    { personId: "a", interval: { start: "09:00", end: "09:45" } },
    { personId: "b", interval: { start: "09:15", end: "09:45" } },
  ]).valid,
  "Dois colaboradores resolvem a sobreposição e o fecho do dia curto."
);
assert(
  !checkPresenceAvailabilityCapacity(shortOperating, shortRequirements, [
    [{ start: "09:00", end: "09:45" }],
  ]).valid,
  "A pré-verificação também respeita o mínimo mais exigente da sobreposição."
);
assert(
  checkPresenceForAssignments(
    [{ start: "09:00", end: "09:20" }],
    { minimumAtOpening: 0, minimumDuringOperation: 3, minimumAtClosing: 1 },
    [{ personId: "a", interval: { start: "09:00", end: "09:20" } }]
  ).valid,
  "Operação de 20 minutos aplica o máximo entre abertura e fecho, sem centro."
);

// Day boundaries are validated in half-open intervals [start, end).
const exactBoundary = checkPresenceForAssignments(nineToSix, oneTwoOne, [
  { personId: "a", interval: { start: "09:00", end: "17:30" } },
  { personId: "b", interval: { start: "09:30", end: "17:30" } },
]);
assert(
  !exactBoundary.valid &&
  exactBoundary.shortages[0].phase === "closing" &&
  exactBoundary.shortages[0].interval.start === "17:30",
  "Um turno terminado às 17:30 não conta para o período de fecho."
);

console.log("Presence phase windows V1: todos os testes passaram.");
