import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const calendar=readFileSync(
  new URL("../src/CalendarScheduler.tsx",import.meta.url),"utf8");
const timeline=readFileSync(
  new URL("../src/DayScheduleTimeline.tsx",import.meta.url),"utf8");
const styles=readFileSync(
  new URL("../src/styles.css",import.meta.url),"utf8");
const timelineStyles=readFileSync(
  new URL("../src/calendarScheduler.css",import.meta.url),"utf8");

test("a página Horários empilha calendário e detalhes em largura total",()=>{
  assert.match(styles,
    /\.calendar-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(calendar,/className="surface calendar-panel"/);
  assert.match(calendar,/<section className="surface detail-panel"/);
  assert.doesNotMatch(calendar,/<aside className="surface detail-panel"/);
  assert.match(calendar,/<DayScheduleTimeline timeline=\{dailyTimeline\}/);
});

test("o detalhe diário nunca usa a projeção filtrada do calendário",()=>{
  assert.match(calendar,/calendarScheduleView\(data,selectedMemberId\)/);
  assert.match(calendar,/data\.filter\(assignment=>assignment\.date===selectedDate\)/);
  assert.match(calendar,
    /buildDailyTimeline\(selectedDate,data,activeMemberIds,dailyOpening,/);
  assert.match(calendar,/selectedMemberId=\{selectedMemberId\}/);
  assert.match(calendar,/o detalhe do dia mostra toda a equipa/);
});

test("a escala é baseada no funcionamento do dia e mostra pausas e cobertura",()=>{
  assert.match(timeline,/timelinePosition\(/);
  assert.match(timeline,/minuteLabel\(bounds\.start\)/);
  assert.match(timeline,/minuteLabel\(bounds\.end\)/);
  assert.match(timeline,/opening\.map\(/);
  assert.match(timeline,/row\.shifts\.map\(/);
  assert.match(timeline,/shift\.meals\.map\(/);
  assert.match(timeline,/row\.legacyMeals\.map\(/);
  assert.match(timeline,/coverage\.map\(/);
  assert.match(timeline,/Sem cobertura:/);
});

test("em ecrãs pequenos o gráfico preserva a escala com scroll horizontal",()=>{
  assert.match(timeline,/role="region"/);
  assert.match(timeline,/tabIndex=\{0\}/);
  assert.match(timelineStyles,/\.daily-timeline-scroll\s*\{[^}]*overflow:\s*auto/);
  assert.match(timelineStyles,/\.daily-timeline-axis\s*\{[^}]*position:\s*sticky/);
  assert.match(timelineStyles,/@media \(max-width: 460px\)/);
});

test("o calendário preserva a certificação e o armazenamento completos",()=>{
  assert.match(calendar,/certificationForSaved\(currentSources,year,month,/);
  assert.match(calendar,/year,month,candidates,revision/);
  assert.match(calendar,/saveMonthlyDraftToBrowser\(/);
  assert.doesNotMatch(calendar,/saveMonthlyDraftToBrowser\(\s*year,month,view/);
});
