import test from "node:test";
import assert from "node:assert/strict";
import {
  planWeekendRotation,requiredRestDayCount,
  type RotationMember,type WeekendRotationInput,type WeekdayNumbers,
} from "../src/weekendRotation";
import {WEEKDAYS,type Weekday} from "../src/operatingHours";
import {addCivilDays,civilDayOfWeek} from "../src/schedulePeriods";

const names=["A","B","C","D","E","F"];
const weekdays=WEEKDAYS.map(day=>day.id);
const minimums=(weekday:number,saturday:number,sunday:number):WeekdayNumbers=>
  Object.fromEntries(weekdays.map((day,index)=>[
    day,index===5?saturday:index===6?sunday:weekday,
  ])) as WeekdayNumbers;
const cap=(weekday:number,saturday:number,sunday:number):WeekdayNumbers=>
  minimums(weekday,saturday,sunday);
function members(count:number,weeklyDaysOff=2):RotationMember[]{
  return names.slice(0,count).map(id=>({
    id,weeklyDaysOff,fixedDaysOff:[] as Weekday[],
    minimumWeekdayDaysOffOnFullWeekend:1,
  }));
}
function input(
  count=4,staffing=minimums(2,3,3),
):WeekendRotationInput {
  return {
    startWeek:"2026-11-02",weeks:4,members:members(count),
    minimumPresentByWeekday:staffing,
    maximumEffectiveMinutesByWeekday:cap(570,570,300),
  };
}

test("duas folgas habituais + fim de semana completo + um dia a meio = três dias sem trabalho",()=>{
  const a=members(1)[0];
  assert.equal(requiredRestDayCount(a,false),2);
  assert.equal(requiredRestDayCount(a,true),3);
  const fixed:RotationMember={
    ...a,weeklyDaysOff:1,fixedDaysOff:["wednesday"],
  };
  assert.equal(requiredRestDayCount(fixed,false),1);
  assert.equal(requiredRestDayCount(fixed,true),3);
  assert.equal(requiredRestDayCount({
    ...a,minimumWeekdayDaysOffOnFullWeekend:0,
  },true),2,"políticas diferentes não herdam regras de outra empresa");
});

test("rotação determinística: quatro pessoas, um fim de semana por semana, cada pessoa uma vez",()=>{
  const scenario=input();
  const before=JSON.stringify(scenario);
  const plan=planWeekendRotation(scenario);
  assert.equal(plan.status,"planned",JSON.stringify(plan.issues));
  assert.equal(plan.historyProvided,false);
  assert.deepEqual(plan.weeks.map(w=>w.fullWeekendOffMemberIds),[
    ["A"],["B"],["C"],["D"],
  ]);
  assert.deepEqual(plan.weekendCounts.map(m=>m.planned),[1,1,1,1]);
  assert.deepEqual(plan.weeks.map(w=>w.weekStart),[
    "2026-11-02","2026-11-09","2026-11-16","2026-11-23",
  ]);
  for(const week of plan.weeks){
    assert.equal(civilDayOfWeek(week.saturday),5);
    assert.equal(civilDayOfWeek(week.sunday),6);
    assert.equal(week.members.length,4);
    assert.ok(week.presentByWeekday.saturday>=3);
    assert.ok(week.presentByWeekday.sunday>=3);
    for(const m of week.members){
      assert.equal(m.daysWithoutWork.length,m.fullWeekendOff?3:2);
      if(m.fullWeekendOff){
        assert.ok(m.daysWithoutWork.includes(week.saturday));
        assert.ok(m.daysWithoutWork.includes(week.sunday));
        assert.equal(m.daysWithoutWork.filter(date=>
          civilDayOfWeek(date)<5).length,1);
      }else{
        assert.ok(!(
          m.daysWithoutWork.includes(week.saturday)&&
          m.daysWithoutWork.includes(week.sunday)
        ),"sem fim de semana completo atribuído não existe descanso completo por acaso");
      }
    }
    for(const weekday of weekdays)
      assert.ok(week.presentByWeekday[weekday]>=
        scenario.minimumPresentByWeekday[weekday]);
  }
  assert.deepEqual(planWeekendRotation(scenario),plan);
  assert.equal(JSON.stringify(scenario),before,"o planeamento não escreve nos dados");
});

