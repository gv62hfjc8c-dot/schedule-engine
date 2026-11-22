import test from "node:test";
import assert from "node:assert/strict";
import {analyzeFunctionalCapacity} from "../src/functionalCapacityAnalysis";
import type {WorkAssignment} from "../src/workAssignments";
import {suggestedWeeklyOpeningHours} from "../src/operatingHours";

const DATE="2026-11-02";
const P={mode:"28d" as const,start:DATE};
const MONDAYS=["2026-11-02","2026-11-09","2026-11-16","2026-11-23"];
const uuid=(n:number)=>"00000000-0000-4000-8000-"+
  String(n).padStart(12,"0");

function example(checkouts:number,sales:number,flex:number){
  const team={members:[
    ...Array.from({length:checkouts},(_,i)=>({
      id:uuid(i+1),name:"Caixa "+i,active:true,qualifiedRoles:["checkout"],
    })),
    ...Array.from({length:sales},(_,i)=>({
      id:uuid(i+101),name:"Vendas "+i,active:true,qualifiedRoles:["sales"],
    })),
    ...Array.from({length:flex},(_,i)=>({
      id:uuid(i+201),name:"Polivalente "+i,active:true,
      qualifiedRoles:["checkout","sales"],
    })),
  ]};
  const openingHours=suggestedWeeklyOpeningHours();
  for(const weekday of openingHours.days)
    weekday.intervals=weekday.day==="monday"?[
      {start:"09:00",end:"13:00"},
    ]:[];
  return {period:P,team,openingHours,minimumPercent:50};
}
type Sample=ReturnType<typeof example>;
function schedules(sample:Sample,options?:{
  ids?:string[];start?:string;end?:string;role?:string;
}):WorkAssignment[] {
  const roster=options?.ids??sample.team.members.map(m=>m.id);
  const labels=new Map(sample.team.members.map(m=>[
    m.id,m.qualifiedRoles[0],
  ]));
  return MONDAYS.flatMap(date=>roster.map(memberId=>({
    date,memberId,start:options?.start??"09:00",end:options?.end??"13:00",
    role:options?.role??labels.get(memberId)!,
  })));
}

test("PR94: 50% mantém denominadores dos polivalentes sem duplicar presença",()=>{
  const s=example(1,3,2);
  const shifts=schedules(s).map(a=>({
    ...a,role:s.team.members.find(m=>m.id===a.memberId)!
      .qualifiedRoles.length===2?"checkout":a.role,
  }));
  const before=JSON.stringify(s);
  const report=analyzeFunctionalCapacity({...s,assignments:shifts});
  assert.ok(report);
  assert.equal(report.status,"complete");
  assert.deepEqual(report.roleTargets.map(r=>[
    r.role,r.qualifiedPeople,r.minimumConcurrent,
  ]),[["checkout",3,2],["sales",5,3]]);
  assert.equal(report.openingMinutes,960);
  assert.equal(report.requiredMinutes,4800);
  assert.equal(report.scheduledInsideOpeningMinutes,5760);
  assert.equal(report.periodCapacityDeficitMinutes,0);
  assert.equal(report.dayLockedCapacityDeficitMinutes,0);
  assert.equal(report.simultaneousDeficitMinutes,0);
  assert.equal(report.observedRoleGapMinutes,0);
  assert.equal(report.emptyRoleMinutes,0);
  assert.ok(report.roleTargets.every(role=>role.emptyMinutes===0));
  assert.equal(report.roleAndAllocationGapMinutes,0);
  assert.equal(JSON.stringify(s),before);
  assert.deepEqual(report,analyzeFunctionalCapacity({...s,assignments:shifts}),
    "diagnóstico puro e determinístico");
});

test("PR94: cinco escalados para seis postos revelam falta estrutural",()=>{
  const s=example(2,2,4);
  const five=s.team.members.slice(0,5).map(m=>m.id);
  const shifts=schedules(s,{ids:five});
  const report=analyzeFunctionalCapacity({...s,assignments:shifts});
  assert.ok(report);
  assert.equal(report.requiredMinutes,5760);
  assert.equal(report.scheduledInsideOpeningMinutes,4800);
  assert.equal(report.periodCapacityDeficitMinutes,960);
  assert.equal(report.dayLockedCapacityDeficitMinutes,960);
  assert.equal(report.simultaneousDeficitMinutes,960);
  assert.equal(report.observedRoleGapMinutes,960);
  assert.equal(report.roleAndAllocationGapMinutes,0);
  assert.deepEqual(report.days.filter(d=>d.openingMinutes>0).map(d=>
    d.dailyCapacityDeficitMinutes),[240,240,240,240]);
});

