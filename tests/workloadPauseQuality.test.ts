import test from "node:test";
import assert from "node:assert/strict";
import {
  improveSimultaneousCoverage,measureSimultaneousCoverage,
} from "../src/simultaneousCoverage";
import {mealDayOptions} from "../src/mealBreaks";
import {
  assignmentMinutes,clockMinutes,type WorkAssignment,
} from "../src/workAssignments";
import {generateSchedule} from "../src/generateSchedule";
import {certifySchedule} from "../src/certifySchedule";
import {suggestedWeeklyOpeningHours} from "../src/operatingHours";
import {balanceLongWorkdays,compareDailyWorkloadWithLongDayCount,dailyWorkloadQuality}
  from "../src/dailyWorkloadBalance";

const IDS=Array.from({length:8},(_,i)=>
  "00000000-0000-4000-8000-"+String(i+1).padStart(12,"0"));
const OPEN=[{start:510,end:1140}];

function shift(member:number,date:string,start:string,end:string,
  meal:string):WorkAssignment {
  const begin=clockMinutes(meal);
  const clock=(n:number)=>String(Math.floor(n/60)).padStart(2,"0")+":"+
    String(n%60).padStart(2,"0");
  return {memberId:IDS[member],date,start,end,
    mealBreak:{start:meal,end:clock(begin+60)}};
}

function improve(shifts:readonly WorkAssignment[]):WorkAssignment[] {
  const options=shifts.map(s=>mealDayOptions(
    s.memberId,s.date,OPEN,assignmentMinutes(s)));
  return improveSimultaneousCoverage(shifts,options,OPEN);
}

test("sábado 07/11 real anonimizado: 3 pausas às 11h30 sem deixar apenas uma pessoa",()=>{
  // Extracted as a minimal anonymous regression from the user's local
  // diagnostic. No names, real IDs, hours-history or personal data stored.
  const shifts=[
    shift(0,"2026-11-07","08:30","16:30","11:30"),
    shift(1,"2026-11-07","08:30","18:15","11:30"),
    shift(2,"2026-11-07","08:30","18:15","11:30"),
    shift(3,"2026-11-07","09:15","19:00","12:30"),
  ];
  const baseline=measureSimultaneousCoverage(shifts,OPEN);
  assert.deepEqual(baseline,{uncoveredMinutes:0,soloMinutes:105});
  const input=JSON.stringify(shifts);
  const outcome=improve(shifts);
  const now=measureSimultaneousCoverage(outcome,OPEN);
  assert.equal(now.uncoveredMinutes,0);
  assert.ok(now.soloMinutes<=45,
    "a pausa 11h30 e os 45min finais devem ficar melhor distribuídos");
  assert.deepEqual(outcome.map(assignmentMinutes),
    shifts.map(assignmentMinutes));
  assert.deepEqual(outcome.map(a=>a.memberId),shifts.map(a=>a.memberId));
  assert.ok(outcome.every(s=>s.mealBreak &&
    clockMinutes(s.mealBreak.end)-clockMinutes(s.mealBreak.start)===60 &&
    clockMinutes(s.mealBreak.start)>=clockMinutes(s.start)+180));
  assert.equal(JSON.stringify(shifts),input,"não altera o turno de entrada");
  assert.deepEqual(improve(outcome),outcome,"estável sob nova otimização");
});

