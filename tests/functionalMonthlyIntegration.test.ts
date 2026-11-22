import test from "node:test";
import assert from "node:assert/strict";
import {generateSchedule,type GenerationInput} from "../src/generateSchedule";
import {certifySchedule} from "../src/certifySchedule";
import {suggestedWeeklyOpeningHours} from "../src/operatingHours";
import {enumerateCivilDays,resolvePlanningPeriod} from "../src/schedulePeriods";
import {saveMonthlyDraft,loadMonthlyDraft} from "../src/monthlyScheduleDraftRepository";
import {allocateFunctionalMonth} from "../src/functionalScheduling";
import {certifyFunctionalCoverage} from "../src/functionalCoverage";
import {analyzeFunctionalCapacity} from "../src/functionalCapacityAnalysis";
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

test("PR94: objetivo abaixo de 50% não invalida turnos operacionalmente corretos",()=>{
  const input=sample(2,2,4,"28d");
  const generated=generateSchedule(input);
  assert.equal(generated.certification.status,"valid");
  // Uma segunda-feira fica com os dois vendedores exclusivos de serviço.
  // A loja tem pessoas presentes durante toda a abertura, mas não tem
  // ninguém em Caixa e fica aquém do objetivo SOFT (3 Caixa + 3 Vendas).
  const monday="2026-11-02";
  const staffSales=new Set(input.team.members
    .filter(m=>m.qualifiedRoles.length===1 &&
      m.qualifiedRoles[0]==="sales").map(m=>m.id));
  const candidate=generated.candidateAssignments.filter(shift=>
    shift.date!==monday||staffSales.has(shift.memberId));
  const certification=certifySchedule({
    ...input,candidateAssignments:candidate,
    functionalCoveragePolicy:"qualified50",
  });
  assert.equal(certification.status,"valid",
    JSON.stringify(certification.issues.slice(0,10)));
  assert.ok(!certification.issues.some(i=>
    i.code==="FUNCTIONAL_COVERAGE_GAP"||
    i.code==="FUNCTIONAL_CAPACITY_SHORTFALL"));
  const quality=analyzeFunctionalCapacity({
    period:input.period,team:input.team,openingHours:input.openingHours,
    assignments:candidate,minimumPercent:50,
  });
  assert.ok(quality);
  assert.ok(quality.observedRoleGapMinutes>0,
    "a diferença à meta permanece visível, mas nunca é um HARD issue");
  const day=quality.days.find(d=>d.date===monday)!;
  assert.ok(day.observedRoleGapMinutes>0);
  assert.equal(day.simultaneousDeficitMinutes,4*60*4,
    "seis postos de referência menos dois trabalhadores = 4 pessoas-hora por hora");
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
  const plan=allocateFunctionalMonth(shifts,period,members,input.openingHours,["checkout","sales"]);
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
  assert.deepEqual(allocateFunctionalMonth(shifts,period,members,input.openingHours,["checkout","sales"]),
    plan,"determinismo");
});


