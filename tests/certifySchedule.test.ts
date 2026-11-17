import test from "node:test";
import assert from "node:assert/strict";
import {certifySchedule,type CertificationInput} from "../src/certifySchedule";
import {resolvePlanningPeriod,enumerateCivilDays,civilDayOfWeek,
  type PeriodRequest} from "../src/schedulePeriods";
import {suggestedWeeklyOpeningHours} from "../src/operatingHours";
import {compareWeeklyHours,REQUIRED_WEEKLY_MINUTES} from "../src/weeklyHours";
import type {WorkAssignment} from "../src/workAssignments";

const ANA="1a2b3c4d-3333-4444-8aaa-123456789abc";
const RUI="1a2b3c4d-3333-4444-8aaa-123456789abd";
const team={members:[{id:ANA,name:"Ana",active:true}]};
const company=()=>{
  const hours=suggestedWeeklyOpeningHours();
  for(const day of hours.days)if(day.intervals.length>0)
    day.intervals=[{start:"08:00",end:"21:00"}];
  return hours;
};
const work=(date:string,memberId=ANA,start="09:00",end="17:00"):WorkAssignment=>
  ({date,memberId,start,end});
const weekdays=(start:string,endExclusive:string,memberId=ANA,startHour="09:00",endHour="17:00")=>
  enumerateCivilDays({start,endExclusive})
    .filter(date=>civilDayOfWeek(date)<5)
    .map(date=>work(date,memberId,startHour,endHour));
const input=(period:PeriodRequest):CertificationInput=>({
  period,team,openingHours:company(),
  candidateAssignments:weekdays(
    resolvePlanningPeriod(period).start,
    resolvePlanningPeriod(period).endExclusive
  ),
});
function codes(data:CertificationInput){
  return certifySchedule(data).issues.map(e=>e.code);
}

test("40h = 2400 minutos: hard constraint exata",()=>{
  assert.equal(REQUIRED_WEEKLY_MINUTES,2400);
  assert.deepEqual(compareWeeklyHours(2400),{
    kind:"exact",requiredMinutes:2400,actualMinutes:2400,differenceMinutes:0,
  });
  assert.equal(compareWeeklyHours(2280).kind,"missing");
  assert.equal(compareWeeklyHours(2520).kind,"excess");
  assert.throws(()=>compareWeeklyHours(2400.5));
});

test("Uma semana completa com 40h é válida",()=>{
  const result=certifySchedule(input({mode:"weekly",start:"2026-11-02"}));
  assert.equal(result.status,"valid");
  assert.equal(result.issues.length,0);
  assert.equal(result.weeks.length,1);
  assert.equal(result.weeks[0].actualMinutes,2400);
  assert.equal(result.weeks[0].differenceMinutes,0);
});

test("40h válidas não exigem cobertura mínima de toda a abertura da empresa",()=>{
  const data=input({mode:"weekly",start:"2026-11-02"});
  // Empresa aberta 08:00–21:00; colaborador trabalha apenas 09:00–17:00.
  // Os intervalos 08:00–09:00 e 17:00–21:00 podem ficar sem ninguém.
  const result=certifySchedule(data);
  assert.equal(result.status,"valid");
  assert.equal(result.weeks[0].actualMinutes,2400);
  assert.equal(result.issues.length,0);
});

test("38h é inválido: não é uma penalização suave",()=>{
  const data=input({mode:"weekly",start:"2026-11-02"});
  (data.candidateAssignments as WorkAssignment[])[0].end="15:00";
  const result=certifySchedule(data);
  assert.equal(result.status,"invalid");
  assert.ok(codes(data).includes("WEEKLY_HOURS_MISSING"));
  assert.equal(result.weeks[0].actualMinutes,2280);
});

test("42h é inválido: excesso também viola a regra fixa",()=>{
  const data=input({mode:"weekly",start:"2026-11-02"});
  (data.candidateAssignments as WorkAssignment[])[0].end="19:00";
  const result=certifySchedule(data);
  assert.equal(result.status,"invalid");
  assert.ok(result.issues.some(i=>i.code==="WEEKLY_HOURS_EXCESS" &&
    i.actualMinutes===2520));
});

