import type { Pessoa } from "../src/types";
import { generateSchedule } from "../src/utils/generateSchedule";
import { validateSchedule } from "../src/utils/validateSchedule";

const WEEK_START = "2026-09-14";

const pessoas: Pessoa[] = [
  { id: "1", nome: "Ana" },
  { id: "2", nome: "Bruno", eligibleShiftIds: ["A", "C"] },
  { id: "3", nome: "Carla" },
  { id: "4", nome: "Duarte", eligibleShiftIds: ["B"] },
  { id: "5", nome: "Eva" },
  { id: "6", nome: "Filipe" },
];

const schedule = generateSchedule(pessoas, WEEK_START);
const validation = validateSchedule(
  pessoas,
  schedule,
  WEEK_START
);

console.log("\n=== SCHEDULE ENGINE V0 ===\n");

for (const pessoa of pessoas) {
  const mondayShift =
    schedule[`${pessoa.id}::${WEEK_START}`]?.shift ?? "—";

  console.log(
    `${pessoa.nome}: turno ${mondayShift}`
  );
}

console.log("\n=== VALIDAÇÃO ===\n");

if (!validation.valid) {
  for (const error of validation.errors) {
    console.error(`- ${error}`);
  }

  process.exitCode = 1;
} else {
  console.log("OK — horário válido segundo as hard constraints V0.");
}
