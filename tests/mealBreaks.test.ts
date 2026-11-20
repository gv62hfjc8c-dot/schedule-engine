import test from "node:test";
import assert from "node:assert/strict";
import {
  effectiveMealDayCapacity,planMealDay,validateMealBreak,
  MEAL_BREAK_DURATION_MINUTES,
  MEAL_BREAK_EARLIEST_AFTER_ENTRY_MINUTES,
} from "../src/mealBreaks";
import {generateSchedule} from "../src/generateSchedule";
import {certifySchedule,type CertificationInput} from "../src/certifySchedule";
import {
  assignmentMinutes,clockMinutes,effectiveWorkIntervals,
  type WorkAssignment,
} from "../src/workAssignments";
import {suggestedWeeklyOpeningHours} from "../src/operatingHours";

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
    team:{members:[{id:ANA,name:"Ana",active:true},
      {id:RUI,name:"Rui",active:true}]},
    openingHours:hours,candidateAssignments:[],
    mealBreakPolicy:"v2",
  };
}
function generated(input:CertificationInput){
  return generateSchedule({
    period:input.period,team:input.team,
    openingHours:input.openingHours,mealBreakPolicy:"v2",
    externalContext:input.externalContext,
  });
}
function assertCoverage(
  shifts:readonly WorkAssignment[],date:string,start:number,end:number
){
  const actual=shifts.filter(a=>a.date===date);
  for(let minute=start;minute<end;minute++)
    assert.ok(actual.some(a=>effectiveWorkIntervals(a).some(i=>
      i.start<=minute&&i.end>minute)),
    "Sem cobertura no minuto "+minute+" do dia "+date);
}

test("O almoço tem duração fixa de 60min e só começa a partir de entrada+180min",()=>{
  assert.equal(MEAL_BREAK_DURATION_MINUTES,60);
  assert.equal(MEAL_BREAK_EARLIEST_AFTER_ENTRY_MINUTES,180);
  assert.deepEqual(validateMealBreak({memberId:ANA,date:"2026-11-02",
    start:"12:00",end:"13:00"}),{
      memberId:ANA,date:"2026-11-02",start:"12:00",end:"13:00",
    });
  assert.equal(validateMealBreak({memberId:ANA,date:"2026-11-02",
    start:"12:00",end:"12:30"}),null);
  assert.equal(validateMealBreak({memberId:ANA,date:"2026-11-31",
    start:"12:00",end:"13:00"}),null);
});

test("O dia curto 09-13 continua um único turno sem almoço",()=>{
  const business=[{start:540,end:780}];
  assert.equal(effectiveMealDayCapacity(business),240);
  assert.equal(planMealDay(ANA,"2026-11-07",business,240,540),null);
  const d=scenario(6);
  const hours=d.openingHours as ReturnType<typeof suggestedWeeklyOpeningHours>;
  hours.days[5].intervals=[{start:"09:00",end:"13:00"}];
  const result=generated(d);
  assert.equal(result.status,"valid",JSON.stringify(result.certification.issues));
  for(const memberId of [ANA,RUI]){
    const shifts=result.candidateAssignments.filter(a=>
      a.memberId===memberId && a.date==="2026-11-07");
    assert.deepEqual(shifts,[{memberId,date:"2026-11-07",
      start:"09:00",end:"13:00"}]);
    assert.equal(minutes(shifts),240);
  }
});

test("Um único turno 09-18 contém pausa 12-13 e 8h efetivas",()=>{
  const openings=[{start:540,end:1140}];
  assert.equal(effectiveMealDayCapacity(openings),540);
  const p=planMealDay(ANA,"2026-11-02",openings,480,540);
  assert.ok(p);
  assert.deepEqual(p.assignment,{
    memberId:ANA,date:"2026-11-02",start:"09:00",end:"18:00",
    mealBreak:{start:"12:00",end:"13:00"},
  });
  assert.equal(assignmentMinutes(p.assignment),480);
});

test("Dois colaboradores: um turno por pessoa e pausas sem deixar a empresa vazia",()=>{
  const d=scenario();
  const snapshot=JSON.stringify(d);
  const result=generated(d);
  assert.equal(result.status,"valid",JSON.stringify(result.certification.issues));
  assert.equal(result.candidateAssignments.length,10,
    "Um turno por colaborador em cada um dos cinco dias");
  assert.deepEqual(result.certification.weeks.map(w=>w.actualMinutes),
    [2400,2400]);
  for(const date of ["2026-11-02","2026-11-03","2026-11-04",
    "2026-11-05","2026-11-06"]){
    const shifts=result.candidateAssignments.filter(a=>a.date===date);
    assert.equal(shifts.length,2);
    assert.ok(shifts.every(s=>s.mealBreak));
    for(const shift of shifts){
      const meal=shift.mealBreak!;
      assert.equal(clockMinutes(meal.end)-clockMinutes(meal.start),60);
      assert.ok(clockMinutes(meal.start)>=clockMinutes(shift.start)+180);
      assert.equal(assignmentMinutes(shift),480);
    }
    assertCoverage(result.candidateAssignments,date,540,1140);
  }
  assert.deepEqual(result,generated(d));
  assert.equal(JSON.stringify(d),snapshot);
});

