import { generateWeekSchedule, weekAlerts } from "../src/utils/autoSchedule";
import { COVERAGE_CONFIG } from "../src/constants";
import { mondayOf, addDays, dateKey } from "../src/utils/dates";
import type { Colaborador, Schedule } from "../src/types";

const STAFF: Colaborador[] = [
  { id: "1", nome: "Ana", equipa: "vendas" },
  { id: "2", nome: "Bruno", equipa: "vendas" },
  { id: "3", nome: "Carla", equipa: "vendas" },
  { id: "4", nome: "Diogo", equipa: "caixa" },
  { id: "5", nome: "Eva", equipa: "caixa" },
  { id: "6", nome: "Filipe", equipa: "caixa" },
];

const monday = mondayOf(2026, 8, 7);
const schedule: Schedule = {};

const result = generateWeekSchedule(
  monday,
  STAFF,
  COVERAGE_CONFIG,
  schedule
);

const dates = Array.from({ length: 5 }, (_, i) => addDays(monday, i));

console.log("\n=== HORÁRIOS GERADOS ===\n");

for (const date of dates) {
  const k = dateKey(date.getFullYear(), date.getMonth(), date.getDate());

  console.log(
    `${k} (${["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"][date.getDay()]})`
  );

  for (const person of STAFF) {
    const cell = result.schedule[`${person.nome}-${k}`];

    if (!cell) {
      console.log(`  ${person.nome}: —`);
      continue;
    }

    if (cell.type === "Folga") {
      console.log(`  ${person.nome}: FOLGA`);
    } else {
      console.log(
        `  ${person.nome}: ${cell.entry} → ${cell.lunchStart} → ${cell.lunchEnd} → ${cell.exit}`
      );
    }
  }

  console.log();
}

console.log("=== COBERTURA ===\n");

const alerts = weekAlerts(dates, result.schedule, STAFF, COVERAGE_CONFIG);

if (alerts.length === 0) {
  console.log("Sem défices de cobertura.");
} else {
  for (const alert of alerts) {
    console.log(
      `${dateKey(
        alert.date.getFullYear(),
        alert.date.getMonth(),
        alert.date.getDate()
      )} | ${alert.team} | ${alert.inicio}-${alert.fim} | ${alert.have}/${alert.need}`
    );
  }
}

console.log("\n=== AVISOS DO GERADOR ===\n");

console.log(result.avisos);

console.log("\n=== VERIFICAÇÃO DO CALENDÁRIO ===\n");

const saturday = addDays(monday, 5);
const sunday = addDays(monday, 6);

const saturdayKey = dateKey(
  saturday.getFullYear(),
  saturday.getMonth(),
  saturday.getDate()
);

const sundayKey = dateKey(
  sunday.getFullYear(),
  sunday.getMonth(),
  sunday.getDate()
);

const weekendCells = Object.keys(result.schedule).filter((key) => {
  return key.endsWith(`-${saturdayKey}`) || key.endsWith(`-${sundayKey}`);
});

if (weekendCells.length === 0) {
  console.log("OK — não existem células geradas para sábado ou domingo.");
} else {
  console.error(
    `ERRO — existem ${weekendCells.length} células no fim de semana:`
  );
  console.error(weekendCells);
  process.exitCode = 1;
}

console.log("\n=== FIM ===\n");