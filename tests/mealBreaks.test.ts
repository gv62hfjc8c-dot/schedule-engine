import test from "node:test";
import assert from "node:assert/strict";
import {
  effectiveMealDayCapacity,planMealDay,validateMealBreak,
  MEAL_BREAK_DURATION_MINUTES,
  MEAL_BREAK_EARLIEST_AFTER_ENTRY_MINUTES,
} from "../src/mealBreaks";
import {generateSchedule} from "../src/generateSchedule";
import {certifySchedule} from "../src/certifySchedule";
import {assignmentMinutes,type WorkAssignment} from "../src/workAssignments";
import {suggestedWeeklyOpeningHours} from "../src/operatingHours";
import type {CertificationInput} from "../src/certifySchedule";

const ANA="1a2b3c4d-3333-4444-8aaa-123456789abc";
const RUI="1a2b3c4d-3333-4444-8aaa-123456789abd";
const minutes=(work:WorkAssignment[])=>
  work.reduce((sum,a)=>sum+assignmentMinutes(a),0);
function scenario(days=5):CertificationInput {
  const hours=suggestedWeeklyOpeningHours();
  for(let i=0;i<hours.days.length;i++)
    hours.days[i].intervals=i<days?[{start:"09:00",end:"19:00"}]:[];
  return {
    period:{mode:"weekly",start:"2026-11-02"},
    team:{members:[{id:ANA,name:"Ana",active:true},{id:RUI,name:"Rui",active:true}]},
    openingHours:hours,candidateAssignments:[],
    mealBreakPolicy:"v1",mealBreaks:[],
  };
}

test("A política de almoço tem exatamente 60min e início pelo menos 180min após a entrada",()=>{
  assert.equal(MEAL_BREAK_DURATION_MINUTES,60);
  assert.equal(MEAL_BREAK_EARLIEST_AFTER_ENTRY_MINUTES,180);
  assert.deepEqual(validateMealBreak({
    memberId:ANA,date:"2026-11-02",start:"12:00",end:"13:00",
  }),{memberId:ANA,date:"2026-11-02",start:"12:00",end:"13:00"});
  assert.equal(validateMealBreak({
    memberId:ANA,date:"2026-11-02",start:"12:00",end:"12:30",
  }),null);
});

test("Janela de 4h não tem almoço e mantém 4 horas de trabalho",()=>{
  const business=[{start:540,end:780}];
  assert.equal(effectiveMealDayCapacity(business),240);
  assert.equal(planMealDay(ANA,"2026-11-07",business,240,540),null);
  const data=scenario(6);
  data.openingHours=(data.openingHours as ReturnType<typeof suggestedWeeklyOpeningHours>);
  (data.openingHours as ReturnType<typeof suggestedWeeklyOpeningHours>)
    .days[5].intervals=[{start:"09:00",end:"13:00"}];
  const result=generateSchedule({
    period:data.period,team:data.team,openingHours:data.openingHours,
    mealBreakPolicy:"v1",
  });
  assert.equal(result.status,"valid");
  for(const id of [ANA,RUI]){
    const saturday=result.candidateAssignments.filter(a=>
      a.memberId===id&&a.date==="2026-11-07");
    assert.deepEqual(saturday.map(a=>[a.start,a.end]),[["09:00","13:00"]]);
    assert.equal(result.mealBreaks.filter(b=>b.memberId===id&&b.date==="2026-11-07").length,0);
  }
});

test("Um turno de oito horas efetivas cabe em nove horas de presença",()=>{
  const intervals=[{start:540,end:1140}];
  assert.equal(effectiveMealDayCapacity(intervals),540);
  const p=planMealDay(ANA,"2026-11-02",intervals,480,540);
  assert.ok(p);
  assert.deepEqual(p.mealBreak,{memberId:ANA,date:"2026-11-02",
    start:"12:00",end:"13:00"});
  assert.deepEqual(p.assignments.map(a=>[a.start,a.end]),[
    ["09:00","12:00"],["13:00","18:00"],
  ]);
  assert.equal(minutes(p.assignments),480);
});

test("O motor gera 40h de trabalho efetivo e pausa explícita em cinco dias normais",()=>{
  const d=scenario();
  const before=JSON.stringify(d);
  const result=generateSchedule({
    period:d.period,team:d.team,openingHours:d.openingHours,
    mealBreakPolicy:"v1",
  });
  assert.equal(result.status,"valid");
  assert.equal(result.mealBreaks.length,10);
  assert.equal(result.candidateAssignments.length,20);
  assert.deepEqual(result.certification.weeks.map(w=>w.actualMinutes),[2400,2400]);
  for(const id of [ANA,RUI]){
    const entries=result.candidateAssignments.filter(a=>a.memberId===id);
    assert.equal(minutes(entries),2400);
    const lunches=result.mealBreaks.filter(b=>b.memberId===id);
    assert.equal(lunches.length,5);
    assert.equal(new Set(lunches.map(b=>b.start)).size,1,
      "Pausa previsível ao longo da semana");
    assert.equal(new Set(entries.filter(a=>a.start.endsWith(":00"))
      .map(a=>a.date)).size,5);
  }
  assert.deepEqual(result,generateSchedule({
    period:d.period,team:d.team,openingHours:d.openingHours,
    mealBreakPolicy:"v1",
  }));
  assert.equal(JSON.stringify(d),before);
});

