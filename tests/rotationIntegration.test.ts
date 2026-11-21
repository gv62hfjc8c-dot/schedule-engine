import test from "node:test";
import assert from "node:assert/strict";
import {generateSchedule,type GenerationInput} from "../src/generateSchedule";
import {certifySchedule} from "../src/certifySchedule";
import {fourWeekSoftTargets,prepareRotation} from "../src/rotationIntegration";
import {assignmentMinutes,type WorkAssignment} from "../src/workAssignments";
import {resolvePlanningPeriod,addCivilDays,civilDayOfWeek} from "../src/schedulePeriods";
import {suggestedWeeklyOpeningHours} from "../src/operatingHours";
import {validateTeamRoster} from "../src/team";
import {loadTeamDraft,saveTeamDraft} from "../src/teamDraftRepository";

const IDS=Array.from({length:4},(_,i)=>
  "00000000-0000-4000-8000-"+String(i+1).padStart(12,"0"));
function shop():GenerationInput {
  const openingHours=suggestedWeeklyOpeningHours();
  openingHours.days.forEach((day,index)=>day.intervals=
    index===6?[{start:"14:00",end:"19:00"}]:
      [{start:"08:30",end:"19:00"}]);
  return {
    period:{mode:"28d",start:"2026-11-02"},
    openingHours,mealBreakPolicy:"v2",hoursPolicy:"rolling28",
    team:{members:IDS.map((id,index)=>({
      id,name:"Teste "+index,active:true,weeklyDaysOff:2,
      weekendRest:{minimumWeekdayDaysOffOnFullWeekend:1},
    }))},
  };
}
function weekWork(shifts:readonly WorkAssignment[],id:string,start:string){
  const end=addCivilDays(start,7);
  return shifts.filter(s=>s.memberId===id&&s.date>=start&&s.date<end);
}

test("modelo de equipa antigo é compatível e os novos campos sobrevivem à gravação",()=>{
  const state=new Map<string,string>();
  const storage={
    getItem:(key:string)=>state.get(key)??null,
    setItem:(key:string,val:string)=>{state.set(key,val);},
  };
  const original=shop().team;
  assert.equal(saveTeamDraft(storage,original).ok,true);
  const restored=loadTeamDraft(storage);
  assert.equal(restored.status,"loaded");
  if(restored.status!=="loaded")return;
  assert.deepEqual(restored.value,original);
  const old={members:[{id:IDS[0],name:"Anterior",active:true,weeklyDaysOff:2}]};
  assert.equal(saveTeamDraft(storage,old).ok,true);
  const legacy=loadTeamDraft(storage);
  assert.equal(legacy.status,"loaded");
  if(legacy.status==="loaded")assert.deepEqual(legacy.value,old);
});

test("certificador independente aceita 3 dias de descanso no fim de semana completo",()=>{
  const data=shop();
  const scenario=generateSchedule(data);
  assert.equal(scenario.status,"valid",JSON.stringify(scenario.certification.issues.slice(0,12)));
  const checked=certifySchedule({...data,candidateAssignments:scenario.candidateAssignments});
  assert.equal(checked.status,"valid",JSON.stringify(checked.issues.slice(0,12)));
  assert.equal(checked.weeks.length,16);
});