test("14 dias com 30h+50h não satisfazem as duas semanas",()=>{
  const data=input({mode:"14d",start:"2026-11-02"});
  data.candidateAssignments=[
    ...weekdays("2026-11-02","2026-11-09",ANA,"09:00","15:00"),
    ...weekdays("2026-11-09","2026-11-16",ANA,"09:00","19:00"),
  ];
  const report=certifySchedule(data);
  assert.equal(report.status,"invalid");
  assert.deepEqual(report.weeks.map(w=>w.actualMinutes),[1800,3000]);
  assert.ok(report.issues.some(i=>i.code==="WEEKLY_HOURS_MISSING"));
  assert.ok(report.issues.some(i=>i.code==="WEEKLY_HOURS_EXCESS"));
});

test("14, 21 e 28 dias validam cada semana, sem compensações globais",()=>{
  for(const mode of ["14d","21d","28d"] as const){
    const report=certifySchedule(input({mode,start:"2026-11-02"}));
    assert.equal(report.status,"valid",mode);
    assert.equal(report.weeks.length,mode==="14d"?2:mode==="21d"?3:4);
    assert.ok(report.weeks.every(w=>w.actualMinutes===2400));
  }
});

function completeExternalDates(){
  return [
    ...enumerateCivilDays({start:"2026-10-26",endExclusive:"2026-11-01"}),
    ...enumerateCivilDays({start:"2026-12-01",endExclusive:"2026-12-07"}),
  ];
}
function november(){
  const request:PeriodRequest={mode:"monthly",year:2026,month:11};
  const data=input(request);
  data.externalContext={
    assignments:[
      ...weekdays("2026-10-26","2026-11-01"),
      ...weekdays("2026-12-01","2026-12-07"),
    ],
    completeDates:completeExternalDates(),
  };
  return data;
}

test("Novembro certifica 40h semanais consultando outubro/dezembro sem os alterar",()=>{
  const data=november();
  const oldContext=JSON.stringify(data.externalContext);
  const oldCandidate=JSON.stringify(data.candidateAssignments);
  const report=certifySchedule(data);
  assert.equal(report.status,"valid");
  assert.deepEqual(report.weeks.map(w=>w.actualMinutes),
    [2400,2400,2400,2400,2400,2400]);
  assert.equal(report.weeks.length,6);
  assert.equal(JSON.stringify(data.externalContext),oldContext);
  assert.equal(JSON.stringify(data.candidateAssignments),oldCandidate);
  assert.equal(report.period?.start,"2026-11-01");
  assert.equal(report.period?.endExclusive,"2026-12-01");
  assert.equal(report.period?.validation.start,"2026-10-26");
  assert.equal(report.period?.validation.endExclusive,"2026-12-07");
});

test("Se dezembro estiver indefinido, a semana de fronteira não é declarada válida",()=>{
  const data=november();
  data.externalContext={
    assignments:weekdays("2026-10-26","2026-11-01"),
    completeDates:completeExternalDates().filter(date=>date<"2026-12-01"),
  };
  const report=certifySchedule(data);
  assert.equal(report.status,"insufficient_context");
  assert.ok(report.issues.some(i=>i.code==="CONTEXT_INCOMPLETE" &&
    i.weekStart==="2026-11-30"));
  assert.equal(report.weeks.at(-1)?.complete,false);
  assert.equal(report.weeks.at(-1)?.differenceMinutes,null);
});

test("Ter turnos noutro mês não prova que os dias vazios desse mês são conhecidos",()=>{
  const data=november();
  data.externalContext!.completeDates=[];
  assert.equal(certifySchedule(data).status,"insufficient_context");
});

test("Horários externos continuam em leitura mesmo com abertura atual diferente",()=>{
  const data=november();
  const context=data.externalContext!.assignments as WorkAssignment[];
  for(const item of context){
    item.start="06:00";
    item.end="14:00";
  }
  const report=certifySchedule(data);
  assert.equal(report.status,"valid");
  assert.equal(report.issues.length,0);
});

test("Proposta com turno em dezembro é inválida, mesmo que dezembro esteja em rascunho",()=>{
  const data=november();
  (data.candidateAssignments as WorkAssignment[]).push(work("2026-12-01"));
  const report=certifySchedule(data);
  assert.equal(report.status,"invalid");
  assert.ok(report.issues.some(e=>e.code==="OUTSIDE_EDITABLE_PERIOD" &&
    e.date==="2026-12-01"));
  assert.equal(report.period?.endExclusive,"2026-12-01");
});

