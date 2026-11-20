import test from "node:test";
import assert from "node:assert/strict";
import {calculateRolling28Day} from "../src/rolling28Day";
import {addCivilDays,enumerateCivilDays} from "../src/schedulePeriods";

const ANA="1a2b3c4d-3333-4444-8aaa-123456789abc";
const BIA="1a2b3c4d-3333-4444-8aaa-123456789abd";
const dateRange=(endInclusive:string)=>
  enumerateCivilDays({
    start:addCivilDays(endInclusive,-27),
    endExclusive:addCivilDays(endInclusive,1),
  });
const shift=(date:string,memberId=ANA)=>({
  date,memberId,start:"09:00",end:"18:00",
  mealBreak:{start:"13:00",end:"14:00"},
});

test("28 dias móveis são independentes do início de semanas ou meses",()=>{
  const dates=dateRange("2026-11-20");
  assert.equal(dates.length,28);
  assert.equal(dates[0],"2026-10-24");
  const first=calculateRolling28Day({
    memberId:ANA,throughDate:"2026-11-20",
    completeDates:dates,
    assignments:dates.slice(0,20).map(date=>shift(date)),
  });
  assert.equal(first.status,"complete");
  assert.equal(first.start,"2026-10-24");
  assert.equal(first.endExclusive,"2026-11-21");
  assert.equal(first.targetMinutes,9600);
  assert.equal(first.actualMinutes,9600); // 20 × (9h presence - 1h meal)
  assert.equal(first.differenceMinutes,0);
  assert.equal(first.averageWeeklyMinutes,2400);
  assert.equal(first.workingDays,20);

  const next=calculateRolling28Day({
    memberId:ANA,throughDate:"2026-11-21",
    completeDates:dateRange("2026-11-21"),
    assignments:dates.slice(1,20).map(date=>shift(date)),
  });
  assert.equal(next.start,"2026-10-25");
  assert.equal(next.actualMinutes,19*480);
  assert.equal(next.differenceMinutes,-480);
});

test("dia sem turno explícito não é um dia desconhecido",()=>{
  const dates=dateRange("2026-11-20");
  const result=calculateRolling28Day({
    memberId:ANA,throughDate:"2026-11-20",
    completeDates:dates,assignments:[],
  });
  assert.equal(result.status,"complete");
  assert.equal(result.actualMinutes,0);
  assert.equal(result.workingDays,0);
});

test("histórico incompleto não inventa débito de horas",()=>{
  const dates=dateRange("2026-11-20");
  const result=calculateRolling28Day({
    memberId:ANA,throughDate:"2026-11-20",
    completeDates:dates.slice(1),
    assignments:[shift("2026-11-20")],
  });
  assert.equal(result.status,"insufficient_context");
  assert.deepEqual(result.missingDates,["2026-10-24"]);
  assert.equal(result.actualMinutes,null);
  assert.equal(result.differenceMinutes,null);
});

test("exclui turnos de outro colaborador e fora da janela",()=>{
  const result=calculateRolling28Day({
    memberId:ANA,throughDate:"2026-11-20",
    completeDates:dateRange("2026-11-20"),
    assignments:[
      shift("2026-11-20"),
      shift("2026-11-20",BIA),
      shift("2026-10-23"),
      shift("2026-11-21"),
    ],
  });
  assert.equal(result.status,"complete");
  assert.equal(result.actualMinutes,480);
});

test("target configurável é isolado do valor fixo de 40h",()=>{
  const result=calculateRolling28Day({
    memberId:ANA,throughDate:"2026-11-20",
    completeDates:dateRange("2026-11-20"),
    assignments:[shift("2026-11-20")],
    weeklyTargetMinutes:1200,
  });
  assert.equal(result.status,"complete");
  assert.equal(result.targetMinutes,4800);
  assert.equal(result.differenceMinutes,-4320);
});

test("não aceita turnos sobrepostos nem contexto corrompido",()=>{
  const context=dateRange("2026-11-20");
  const options={memberId:ANA,throughDate:"2026-11-20",completeDates:context};
  assert.equal(calculateRolling28Day({
    ...options,assignments:[shift("2026-11-20"),shift("2026-11-20")],
  }).status,"invalid_input");
  assert.equal(calculateRolling28Day({
    ...options,assignments:[],completeDates:[...context,context[0]],
  }).status,"invalid_input");
  assert.equal(calculateRolling28Day({
    ...options,assignments:[],weeklyTargetMinutes:-1,
  }).status,"invalid_input");
  assert.equal(calculateRolling28Day({
    ...options,assignments:[],throughDate:"2026-02-30",
  }).status,"invalid_input");
});

test("total móvel não altera nem reescreve os horários de origem",()=>{
  const assignments=[shift("2026-11-20")];
  const completeDates=dateRange("2026-11-20");
  const before=JSON.stringify({assignments,completeDates});
  calculateRolling28Day({
    memberId:ANA,throughDate:"2026-11-20",
    completeDates,assignments,
  });
  assert.equal(JSON.stringify({assignments,completeDates}),before);
});
