import type { Pessoa, ShiftId } from "./types";
import { generateSchedule } from "./utils/generateSchedule";

const WEEK_START = "2026-09-14";

function createPessoas(count: number): Pessoa[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `p${index + 1}`,
    nome: `Pessoa ${index + 1}`,
  }));
}

function testCase(
  count: number,
  expectedShifts: ShiftId[]
): void {
  const pessoas = createPessoas(count);
  const schedule = generateSchedule(pessoas, WEEK_START);

  const expectedCellCount = count * 5;
  const actualCellCount = Object.keys(schedule).length;

  if (actualCellCount !== expectedCellCount) {
    throw new Error(
      `${count} pessoas: esperadas ${expectedCellCount} células, recebidas ${actualCellCount}`
    );
  }

  const expectedDates = [
  "2026-09-14",
  "2026-09-15",
  "2026-09-16",
  "2026-09-17",
  "2026-09-18",
];

for (let index = 0; index < pessoas.length; index++) {
  const pessoa = pessoas[index];
  const expectedShift = expectedShifts[index];

  for (const date of expectedDates) {
    const scheduleKey = `${pessoa.id}::${date}`;
    const actualShift = schedule[scheduleKey]?.shift;

    if (actualShift !== expectedShift) {
      throw new Error(
        `${scheduleKey}: esperado turno ${expectedShift}, recebido ${actualShift}`
      );
    }
  }
}

  console.log(`✓ ${count} pessoas`);
}

testCase(0, []);
testCase(1, ["A"]);
testCase(2, ["A", "B"]);
testCase(3, ["A", "B", "C"]);
testCase(6, ["A", "B", "C", "A", "B", "C"]);
testCase(10, ["A", "B", "C", "A", "B", "C", "A", "B", "C", "A"]);

const pessoasWithEligibility: Pessoa[] = [
  {
    id: "p1",
    nome: "Pessoa 1",
  },
  {
    id: "p2",
    nome: "Pessoa 2",
    eligibleShiftIds: ["A", "C"],
  },
  {
    id: "p3",
    nome: "Pessoa 3",
  },
];

const eligibilitySchedule = generateSchedule(
  pessoasWithEligibility,
  WEEK_START
);

const p2Shift =
  eligibilitySchedule["p2::2026-09-14"]?.shift;

if (p2Shift !== "C") {
  throw new Error(
    `p2: esperado turno elegível C, recebido ${p2Shift}`
  );
}

console.log("✓ generator respeita elegibilidade de turno");

const pessoasWithoutEligibleShifts: Pessoa[] = [
  {
    id: "p1",
    nome: "Pessoa 1",
    eligibleShiftIds: [],
  },
];

const noEligibleSchedule = generateSchedule(
  pessoasWithoutEligibleShifts,
  WEEK_START
);

if (Object.keys(noEligibleSchedule).length !== 0) {
  throw new Error(
    "Pessoa sem turnos elegíveis não deveria receber qualquer atribuição"
  );
}

console.log("✓ generator não viola elegibilidade quando não existe solução");

console.log("Generator V0: todos os testes passaram.");