test("Certificador rejeita lacuna causada por pausas coincidentes mesmo com 40h",()=>{
  const d=scenario();
  const valid=generated(d);
  assert.equal(valid.status,"valid");
  const day="2026-11-02";
  const other=valid.candidateAssignments.find(a=>a.memberId===RUI&&a.date===day)!;
  const first=valid.candidateAssignments.find(a=>a.memberId===ANA&&a.date===day)!;
  // Make the second colleague unavailable during the first colleague's meal.
  // Keep the same 8 effective hours and one-hour pause in one shift.
  const shifted={...other,start:"09:00",end:"18:00",
    mealBreak:{...first.mealBreak!}};
  const changed=valid.candidateAssignments.map(a=>
    a.date===day&&a.memberId===RUI?shifted:a);
  const report=certifySchedule({...d,candidateAssignments:changed});
  assert.equal(report.status,"invalid");
  assert.ok(report.issues.some(i=>i.code==="OPENING_UNCOVERED"&&
    i.date===day&&i.gapStart!==undefined));
});

test("Certificador recusa pausa inexistente, precoce, de duração errada ou jornada curta com pausa",()=>{
  const d=scenario();
  const valid=generated(d);
  assert.equal(valid.status,"valid");
  const original=valid.candidateAssignments[0];
  const withShift=(shift:WorkAssignment)=>certifySchedule({...d,
    candidateAssignments:valid.candidateAssignments.map(a=>
      a===original?shift:a),
  });
  assert.ok(withShift({...original,mealBreak:undefined}).issues.some(i=>
    i.code==="MEAL_BREAK_MISSING"));
  assert.ok(withShift({...original,mealBreak:{
    start:"11:00",end:"12:00",
  }}).issues.some(i=>i.code==="MEAL_BREAK_TOO_EARLY"));
  assert.ok(withShift({...original,mealBreak:{
    start:"12:00",end:"12:30",
  }}).issues.some(i=>i.code==="INVALID_MEAL_BREAK"));
  const short:WorkAssignment={
    memberId:ANA,date:"2026-11-02",
    start:"09:00",end:"14:00",
    mealBreak:{start:"12:00",end:"13:00"},
  };
  assert.ok(withShift(short).issues.some(i=>
    i.code==="MEAL_BREAK_UNNECESSARY"));
});

test("Pausa pode coincidir com encerramento da empresa, sem separar o turno",()=>{
  const intervals=[{start:540,end:720},{start:780,end:1140}];
  const p=planMealDay(ANA,"2026-11-02",intervals,540,540);
  assert.ok(p);
  assert.deepEqual(p.assignment,{
    memberId:ANA,date:"2026-11-02",
    start:"09:00",end:"19:00",
    mealBreak:{start:"12:00",end:"13:00"},
  });
  assert.equal(assignmentMinutes(p.assignment),540);
  assert.equal(effectiveMealDayCapacity(intervals),540);
});

test("Se as 40h ou a cobertura forem impossíveis, a proposta fica inválida",()=>{
  const d=scenario();
  const hours=d.openingHours as ReturnType<typeof suggestedWeeklyOpeningHours>;
  for(const day of hours.days)if(day.intervals.length)
    day.intervals=[{start:"09:00",end:"17:00"}];
  const result=generated(d);
  assert.equal(result.status,"invalid");
  assert.ok(result.certification.issues.some(i=>
    i.code==="WEEKLY_HOURS_MISSING"));
  assert.ok(result.shortfalls.some(s=>s.missingMinutes>0));
});

test("Um único colaborador não pode certificar cobertura de 09-19 se faz 8h efetivas",()=>{
  const d=scenario();
  d.team={members:[{id:ANA,name:"Ana",active:true}]};
  const result=generated(d);
  assert.equal(result.status,"invalid");
  assert.ok(result.certification.issues.some(i=>i.code==="OPENING_UNCOVERED"));
});

test("Rotação de entrada permanece semanal com dois colaboradores",()=>{
  const d=scenario();
  const result=generateSchedule({
    period:{mode:"14d",start:"2026-11-02"},
    team:d.team,openingHours:d.openingHours,mealBreakPolicy:"v2",
  });
  assert.equal(result.status,"valid",JSON.stringify(result.certification.issues));
  for(const id of [ANA,RUI]){
    const first=(date:string)=>result.candidateAssignments.find(a=>
      a.memberId===id&&a.date===date)!.start;
    assert.equal(first("2026-11-02"),first("2026-11-06"));
    assert.equal(first("2026-11-09"),first("2026-11-13"));
    assert.notEqual(first("2026-11-02"),first("2026-11-09"));
  }
});

test("O mês de 31 dias conserva as datas exteriores read-only",()=>{
  const d=scenario();
  const input={
    period:{mode:"monthly" as const,year:2026,month:12},
    team:d.team,openingHours:d.openingHours,
    mealBreakPolicy:"v2" as const,
  };
  const before=JSON.stringify(input);
  const result=generateSchedule(input);
  assert.ok(result.candidateAssignments.every(a=>
    a.date>="2026-12-01"&&a.date<"2027-01-01"));
  assert.ok(result.candidateAssignments.every(a=>!a.mealBreak ||
    clockMinutes(a.mealBreak.end)-clockMinutes(a.mealBreak.start)===60));
  assert.notEqual(result.status,"valid",
    "Sem contexto de meses vizinhos nunca há certificação válida");
  assert.ok(result.certification.issues.some(i=>
    i.code==="CONTEXT_INCOMPLETE"));
  assert.equal(JSON.stringify(input),before);
});