test("PR94: horas totais suficientes podem estar mal posicionadas",()=>{
  const s=example(2,2,0);
  const shifts=schedules(s,{end:"11:00"});
  const report=analyzeFunctionalCapacity({...s,assignments:shifts});
  assert.ok(report);
  assert.equal(report.requiredMinutes,1920);
  assert.equal(report.scheduledInsideOpeningMinutes,1920);
  assert.equal(report.periodCapacityDeficitMinutes,0);
  assert.equal(report.dayLockedCapacityDeficitMinutes,0);
  assert.equal(report.simultaneousDeficitMinutes,960);
  assert.equal(report.observedRoleGapMinutes,960);
  assert.equal(report.emptyRoleMinutes,960,
    "duas funções ficam vazias nas últimas duas horas de quatro segundas");
  assert.deepEqual(report.roleTargets.map(r=>r.emptyMinutes),[480,480]);
  assert.equal(report.roleAndAllocationGapMinutes,0);
  assert.equal(report.status,"complete");
});

test("PR94: falta por competência não é confundida com falta de pessoas",()=>{
  const s=example(2,2,0);
  const shifts=schedules(s).map(a=>(
    a.memberId===s.team.members[2].id?{...a,role:"checkout"}:a
  ));
  const report=analyzeFunctionalCapacity({...s,assignments:shifts});
  assert.ok(report);
  assert.equal(report.periodCapacityDeficitMinutes,0);
  assert.equal(report.simultaneousDeficitMinutes,0);
  assert.equal(report.status,"incomplete_assignments");
  assert.equal(report.roleAndAllocationGapMinutes,null,
    "não comparar lacunas quando a proposta contém funções inválidas");
});

test("PR94: pausas retiram capacidade e podem criar lacuna temporal",()=>{
  const s=example(2,2,0);
  const shifts=schedules(s).map(a=>({
    ...a,mealBreak:{start:"11:00",end:"12:00"},
  }));
  const report=analyzeFunctionalCapacity({...s,assignments:shifts});
  assert.ok(report);
  assert.equal(report.requiredMinutes,1920);
  assert.equal(report.scheduledInsideOpeningMinutes,2880);
  assert.equal(report.periodCapacityDeficitMinutes,0);
  assert.equal(report.simultaneousDeficitMinutes,480,
    "no intervalo das pausas faltam duas pessoas, em quatro segundas");
  assert.equal(report.observedRoleGapMinutes,480);
  assert.equal(report.emptyRoleMinutes,480,
    "uma hora com ambas as funções vazias em quatro segundas");
  assert.deepEqual(report.days.filter(day=>day.openingMinutes>0)
    .map(day=>day.emptyRoleMinutes),[120,120,120,120]);
  assert.equal(report.dayLockedCapacityDeficitMinutes,0);
});

test("PR94: três funções genéricas continuam sujeitas aos mesmos limites",()=>{
  const s=example(1,1,0);
  const team={
    roles:[
      {id:"kitchen",label:"Cozinha"},
      {id:"frontdesk",label:"Receção"},
      {id:"storage",label:"Armazém"},
    ],
    members:[
      {id:uuid(401),name:"Ana",active:true,qualifiedRoles:["kitchen"]},
      {id:uuid(402),name:"Bruno",active:true,qualifiedRoles:["frontdesk"]},
      {id:uuid(403),name:"Carla",active:true,qualifiedRoles:["storage"]},
    ],
  };
  const shifts=MONDAYS.flatMap(date=>team.members.map(m=>({
    date,memberId:m.id,start:"09:00",end:"13:00",role:m.qualifiedRoles[0],
  })));
  const report=analyzeFunctionalCapacity({
    ...s,team,assignments:shifts,
  });
  assert.ok(report);
  assert.equal(report.roleTargets.length,3);
  assert.equal(report.requiredMinutes,2880);
  assert.equal(report.scheduledInsideOpeningMinutes,2880);
  assert.equal(report.observedRoleGapMinutes,0);
  assert.equal(report.emptyRoleMinutes,0);
});

test("PR94: entradas inválidas nunca produzem um relatório de viabilidade falso",()=>{
  const s=example(1,1,0);
  const shifts=schedules(s);
  assert.equal(analyzeFunctionalCapacity({
    ...s,minimumPercent:101,assignments:shifts,
  }),null);
  assert.equal(analyzeFunctionalCapacity({
    ...s,assignments:[...shifts,{...shifts[0]}],
  }),null,"duas jornadas para a mesma pessoa e dia");
  assert.equal(analyzeFunctionalCapacity({
    ...s,assignments:[{...shifts[0],memberId:uuid(999)}],
  }),null);
});