test("sábados reais 14, 21 e 28: reduzir solidão sem criar minutos sem cobertura",()=>{
  const samples=[
    [
      shift(0,"2026-11-14","08:30","18:45","11:30"),
      shift(1,"2026-11-14","10:00","18:00","13:00"),
      shift(2,"2026-11-14","08:45","19:00","12:30"),
      shift(3,"2026-11-14","09:00","18:45","12:00"),
    ],
    [
      shift(0,"2026-11-21","10:30","18:30","13:30"),
      shift(1,"2026-11-21","08:45","19:00","11:45"),
      shift(2,"2026-11-21","09:30","17:30","12:30"),
      shift(3,"2026-11-21","08:30","18:15","13:00"),
      shift(4,"2026-11-21","08:30","18:15","11:30"),
    ],
    [
      shift(0,"2026-11-28","08:30","18:45","11:30"),
      shift(1,"2026-11-28","09:15","19:00","12:30"),
      shift(2,"2026-11-28","09:15","19:00","12:15"),
      shift(3,"2026-11-28","08:45","18:30","11:45"),
    ],
  ];
  const baseline=[30,30,45];
  for(let k=0;k<samples.length;k++){
    const old=measureSimultaneousCoverage(samples[k],OPEN);
    assert.deepEqual(old,{uncoveredMinutes:0,soloMinutes:baseline[k]});
    const output=improve(samples[k]);
    const quality=measureSimultaneousCoverage(output,OPEN);
    assert.equal(quality.uncoveredMinutes,0);
    assert.ok(quality.soloMinutes<=old.soloMinutes);
    assert.equal(output.length,samples[k].length);
    assert.deepEqual(output.map(assignmentMinutes),
      samples[k].map(assignmentMinutes));
  }
});

test("almoço num único turno: evita nova lacuna mesmo que haja preferência de duas pessoas",()=>{
  const shifts=[
    shift(0,"2026-11-07","08:30","18:15","11:30"),
    shift(1,"2026-11-07","09:15","19:00","12:30"),
  ];
  const prior=measureSimultaneousCoverage(shifts,OPEN);
  assert.equal(prior.uncoveredMinutes,0);
  const output=improve(shifts);
  assert.equal(measureSimultaneousCoverage(output,OPEN).uncoveredMinutes,0);
  assert.deepEqual(output.map(assignmentMinutes),
    shifts.map(assignmentMinutes));
});

test("um dia com cobertura incompleta continua incompleto, sem falsos certificados",()=>{
  const shifts=[shift(0,"2026-11-07","09:00","18:00","12:00")];
  assert.ok(measureSimultaneousCoverage(shifts,OPEN).uncoveredMinutes>0);
  assert.deepEqual(improve(shifts),shifts);
});

test("quatro turnos normais + domingo curto: menos dias >9h sem acrescentar minutos",()=>{
  const plans=[
    ...Array.from({length:4},()=>({
      shortOpening:false,capacity:570,allocated:555,
    })),
    {shortOpening:true,capacity:300,allocated:300},
  ];
  const original=dailyWorkloadQuality(plans.map(p=>p.allocated));
  assert.equal(original.daysBeyondNine,4);
  const before=plans.reduce((sum,p)=>sum+p.allocated,0);
  balanceLongWorkdays(plans,true);
  const quality=dailyWorkloadQuality(plans.map(p=>p.allocated));
  assert.equal(quality.daysBeyondNine,2);
  assert.equal(quality.beyondNineMinutes,original.beyondNineMinutes);
  assert.ok(compareDailyWorkloadWithLongDayCount(quality,original)<0);
  assert.equal(plans.reduce((sum,p)=>sum+p.allocated,0),before);
  assert.ok(plans.every(p=>p.allocated<=p.capacity));
  assert.equal(plans[4].allocated,300,"domingo curto integral");
  const after=JSON.stringify(plans);
  balanceLongWorkdays(plans,true);
  assert.equal(JSON.stringify(plans),after);
});

function realScenarioAnonymized() {
  // Team order, weekly rest policies and operating hours are those of the
  // uploaded November regression, but IDs/names are intentionally synthetic.
  const originalSortRanks=[4,8,2,5,1,7,3,6];
  const fixed=["wednesday","saturday","monday","friday",
    "tuesday","monday","friday","tuesday"] as const;
  const team={members:originalSortRanks.map((rank,index)=>({
    id:IDS[rank-1],name:"Pessoa "+String(index+1),
    active:true,weeklyDaysOff:index<3?1:2,
    fixedDaysOff:[fixed[index]],
    weekendRest:{minimumWeekdayDaysOffOnFullWeekend:1},
  }))};
  const openingHours=suggestedWeeklyOpeningHours();
  openingHours.days.forEach((day,index)=>{
    day.intervals=index===6?[{start:"14:00",end:"19:00"}]:
      [{start:"08:30",end:"19:00"}];
  });
  return {period:{mode:"monthly" as const,year:2026,month:11},
    team,openingHours,mealBreakPolicy:"v2" as const,
    hoursPolicy:"rolling28" as const};
}

