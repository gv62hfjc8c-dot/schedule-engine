import test from "node:test";
import assert from "node:assert/strict";
import {
  DAILY_STAFFING_REFERENCE_PERCENT,
  desiredDailyHeadcount,scoreDailyStaffing,compareDailyStaffing,
  evaluateDailyStaffing,
} from "../src/dailyStaffingBalance";
import {generateSchedule} from "../src/generateSchedule";
import {certifySchedule} from "../src/certifySchedule";
import {
  suggestedWeeklyOpeningHours,validateWeeklyOpeningHours,
} from "../src/operatingHours";
import {
  saveOpeningHoursDraft,loadOpeningHoursDraft,
} from "../src/openingHoursDraftRepository";
import {resolvePlanningPeriod} from "../src/schedulePeriods";

const ids=Array.from({length:8},(_,i)=>
  "00000000-0000-4000-8000-"+String(i+1).padStart(12,"0"));

function scenario(){
  const openingHours=suggestedWeeklyOpeningHours();
  for(const [index,day] of openingHours.days.entries())
    day.intervals=index===6?[{start:"14:00",end:"19:00"}]:
      [{start:"08:30",end:"19:00"}];
  return {
    period:{mode:"28d" as const,start:"2026-11-02"},
    openingHours,
    mealBreakPolicy:"v2" as const,
    hoursPolicy:"rolling28" as const,
    team:{members:ids.map((id,i)=>({
      id,name:"Pessoa "+i,active:true,weeklyDaysOff:2,
      weekendRest:{minimumWeekdayDaysOffOnFullWeekend:1},
    }))},
  };
}

test("a referência de 60% é INTERNA ao algoritmo, não é configuração da empresa",()=>{
  assert.equal(DAILY_STAFFING_REFERENCE_PERCENT,60);
  assert.equal(desiredDailyHeadcount(8,DAILY_STAFFING_REFERENCE_PERCENT),5);
  assert.equal(desiredDailyHeadcount(4,DAILY_STAFFING_REFERENCE_PERCENT),3);
  assert.equal(desiredDailyHeadcount(10,DAILY_STAFFING_REFERENCE_PERCENT),6);
  assert.throws(()=>desiredDailyHeadcount(8,0));
  assert.throws(()=>desiredDailyHeadcount(8,101));
  assert.equal("dailyStaffingTargetPercent" in scenario().openingHours,false);
});

test("a pontuação continua SOFT e penaliza o défice antes da concentração",()=>{
  const open=Array.from({length:7},()=>true);
  const targets=Array.from({length:7},()=>5);
  const bad=scoreDailyStaffing([8,8,8,8,8,2,2],targets,open);
  const improved=scoreDailyStaffing([6,6,6,6,6,5,5],targets,open);
  const even=scoreDailyStaffing([5,5,5,5,5,5,5],targets,open);
  assert.equal(bad.missingDays,2);
  assert.equal(improved.missingDays,0);
  assert.ok(compareDailyStaffing(improved,bad)<0);
  assert.ok(compareDailyStaffing(even,improved)<0);
  const closed=scoreDailyStaffing([5,5,5,5,5,0,0],targets,
    [true,true,true,true,true,false,false]);
  assert.equal(closed.shortfallPenalty,0);
});

test("a organização guarda apenas funcionamento, mesmo com um campo experimental antigo",()=>{
  const config=scenario().openingHours;
  const state=new Map<string,string>();
  const storage={
    getItem:(key:string)=>state.get(key)??null,
    setItem:(key:string,value:string)=>{state.set(key,value);},
  };
  assert.equal(saveOpeningHoursDraft(storage,config).ok,true);
  const loaded=loadOpeningHoursDraft(storage);
  assert.equal(loaded.status,"loaded");
  if(loaded.status==="loaded")
    assert.deepEqual(loaded.value,config);
  // A build experimental may already have saved a percentage. Do not
  // delete opening hours or reject the existing company record.
  const experimental={...config,dailyStaffingTargetPercent:60};
  assert.equal(validateWeeklyOpeningHours(experimental).valid,true);
  assert.equal(saveOpeningHoursDraft(storage,experimental).ok,true);
  const imported=loadOpeningHoursDraft(storage);
  assert.equal(imported.status,"loaded");
  if(imported.status==="loaded"){
    assert.deepEqual(imported.value,config);
    assert.equal("dailyStaffingTargetPercent" in imported.value,false);
  }
});