test("folga fixa de quarta-feira permanece quando a pessoa descansa sábado e domingo",()=>{
  const scenario=input();
  scenario.members=members(4);
  (scenario.members as RotationMember[])[0]={
    ...(scenario.members as RotationMember[])[0],
    weeklyDaysOff:1,fixedDaysOff:["wednesday"],
  };
  const result=planWeekendRotation(scenario);
  assert.equal(result.status,"planned",JSON.stringify(result.issues));
  for(const week of result.weeks){
    const a=week.members.find(m=>m.memberId==="A")!;
    assert.ok(a.daysWithoutWork.includes(addCivilDays(week.weekStart,2)));
    if(a.fullWeekendOff){
      assert.equal(a.daysWithoutWork.length,3);
      assert.ok(a.daysWithoutWork.includes(week.saturday));
      assert.ok(a.daysWithoutWork.includes(week.sunday));
    }else assert.equal(a.daysWithoutWork.length,1);
  }
});

test("40h não são inventadas: quatro dias disponíveis de 9h30 dão no máximo 38h",()=>{
  const result=planWeekendRotation(input());
  assert.equal(result.status,"planned");
  const award=result.weeks[0].members.find(m=>m.fullWeekendOff)!;
  assert.equal(award.daysWithoutWork.length,3);
  assert.equal(award.effectiveMinutesUpperBound,4*570);
  assert.ok(award.effectiveMinutesUpperBound!<2400);
  const week=result.weeks[0];
  assert.equal(week.presentByWeekday.sunday,3);
});

test("frequência resulta da capacidade: duas pessoas livres por fim de semana numa equipa de seis",()=>{
  const scenario=input(6,minimums(3,4,4));
  const result=planWeekendRotation(scenario);
  assert.equal(result.status,"planned",JSON.stringify(result.issues));
  assert.ok(result.weeks.every(w=>w.fullWeekendOffMemberIds.length===2));
  const counts=result.weekendCounts.map(c=>c.planned);
  assert.equal(counts.reduce((a,b)=>a+b,0),8);
  assert.ok(Math.max(...counts)-Math.min(...counts)<=1,
    "a distribuição de fins de semana deve ser equilibrada");
  assert.ok(result.weeks.every(w=>
    w.presentByWeekday.saturday>=4 && w.presentByWeekday.sunday>=4));
});

test("60% ao fim de semana considera sábado fixo antes de atribuir descansos completos",()=>{
  // Regressão estrutural anonimizada: 8 pessoas, 3 com uma folga e
  // 5 com duas, incluindo uma folga fixa ao sábado.
  const fixed:Weekday[]=[
    "wednesday","saturday","monday","friday",
    "tuesday","monday","friday","tuesday",
  ];
  const scenario:WeekendRotationInput={
    startWeek:"2026-11-02",weeks:4,
    members:fixed.map((day,index)=>({
      id:"P"+(index+1),weeklyDaysOff:index<3?1:2,
      fixedDaysOff:[day],
      minimumWeekdayDaysOffOnFullWeekend:1,
    })),
    minimumPresentByWeekday:minimums(2,2,1),
    maximumEffectiveMinutesByWeekday:cap(570,570,300),
    workloadPreference:{
      cycleReferenceMinutes:9600,preferredUpperDailyMinutes:540,
      cycleWeeks:4,
    },
  };
  const original=JSON.stringify(scenario);
  const result=planWeekendRotation(scenario);
  assert.equal(result.status,"planned",JSON.stringify(result.issues));
  assert.equal(result.weeks.length,4);
  for(const week of result.weeks){
    assert.ok(week.presentByWeekday.saturday>=5,
      "o descanso fixo de sábado não pode ser esquecido: "+week.weekStart);
    assert.ok(week.presentByWeekday.sunday>=5,
      "não sacrificar o domingo: "+week.weekStart);
    const saturdayFixed=week.members.find(m=>m.memberId==="P2")!;
    assert.ok(saturdayFixed.daysWithoutWork.includes(week.saturday));
    for(const member of week.members.filter(m=>m.fullWeekendOff))
      assert.equal(member.daysWithoutWork.filter(date=>
        civilDayOfWeek(date)<5).length,1);
  }
  assert.ok(result.weekendCounts.every(m=>m.planned<=2),
    "a meta diária não deve impor quatro fins de semana ao mesmo membro");
  assert.deepEqual(planWeekendRotation(scenario),result,"determinismo");
  assert.equal(JSON.stringify(scenario),original,"imutabilidade");
});