test("regressão real anonimizada: 8 pessoas, 160h em 28 dias, sem novos conflitos",()=>{
  const config=realScenarioAnonymized();
  const original=JSON.stringify(config);
  const result=generateSchedule(config);
  assert.equal(result.status,"insufficient_context",
    JSON.stringify(result.certification.issues.slice(0,8)));
  assert.ok(result.certification.issues.every(i=>i.code==="CONTEXT_INCOMPLETE"),
    "não pode introduzir qualquer violação de hard constraints");
  const cycle=result.candidateAssignments.filter(a=>
    a.date>="2026-11-02"&&a.date<="2026-11-29");
  for(const member of config.team.members){
    const person=cycle.filter(a=>a.memberId===member.id);
    assert.equal(person.reduce((s,a)=>s+assignmentMinutes(a),0),9600);
  }
  assert.equal(result.rotation?.status,"planned");
  assert.ok(result.rotation!.weeks.every(w=>
    w.fullWeekendOffMemberIds.length<=3));
  const long=result.candidateAssignments.filter(a=>
    assignmentMinutes(a)>540).length;
  assert.ok(long<=56,
    "a regressão deve preservar a melhoria de 64 para no máximo 56 jornadas >9h: "+long);
  const saturdays=["2026-11-07","2026-11-14",
    "2026-11-21","2026-11-28"];
  const solos=saturdays.reduce((sum,date)=>{
    const plan=result.candidateAssignments.filter(a=>a.date===date);
    const quality=measureSimultaneousCoverage(plan,OPEN);
    assert.equal(quality.uncoveredMinutes,0);
    return sum+quality.soloMinutes;
  },0);
  assert.equal(solos,0,
    "a regressão deve preservar 0 minutos com uma pessoa nos quatro sábados; baseline eram 210");
  console.log("PR90_ANONYMOUS_NOVEMBER_QUALITY "+JSON.stringify({
    cycle:"2026-11-02..2026-11-29",
    baselineLongShifts:64,generatedLongShifts:long,
    baselineSoloSaturdayMinutes:210,generatedSoloSaturdayMinutes:solos,
    shifts:result.candidateAssignments.length,
  }));
  assert.deepEqual(result,generateSchedule(config),"determinismo");
  assert.equal(JSON.stringify(config),original,"não pode alterar dados de entrada");
  const independently=certifySchedule({...config,
    candidateAssignments:result.candidateAssignments});
  assert.equal(independently.status,"insufficient_context");
  assert.ok(independently.issues.every(i=>i.code==="CONTEXT_INCOMPLETE"));
});

test("PR92: rotação sensível à carga reduz e reparte jornadas longas antes das horas",()=>{
  const config=realScenarioAnonymized();
  const input=JSON.stringify(config);
  const result=generateSchedule(config);
  const cycle=result.candidateAssignments.filter(a=>
    a.date>="2026-11-02"&&a.date<="2026-11-29");
  const longs=new Map(config.team.members.map(m=>[
    m.id,cycle.filter(a=>a.memberId===m.id &&
      assignmentMinutes(a)>540).length,
  ]));
  const totalLong=[...longs.values()].reduce((sum,n)=>sum+n,0);
  assert.ok(totalLong<20,
    "a nova rotação deve superar as 20 jornadas longas do PR91: "+totalLong);
  assert.ok(Math.max(...longs.values())<12,
    "não concentrar novamente doze jornadas numa pessoa: "+JSON.stringify([...longs]));
  for(const member of config.team.members)
    assert.equal(cycle.filter(a=>a.memberId===member.id)
      .reduce((sum,a)=>sum+assignmentMinutes(a),0),9600);
  assert.equal(result.dailyStaffing?.daysBelowTarget,0);
  assert.equal(result.status,"insufficient_context");
  assert.ok(result.certification.issues.every(i=>i.code==="CONTEXT_INCOMPLETE"));
  for(const date of ["2026-11-07","2026-11-14",
    "2026-11-21","2026-11-28"]){
    const quality=measureSimultaneousCoverage(
      result.candidateAssignments.filter(a=>a.date===date),OPEN);
    assert.deepEqual(quality,{uncoveredMinutes:0,soloMinutes:0});
  }
  assert.equal(JSON.stringify(config),input,"não altera os dados de origem");
  assert.deepEqual(result,generateSchedule(config),"determinismo");
  console.log("PR92_ANONYMIZED_28DAY "+JSON.stringify({
    previousLongDays:20,newLongDays:totalLong,
    byMember:[...longs.values()],shifts:result.candidateAssignments.length,
  }));
});

