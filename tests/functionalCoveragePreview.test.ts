import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const preview=readFileSync(new URL(
  "../src/FunctionalCoveragePreview.tsx",import.meta.url),"utf8");
const calendar=readFileSync(new URL(
  "../src/CalendarScheduler.tsx",import.meta.url),"utf8");

test("PR94: o utilizador pode simular a cobertura do dia no calendário",()=>{
  assert.match(calendar,/import \{FunctionalCoveragePreview\}/);
  assert.match(calendar,/selectedDate&&hasMonthProposal&&/);
  assert.match(calendar,/<FunctionalCoveragePreview key=\{selectedDate\}/);
  assert.match(calendar,/assignments=\{dayAssignments\}/);
  assert.match(calendar,/opening=\{dailyOpening\}/);
  assert.match(calendar,/legacy=\{legacyDraft\}/);
  assert.match(preview,/Testar Caixa e Vendas neste dia/);
  assert.match(preview,/Simular distribuição de funções/);
  assert.match(preview,/role="status"/);
  assert.match(preview,/50% dos colaboradores habilitados/);
});

test("PR94: o ensaio usa equipa atual, horários reais e nunca grava ou certifica o mês",()=>{
  assert.match(preview,/loadTeamDraftFromBrowser\(\)/);
  assert.match(preview,/assignments:\[\.\.\.assignments\]/);
  assert.match(preview,/qualifiedRoles:member\.qualifiedRoles/);
  assert.match(preview,/minimumPercent:50/);
  assert.match(preview,/allocateFunctionalCoverage\(\{/);
  assert.match(preview,/result\.certification/);
  assert.match(preview,/legacy\)/);
  assert.doesNotMatch(preview,/saveMonthlyDraft/);
  assert.doesNotMatch(preview,/saveTeamDraft/);
  assert.doesNotMatch(preview,/generateSchedule\(/);
  assert.doesNotMatch(preview,/certifySchedule\(/);
  assert.match(preview,/não altera nem guarda turnos/);
});

test("PR94: a UI informa claramente quando falta cobertura ou qualificação",()=>{
  assert.match(preview,/colaboradores ativos sem função definida/);
  assert.match(preview,/Cobertura funcional insuficiente/);
  assert.match(preview,/intervalos com cobertura funcional/);
  assert.match(preview,/simultaneamente, excluindo pausas/);
  assert.match(preview,/Cada polivalente conta numa única função/);
});
