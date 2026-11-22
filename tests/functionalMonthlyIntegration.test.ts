import test from "node:test";
import assert from "node:assert/strict";
import {generateSchedule,type GenerationInput} from "../src/generateSchedule";
import {certifySchedule} from "../src/certifySchedule";
import {suggestedWeeklyOpeningHours} from "../src/operatingHours";
import {enumerateCivilDays,resolvePlanningPeriod} from "../src/schedulePeriods";
import {saveMonthlyDraft,loadMonthlyDraft} from "../src/monthlyScheduleDraftRepository";
import {allocateFunctionalMonth} from "../src/functionalScheduling";
import {certifyFunctionalCoverage} from "../src/functionalCoverage";
import {assignmentMinutes} from "../src/workAssignments";
import type {WorkAssignment} from "../src/workAssignments";

function sample(checkouts:number,sales:number,flexible:number,mode:"monthly"|"28d"="monthly"){
  const roster=[
    ...Array.from({length:checkouts},(_,i)=>({
      id:"00000000-0000-4000-8000-"+String(i+1).padStart(12,"0"),
      name:"Caixa "+i,active:true,qualifiedRoles:["checkout"],
    })),
    ...Array.from({length:sales},(_,i)=>({
      id:"00000000-0000-4000-8000-"+String(i+101).padStart(12,"0"),
      name:"Vendas "+i,active:true,qualifiedRoles:["sales"],
    })),
    ...Array.from({length:flexible},(_,i)=>({
      id:"00000000-0000-4000-8000-"+String(i+201).padStart(12,"0"),
      name:"Polivalente "+i,active:true,qualifiedRoles:["checkout","sales"],
    })),
  ];
  const openingHours=suggestedWeeklyOpeningHours();
  for(const day of openingHours.days)day.intervals=[
    {start:"09:00",end:"13:00"},
  ];
  const period=mode==="monthly"
    ?{mode:"monthly" as const,year:2026,month:11}
    :{mode:"28d" as const,start:"2026-11-02"};
  const input:GenerationInput={
    team:{members:roster},openingHours,period,
    hoursPolicy:"rolling28",mealBreakPolicy:"v2",
  };
  return input;
}
function dayRoles(shifts:WorkAssignment[],day:string):Record<string,number>{
  return Object.fromEntries(["checkout","sales"].map(role=>
    [role,shifts.filter(a=>a.date===day && a.role===role).length]));
}

test("PR94: 30 dias completos colocam dois polivalentes na Caixa quando necessário",()=>{
  const input=sample(1,3,2);
  const baseline=JSON.stringify(input);
  const result=generateSchedule(input);
  assert.equal(result.functionalCoveragePolicy,"qualified50");
  assert.equal(result.status,"insufficient_context");
  assert.ok(result.certification.issues.every(i=>i.code==="CONTEXT_INCOMPLETE"),
    JSON.stringify(result.certification.issues.slice(0,8)));
  const days=enumerateCivilDays(resolvePlanningPeriod(input.period));
  assert.equal(days.length,30);
  assert.equal(result.candidateAssignments.length,180);
  for(const day of days){
    assert.deepEqual(dayRoles(result.candidateAssignments,day),
      {checkout:3,sales:3},day);
    const shifts=result.candidateAssignments.filter(a=>a.date===day);
    assert.ok(shifts.every(shift=>shift.start==="09:00"&&shift.end==="13:00"));
    assert.equal(new Set(shifts.map(s=>s.memberId)).size,6);
  }
  assert.equal(JSON.stringify(input),baseline);
  assert.deepEqual(result,generateSchedule(input),"determinismo");
  assert.deepEqual(certifySchedule({
    ...input,candidateAssignments:result.candidateAssignments,
    functionalCoveragePolicy:"qualified50",
  }),result.certification,"validador mensal independente");
});

test("PR94: inversão do défice coloca polivalentes nas Vendas em 28 dias",()=>{
  const input=sample(3,1,2,"28d");
  const result=generateSchedule(input);
  assert.equal(result.status,"valid",JSON.stringify(result.certification.issues.slice(0,8)));
  assert.equal(result.candidateAssignments.length,168);
  assert.equal(result.certification.issues.length,0);
  for(const day of enumerateCivilDays(resolvePlanningPeriod(input.period)))
    assert.deepEqual(dayRoles(result.candidateAssignments,day),
      {checkout:3,sales:3},day);
});

test("PR94: calendário de 31 dias mantém um único posto por turno",()=>{
  const input=sample(1,3,2);
  input.period={mode:"monthly",year:2026,month:12};
  const result=generateSchedule(input);
  const days=enumerateCivilDays(resolvePlanningPeriod(input.period));
  assert.equal(days.length,31);
  assert.equal(result.candidateAssignments.length,6*31);
  for(const day of days)assert.deepEqual(
    dayRoles(result.candidateAssignments,day),{checkout:3,sales:3},day);
  assert.ok(!result.certification.issues.some(i=>
    i.code==="FUNCTIONAL_COVERAGE_GAP"||
    i.code==="FUNCTIONAL_ASSIGNMENT_INVALID"));
});

