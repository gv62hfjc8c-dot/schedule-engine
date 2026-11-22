import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {pageForPath} from "../src/routes";

const read=(path:string)=>readFileSync(
  new URL("../src/"+path,import.meta.url),"utf8");
const base=read("styles.css");
const calendarCss=read("calendarScheduler.css");
const teamCss=read("team.css");
const app=read("App.tsx");
const calendar=read("CalendarScheduler.tsx");
const timeline=read("DayScheduleTimeline.tsx");

test("PR93: seis páginas reais partilham navegação e base responsiva",()=>{
  const routes=[
    ["/","welcome"],
    ["/horarios","calendar"],
    ["/configuracao","settings"],
    ["/configuracao/inicial","setup"],
    ["/configuracao/funcionamento","operatingHours"],
    ["/configuracao/equipa","team"],
  ] as const;
  for(const [path,page] of routes)assert.equal(pageForPath(path),page);
  assert.match(app,/className="workspace-header-inner"/);
  assert.match(app,/className="workspace-nav"/);
  assert.match(base,/\.workspace-header-inner\s*\{/);
  assert.match(base,/@media \(max-width: 620px\)/);
  assert.match(base,/@media \(min-width: 621px\) and \(max-width: 880px\)/);
  assert.match(base,/@media \(max-width: 360px\)/);
  assert.match(base,/@media \(max-height: 520px\) and \(orientation: landscape\)/);
});

test("PR93: formulários em mobile evitam zoom iOS e respeitam notch",()=>{
  assert.match(base,/text-size-adjust:\s*100%/);
  assert.match(base,/env\(safe-area-inset-left\)/);
  assert.match(base,/env\(safe-area-inset-bottom\)/);
  for(const token of [
    ".opening-times input",
    ".company-form input",
    ".login-fields input",
    ".team-form input",
    ".team-form select",
    ".schedule-member-filter select",
  ])assert.ok(base.includes(token),"campo sem política de tamanho: "+token);
  assert.match(base,/font-size:\s*16px/);
  assert.match(base,/\.workspace-nav a\s*\{[^}]*min-height:\s*44px/s);
  assert.match(base,/\.calendar-day, \.empty-day\s*\{[^}]*min-height:\s*54px/s);
  assert.match(base,/\.opening-times\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
});

test("PR93: calendário móvel legível sem perder horas completas e folgas",()=>{
  assert.match(calendar,/className="calendar-day-number"/);
  assert.match(calendar,/className="calendar-count-word"/);
  assert.match(calendar,/className="calendar-mobile-shift"/);
  assert.match(calendar,/className="calendar-member-empty-full"/);
  assert.match(calendar,/className="calendar-member-empty-short"/);
  assert.match(calendar,/previewRestDays\.has\(cell\.date!\)\?"Folga":"—"/);
  assert.match(calendar,/shift\.start\+" a "\+shift\.end/);
  assert.match(calendar,/aria-pressed=\{selectedDate===cell\.date\}/);
  assert.match(calendarCss,/\.calendar-member-shifts > span:not\(\.calendar-mobile-shift\)/);
  assert.match(calendarCss,/\.calendar-day \.calendar-assignment-count/);
  assert.match(calendarCss,/\.calendar-count-word\s*\{\s*display:\s*none/);
  assert.match(calendar,/calendarScheduleView\(data,selectedMemberId\)/,
    "a projeção do filtro existente não pode ser substituída");
});

test("PR93: linha temporal mantém a escala e anuncia scroll em mobile",()=>{
  assert.match(timeline,/className="daily-timeline-mobile-hint"/);
  assert.match(timeline,/aria-describedby="daily-timeline-scroll-hint"/);
  assert.match(timeline,/className="daily-timeline-scroll" role="region"/);
  assert.match(timeline,/tabIndex=\{0\}/);
  assert.match(timeline,/Math\.max\(540,Math\.ceil\(span\/60\)\*64\)/);
  assert.match(calendarCss,/\.daily-timeline-scroll\s*\{[^}]*overflow:\s*auto/);
  assert.match(calendarCss,/overscroll-behavior-x:\s*contain/);
  assert.match(calendarCss,/\.daily-timeline-person\s*\{[^}]*position:\s*sticky/s);
});

test("PR93: equipa e funcionamento quebram colunas antes de transbordar",()=>{
  assert.match(teamCss,/@media \(max-width: 360px\)/);
  assert.match(teamCss,/\.team-person\s*\{[^}]*grid-template-columns:\s*38px minmax\(0, 1fr\)/s);
  assert.match(teamCss,/\.team-form\s*\{[^}]*max-width:\s*100%/s);
  assert.match(base,/\.opening-day\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
  assert.match(base,/\.settings-panel\s*\{[^}]*max-width:\s*100%/s);
  assert.match(base,/@media \(hover: none\) and \(pointer: coarse\)/);
});