test("PR91: ciclo de 28 dias reduz jornadas >9h sem prejudicar a cobertura real",()=>{
  const config=realScenarioAnonymized();
  const initial=JSON.stringify(config);
  const result=generateSchedule(config);
  assert.equal(result.status,"insufficient_context");
  assert.ok(result.certification.issues.every(issue=>
    issue.code==="CONTEXT_INCOMPLETE"),"nunca inserir hard conflicts");
  const cycle=result.candidateAssignments.filter(a=>
    a.date>="2026-11-02"&&a.date<="2026-11-29");
  for(const member of config.team.members){
    const person=cycle.filter(a=>a.memberId===member.id);
    assert.equal(person.reduce((sum,a)=>sum+assignmentMinutes(a),0),
      9600,"160h efetivas no ciclo");
  }
  const long=result.candidateAssignments.filter(a=>
    assignmentMinutes(a)>540).length;
  const saturdays=["2026-11-07","2026-11-14",
    "2026-11-21","2026-11-28"];
  const soloDays=saturdays.map(date=>{
    const shifts=result.candidateAssignments.filter(a=>a.date===date);
    return measureSimultaneousCoverage(shifts,OPEN);
  });
  assert.ok(soloDays.every(q=>q.uncoveredMinutes===0&&q.soloMinutes===0),
    "não sacrificar a presença simultânea para reduzir jornadas");
  const independently=certifySchedule({...config,
    candidateAssignments:result.candidateAssignments});
  assert.equal(independently.status,result.status);
  assert.deepEqual(independently.issues,result.certification.issues);
  // PR91 melhora horas sobre os dias já escalados. A correção da
  // rotação pode modificar o número de turnos, não as 160h do ciclo.
  assert.ok(long<=30,
    "melhoria das 30 jornadas longas não deve regredir: "+long);
  assert.ok(long<56,
    "a otimização real de 28 dias deve superar as 56 jornadas >9h: "+long);
  const staffedWeekends=result.dailyStaffing?.days.filter(day=>
    (day.weekday==="saturday"||day.weekday==="sunday") &&
    day.date>="2026-11-07" && day.date<="2026-11-30")??[];
  assert.equal(staffedWeekends.length,8);
  assert.ok(staffedWeekends.every(day=>day.present>=5),
    "60% SOFT deve ser atingido quando viável: "+
      JSON.stringify(staffedWeekends.map(d=>({
        date:d.date,present:d.present,
      }))));
  assert.equal(result.dailyStaffing?.daysBelowTarget,0,
    "não criar défices de presença nos restantes dias de novembro");
  console.log("PR91_ANONYMIZED_28DAY "+
    JSON.stringify({previousLongDays:56,newLongDays:long,
      soloSaturdayMinutes:soloDays.reduce((sum,q)=>sum+q.soloMinutes,0),
      totalShifts:result.candidateAssignments.length,
      weekendStaffing:staffedWeekends.map(d=>d.present),
      contextStatus:result.status}));
  assert.equal(JSON.stringify(config),initial,"configuração não é mutada");
  assert.deepEqual(generateSchedule(config),result,"repetibilidade");
});