test("PR94: quando é impossível cumprir 50% das duas funções, nunca declara válido",()=>{
  const input=sample(2,2,4,"28d");
  input.team={
    members:input.team.members.map(person=>({...person,weeklyDaysOff:2})),
  };
  const result=generateSchedule(input);
  assert.equal(result.functionalCoveragePolicy,"qualified50");
  assert.equal(result.certification.status,"invalid");
  assert.ok(result.certification.issues.some(i=>
    i.code==="FUNCTIONAL_COVERAGE_GAP"),
    JSON.stringify(result.certification.issues.slice(0,10)));
  assert.equal(result.status,"invalid");
  assert.ok(result.candidateAssignments.every(shift=>shift.role));
});

test("PR94: a ausência ou falsificação de postos invalida a proposta funcional",()=>{
  const input=sample(1,3,2,"28d");
  const result=generateSchedule(input);
  assert.equal(result.certification.status,"valid");
  const tampered=result.candidateAssignments.map(a=>({...a}));
  delete tampered[0].role;
  const missing=certifySchedule({
    ...input,candidateAssignments:tampered,
    functionalCoveragePolicy:"qualified50",
  });
  assert.equal(missing.status,"invalid");
  assert.ok(missing.issues.some(i=>i.code==="FUNCTIONAL_ASSIGNMENT_INVALID"));
  tampered[0].role="unknown";
  const invalid=certifySchedule({
    ...input,candidateAssignments:tampered,
    functionalCoveragePolicy:"qualified50",
  });
  assert.equal(invalid.status,"invalid");
  assert.ok(invalid.issues.some(i=>i.code==="FUNCTIONAL_ASSIGNMENT_INVALID"));
  const missingPolicy=certifySchedule({
    ...input,candidateAssignments:result.candidateAssignments,
  });
  assert.equal(missingPolicy.status,"invalid");
  assert.ok(missingPolicy.issues.some(i=>i.code==="INVALID_FUNCTIONAL_POLICY"));
});

test("PR94: gravação/leitura preserva funções e política e os legados continuam legíveis",()=>{
  const input=sample(1,3,2);
  const generated=generateSchedule(input);
  const stored=new Map<string,string>();
  const memory={
    getItem:(key:string)=>stored.get(key)??null,
    setItem:(key:string,value:string)=>{stored.set(key,value);},
  };
  const saved=saveMonthlyDraft(memory,2026,11,
    generated.candidateAssignments,null,undefined,"v2","rolling28",
    undefined,"qualified50");
  assert.equal(saved.ok,true);
  const restored=loadMonthlyDraft(memory,2026,11);
  assert.equal(restored.status,"loaded");
  if(restored.status==="loaded"){
    assert.equal(restored.functionalCoveragePolicy,"qualified50");
    assert.deepEqual(restored.assignments,generated.candidateAssignments);
  }
  const corrupt=generated.candidateAssignments.map(s=>({...s}));
  delete corrupt[0].role;
  const blocked=saveMonthlyDraft(memory,2026,11,corrupt,
    saved.ok?saved.revision:null,undefined,"v2","rolling28",undefined,
    "qualified50");
  assert.equal(blocked.ok,false);
  assert.deepEqual(loadMonthlyDraft(memory,2026,11),restored,
    "não substitui registo válido por dados inválidos");
  const legacyMemory={
    getItem:(key:string)=>key.includes("2026-11")?
      JSON.stringify({version:1,year:2026,month:11,assignments:[]}):null,
    setItem:(_:string,__:string)=>{},
  };
  const legacy=loadMonthlyDraft(legacyMemory,2026,11);
  assert.equal(legacy.status,"loaded");
  if(legacy.status==="loaded"){
    assert.equal(legacy.functionalCoveragePolicy,undefined);
    assert.deepEqual(legacy.assignments,[]);
  }
});


test("PR94: o planeador corrige pausas simultâneas em ambos os postos sem mudar horas",()=>{
  const input=sample(2,2,0,"28d");
  const date="2026-11-02";
  const members=input.team.members;
  const shifts=members.map(m=>({
    memberId:m.id,date,start:"09:00",end:"18:00",
    mealBreak:{start:"12:00",end:"13:00"},
  }));
  for(const day of input.openingHours.days)day.intervals=[
    {start:"09:00",end:"18:00"},
  ];
  const period=resolvePlanningPeriod(input.period);
  const plan=allocateFunctionalMonth(shifts,period,members,input.openingHours);
  assert.equal(plan.length,4);
  assert.deepEqual(plan.map(a=>assignmentMinutes(a)),
    shifts.map(a=>assignmentMinutes(a)),
    "o ajuste não pode inventar ou retirar minutos efetivos");
  const functional=certifyFunctionalCoverage({
    date,assignments:plan,members,opening:[{start:"09:00",end:"18:00"}],
    roles:["checkout","sales"],minimumPercent:50,
  },plan.map(a=>({memberId:a.memberId,role:a.role!})));
  assert.equal(functional.status,"covered",JSON.stringify(functional.issues));
  assert.ok(plan.some(a=>a.mealBreak?.start!=="12:00"),
    "o escalonador deve separar pausas coincidentes por função");
  for(const role of ["checkout","sales"])assert.ok(
    functional.slots.every(slot=>slot.counts[role]>=1));
  assert.deepEqual(allocateFunctionalMonth(shifts,period,members,input.openingHours),
    plan,"determinismo");
});
