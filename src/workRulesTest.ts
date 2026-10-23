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

const shortOpeningShift = createOpeningShift(
  operation,
  13 * 60
);
const shortClosingShift = createClosingShift(
  operation,
  13 * 60
);

if (
  !shortOpeningShift ||
  !shortClosingShift ||
  shortOpeningShift.start !== "08:00" ||
  shortOpeningShift.end !== "20:00" ||
  shortClosingShift.start !== "08:00" ||
  shortClosingShift.end !== "20:00"
) {
  throw new Error(
    "Num dia mais curto do que a duração padrão, o turno deveria ajustar-se ao período operacional"
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

const splitOpeningShift = createOpeningShift(
  splitOperation,
  8 * 60
);
const splitClosingShift = createClosingShift(
  splitOperation,
  8 * 60
);

if (
  !splitOpeningShift ||
  splitOpeningShift.start !== "08:00" ||
  splitOpeningShift.end !== "12:00" ||
  !splitClosingShift ||
  splitClosingShift.start !== "14:00" ||
  splitClosingShift.end !== "20:00"
) {
  throw new Error(
    "Turnos contínuos devem ajustar-se ao respetivo período operacional sem atravessar fechos"
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