test("quatro semanas reais: cobertura, fim de semana completo, folga a meio da semana e 160h",()=>{
  const config=shop();
  const before=JSON.stringify(config);
  const result=generateSchedule(config);
  assert.equal(result.status,"valid",JSON.stringify(result.certification.issues.slice(0,12)));
  assert.equal(result.rotation?.status,"planned",JSON.stringify(result.rotation?.issues));
  assert.equal(result.rotation?.weeks.length,4);
  assert.equal(JSON.stringify(config),before);
  assert.deepEqual(generateSchedule(config),result);
  const counts=result.rotation?.weekendCounts.map(c=>c.planned)??[];
  assert.ok(Math.max(...counts)-Math.min(...counts)<=1);
  for(const w of result.rotation!.weeks){
    const daySet=new Set(w.fullWeekendOffMemberIds);
    assert.ok(daySet.size>0);
    for(const id of IDS){
      const shifts=weekWork(result.candidateAssignments,id,w.weekStart);
      const daysWithWork=new Set(shifts.map(s=>s.date));
      const member=w.members.find(m=>m.memberId===id)!;
      assert.equal(shifts.length,daySet.has(id)?4:5);
      assert.equal(daysWithWork.size,shifts.length);
      assert.equal(member.daysWithoutWork.length,daySet.has(id)?3:2);
      for(const date of member.daysWithoutWork)
        assert.ok(!daysWithWork.has(date),"não se trabalha em folgas planeadas");
      if(daySet.has(id)){
        assert.ok(!daysWithWork.has(w.saturday));
        assert.ok(!daysWithWork.has(w.sunday));
        assert.equal(member.daysWithoutWork.filter(d=>civilDayOfWeek(d)<5).length,1);
        assert.ok(shifts.reduce((sum,s)=>sum+assignmentMinutes(s),0)<=2280);
      }
    }
    const sunday=result.candidateAssignments.filter(s=>s.date===w.sunday);
    assert.ok(sunday.every(s=>s.start==="14:00"&&s.end==="19:00"));
  }
  for(const id of IDS){
    const minutes=result.candidateAssignments.filter(s=>s.memberId===id)
      .reduce((sum,s)=>sum+assignmentMinutes(s),0);
    assert.equal(minutes,9600,
      "a distribuição deve conseguir 160h em quatro semanas quando é viável");
  }
});

test("folga fixa continua obrigatória com e sem fim de semana completo",()=>{
  const config=shop();
  const roster=config.team as {members:{
    id:string;name:string;active:boolean;weeklyDaysOff:number;
    fixedDaysOff?:("wednesday")[];
    weekendRest:{minimumWeekdayDaysOffOnFullWeekend:number}
  }[]};
  roster.members[0].fixedDaysOff=["wednesday"];
  const result=generateSchedule(config);
  assert.equal(result.status,"valid",JSON.stringify(result.certification.issues.slice(0,10)));
  assert.ok(result.candidateAssignments.filter(s=>s.memberId===IDS[0])
    .every(s=>civilDayOfWeek(s.date)!==2));
  const offending={
    ...result.candidateAssignments.find(s=>s.memberId===IDS[0])!,
    date:"2026-11-04",
  };
  const report=certifySchedule({...config,candidateAssignments:[
    ...result.candidateAssignments,offending,
  ]});
  assert.equal(report.status,"invalid");
  assert.ok(report.issues.some(i=>i.code==="FIXED_DAY_OFF_VIOLATED"));
});

test("não pretende 40h numa semana de quatro dias com capacidade máxima 38h",()=>{
  const config=shop();
  const checked=validateTeamRoster(config.team);
  assert.equal(checked.valid,true);
  if(!checked.valid)return;
  const rotation=prepareRotation(resolvePlanningPeriod(config.period),
    checked.value,config.openingHours as ReturnType<typeof suggestedWeeklyOpeningHours>,
    []);
  assert.ok(rotation);
  assert.equal(rotation!.rotation.status,"planned");
  assert.ok(rotation!.rotation.weeks.some(w=>w.members.some(m=>
    m.fullWeekendOff&&m.effectiveMinutesUpperBound===2280)));
  const caps=rotation!.rotation.weeks.map(w=>
    w.members[0].effectiveMinutesUpperBound!);
  const distributed=fourWeekSoftTargets(caps);
  assert.equal(distributed.targets.reduce((sum,v)=>sum+v,0),9600);
  assert.equal(distributed.missingMinutes,0);
});

test("se as capacidades não permitem 160h, a falta fica explícita e não é inventada",()=>{
  const budgets=fourWeekSoftTargets([2280,2280,2280,2280]);
  assert.deepEqual(budgets.targets,[2280,2280,2280,2280]);
  assert.equal(budgets.missingMinutes,480);
  assert.deepEqual(fourWeekSoftTargets([2280,2580,2580,2580]).targets,
    [2280,2445,2445,2430]);
});