test("oito pessoas: equilibra presença sem exigir qualquer opção de configuração",()=>{
  const input=scenario();
  const original=JSON.stringify(input);
  const result=generateSchedule(input);
  assert.equal(result.status,"valid",
    JSON.stringify(result.certification.issues.slice(0,12)));
  assert.equal(result.rotation?.status,"planned");
  assert.equal(result.dailyStaffing?.desired,5);
  assert.equal(result.dailyStaffing?.daysBelowTarget,0);
  assert.equal(result.dailyStaffing?.totalMissingPersonDays,0);
  assert.equal(result.rotationTargetShortfalls?.length,0);
  assert.ok(result.rotation!.weeks.every(week=>
    week.fullWeekendOffMemberIds.length<=3 &&
    week.presentByWeekday.saturday>=5 &&
    week.presentByWeekday.sunday>=5));
  assert.deepEqual(generateSchedule(input),result,"geração determinística");
  assert.equal(JSON.stringify(input),original,"não altera entradas");
});

test("o certificador nunca transforma a referência interna em hard constraint",()=>{
  const input=scenario();
  const proposal=generateSchedule(input);
  const outcome=certifySchedule({
    ...input,candidateAssignments:proposal.candidateAssignments,
  });
  assert.equal(outcome.status,"valid");
});

test("presença conta pessoas distintas com turno, não turnos repetidos",()=>{
  const input=scenario();
  const report=evaluateDailyStaffing([
    {memberId:ids[0],date:"2026-11-02",start:"08:30",end:"12:30"},
    {memberId:ids[0],date:"2026-11-02",start:"14:00",end:"19:00"},
    {memberId:ids[1],date:"2026-11-02",start:"08:30",end:"19:00"},
    {memberId:ids[2],date:"2026-11-02",start:"09:00",end:"19:00"},
  ],resolvePlanningPeriod(input.period),input.openingHours,ids);
  assert.equal(report.days[0].present,3);
  assert.equal(report.days[0].missing,2);
  assert.equal(report.days[0].desired,5);
  assert.equal(report.targetPercent,60);
});

test("quando a referência interna não é possível, mantém folgas e assinala desvio",()=>{
  const input=scenario();
  input.team.members=input.team.members.slice(0,4);
  const result=generateSchedule(input);
  assert.equal(result.status,"valid",
    JSON.stringify(result.certification.issues.slice(0,12)));
  assert.equal(result.dailyStaffing?.desired,3);
  assert.ok(result.dailyStaffing!.daysBelowTarget>0);
  for(const week of result.rotation!.weeks)
    for(const member of week.members)
      assert.equal(member.daysWithoutWork.length,
        member.fullWeekendOff?3:2);
});

test("sem rotação ativada não introduz regras de folga na equipa legada",()=>{
  const input=scenario();
  for(const member of input.team.members)
    delete (member as {weekendRest?:unknown}).weekendRest;
  const result=generateSchedule(input);
  assert.equal(result.rotation,undefined);
  assert.equal(result.dailyStaffing,undefined);
  assert.equal(result.status,"valid");
});

test("uma empresa encerrada ao domingo não recebe falsos défices nesse dia",()=>{
  const input=scenario();
  input.openingHours.days[6].intervals=[];
  const result=generateSchedule(input);
  assert.equal(result.status,"valid",
    JSON.stringify(result.certification.issues.slice(0,12)));
  assert.ok(result.dailyStaffing);
  assert.ok(result.dailyStaffing!.days.every(day=>
    day.weekday!=="sunday"));
  assert.equal(result.dailyStaffing!.days.length,24);
});

test("folgas fixas continuam a sobrepor-se a qualquer objetivo de presença",()=>{
  const input=scenario();
  const members=input.team.members as Array<typeof input.team.members[number]&{
    fixedDaysOff?:("monday"|"tuesday")[];
  }>;
  members[0].fixedDaysOff=["monday"];
  members[1].fixedDaysOff=["tuesday"];
  const result=generateSchedule(input);
  assert.equal(result.status,"valid",
    JSON.stringify(result.certification.issues.slice(0,12)));
  const first=new Set(["2026-11-02","2026-11-09","2026-11-16","2026-11-23"]);
  const second=new Set(["2026-11-03","2026-11-10","2026-11-17","2026-11-24"]);
  assert.ok(result.candidateAssignments.every(shift=>
    !(shift.memberId===ids[0]&&first.has(shift.date))&&
    !(shift.memberId===ids[1]&&second.has(shift.date))));
});