test("Contexto nunca pode conter turnos dentro do mês editável",()=>{
  const data=november();
  (data.externalContext!.assignments as WorkAssignment[]).push(work("2026-11-02"));
  assert.ok(codes(data).includes("CONTEXT_IN_EDITABLE_PERIOD"));
});

test("Intervalos sobrepostos são rejeitados sem duplicar uma carga válida",()=>{
  const data=input({mode:"weekly",start:"2026-11-02"});
  (data.candidateAssignments as WorkAssignment[]).push(work("2026-11-02",ANA,"12:00","15:00"));
  assert.equal(certifySchedule(data).status,"invalid");
  assert.ok(codes(data).includes("OVERLAPPING_WORK"));
});

test("Turno num dia encerrado ou fora do funcionamento é inválido",()=>{
  const data=input({mode:"weekly",start:"2026-11-02"});
  (data.candidateAssignments as WorkAssignment[]).push(work("2026-11-08"));
  assert.ok(codes(data).includes("OUTSIDE_OPENING_HOURS"));
});

test("Colaborador inativo não recebe novos turnos; ativo mantém 40h",()=>{
  const data=input({mode:"weekly",start:"2026-11-02"});
  data.team={members:[...team.members,{id:RUI,name:"Rui",active:false}]};
  assert.equal(certifySchedule(data).status,"valid");
  (data.candidateAssignments as WorkAssignment[]).push(work("2026-11-02",RUI));
  assert.ok(codes(data).includes("INACTIVE_MEMBER"));
});

test("Vários colaboradores ativos exigem 40h cada um",()=>{
  const data=input({mode:"weekly",start:"2026-11-02"});
  data.team={members:[...team.members,{id:RUI,name:"Rui",active:true}]};
  assert.ok(codes(data).includes("WEEKLY_HOURS_MISSING"));
  data.candidateAssignments=[
    ...(data.candidateAssignments as WorkAssignment[]),
    ...weekdays("2026-11-02","2026-11-09",RUI),
  ];
  assert.equal(certifySchedule(data).status,"valid");
});

test("Não converte horas de abertura em horas atribuídas",()=>{
  const data=input({mode:"weekly",start:"2026-11-02"});
  data.candidateAssignments=[];
  const report=certifySchedule(data);
  assert.equal(report.status,"invalid");
  assert.equal(report.weeks[0].actualMinutes,0);
  assert.equal(report.weeks[0].requiredMinutes,2400);
});

test("Mesmo sem contexto completo, excesso conhecido é definitivamente inválido",()=>{
  const data=november();
  data.externalContext!.completeDates=[];
  (data.candidateAssignments as WorkAssignment[]).push(work("2026-11-30",ANA,"17:00","19:00"));
  const report=certifySchedule(data);
  // Overlaps are not counted as a valid solution, regardless of missing context.
  assert.equal(report.status,"invalid");
  assert.ok(codes(data).includes("OVERLAPPING_WORK")===false); // abuts 09–17
});

test("Datas de contexto fora do horizonte ou duplicadas são inválidas",()=>{
  const data=november();
  (data.externalContext!.completeDates as string[]).push("2027-01-01");
  assert.ok(codes(data).includes("INVALID_CONTEXT_DAY"));
  (data.externalContext!.completeDates as string[]).pop();
  (data.externalContext!.completeDates as string[]).push("2026-12-01");
  assert.ok(codes(data).includes("DUPLICATE_CONTEXT_DAY"));
});

test("Entradas estruturais inválidas nunca originam validação falsa",()=>{
  const data=input({mode:"weekly",start:"2026-11-02"});
  data.candidateAssignments=null;
  assert.ok(codes(data).includes("INVALID_ASSIGNMENT"));
  data.candidateAssignments=[{memberId:ANA,date:"2026-11-02",start:"18:00",end:"08:00"}];
  assert.ok(codes(data).includes("INVALID_ASSIGNMENT"));
  data.candidateAssignments=[work("2026-11-02","desconhecido")];
  assert.ok(codes(data).includes("UNKNOWN_MEMBER"));
  data.team={members:[]};
  assert.ok(codes(data).includes("NO_ACTIVE_MEMBERS"));
  assert.equal(certifySchedule({...data,period:{mode:"weekly",start:"2026-11-03"}}).status,"invalid");
});
