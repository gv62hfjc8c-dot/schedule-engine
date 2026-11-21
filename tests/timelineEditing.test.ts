import test from "node:test";
import assert from "node:assert/strict";
import {moveTimelineAssignment} from "../src/timelineEditing";
import {certifySchedule} from "../src/certifySchedule";
import {suggestedWeeklyOpeningHours} from "../src/operatingHours";
import type {WorkAssignment} from "../src/workAssignments";

const ANA="1a2b3c4d-3333-4444-8aaa-123456789abc";
const RUI="1a2b3c4d-3333-4444-8aaa-123456789abd";
const date="2026-11-16";
const bounds={start:510,end:1140};
function sample():WorkAssignment[]{
  return [
    {memberId:ANA,date,start:"09:00",end:"18:00",
      mealBreak:{start:"12:00",end:"13:00"}},
    {memberId:RUI,date,start:"10:00",end:"19:00",
      mealBreak:{start:"13:00",end:"14:00"}},
  ];
}
function request(kind:"shift"|"meal",deltaMinutes:number,entry=sample()[0]){
  return {kind,memberId:entry.memberId,date:entry.date,start:entry.start,
    end:entry.end,deltaMinutes,bounds};
}
test("arrastar turno muda entrada e saída e leva a refeição no mesmo delta",()=>{
  const assignments=sample();
  const snapshot=JSON.stringify(assignments);
  const moved=moveTimelineAssignment(assignments,request("shift",-30));
  assert.equal(moved.changed,true);
  if(!moved.changed)throw Error("missing move");
  assert.deepEqual(moved.assignments[0],{
    memberId:ANA,date,start:"08:30",end:"17:30",
    mealBreak:{start:"11:30",end:"12:30"},
  });
  assert.equal(moved.assignments[1],assignments[1]);
  assert.equal(JSON.stringify(assignments),snapshot);
  assert.equal(moved.deltaMinutes,-30);
});

test("arrastar só a pausa mantém a duração e a localização do turno",()=>{
  const assignments=sample();
  const moved=moveTimelineAssignment(assignments,request("meal",60));
  assert.equal(moved.changed,true);
  if(!moved.changed)throw Error("missing move");
  assert.equal(moved.assignments[0].start,"09:00");
  assert.equal(moved.assignments[0].end,"18:00");
  assert.deepEqual(moved.assignments[0].mealBreak,
    {start:"13:00",end:"14:00"});
  assert.equal(moved.assignments[1],assignments[1]);
});

test("movimento de rato é quantizado de quinze em quinze minutos",()=>{
  const assignments=sample();
  const a=moveTimelineAssignment(assignments,request("shift",19));
  assert.equal(a.changed,true);
  if(!a.changed)throw Error("should change");
  assert.equal(a.deltaMinutes,15);
  const b=moveTimelineAssignment(assignments,request("meal",6));
  assert.equal(b.changed,false);
  const c=moveTimelineAssignment(assignments,request("meal",9));
  assert.equal(c.changed,true);
  if(c.changed)assert.equal(c.deltaMinutes,15);
});

test("arrastamento ao limite do funcionamento não cria turno fora do eixo",()=>{
  const assignments=sample();
  const left=moveTimelineAssignment(assignments,request("shift",-9999));
  assert.equal(left.changed,true);
  if(left.changed)assert.equal(left.assignments[0].start,"08:30");
  const right=moveTimelineAssignment(assignments,request("shift",9999));
  assert.equal(right.changed,true);
  if(right.changed)assert.equal(right.assignments[0].end,"19:00");
  const fixed:WorkAssignment={memberId:ANA,date,start:"14:00",end:"19:00"};
  const locked=moveTimelineAssignment([fixed],{
    ...request("shift",45,fixed),bounds:{start:840,end:1140},
  });
  assert.equal(locked.changed,false);
});

test("pausas nunca podem sair do turno ou tornar-se um intervalo invertido",()=>{
  const assignments=sample();
  for(const delta of [-9999,9999]){
    const r=moveTimelineAssignment(assignments,request("meal",delta));
    assert.equal(r.changed,true);
    if(!r.changed)continue;
    const meal=r.assignments[0].mealBreak!;
    assert.ok(meal.start>"09:00");
    assert.ok(meal.end<"18:00");
    assert.equal(Number(meal.end.slice(0,2))*60+
      Number(meal.end.slice(3))-
      (Number(meal.start.slice(0,2))*60+Number(meal.start.slice(3))),60);
  }
});

test("sem pausa, identidade inexistente ou pedido inválido nunca altera dados",()=>{
  const assignments=sample();
  const impossible=moveTimelineAssignment(assignments,{
    ...request("shift",30),start:"00:00",
  });
  assert.equal(impossible.changed,false);
  assert.equal(impossible.assignments,assignments);
  const without=moveTimelineAssignment([
    {...assignments[0],mealBreak:undefined},
  ],request("meal",15));
  assert.equal(without.changed,false);
  const nan=moveTimelineAssignment(assignments,request("meal",NaN));
  assert.equal(nan.changed,false);
});

test("o movimento pode produzir conflito, identificado pelo certificador independente",()=>{
  const shifts:WorkAssignment[]=[
    {memberId:ANA,date,start:"09:00",end:"18:00",
      mealBreak:{start:"12:00",end:"13:00"}},
    {memberId:RUI,date,start:"09:00",end:"18:00",
      mealBreak:{start:"13:00",end:"14:00"}},
  ];
  const moved=moveTimelineAssignment(shifts,{
    kind:"meal",memberId:RUI,date,start:"09:00",end:"18:00",
    deltaMinutes:-60,bounds:{start:540,end:1080},
  });
  assert.equal(moved.changed,true);
  if(!moved.changed)throw Error("should keep conflicting edit");
  assert.deepEqual(moved.assignments[1].mealBreak,
    {start:"12:00",end:"13:00"});
  const hours=suggestedWeeklyOpeningHours();
  hours.days[0].intervals=[{start:"09:00",end:"18:00"}];
  const result=certifySchedule({
    period:{mode:"weekly",start:date},
    team:{members:[{id:ANA,name:"Ana",active:true},
      {id:RUI,name:"Rui",active:true}]},
    openingHours:hours,candidateAssignments:moved.assignments,
    mealBreakPolicy:"v2",hoursPolicy:"rolling28",
  });
  assert.equal(result.status,"invalid");
  assert.ok(result.issues.some(issue=>issue.code==="OPENING_UNCOVERED" &&
    issue.date===date && issue.gapStart==="12:00" && issue.gapEnd==="13:00"));
});
