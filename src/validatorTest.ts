import type { Pessoa } from "./types";
import { generateSchedule } from "./utils/generateSchedule";
import { validateSchedule } from "./utils/validateSchedule";
import { SHIFTS } from "./utils/shifts";

const WEEK_START = "2026-09-14";

const pessoas: Pessoa[] = [
  { id: "p1", nome: "Pessoa 1" },
  { id: "p2", nome: "Pessoa 2" },
  { id: "p3", nome: "Pessoa 3" },
];

const completeSchedule = generateSchedule(pessoas, WEEK_START);

const completeResult = validateSchedule(
  pessoas,
  completeSchedule,
  WEEK_START
);

if (!completeResult.valid) {
  throw new Error(
    `Horário completo deveria ser válido: ${completeResult.errors.join(", ")}`
  );
}

console.log("✓ horário completo é válido");

const incompleteSchedule = {
  ...completeSchedule,
};

delete incompleteSchedule["p2::2026-09-16"];

const incompleteResult = validateSchedule(
  pessoas,
  incompleteSchedule,
  WEEK_START
);

if (incompleteResult.valid) {
  throw new Error("Horário incompleto deveria ser inválido");
}

const expectedError = "p2::2026-09-16: célula em falta";

if (!incompleteResult.errors.includes(expectedError)) {
  throw new Error(
    `Erro esperado não encontrado. Recebido: ${incompleteResult.errors.join(", ")}`
  );
}

const expectedWeeklyError =
  "p2: total semanal de 1920 minutos, esperado 2400";

if (!incompleteResult.errors.includes(expectedWeeklyError)) {
  throw new Error(
    `Erro semanal esperado não encontrado. Recebido: ${incompleteResult.errors.join(", ")}`
  );
}

console.log("✓ célula em falta é detetada");
console.log("✓ total semanal inferior a 2400 minutos é detetado");

const inconsistentSchedule = {
  ...completeSchedule,
  "p1::2026-09-16": { shift: "B" as const },
};

const inconsistentResult = validateSchedule(
  pessoas,
  inconsistentSchedule,
  WEEK_START
);

if (inconsistentResult.valid) {
  throw new Error("Horário com mudança de turno deveria ser inválido");
}

const expectedShiftError =
  "p1::2026-09-16: esperado turno A, recebido B";

if (!inconsistentResult.errors.includes(expectedShiftError)) {
  throw new Error(
    `Erro de turno esperado não encontrado. Recebido: ${inconsistentResult.errors.join(", ")}`
  );
}

console.log("✓ mudança de turno durante a semana é detetada");

const independentSchedule = {
  ...completeSchedule,
  "p1::2026-09-14": { shift: "C" as const },
  "p1::2026-09-15": { shift: "C" as const },
  "p1::2026-09-16": { shift: "C" as const },
  "p1::2026-09-17": { shift: "C" as const },
  "p1::2026-09-18": { shift: "C" as const },
};

const independentResult = validateSchedule(
  pessoas,
  independentSchedule,
  WEEK_START
);

if (!independentResult.valid) {
  throw new Error(
    `Turno C consistente deveria ser válido: ${independentResult.errors.join(", ")}`
  );
}

console.log("✓ validator é independente do round-robin");

const invalidShiftSchedule = {
  ...completeSchedule,
} as unknown as Record<string, { shift: "A" | "B" | "C" }>;

(invalidShiftSchedule as Record<string, { shift: string }>)[
  "p1::2026-09-16"
] = {
  shift: "X",
};

const invalidShiftResult = validateSchedule(
  pessoas,
  invalidShiftSchedule,
  WEEK_START
);

if (invalidShiftResult.valid) {
  throw new Error("Horário com turno inexistente deveria ser inválido");
}

const expectedInvalidShiftError =
  "p1::2026-09-16: turno X inexistente";

if (!invalidShiftResult.errors.includes(expectedInvalidShiftError)) {
  throw new Error(
    `Erro de turno inexistente não encontrado. Recebido: ${invalidShiftResult.errors.join(", ")}`
  );
}

console.log("✓ turno inexistente é detetado");

const shiftA = SHIFTS.find((shift) => shift.id === "A");