test("O certificador rejeita pausas em falta, demasiado cedo, curtas, sobrepostas ou em jornadas curtas",()=>{
  const d=scenario();
  const valid=generateSchedule({
    period:d.period,team:d.team,openingHours:d.openingHours,
    mealBreakPolicy:"v1",
  });
  const report=(mealBreaks:unknown,candidateAssignments:unknown=valid.candidateAssignments)=>
    certifySchedule({...d,mealBreaks,candidateAssignments});
  assert.equal(report(valid.mealBreaks).status,"valid");
  const without=report([]);
  assert.equal(without.status,"invalid");
  assert.ok(without.issues.some(i=>i.code==="MEAL_BREAK_MISSING"));
  const early=valid.mealBreaks.map((b,i)=>i===0?
    {...b,start:"11:00",end:"12:00"}:b);
  assert.ok(report(early).issues.some(i=>i.code==="MEAL_BREAK_TOO_EARLY"));
  const halfHour=valid.mealBreaks.map((b,i)=>i===0?
    {...b,end:"12:30"}:b);
  assert.ok(report(halfHour).issues.some(i=>i.code==="INVALID_MEAL_BREAK"));
  const collision=valid.mealBreaks.map((b,i)=>i===0?
    {...b,start:"11:30",end:"12:30"}:b);
  assert.ok(report(collision).issues.some(i=>i.code==="MEAL_BREAK_OVERLAP"));
  const short=[{memberId:ANA,date:"2026-11-02",start:"09:00",end:"13:00"}];
  assert.ok(report([{memberId:ANA,date:"2026-11-02",
    start:"11:00",end:"12:00"}],short).issues.some(i=>
    i.code==="MEAL_BREAK_UNNECESSARY"));
});

test("Uma pausa de uma hora pode coincidir com encerramento da empresa",()=>{
  const intervals=[{start:540,end:720},{start:780,end:1140}];
  const p=planMealDay(ANA,"2026-11-02",intervals,540,540);
  assert.ok(p);
  assert.deepEqual(p.mealBreak,{memberId:ANA,date:"2026-11-02",
    start:"12:00",end:"13:00"});
  assert.equal(minutes(p.assignments),540);
  assert.equal(effectiveMealDayCapacity(intervals),540);
});

test("Quando não cabe uma pausa normal, não se inventam horas ou refeições",()=>{
  const d=scenario();
  const hours=d.openingHours as ReturnType<typeof suggestedWeeklyOpeningHours>;
  for(const day of hours.days)if(day.intervals.length)
    day.intervals=[{start:"09:00",end:"17:00"}];
  const res=generateSchedule({
    period:d.period,team:d.team,openingHours:hours,
    mealBreakPolicy:"v1",
  });
  assert.equal(res.status,"invalid");
  assert.ok(res.shortfalls.some(s=>s.missingMinutes>0));
  assert.ok(res.certification.issues.some(i=>i.code==="WEEKLY_HOURS_MISSING"));
});


test("A rotação dos turnos com almoço continua semanal, nunca diária",()=>{
  const d=scenario();
  const result=generateSchedule({
    period:{mode:"14d",start:"2026-11-02"},
    team:d.team,openingHours:d.openingHours,
    mealBreakPolicy:"v1",
  });
  assert.equal(result.status,"valid");
  for(const memberId of [ANA,RUI]){
    const shiftStart=(date:string)=>{
      const work=result.candidateAssignments.filter(a=>
        a.memberId===memberId&&a.date===date);
      return work[0]?.start;
    };
    assert.equal(shiftStart("2026-11-02"),shiftStart("2026-11-06"));
    assert.equal(shiftStart("2026-11-09"),shiftStart("2026-11-13"));
    assert.notEqual(shiftStart("2026-11-02"),shiftStart("2026-11-09"));
  }
  assert.deepEqual(result.certification.weeks.map(w=>w.actualMinutes),
    [2400,2400,2400,2400]);
});

test("Mês civil de 31 dias nunca inventa pausas ou turnos em meses externos",()=>{
  const d=scenario();
  const input={
    period:{mode:"monthly" as const,year:2026,month:12},
    team:d.team,openingHours:d.openingHours,mealBreakPolicy:"v1" as const,
  };
  const before=JSON.stringify(input);
  const result=generateSchedule(input);
  assert.equal(result.status,"insufficient_context");
  assert.ok(result.candidateAssignments.every(a=>
    a.date>="2026-12-01"&&a.date<"2027-01-01"));
  assert.ok(result.mealBreaks.every(b=>
    b.date>="2026-12-01"&&b.date<"2027-01-01"));
  assert.ok(result.certification.issues.some(i=>
    i.code==="CONTEXT_INCOMPLETE"));
  assert.equal(JSON.stringify(input),before);
});

test("Datas de pausa impossíveis não podem entrar na certificação",()=>{
  assert.equal(validateMealBreak({
    memberId:ANA,date:"2026-11-31",start:"12:00",end:"13:00",
  }),null);
});
