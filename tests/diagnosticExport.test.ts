import test from "node:test";
import assert from "node:assert/strict";
import {
  buildScheduleDiagnostic,diagnosticFileName,DIAGNOSTIC_SCHEMA_VERSION,
} from "../src/diagnosticExport";
import {certifySchedule} from "../src/certifySchedule";
import {suggestedWeeklyOpeningHours} from "../src/operatingHours";
import {assignmentMinutes} from "../src/workAssignments";
import type {WorkAssignment} from "../src/workAssignments";

const A="00000000-0000-4000-8000-000000000001";
const B="00000000-0000-4000-8000-000000000002";

function example() {
  const team={members:[
    {id:A,name:"Pessoa A",active:true,weeklyDaysOff:2,
      fixedDaysOff:["wednesday" as const],
      weekendRest:{minimumWeekdayDaysOffOnFullWeekend:1}},
    {id:B,name:"Pessoa B",active:true,weeklyDaysOff:2,
      weekendRest:{minimumWeekdayDaysOffOnFullWeekend:1}},
  ]};
  const opening=suggestedWeeklyOpeningHours();
  for(const day of opening.days)day.intervals=[
    {start:"08:30",end:"19:00"},
  ];
  opening.days[6].intervals=[{start:"14:00",end:"19:00"}];
  const assignments:WorkAssignment[]=[
    {memberId:A,date:"2026-11-02",start:"08:30",end:"17:30",
      mealBreak:{start:"12:00",end:"13:00"}},
    {memberId:B,date:"2026-11-01",start:"14:00",end:"19:00"},
  ];
  const report=certifySchedule({
    period:{mode:"monthly",year:2026,month:11},
    team,openingHours:opening,candidateAssignments:assignments,
    mealBreakPolicy:"v2",hoursPolicy:"rolling28",
  });
  const input={
    exportedAt:"2026-11-22T10:00:00.000Z",
    year:2026,month:11,
    mode:"generated_preview" as const,
    team,openingHours:opening,
    assignments,savedAssignments:null,
    mealBreaks:[],
    mealBreakPolicy:"v2" as const,
    hoursPolicy:"rolling28" as const,
    plannedRest:[{memberId:B,weekStart:"2026-11-02",
      daysWithoutWork:["2026-11-03","2026-11-07","2026-11-08"],
      fullWeekendOff:true}],
    externalContext:{assignments:[],completeDates:["2026-10-31"]},
    rollingHistory:{assignments:[],completeDates:[]},
    sourceStatuses:{team:"loaded",openingHours:"loaded",
      adjacentMonths:"loaded",rollingHistory:"loaded",savedMonth:"empty"},
    generation:null,displayedCertification:report,
    currentConfigurationCertification:report,
    settingsMatchGeneratedPreview:true,
  };
  return input;
}

test("o diagnóstico exporta configuração e turnos REAIS, mesmo sem proposta guardada",()=>{
  const input=example();
  const before=JSON.stringify(input);
  const diagnostic=buildScheduleDiagnostic(input);
  assert.equal(diagnostic.schema,"schedule-engine-diagnostic");
  assert.equal(diagnostic.schemaVersion,DIAGNOSTIC_SCHEMA_VERSION);
  assert.equal(diagnostic.origin,"generated_preview");
  assert.equal(diagnostic.configuration.team?.members[0].name,"Pessoa A");
  assert.equal(diagnostic.configuration.team?.members[0].fixedDaysOff?.[0],
    "wednesday");
  assert.equal(diagnostic.configuration.openingHours?.days[6].intervals[0].start,
    "14:00");
  assert.deepEqual(diagnostic.proposal.assignments,input.assignments);
  assert.equal(diagnostic.proposal.savedAssignmentsForComparison,null);
  assert.equal(diagnostic.proposal.explicitlyPlannedRest[0].fullWeekendOff,true);
  assert.deepEqual(diagnostic.context.adjacentMonths?.completeDates,
    ["2026-10-31"]);
  assert.deepEqual(diagnostic.validation.displayed,input.displayedCertification);
  assert.equal(diagnostic.settingsMatchGeneratedPreview,true);
  assert.equal(JSON.stringify(input),before,"exportação nunca altera a proposta");
  const json=JSON.parse(JSON.stringify(diagnostic));
  assert.equal(json.analysis.byDay.length,30);
  assert.equal(json.analysis.byDay.find((day:{date:string})=>
    day.date==="2026-11-01").employeesWithShifts,1);
  assert.equal(json.analysis.byDay.find((day:{date:string})=>
    day.date==="2026-11-02").employeesWithShifts,1);
});

test("os totais por pessoa distinguem trabalho efetivo, domingos e folgas planeadas",()=>{
  const diagnostic=buildScheduleDiagnostic(example());
  const personA=diagnostic.analysis.byMember.find(p=>p.memberId===A)!;
  const personB=diagnostic.analysis.byMember.find(p=>p.memberId===B)!;
  assert.equal(personA.effectiveWorkMinutes,480);
  assert.equal(personA.daysWithShifts,1);
  assert.equal(personA.sundaysWorked,0);
  assert.equal(personB.effectiveWorkMinutes,300);
  assert.equal(personB.sundaysWorked,1);
  assert.equal(personB.fullWeekendsOffPlanned,1);
  assert.equal(diagnostic.analysis.byDay.find(day=>
    day.date==="2026-11-02")?.effectiveWorkMinutes,480);
  assert.equal(assignmentMinutes(example().assignments[0]),480);
});

test("mudanças de configuração e ausência de histórico são explicitadas, sem simular sucesso",()=>{
  const input=example();
  input.settingsMatchGeneratedPreview=false;
  input.externalContext=null as never;
  input.rollingHistory=null as never;
  input.sourceStatuses.adjacentMonths="invalid";
  input.sourceStatuses.rollingHistory="unavailable";
  const diagnostic=buildScheduleDiagnostic(input);
  assert.equal(diagnostic.settingsMatchGeneratedPreview,false);
  assert.equal(diagnostic.sourceStatuses.rollingHistory,"unavailable");
  assert.equal(diagnostic.context.adjacentMonths,null);
  assert.equal(diagnostic.interpretation.context.includes("desconhecidas"),true);
  assert.equal(diagnostic.privacy.includesEmployeeNamesAndSchedules,true);
  assert.equal(diagnostic.privacy.containsCredentials,false);
});

test("ficheiro é JSON estável por mês e não contém campos de autenticação ou browser",()=>{
  const diagnostic=buildScheduleDiagnostic(example());
  const raw=JSON.stringify(diagnostic);
  assert.equal(diagnosticFileName(2026,11),
    "schedule-engine-diagnostico-2026-11.json");
  assert.equal(raw.includes("localStorage"),false);
  assert.equal(raw.includes("password"),false);
  assert.equal(raw.includes("authToken"),false);
  assert.equal(raw.includes("revision"),false);
  assert.equal(raw.includes("2026-11-22T10:00:00.000Z"),true);
});

test("sem turnos ainda se podem exportar a equipa e o funcionamento para diagnóstico",()=>{
  const input=example();
  input.assignments=[];
  input.mode="configuration_only";
  input.displayedCertification=null;
  input.currentConfigurationCertification=null;
  const doc=buildScheduleDiagnostic(input);
  assert.equal(doc.origin,"configuration_only");
  assert.equal(doc.analysis.byMember[0].effectiveWorkMinutes,0);
  assert.equal(doc.analysis.byDay.every(day=>day.employeesWithShifts===0),true);
  assert.equal(doc.configuration.team?.members.length,2);
});