if (!shiftA) {
  throw new Error("Turno A não encontrado");
}

const originalExit = shiftA.exit;

try {
  shiftA.exit = "17:00";

  const invalidHoursResult = validateSchedule(
    pessoas,
    completeSchedule,
    WEEK_START
  );

  if (invalidHoursResult.valid) {
    throw new Error(
      "Horário com turno de duração inválida deveria ser inválido"
    );
  }

  const expectedHoursError =
    "p1::2026-09-14: turno A tem 450 minutos efetivos, esperado 480";

  if (!invalidHoursResult.errors.includes(expectedHoursError)) {
    throw new Error(
      `Erro de duração esperado não encontrado. Recebido: ${invalidHoursResult.errors.join(", ")}`
    );
  }

  console.log("✓ turno com duração efetiva inválida é detetado");
} finally {
  shiftA.exit = originalExit;
}

const pessoasWithEligibility: Pessoa[] = [
  {
    id: "p1",
    nome: "Pessoa 1",
    eligibleShiftIds: ["B", "C"],
  },
  {
    id: "p2",
    nome: "Pessoa 2",
  },
  {
    id: "p3",
    nome: "Pessoa 3",
  },
];

const eligibilitySchedule = {
  ...completeSchedule,
};

const eligibilityResult = validateSchedule(
  pessoasWithEligibility,
  eligibilitySchedule,
  WEEK_START
);

if (eligibilityResult.valid) {
  throw new Error(
    "Horário com pessoa atribuída a turno não elegível deveria ser inválido"
  );
}

const expectedEligibilityError =
  "p1::2026-09-14: turno A não elegível para p1";

if (!eligibilityResult.errors.includes(expectedEligibilityError)) {
  throw new Error(
    `Erro de elegibilidade esperado não encontrado. Recebido: ${eligibilityResult.errors.join(", ")}`
  );
}

console.log("✓ turno não elegível é detetado");

const pessoasWithNoEligibleShifts: Pessoa[] = [
  {
    id: "p1",
    nome: "Pessoa 1",
    eligibleShiftIds: [],
  },
  {
    id: "p2",
    nome: "Pessoa 2",
  },
  {
    id: "p3",
    nome: "Pessoa 3",
  },
];

const noEligibleShiftsSchedule = generateSchedule(
  pessoasWithNoEligibleShifts,
  WEEK_START
);

const noEligibleShiftsResult = validateSchedule(
  pessoasWithNoEligibleShifts,
  noEligibleShiftsSchedule,
  WEEK_START
);

if (noEligibleShiftsResult.valid) {
  throw new Error(
    "Pessoa sem turnos elegíveis não deveria ter horário válido"
  );
}

const expectedNoEligibleShiftsError =
  "p1::2026-09-14: turno A não elegível para p1";

if (
  !noEligibleShiftsResult.errors.includes(
    expectedNoEligibleShiftsError
  )
) {
  throw new Error(
    `Erro esperado para pessoa sem turnos elegíveis não encontrado. Recebido: ${noEligibleShiftsResult.errors.join(", ")}`
  );
}

console.log("✓ lista vazia significa nenhum turno elegível");

const pessoasWithExplicitEligibility: Pessoa[] = [
  {
    id: "p1",
    nome: "Pessoa 1",
    eligibleShiftIds: ["A", "C"],
  },
  {
    id: "p2",
    nome: "Pessoa 2",
  },
  {
    id: "p3",
    nome: "Pessoa 3",
  },
];

const explicitEligibilitySchedule = generateSchedule(
  pessoasWithExplicitEligibility,
  WEEK_START
);

const explicitEligibilityResult = validateSchedule(
  pessoasWithExplicitEligibility,
  explicitEligibilitySchedule,
  WEEK_START
);

if (!explicitEligibilityResult.valid) {
  throw new Error(
    `Turno explicitamente elegível deveria ser válido: ${explicitEligibilityResult.errors.join(", ")}`
  );
}

console.log("✓ turno explicitamente elegível é aceite");

console.log(
  "Validator V0 — HC1 + HC2 + HC3 + HC4 + HC5 + HC6 + independência: todos os testes passaram."
);