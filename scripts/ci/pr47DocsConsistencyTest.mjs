/**
 * PR47-01: contract between current user-visible claims, documented limits
 * and the live application. Historical dated changelog sections are records,
 * not current assertions and are intentionally not rewritten.
 */
import assert from "node:assert/strict";
import {readFileSync,readdirSync} from "node:fs";
const read=p=>readFileSync(p,"utf8");
const docs=read("README.md");
const architecture=read("docs/architecture.md");
const app=read("src/App.tsx");
const schedule=read("src/components/ScheduleHome.tsx");
const generator=read("src/components/ConstrainedPeriodGeneratorPanel.tsx");
const approvals=read("src/components/OfficialApprovalPanel.tsx");
const migrationFiles=readdirSync("supabase/migrations")
  .filter(x=>x.endsWith(".sql"));
assert.equal(migrationFiles.length,12,"Expected twelve deployed migrations, including the two history upgrades.");
assert.match(docs,/quatro identificadores históricos reconstruídos\s+e seis migrações PR47/,
  "Documented migration lineage must match the deployed version count.");
assert.match(docs,/doze ficheiros versionados/,
  "README must distinguish the twelve applied migrations and Git alignment.");
assert.match(docs,/28 dias/);
assert.match(architecture,/1–28 dias/);
assert.match(app,/A geração certificada suporta períodos de até 28 dias por proposta/);
assert.doesNotMatch(app,/limite de geração continua a ser de 14 dias/);
assert.match(generator,/Até \{UI_MAX_PERIOD_DAYS\} dias/);
assert.match(schedule,/Proposta guardada · não aprovada/);
assert.match(schedule,/São propostas, não escalas oficialmente aprovadas/);
assert.match(approvals,/ready:ready.ready/);
assert.match(approvals,/Aprovar horário oficialmente/);
assert.match(approvals,/state==="ready"/);
assert.match(docs,/hist[oó]rico verificado/i);
assert.match(architecture,/histórico externo verificado/i);
assert.doesNotMatch(docs,/falta confirmação funcional\s+no Safari do arquivo/);
assert.doesNotMatch(architecture,/A validação no Safari permanece pendente/);
console.log("PR47-01 documentation contract: 28-day capability, archive semantics, trusted official approval, Safari evidence and staged classification migration lineage PASS.");
