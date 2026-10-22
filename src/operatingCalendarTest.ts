import type {
  OperatingHoursException,
  WeeklyOperatingHours,
} from "./types";
import {
  getOperatingIntervalsForDate,
  getWeekday,
} from "./utils/operatingCalendar";

const weeklyOperatingHours: WeeklyOperatingHours = {
  monday: [{ start: "09:00", end: "18:00" }],
  tuesday: [{ start: "09:00", end: "18:00" }],
  wednesday: [{ start: "09:00", end: "18:00" }],
  thursday: [{ start: "09:00", end: "18:00" }],
  friday: [{ start: "09:00", end: "18:00" }],
  saturday: [{ start: "09:00", end: "13:00" }],
  sunday: [],
};

const exceptions: OperatingHoursException[] = [
  {
    date: "2026-10-28",
    intervals: [
      { start: "09:00", end: "13:00" },
      { start: "15:00", end: "19:00" },
    ],
  },
  {
    date: "2026-11-01",
    intervals: [{ start: "10:00", end: "14:00" }],
  },
];

if (getWeekday("2026-10-26") !== "monday") {
  throw new Error("Dia da semana não foi calculado corretamente");
}

const monday = getOperatingIntervalsForDate(
  "2026-10-26",
  weeklyOperatingHours,
  exceptions
);

if (
  monday.length !== 1 ||
  monday[0].start !== "09:00" ||
  monday[0].end !== "18:00"
) {
  throw new Error("Horário semanal não foi aplicado corretamente");
}

const exception = getOperatingIntervalsForDate(
  "2026-10-28",
  weeklyOperatingHours,
  exceptions
);

if (
  exception.length !== 2 ||
  exception[1].start !== "15:00" ||
  exception[1].end !== "19:00"
) {
  throw new Error("Exceção por data não substituiu o horário semanal");
}

const sundayException = getOperatingIntervalsForDate(
  "2026-11-01",
  weeklyOperatingHours,
  exceptions
);

if (
  sundayException.length !== 1 ||
  sundayException[0].start !== "10:00"
) {
  throw new Error("Exceção não abriu corretamente um dia normalmente fechado");
}

let invalidDateRejected = false;

try {
  getWeekday("2026-02-31");
} catch {
  invalidDateRejected = true;
}

if (!invalidDateRejected) {
  throw new Error("Data inválida deveria ser rejeitada");
}

console.log("Operating Calendar V0: todos os testes passaram.");
