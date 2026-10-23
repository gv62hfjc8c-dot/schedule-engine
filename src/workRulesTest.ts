import {
  canPersonWorkContinuousShift,
  createClosingShift,
  createOpeningShift,
  getIntervalDurationMinutes,
  isShiftWithinOperation,
  isValidShiftDurationMinutes,
} from "./utils/workRules";
import {
  createPersonAvailability,
  setWeeklyAvailability,
} from "./utils/availability";

const operation = [
  {
    start: "08:00",
    end: "20:00",
  },
];

const openingShift = createOpeningShift(
  operation,
  8 * 60
);

if (
  !openingShift ||
  openingShift.start !== "08:00" ||
  openingShift.end !== "16:00"
) {
  throw new Error(
    "Turno de abertura deveria ser 08:00–16:00"
  );
}

const closingShift = createClosingShift(
  operation,
  8 * 60
);

if (
  !closingShift ||
  closingShift.start !== "12:00" ||
  closingShift.end !== "20:00"
) {
  throw new Error(
    "Turno de fecho deveria ser 12:00–20:00"
  );
}

if (
  getIntervalDurationMinutes(openingShift) !==
  8 * 60
) {
  throw new Error(
    "Turno de abertura deveria ter 8 horas contínuas"
  );
}

if (
  !isShiftWithinOperation(
    openingShift,
    operation
  ) ||
  !isShiftWithinOperation(
    closingShift,
    operation
  )
) {
  throw new Error(
    "Turnos de abertura e fecho deveriam caber na operação"
  );
}

if (
  createOpeningShift(operation, 13 * 60) !==
    null ||
  createClosingShift(operation, 13 * 60) !==
    null
) {
  throw new Error(
    "Turno maior do que o período operacional deveria ser impossível"
  );
}

const splitOperation = [
  {
    start: "08:00",
    end: "12:00",
  },
  {
    start: "14:00",
    end: "20:00",
  },
];

if (
  createOpeningShift(splitOperation, 8 * 60) !==
    null ||
  createClosingShift(splitOperation, 8 * 60) !==
    null
) {
  throw new Error(
    "Turno contínuo não pode atravessar um período em que a operação está fechada"
  );
}

if (
  !isValidShiftDurationMinutes(480) ||
  isValidShiftDurationMinutes(0) ||
  isValidShiftDurationMinutes(null)
) {
  throw new Error(
    "Validação de duração de turno falhou"
  );
}

let availability =
  createPersonAvailability("p1");

availability = setWeeklyAvailability(
  availability,
  "monday",
  [
    {
      start: "08:00",
      end: "16:00",
    },
  ]
);

const weeklyOperatingHours = {
  monday: operation,
  tuesday: [],
  wednesday: [],
  thursday: [],
  friday: [],
  saturday: [],
  sunday: [],
};

if (
  !canPersonWorkContinuousShift(
    "2026-10-26",
    openingShift,
    availability,
    weeklyOperatingHours,
    []
  )
) {
  throw new Error(
    "Pessoa disponível 08:00–16:00 deveria poder fazer a abertura"
  );
}

if (
  canPersonWorkContinuousShift(
    "2026-10-26",
    closingShift,
    availability,
    weeklyOperatingHours,
    []
  )
) {
  throw new Error(
    "Pessoa indisponível depois das 16:00 não deveria poder fazer o fecho"
  );
}

console.log(
  "Work Rules V0: todos os testes passaram."
);