test("PR94: meta SOFT inalcançável não bloqueia melhoria parcial das pausas",()=>{
  const input=sample(3,3,0,"28d");
  const date="2026-11-02";
  const selected=input.team.members.filter((_,i)=>i===0||i===1||i===3||i===4);
  const shifts=selected.map((m,i)=>({
    memberId:m.id,date,start:"09:00",end:"18:00",
    mealBreak:i<2
      ?{start:"12:00",end:"13:00"}
      :i===2?{start:"14:00",end:"15:00"}
        :{start:"15:00",end:"16:00"},
  }));
  for(const day of input.openingHours.days)day.intervals=[
    {start:"09:00",end:"18:00"},
  ];
  const opening=[{start:"09:00",end:"18:00"}];
  const roles=["checkout","sales"];
  const quality=(planned:WorkAssignment[])=>certifyFunctionalCoverage({
    date,members:input.team.members,assignments:planned,
    opening,roles,minimumPercent:50,
  },planned.map(a=>({memberId:a.memberId,role:a.role!})));
  const before=quality(shifts.map(s=>({
    ...s,role:input.team.members.find(m=>m.id===s.memberId)!.qualifiedRoles[0],
  })));
  const absent=(report:ReturnType<typeof quality>)=>
    report.slots.reduce((n,slot)=>n+
      (slot.counts.checkout===0?assignmentMinutes({
        memberId:selected[0].id,date,start:slot.start,end:slot.end,
      }):0)+
      (slot.counts.sales===0?assignmentMinutes({
        memberId:selected[0].id,date,start:slot.start,end:slot.end,
      }):0),0);
  assert.equal(absent(before),60,"os dois Caixas param em simultâneo");
  // 3 habilitados por função => alvo 2+2 pessoas por minuto.
  // Trabalham só 4 pessoas com 8h efetivas num dia aberto por 9h:
  // 32 horas disponíveis < 36h da meta. Mesmo assim deve evitar
  // que um dos postos fique inteiramente vazio durante uma hora.
  const originalMinutes=shifts.reduce((sum,s)=>sum+assignmentMinutes(s),0);
  assert.equal(originalMinutes,32*60);
  const optimized=allocateFunctionalMonth(
    shifts,resolvePlanningPeriod(input.period),
    input.team.members,input.openingHours,roles);
  assert.equal(optimized.reduce((sum,s)=>sum+assignmentMinutes(s),0),
    originalMinutes,"nunca inventar horas para atingir a meta");
  assert.equal(optimized.length,4);
  const report=quality(optimized);
  assert.equal(absent(report),0,
    "alternar refeições deve evitar o posto sem ninguém mesmo abaixo dos 50%");
  assert.equal(report.status,"uncovered",
    "a impossibilidade dos 50% continua visível como qualidade SOFT");
  assert.ok(optimized.some(a=>a.mealBreak?.start!=="12:00"));
  assert.deepEqual(
    allocateFunctionalMonth(shifts,resolvePlanningPeriod(input.period),
      input.team.members,input.openingHours,roles),
    optimized,"resultado determinístico");
});


test("PR94: sábado mantém almoço plausível quando a função já está coberta",()=>{
  // Synthetic, anonymized reproduction of the five-worker Saturday.
  // A specialist's 11:30 meal must not be moved to 17:00 merely
  // to reach a SOFT target that remains unattainable.
  const input=sample(3,3,2,"28d");
  const roster=input.team.members;
  const date="2026-11-28";
  for(const day of input.openingHours.days)
    day.intervals=[{start:"08:30",end:"19:00"}];
  const shifts:WorkAssignment[]=[
    {memberId:roster[6].id,date,start:"09:00",end:"19:00",
      mealBreak:{start:"13:00",end:"14:00"}},
    {memberId:roster[0].id,date,start:"08:30",end:"18:30",
      mealBreak:{start:"11:30",end:"12:30"}},
    {memberId:roster[7].id,date,start:"08:30",end:"17:00",
      mealBreak:{start:"11:30",end:"12:30"}},
    {memberId:roster[3].id,date,start:"09:00",end:"19:00",
      mealBreak:{start:"12:30",end:"13:30"}},
    {memberId:roster[1].id,date,start:"09:00",end:"18:15",
      mealBreak:{start:"12:00",end:"13:00"}},
  ];
  const result=allocateFunctionalMonth(shifts,
    resolvePlanningPeriod(input.period),roster,input.openingHours,
    ["checkout","sales"]);
  assert.equal(result.length,5);
  const report=certifyFunctionalCoverage({
    date,members:roster,assignments:result,
    opening:[{start:"08:30",end:"19:00"}],
    roles:["checkout","sales"],minimumPercent:50,
  },result.map(a=>({memberId:a.memberId,role:a.role!})));
  assert.notEqual(report.status,"invalid_input");
  assert.ok(report.slots.every(slot=>
    slot.counts.checkout>0 && slot.counts.sales>0),
    "no role may remain entirely deserted during the opening");
  assert.equal(result.find(a=>a.memberId===roster[0].id)!
    .mealBreak?.start,"11:30",
    "do not push a midday lunch to 17:00 for an unchanged SOFT score");
  assert.deepEqual(result.map(assignmentMinutes),
    shifts.map(assignmentMinutes),"preserve everyone's effective hours");
  assert.deepEqual(allocateFunctionalMonth(shifts,
    resolvePlanningPeriod(input.period),roster,input.openingHours,
    ["checkout","sales"]),result,"deterministic cleanup");
});
