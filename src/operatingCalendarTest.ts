import type {
  OperatingHoursException,
  SchedulePeriod,
  WeeklyOperatingHours,
} from "./types";
import {
  getDatesInPeriod,
  getOperatingIntervalsForDate,
} from "./utils/operatingCalendar";

const period: SchedulePeriod = {
  startDate: "2026-10-26",
  endDate: "2026-11-01",
};

const dates = getDatesInPeriod(period);

if (dates.length !== 7) {
  throw new Error(
    `Período deveria conter 7 dias, recebeu ${dates.length}`
  );
}

if (
  dates[0] !== "2026-10-26" ||
  dates[6] !== "2026-11-01"
) {
  throw new Error("Datas do período não foram calculadas corretamente");
}

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

let invalidPeriodRejected = false;

try {
  getDatesInPeriod({
    startDate: "2026-11-02",
    endDate: "2026-11-01",
  });
} catch {
  invalidPeriodRejected = true;
}

if (!invalidPeriodRejected) {
  throw new Error("Período invertido deveria ser rejeitado");
}

console.log("Operating Calendar V0: todos os testes passaram.");
