import test from "node:test";
import assert from "node:assert/strict";
import {
  desiredDailyHeadcount,scoreDailyStaffing,compareDailyStaffing,
  evaluateDailyStaffing,
} from "../src/dailyStaffingBalance";
import {generateSchedule} from "../src/generateSchedule";
import {certifySchedule} from "../src/certifySchedule";
import {suggestedWeeklyOpeningHours,validateWeeklyOpeningHours} from "../src/operatingHours";
import {
  saveOpeningHoursDraft,loadOpeningHoursDraft,
} from "../src/openingHoursDraftRepository";
import {resolvePlanningPeriod} from "../src/schedulePeriods";
import {effectiveWorkIntervals} from "../src/workAssignments";

const ids=Array.from({length:8},(_,i)=>
  "00000000-0000-4000-8000-"+String(i+1).padStart(12,"0"));

function scenario(percent?:number){
  const openingHours=suggestedWeeklyOpeningHours();
  for(const [index,day] of openingHours.days.entries())
    day.intervals=index===6?[{start:"14:00",end:"19:00"}]:
      [{start:"08:30",end:"19:00"}];
  if(percent!==undefined)openingHours.dailyStaffingTargetPercent=percent;
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

test("60% de oito pessoas significa cinco pessoas escaladas, sem arredondamento para baixo",()=>{
  assert.equal(desiredDailyHeadcount(8,60),5);
  assert.equal(desiredDailyHeadcount(4,60),3);
  assert.equal(desiredDailyHeadcount(10,60),6);
  assert.equal(desiredDailyHeadcount(0,60),0);
  assert.throws(()=>desiredDailyHeadcount(8,0));
  assert.throws(()=>desiredDailyHeadcount(8,101));
  assert.throws(()=>desiredDailyHeadcount(8,60.5));
});

test("pontuação é SOFT: penaliza falta diária e depois concentração",()=>{
  const on=Array.from({length:7},()=>true);
  const targets=Array.from({length:7},()=>5);
  const bad=scoreDailyStaffing([8,8,8,8,8,2,2],targets,on);
  const better=scoreDailyStaffing([6,6,6,6,6,5,5],targets,on);
  assert.ok(compareDailyStaffing(better,bad)<0);
  assert.equal(bad.missingDays,2);
  assert.equal(better.missingDays,0);
  const even=scoreDailyStaffing([5,5,5,5,5,5,5],targets,on);
  assert.ok(compareDailyStaffing(even,better)<0);
  const closed=scoreDailyStaffing([5,5,5,5,5,0,0],targets,
    [true,true,true,true,true,false,false]);
  assert.equal(closed.shortfallPenalty,0,
    "dias encerrados não geram falso défice de presença");
});

test("preferência opcional persiste no funcionamento, sem migrar nem perder as configurações antigas",()=>{
  const config=scenario(60).openingHours;
  const state=new Map<string,string>();
  const store={
    getItem:(key:string)=>state.get(key)??null,
    setItem:(key:string,value:string)=>{state.set(key,value);},
  };
  assert.equal(validateWeeklyOpeningHours(config).valid,true);
  assert.equal(saveOpeningHoursDraft(store,config).ok,true);
  const loaded=loadOpeningHoursDraft(store);
  assert.equal(loaded.status,"loaded");
  if(loaded.status==="loaded")
    assert.equal(loaded.value.dailyStaffingTargetPercent,60);
  const legacy=scenario().openingHours;
  assert.equal(saveOpeningHoursDraft(store,legacy).ok,true);
  const old=loadOpeningHoursDraft(store);
  assert.equal(old.status,"loaded");
  if(old.status==="loaded")
    assert.equal(old.value.dailyStaffingTargetPercent,undefined);
  for(const percent of [-1,0,60.5,101]){
    const bad={...legacy,dailyStaffingTargetPercent:percent};
    assert.equal(validateWeeklyOpeningHours(bad).valid,false);
  }
});

test("oito pessoas, objetivo 60%: evita atribuir quatro fins de semana completos simultâneos",()=>{
  const input=scenario(60);
  const untouched=JSON.stringify(input);
  const output=generateSchedule(input);
  assert.equal(output.status,"valid",JSON.stringify(output.certification.issues.slice(0,10)));
  assert.equal(output.rotation?.status,"planned",
    JSON.stringify(output.rotation?.issues));
  assert.equal(output.dailyStaffing?.desired,5);
  assert.deepEqual(output,generateSchedule(input),"determinístico");
  assert.equal(JSON.stringify(input),untouched,"não altera dados da empresa");
  for(const week of output.rotation!.weeks){
    assert.ok(week.fullWeekendOffMemberIds.length<=3,
      "é preferível preservar cinco pessoas no sábado e domingo");
    for(const day of ["saturday","sunday"] as const)
      assert.ok(week.presentByWeekday[day]>=5,
        "as folgas planeadas têm de permitir cinco pessoas em cada dia");
  }
  assert.ok(output.dailyStaffing);
  assert.equal(output.dailyStaffing!.daysBelowTarget,0,
    "este cenário tem capacidade de pessoal para cumprir o objetivo");
  assert.equal(output.dailyStaffing!.totalMissingPersonDays,0);
  assert.equal(output.rotationTargetShortfalls?.length,0);
});

test("com 60% desativado, não injeta uma regra rígida no gerador antigo",()=>{
  const config=scenario();
  const output=generateSchedule(config);
  assert.equal(output.dailyStaffing,undefined);
  assert.equal(output.status,"valid");
  const more=generateSchedule(scenario(60));
  assert.ok(more.rotation!.weeks.every(w=>
    w.fullWeekendOffMemberIds.length<=3));
  assert.equal(certifySchedule({
    ...scenario(100),candidateAssignments:output.candidateAssignments,
  }).status,"valid",
  "o certificador não transforma preferências de percentagem em hard constraints");
});

test("relatório conta pessoas distintas por dia, não turnos ou presença simultânea",()=>{
  const config=scenario(60);
  const period=resolvePlanningPeriod(config.period);
  const report=evaluateDailyStaffing([
    {memberId:ids[0],date:"2026-11-02",start:"08:30",end:"12:30"},
    {memberId:ids[0],date:"2026-11-02",start:"14:00",end:"19:00"},
    {memberId:ids[1],date:"2026-11-02",start:"08:30",end:"19:00"},
    {memberId:ids[2],date:"2026-11-02",start:"09:00",end:"19:00"},
  ],period,config.openingHours,ids,60);
  assert.equal(report.days[0].present,3);
  assert.equal(report.days[0].missing,2);
  assert.equal(report.days.length,28);
  assert.ok(report.daysBelowTarget>0);
  // No claim of simultaneous coverage is made by these counts.
  assert.ok(effectiveWorkIntervals({memberId:ids[0],date:"2026-11-02",
    start:"08:30",end:"12:30"}).length>0);
});

test("quando 60% é inalcançável, conserva hard constraints e assinala faltas",()=>{
  const input=scenario(100);
  const output=generateSchedule(input);
  assert.equal(output.rotation?.status,"planned");
  assert.ok(output.dailyStaffing);
  assert.ok(output.dailyStaffing!.daysBelowTarget>0);
  assert.ok(output.dailyStaffing!.totalMissingPersonDays>0);
  assert.equal(output.status,"valid",
    JSON.stringify(output.certification.issues.slice(0,8)));
});

test("objetivo individual é independente de encerramentos e folgas fixas",()=>{
  const config=scenario(60);
  config.openingHours.days[6].intervals=[];
  const members=config.team.members as Array<typeof config.team.members[number] & {
    fixedDaysOff?:("monday"|"tuesday")[];
  }>;
  members[0].fixedDaysOff=["monday"];
  members[1].fixedDaysOff=["tuesday"];
  const result=generateSchedule(config);
  assert.equal(result.status,"valid",
    JSON.stringify(result.certification.issues.slice(0,10)));
  assert.ok(result.dailyStaffing);
  assert.ok(result.dailyStaffing!.days.every(d=>d.weekday!=="sunday"));
  assert.equal(result.dailyStaffing!.days.length,24);
  assert.ok(result.candidateAssignments.every(shift=>
    (shift.memberId!==ids[0]||!["2026-11-02","2026-11-09","2026-11-16","2026-11-23"].includes(shift.date)) &&
    (shift.memberId!==ids[1]||!["2026-11-03","2026-11-10","2026-11-17","2026-11-24"].includes(shift.date))));
});