test("sem adesão à rotação os resultados antigos não mudam",()=>{
  const input=shop();
  (input.team as {members:{weekendRest?:unknown}[]}).members.forEach(m=>
    delete m.weekendRest);
  const result=generateSchedule(input);
  assert.equal(result.rotation,undefined);
  assert.equal(result.certification.issues.some(i=>
    i.code==="WEEKEND_WEEKDAY_REST_MISSING"),false);
});

test("rotação não inventa datas desconhecidas nas fronteiras mensais",()=>{
  const input=shop();
  input.period={mode:"monthly",year:2026,month:11};
  const result=generateSchedule(input);
  assert.equal(result.status,"insufficient_context",
    JSON.stringify(result.certification.issues.slice(0,8)));
  assert.equal(result.rotation?.weeks.length,4);
  assert.ok(result.candidateAssignments.every(s=>
    s.date>="2026-11-01"&&s.date<"2026-12-01"));
});

test("certificador rejeita de forma independente fim de semana sem folga obrigatória a meio da semana",()=>{
  const input=shop();
  const generated=generateSchedule(input);
  assert.equal(generated.status,"valid");
  const week=generated.rotation!.weeks[0];
  const rest=week.members.find(m=>m.fullWeekendOff)!;
  const weekdayRest=rest.daysWithoutWork.find(date=>
    civilDayOfWeek(date)<5)!;
  const forbidden:WorkAssignment={
    memberId:rest.memberId,date:weekdayRest,
    start:"08:30",end:"17:30",
    mealBreak:{start:"12:00",end:"13:00"},
  };
  const report=certifySchedule({
    ...input,candidateAssignments:[...generated.candidateAssignments,forbidden],
  });
  assert.equal(report.status,"invalid");
  assert.ok(report.issues.some(issue=>
    issue.code==="WEEKEND_WEEKDAY_REST_MISSING"));
  assert.ok(report.issues.some(issue=>
    issue.code==="WEEKLY_DAYS_OFF_MISMATCH" &&
    issue.memberId===rest.memberId &&
    issue.requiredDaysOff===3 && issue.actualDaysOff===2));
});

test("oito pessoas não recebem seis fins de semana livres simultâneos, deixando falhas de abertura",()=>{
  const config=shop();
  const roster=config.team as {members:{
    id:string;name:string;active:boolean;weeklyDaysOff:number;
    weekendRest:{minimumWeekdayDaysOffOnFullWeekend:number}
  }[]};
  for(let i=4;i<8;i++)
    roster.members.push({
      id:"00000000-0000-4000-8000-"+String(i+1).padStart(12,"0"),
      name:"Pessoa "+i,active:true,weeklyDaysOff:2,
      weekendRest:{minimumWeekdayDaysOffOnFullWeekend:1},
    });
  const result=generateSchedule(config);
  assert.equal(result.rotation?.status,"planned",
    JSON.stringify(result.rotation?.issues));
  assert.ok(result.rotation!.weeks.every(week=>
    week.fullWeekendOffMemberIds.length<=4),
    "os dias de descanso devem preservar capacidade para as 160h/28d");
  assert.ok(result.rotation!.weeks.every(week=>
    week.presentByWeekday.saturday>=4),
    "sábado não pode ficar artificialmente reduzido a duas pessoas");
  assert.ok(result.rotation!.weekendCounts.every(member=>
    member.planned<=2),
    "a frequência resulta de 160h e das jornadas preferidas, não de 4 semanas fixas");
  assert.equal(result.rotationTargetShortfalls?.length,0);
  assert.equal(result.status,"valid",
    JSON.stringify(result.certification.issues.slice(0,15)));
  for(const date of ["2026-11-14","2026-11-21"]){
    assert.ok(result.candidateAssignments.some(shift=>
      shift.date===date&&shift.start==="08:30"),
      "o período inicial 08h30–08h45 tem de ficar coberto");
  }
});
