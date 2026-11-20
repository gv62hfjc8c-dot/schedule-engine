import test from "node:test";
import assert from "node:assert/strict";
import {calendarScheduleView} from "../src/calendarScheduleView";
import type {WorkAssignment} from "../src/workAssignments";

const ANA="1a2b3c4d-3333-4444-8aaa-123456789abc";
const RUI="1a2b3c4d-3333-4444-8aaa-123456789abd";
const assignments:WorkAssignment[]=[
  {memberId:ANA,date:"2026-11-02",start:"09:00",end:"13:00"},
  {memberId:ANA,date:"2026-11-02",start:"14:00",end:"18:00"},
  {memberId:RUI,date:"2026-11-02",start:"11:00",end:"19:00"},
  {memberId:RUI,date:"2026-11-03",start:"09:00",end:"17:00"},
  {memberId:ANA,date:"2026-11-04",start:"09:00",end:"13:00"},
];

test("Vista de toda a equipa preserva turnos, sem mutação",()=>{
  const snapshot=JSON.stringify(assignments);
  const view=calendarScheduleView(assignments,null);
  assert.equal(view.assignments,assignments);
  assert.equal(view.assignments.length,5);
  assert.equal(view.byDay.get("2026-11-02")?.length,3);
  assert.equal(view.workingDays,3);
  assert.equal(view.totalMinutes,28*60);
  assert.equal(JSON.stringify(assignments),snapshot);
});

test("Vista individual mostra apenas os turnos do colaborador, incluindo os repartidos",()=>{
  const snapshot=JSON.stringify(assignments);
  const ana=calendarScheduleView(assignments,ANA);
  assert.deepEqual([...ana.byDay.keys()],["2026-11-02","2026-11-04"]);
  assert.equal(ana.byDay.get("2026-11-02")?.length,2);
  assert.equal(ana.workingDays,2);
  assert.equal(ana.totalMinutes,12*60);
  assert.ok(ana.assignments.every(a=>a.memberId===ANA));
  const rui=calendarScheduleView(assignments,RUI);
  assert.equal(rui.totalMinutes,16*60);
  assert.equal(rui.workingDays,2);
  assert.equal(rui.byDay.get("2026-11-04"),undefined);
  assert.equal(JSON.stringify(assignments),snapshot);
});

test("Dia sem turno de um colaborador não é confundido com ausência de turnos da equipa",()=>{
  const memberView=calendarScheduleView(assignments,ANA);
  const teamView=calendarScheduleView(assignments,null);
  assert.equal(memberView.byDay.has("2026-11-03"),false);
  assert.equal(teamView.byDay.has("2026-11-03"),true);
  const absent=calendarScheduleView(assignments,"1a2b3c4d-3333-4444-8aaa-123456789abe");
  assert.equal(absent.totalMinutes,0);
  assert.equal(absent.workingDays,0);
  assert.equal(absent.assignments.length,0);
});

test("O filtro é apenas leitura: voltar à equipa mostra todos os mesmos turnos",()=>{
  const snapshot=JSON.stringify(assignments);
  calendarScheduleView(assignments,ANA);
  calendarScheduleView(assignments,RUI);
  const restored=calendarScheduleView(assignments,null);
  assert.deepEqual(restored.assignments,assignments);
  assert.equal(JSON.stringify(assignments),snapshot);
});
