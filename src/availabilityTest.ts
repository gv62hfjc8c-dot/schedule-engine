import {
  createPersonAvailability,
  getAvailabilityIntervalsForDate,
  isAvailableForInterval,
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

console.log("Availability V0: todos os testes passaram.");
