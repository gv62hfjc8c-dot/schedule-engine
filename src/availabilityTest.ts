import {
  createPersonAvailability,
  getAvailabilityIntervalsForDate,
  getSchedulableIntervalsForDate,
  isAvailableForInterval,
  isSchedulableForInterval,
  setAvailabilityExceptions,
  setWeeklyAvailability,
} from "./utils/availability";

let availability = createPersonAvailability("p1");

if (
  Object.values(availability.weeklyAvailability).some(
    (intervals) => intervals.length > 0
  )
) {
  throw new Error("Nova disponibilidade deveria começar vazia");
}

availability = setWeeklyAvailability(
  availability,
  "monday",
  [{ start: "09:00", end: "18:00" }]
);

const monday = getAvailabilityIntervalsForDate(
  "2026-10-26",
  availability
);

if (
  monday.length !== 1 ||
  monday[0]?.start !== "09:00" ||
  monday[0]?.end !== "18:00"
) {
  throw new Error("Disponibilidade semanal não foi resolvida");
}

if (
  !isAvailableForInterval(
    "2026-10-26",
    { start: "10:00", end: "12:00" },
    availability
  )
) {
  throw new Error("Intervalo contido deveria estar disponível");
}

if (
  isAvailableForInterval(
    "2026-10-26",
    { start: "08:00", end: "10:00" },
    availability
  )
) {
  throw new Error(
    "Intervalo parcialmente fora não deveria estar disponível"
  );
}

availability = setAvailabilityExceptions(
  availability,
  [
    {
      date: "2026-10-26",
      intervals: [],
    },
    {
      date: "2026-10-27",
      intervals: [{ start: "14:00", end: "18:00" }],
    },
  ]
);

if (
  getAvailabilityIntervalsForDate(
    "2026-10-26",
    availability
  ).length !== 0
) {
  throw new Error("Exceção deveria substituir a semana");
}

if (
  !isAvailableForInterval(
    "2026-10-27",
    { start: "15:00", end: "17:00" },
    availability
  )
) {
  throw new Error("Exceção disponível deveria ser respeitada");
}

if (
  isAvailableForInterval(
    "2026-10-27",
    { start: "09:00", end: "10:00" },
    availability
  )
) {
  throw new Error("Fora da exceção deveria ser indisponível");
}

const weeklyOperatingHours = {
  monday: [{ start: "10:00", end: "17:00" }],
  tuesday: [{ start: "09:00", end: "18:00" }],
  wednesday: [],
  thursday: [],
  friday: [],
  saturday: [],
  sunday: [],
};

const operationAwareAvailability = setWeeklyAvailability(
  createPersonAvailability("p2"),
  "monday",
  [{ start: "09:00", end: "18:00" }]
);

const schedulableMonday = getSchedulableIntervalsForDate(
  "2026-10-26",
  operationAwareAvailability,
  weeklyOperatingHours,
  []
);

if (
  schedulableMonday.length !== 1 ||
  schedulableMonday[0]?.start !== "10:00" ||
  schedulableMonday[0]?.end !== "17:00"
) {
  throw new Error(
    "Tempo escalável deveria ser a interseção com o calendário operacional"
  );
}

if (
  isSchedulableForInterval(
    "2026-10-26",
    { start: "09:00", end: "10:00" },
    operationAwareAvailability,
    weeklyOperatingHours,
    []
  )
) {
  throw new Error(
    "Não deveria ser escalável fora do horário operacional"
  );
}

const sundayAvailability = setWeeklyAvailability(
  createPersonAvailability("p3"),
  "sunday",
  [{ start: "09:00", end: "18:00" }]
);

if (
  isSchedulableForInterval(
    "2026-11-01",
    { start: "10:00", end: "12:00" },
    sundayAvailability,
    weeklyOperatingHours,
    []
  )
) {
  throw new Error(
    "Pessoa não pode ser escalada num dia em que a operação está fechada"
  );
}

const sundayOpeningException = [
  {
    date: "2026-11-01",
    intervals: [{ start: "10:00", end: "14:00" }],
  },
];

if (
  !isSchedulableForInterval(
    "2026-11-01",
    { start: "11:00", end: "13:00" },
    sundayAvailability,
    weeklyOperatingHours,
    sundayOpeningException
  )
) {
  throw new Error(
    "Exceção operacional aberta deveria permitir interseção com disponibilidade"
  );
}

console.log("Availability V0: todos os testes passaram.");
