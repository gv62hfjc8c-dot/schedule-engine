import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const calendarScheduler = readFileSync(new URL("../src/CalendarScheduler.tsx", import.meta.url), "utf8");
const teamEditor = readFileSync(new URL("../src/TeamEditor.tsx", import.meta.url), "utf8");

test("A interface não apresenta linguagem de desenvolvimento", () => {
  for (const forbidden of [
    "Fundação V2", "Base visual", "Fechar demonstração",
    "Abrir demonstração", "Explorar a nova base",
    "Primeiro conceito", "Próxima etapa",
    "Ainda não implementado", "Não introduzas credenciais reais",
  ]) {
    assert.equal(app.includes(forbidden), false,
      "Texto interno não pode aparecer na interface: " + forbidden);
  }
});

test("A autenticação não simula uma sessão nem armazena credenciais", () => {
  assert.match(app, /onSubmit=\{handleSignIn\}/);
  assert.match(app, /event\.preventDefault\(\)/);
  assert.match(app, /setSignInError\(true\)/);
  assert.equal(app.includes("localStorage"), false);
  assert.equal(app.includes("sessionStorage"), false);
  assert.equal(app.includes("document.cookie"), false);
  assert.equal(app.includes("fetch("), false);
});

test("Layout adapta-se a desktop, tablet e telemóvel sem largura fixa da página", () => {
  assert.match(styles, /grid-template-columns:\s*minmax\(0,\s*1\.08fr\)/);
  assert.match(styles, /@media\s*\(max-width:\s*1020px\)/);
  assert.match(styles, /@media\s*\(max-width:\s*880px\)/);
  assert.match(styles, /@media\s*\(max-width:\s*620px\)/);
  assert.match(styles, /@media\s*\(max-width:\s*460px\)/);
  assert.match(styles, /grid-template-columns:\s*repeat\(7,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(styles, /min-width:\s*320px/);
  assert.match(styles, /prefers-reduced-motion:\s*reduce/);
});

test("A interface distingue ausência de horário e folga", () => {
  assert.match(calendarScheduler, /sem turnos registados não corresponde automaticamente a uma folga/);
});

test("O calendário mostra geração real, certificação e guarda sem validação manual", () => {
  assert.match(app, /<CalendarScheduler\s*\/>/);
  assert.match(calendarScheduler, /Gerar horário/);
  assert.match(calendarScheduler, /Guardar proposta/);
  assert.match(calendarScheduler, /generateSchedule\(/);
  assert.match(calendarScheduler, /saveMonthlyDraftToBrowser\(/);
  assert.match(calendarScheduler, /certificationForSaved\(/);
  assert.doesNotMatch(calendarScheduler, /Validar horário/);
  assert.match(calendarScheduler, /calendar-assignment-count/);
  assert.match(calendarScheduler, /day-work-item/);
});

test("O calendário gera automaticamente, sem seletor de intervalos de entradas",()=>{
  assert.doesNotMatch(calendarScheduler,/schedule-start-spacing/);
  assert.doesNotMatch(calendarScheduler,/startSpacingMinutes/);
  assert.doesNotMatch(calendarScheduler,/30 em 30 minutos/);
  assert.doesNotMatch(calendarScheduler,/60 em 60 minutos/);
  assert.match(calendarScheduler,/O motor distribui automaticamente os turnos/);
  assert.match(calendarScheduler,/generateSchedule\(\{/);
});


test("Folgas semanais configuram só a quantidade na página Equipa",()=>{
  assert.match(teamEditor,/id="team-weekly-days-off"/);
  assert.match(teamEditor,/name="weeklyDaysOff"/);
  assert.match(teamEditor,/Por definir \(sem regra adicional\)/);
  assert.match(teamEditor,/O motor escolhe os dias/);
  assert.doesNotMatch(teamEditor,/name="dayOffWeekday"/);
  assert.doesNotMatch(teamEditor,/type="date"/);
  assert.doesNotMatch(calendarScheduler,/Adicionar folga/);
  assert.match(calendarScheduler,
    /sem turnos registados não corresponde automaticamente a uma folga/);
});

test("O calendário pode filtrar por colaborador sem alterar geração ou gravação",()=>{
  assert.match(calendarScheduler,/id="schedule-member-filter"/);
  assert.match(calendarScheduler,/Ver horário de/);
  assert.match(calendarScheduler,/Toda a equipa/);
  assert.match(calendarScheduler,/calendarScheduleView\(data,selectedMemberId\)/);
  assert.match(calendarScheduler,/calendar-member-shifts/);
  assert.match(calendarScheduler,/calendar-member-empty/);
  assert.match(calendarScheduler,/selectedMemberId=\{selectedMemberId\}/);
  assert.match(calendarScheduler,/onSelectMember=\{setSelectedMemberId\}/);
  assert.match(calendarScheduler,/selectedMemberId!==null && data.length>0/);
  assert.match(calendarScheduler,/view\.totalMinutes/);
  assert.match(calendarScheduler,/view\.workingDays/);
  assert.match(calendarScheduler,/O filtro mostra apenas este colaborador/);
  // Both certification and persistence must still receive ALL assignments.
  assert.match(calendarScheduler,/preview\.candidateAssignments,revision/);
  assert.match(calendarScheduler,/certificationForSaved\(currentSources,year,month,\s*preview\.candidateAssignments,preview\.mealBreaks,"v1"\)/);
  assert.doesNotMatch(calendarScheduler,/saveMonthlyDraftToBrowser\(\s*year,month,view/);
});