test("exigir toda a equipa ao domingo impede fins de semana completos",()=>{
  const scenario=input(4,minimums(2,3,4));
  const result=planWeekendRotation(scenario);
  assert.equal(result.status,"planned",JSON.stringify(result.issues));
  assert.ok(result.weeks.every(w=>w.fullWeekendOffMemberIds.length===0));
  assert.ok(result.weekendCounts.every(c=>c.planned===0),
    "não se promete arbitrariamente uma frequência de quatro semanas");
});

test("histórico real dá prioridade a quem aguarda há mais tempo",()=>{
  const scenario=input();
  scenario.weeks=1;
  scenario.previousFullWeekends=[
    {memberId:"A",weekStart:"2026-10-26"},
    {memberId:"A",weekStart:"2026-10-05"},
    {memberId:"B",weekStart:"2026-10-12"},
  ];
  const result=planWeekendRotation(scenario);
  assert.equal(result.status,"planned");
  assert.equal(result.historyProvided,true);
  assert.deepEqual(result.weeks[0].fullWeekendOffMemberIds,["C"]);
});

test("não reinicia a rotação na mudança de mês nem após quatro semanas",()=>{
  const scenario=input();
  scenario.startWeek="2026-11-23";
  scenario.weeks=6;
  const result=planWeekendRotation(scenario);
  assert.equal(result.status,"planned");
  assert.deepEqual(result.weeks.map(w=>w.fullWeekendOffMemberIds),[
    ["A"],["B"],["C"],["D"],["A"],["B"],
  ]);
  assert.equal(result.weeks[1].saturday,"2026-12-05");
});

test("uma empresa encerrada ao sábado e domingo não necessita rotação artificial",()=>{
  const scenario=input(4,minimums(4,0,0));
  scenario.closedWeekdays=["saturday","sunday"];
  scenario.maximumEffectiveMinutesByWeekday=cap(480,0,0);
  const result=planWeekendRotation(scenario);
  assert.equal(result.status,"planned",JSON.stringify(result.issues));
  assert.ok(result.weeks.every(w=>w.fullWeekendOffMemberIds.length===4));
  assert.ok(result.weeks.every(w=>w.members.every(member=>
    member.effectiveMinutesUpperBound===5*480)));
});

test("uma empresa pode ter cobertura e folgas incompatíveis; não esconder impossibilidades",()=>{
  const scenario=input(4,minimums(4,4,4));
  const result=planWeekendRotation(scenario);
  assert.equal(result.status,"infeasible");
  assert.ok(result.issues.some(i=>i.code==="REST_PATTERN_INFEASIBLE"));
  assert.equal(result.weeks.length,0);
});

test("folgas fixas que eliminam a cobertura mínima são identificadas antes da rotação",()=>{
  const scenario=input();
  (scenario.members as RotationMember[])[0]={
    ...(scenario.members as RotationMember[])[0],
    fixedDaysOff:["sunday"],
  };
  scenario.minimumPresentByWeekday=minimums(2,3,4);
  const result=planWeekendRotation(scenario);
  assert.equal(result.status,"infeasible");
  assert.ok(result.issues.some(i=>
    i.code==="IMPOSSIBLE_DAY_MINIMUM"&&i.weekday==="sunday"));
});

test("rejeita regras contraditórias, datas erradas e históricos inválidos",()=>{
  const badDate=input();
  badDate.startWeek="2026-11-03";
  assert.equal(planWeekendRotation(badDate).status,"infeasible");
  const duplicate=input();
  (duplicate.members as RotationMember[])[1].id="A";
  assert.equal(planWeekendRotation(duplicate).status,"infeasible");
  const incompatible=input();
  (incompatible.members as RotationMember[])[0].fixedDaysOff=[
    "monday","tuesday","wednesday",
  ];
  assert.equal(planWeekendRotation(incompatible).status,"infeasible");
  const closed=input();
  closed.closedWeekdays=["sunday"];
  assert.equal(planWeekendRotation(closed).status,"infeasible");
  const futureHistory=input();
  futureHistory.previousFullWeekends=[{
    memberId:"A",weekStart:"2026-11-02",
  }];
  assert.equal(planWeekendRotation(futureHistory).status,"infeasible");
});

test("capacidade por hora não é inferida da cobertura de pessoas por dia",()=>{
  const scenario=input();
  scenario.maximumEffectiveMinutesByWeekday=undefined;
  const plan=planWeekendRotation(scenario);
  assert.equal(plan.status,"planned");
  assert.ok(plan.weeks.every(w=>w.members.every(m=>
    m.effectiveMinutesUpperBound===null)));
});
