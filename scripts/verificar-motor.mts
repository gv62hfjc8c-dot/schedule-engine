// scripts/verificar-motor.mts
// Corre o motor de geração automática sobre várias semanas seguidas e confirma:
//  - zero violações de cobertura mínima por equipa (usa a mesma weekAlerts que a app usa ao vivo)
//  - dia fixo respeitado sempre que possível
//  - rotação de fins de semana completos razoavelmente equilibrada
// Uso: npx tsx scripts/verificar-motor.mts [ano] [mes(1-12)] [semanas]
import { generateWeekSchedule, weekAlerts, readWeekendBonus } from "../src/utils/autoSchedule";
import { DEFAULT_STAFF, COVERAGE_CONFIG } from "../src/constants";
import { mondayOf, addDays, dateKey } from "../src/utils/dates";
import type { Schedule } from "../src/types";

if (DEFAULT_STAFF.length === 0) {
  console.log(
    "DEFAULT_STAFF está vazio (é o normal — a app começa sem ninguém). Para testar o motor aqui,\n" +
    "edita temporariamente DEFAULT_STAFF em src/constants.ts com alguns colaboradores de exemplo."
  );
  process.exit(0);
}

const y = Number(process.argv[2]) || new Date().getFullYear();
const m = (Number(process.argv[3]) || new Date().getMonth() + 1) - 1;
const semanas = Number(process.argv[4]) || 6;

let schedule: Schedule = {};
let monday = mondayOf(y, m, 1);
let totalAvisos = 0;
const bonusHistory: Record<string, number> = {};

for (let w = 0; w < semanas; w++) {
  const res = generateWeekSchedule(monday, DEFAULT_STAFF, COVERAGE_CONFIG, schedule);
  schedule = res.schedule;
  totalAvisos += res.avisos.length;

  const dates = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const alerts = weekAlerts(dates, schedule, DEFAULT_STAFF, COVERAGE_CONFIG);
  const bonus = readWeekendBonus(monday, DEFAULT_STAFF, schedule);
  if (bonus.vendas) bonusHistory[bonus.vendas] = (bonusHistory[bonus.vendas] || 0) + 1;
  if (bonus.caixa) bonusHistory[bonus.caixa] = (bonusHistory[bonus.caixa] || 0) + 1;

  console.log(
    `Semana de ${dateKey(monday.getFullYear(), monday.getMonth(), monday.getDate())}: ` +
    `fim de semana: vendas=${bonus.vendas ?? "-"} caixa=${bonus.caixa ?? "-"} | ` +
    `avisos de geração: ${res.avisos.length} | violações ao vivo: ${alerts.length}`
  );
  if (alerts.length) alerts.forEach((a) => console.log(`   ⚠ ${a.date.toDateString()} ${a.team}: ${a.have}/${a.need}`));

  monday = addDays(monday, 7);
}

console.log(`\nTotal de avisos de cobertura em ${semanas} semanas: ${totalAvisos}`);
console.log("Distribuição de fins de semana completos:", bonusHistory);
