import test from "node:test";
import assert from "node:assert/strict";
import {performance} from "node:perf_hooks";
import {generateSchedule,type GenerationInput} from "../src/generateSchedule";
import {certifySchedule} from "../src/certifySchedule";
import {WEEKDAYS,type WeeklyOpeningHours} from "../src/operatingHours";
import {
  addCivilDays,civilDayOfWeek,enumerateCivilDays,resolvePlanningPeriod,
  type PeriodRequest,
} from "../src/schedulePeriods";
import {
  assignmentMinutes,clockMinutes,type WorkAssignment,
} from "../src/workAssignments";

/**
 * Reproducible synthetic diagnostics for PR80. The objective is to MEASURE
 * quality and scalability, not to introduce coverage as a hard constraint.
 * Test output intentionally exposes unfair distributions rather than failing
 * on a subjective quality threshold.
 */
const TEAM_SIZES=[2,10,50,200] as const;
const OPEN=9*60;
const CLOSE=19*60;

function scenario(size:number,period:PeriodRequest={mode:"28d",start:"2026-11-02"}):
  GenerationInput {
  const members=Array.from({length:size},(_,i)=>({
    id:"00000000-0000-4000-8000-"+String(i+1).padStart(12,"0"),
    name:"Colaborador "+String(i+1).padStart(3,"0"),
    active:true,
  }));
  const openingHours:WeeklyOpeningHours={
    days:WEEKDAYS.map(({id},i)=>({
      day:id,
      intervals:i<5?[{start:"09:00",end:"19:00"}]:[],
    })),
  };
  return {period,team:{members},openingHours};
}
interface Diagnostics {
  teamSize:number;
  periodMode:string;
  status:string;
  activeDays:number;
  assignments:number;
  weeklySummaries:number;
  distinctStartsPerDayMin:number;
  distinctStartsPerDayMax:number;
  distinctStartsPerDayMean:number;
  /** The metric counts only exact 09:00 starts, not minimum staffing. */
  noExactOpeningShifts:number;
  /** The metric counts only exact 19:00 finishes, not minimum staffing. */
  noExactClosingShifts:number;
  openingShiftsPerMemberMin:number;
  openingShiftsPerMemberMax:number;
  closingShiftsPerMemberMin:number;
  closingShiftsPerMemberMax:number;
  meanStartMinutePerMemberMin:number;
  meanStartMinutePerMemberMax:number;
  meanStartGapMinutes:number;
  generationMsFirst:number;
  generationMsSecond:number;
}

function quality(
  size:number,assignments:WorkAssignment[],status:string,
  weeklySummaries:number,firstMs:number,secondMs:number,periodMode:string
):Diagnostics {
  const byDay=new Map<string,WorkAssignment[]>();
  const byMember=new Map<string,WorkAssignment[]>();
  for(const assignment of assignments){
    byDay.set(assignment.date,[...(byDay.get(assignment.date)??[]),assignment]);
    byMember.set(assignment.memberId,
      [...(byMember.get(assignment.memberId)??[]),assignment]);
  }
  const uniqueStarts=[...byDay.values()].map(items=>
    new Set(items.map(x=>x.start)).size);
  const members=[...byMember.values()];
  const openings=members.map(items=>items.filter(x=>clockMinutes(x.start)===OPEN).length);
  const closings=members.map(items=>items.filter(x=>clockMinutes(x.end)===CLOSE).length);
  const meanStarts=members.map(items=>
    items.reduce((sum,x)=>sum+clockMinutes(x.start),0)/items.length);
  const minMean=Math.min(...meanStarts);
  const maxMean=Math.max(...meanStarts);
  const round=(v:number)=>Math.round(v*100)/100;
  return {
    teamSize:size,periodMode,status,activeDays:byDay.size,
    assignments:assignments.length,weeklySummaries,
    distinctStartsPerDayMin:Math.min(...uniqueStarts),
    distinctStartsPerDayMax:Math.max(...uniqueStarts),
    distinctStartsPerDayMean:round(
      uniqueStarts.reduce((sum,n)=>sum+n,0)/uniqueStarts.length
    ),
    noExactOpeningShifts:openings.filter(n=>n===0).length,
    noExactClosingShifts:closings.filter(n=>n===0).length,
    openingShiftsPerMemberMin:Math.min(...openings),
    openingShiftsPerMemberMax:Math.max(...openings),
    closingShiftsPerMemberMin:Math.min(...closings),
    closingShiftsPerMemberMax:Math.max(...closings),
    meanStartMinutePerMemberMin:round(minMean),
    meanStartMinutePerMemberMax:round(maxMean),
    meanStartGapMinutes:round(maxMean-minMean),
    generationMsFirst:round(firstMs),
    generationMsSecond:round(secondMs),
  };
}

test("Diagnóstico 2/10/50/200: 28 dias, 40h exatas e métricas de distribuição",()=>{
  for(const size of TEAM_SIZES){
    const data=scenario(size);
    const snapshot=JSON.stringify(data);
    const before=performance.now();
    const first=generateSchedule(data);
    const firstMs=performance.now()-before;
    const secondStart=performance.now();
    const second=generateSchedule(data);
    const secondMs=performance.now()-secondStart;

    assert.equal(first.status,"valid",size+" colaboradores");
    assert.equal(first.certification.status,"valid");
    assert.deepEqual(first.certification.issues,[]);
    assert.equal(first.certification.weeks.length,4*size);
    assert.ok(first.certification.weeks.every(week=>
      week.complete && week.actualMinutes===2400));
    assert.equal(first.candidateAssignments.length,20*size);
    assert.deepEqual(first.candidateAssignments,second.candidateAssignments);
    assert.deepEqual(first.certification,second.certification);
    assert.equal(JSON.stringify(data),snapshot,
      "A medição não pode escrever nem alterar inputs.");

    const days=enumerateCivilDays(resolvePlanningPeriod(data.period))
      .filter(date=>civilDayOfWeek(date)<5);
    assert.equal(days.length,20);
    const byDay=new Map<string,number>();
    const perMember=new Map<string,number>();
    for(const shift of first.candidateAssignments){
      assert.ok(days.includes(shift.date));
      assert.ok(clockMinutes(shift.start)>=OPEN);
      assert.ok(clockMinutes(shift.end)<=CLOSE);
      assert.equal(assignmentMinutes(shift),480);
      byDay.set(shift.date,(byDay.get(shift.date)??0)+1);
      perMember.set(shift.memberId,(perMember.get(shift.memberId)??0)+480);
    }
    assert.equal(byDay.size,20);
    assert.ok([...byDay.values()].every(n=>n===size));
    assert.equal(perMember.size,size);
    assert.ok([...perMember.values()].every(minutes=>minutes===20*480));

    const metric=quality(
      size,first.candidateAssignments,first.status,
      first.certification.weeks.length,firstMs,secondMs,data.period.mode
    );
    const expectedDifferentStarts=Math.min(size,5); // 09:00..11:00 every 30m.
    assert.equal(metric.distinctStartsPerDayMin,expectedDifferentStarts);
    assert.equal(metric.distinctStartsPerDayMax,expectedDifferentStarts);
    // A 5-slot rotation needs FIVE weeks for complete equity, while this
    // baseline spans only four. Never change starts midweek to force the
    // older daily-rotation metric to zero.
    assert.ok(metric.meanStartGapMinutes<=30,
      "Em quatro semanas a rotação não deve exceder um slot de desvio médio");
    assert.ok(metric.openingShiftsPerMemberMax-
      metric.openingShiftsPerMemberMin<=5);
    assert.ok(metric.closingShiftsPerMemberMax-
      metric.closingShiftsPerMemberMin<=5);
    assert.ok(first.candidateAssignments.every(shift=>
      (clockMinutes(shift.start)-OPEN)%30===0));
    const memberWeekStarts=new Map<string,Set<string>>();
    for(const shift of first.candidateAssignments){
      const monday=addCivilDays(shift.date,-civilDayOfWeek(shift.date));
      const key=shift.memberId+"|"+monday;
      const starts=memberWeekStarts.get(key)??new Set<string>();
      starts.add(shift.start);
      memberWeekStarts.set(key,starts);
    }
    assert.equal(memberWeekStarts.size,4*size);
    assert.ok([...memberWeekStarts.values()].every(starts=>starts.size===1),
      "O colaborador deve ter um único horário de entrada por semana");
    // Quality observations are diagnostic: no arbitrary fairness threshold
    // should be mistaken for a contractual rule.
    console.log("SCHEDULE_DISTRIBUTION_DIAGNOSTIC "+JSON.stringify(metric));
  }
});

test("200 colaboradores: geração mensal de 31 dias mantém contexto desconhecido",()=>{
  const data=scenario(200,{mode:"monthly",year:2026,month:12});
  const before=JSON.stringify(data);
  const start=performance.now();
  const result=generateSchedule(data);
  const generationMs=performance.now()-start;
  assert.equal(result.status,"insufficient_context");
  assert.ok(result.certification.issues.some(issue=>issue.code==="CONTEXT_INCOMPLETE"));
  assert.equal(result.certification.issues.some(issue=>
    issue.code==="WEEKLY_HOURS_MISSING" || issue.code==="WEEKLY_HOURS_EXCESS"
  ),false);
  assert.ok(result.candidateAssignments.every(a=>
    a.date>="2026-12-01" && a.date<"2027-01-01"));
  assert.equal(JSON.stringify(data),before);
  console.log("SCHEDULE_MONTHLY_DIAGNOSTIC "+JSON.stringify({
    teamSize:200,periodMode:"monthly",year:2026,month:12,
    status:result.status,assignments:result.candidateAssignments.length,
    contextIncompleteWeeks:new Set(result.certification.issues
      .filter(issue=>issue.code==="CONTEXT_INCOMPLETE")
      .map(issue=>issue.weekStart)).size,
    generationMs:Math.round(generationMs*100)/100,
  }));
});

test("Métricas de 2 colaboradores revelam distribuição alternada, sem cobertura hard",()=>{
  const data=scenario(2);
  const result=generateSchedule(data);
  const days=enumerateCivilDays(resolvePlanningPeriod(data.period))
    .filter(date=>civilDayOfWeek(date)<5);
  for(const day of days){
    const shifts=result.candidateAssignments.filter(a=>a.date===day);
    assert.deepEqual(shifts.map(s=>s.start).sort(),["09:00","11:00"]);
    assert.deepEqual(shifts.map(s=>s.end).sort(),["17:00","19:00"]);
  }
  const metric=quality(2,result.candidateAssignments,result.status,
    result.certification.weeks.length,0,0,"28d");
  assert.equal(metric.noExactOpeningShifts,0);
  assert.equal(metric.noExactClosingShifts,0);
  assert.equal(metric.openingShiftsPerMemberMin,10);
  assert.equal(metric.openingShiftsPerMemberMax,10);
  assert.equal(metric.meanStartGapMinutes,0);
});

test("O motor escolhe horas certas quando há posições suficientes para a equipa",()=>{
  for(const size of [2,3]){
    const data=scenario(size);
    const snapshot=JSON.stringify(data);
    const result=generateSchedule(data);
    assert.equal(result.status,"valid");
    const starts=[...new Set(result.candidateAssignments
      .filter(shift=>shift.date==="2026-11-02").map(shift=>shift.start))].sort();
    assert.deepEqual(starts,size===2
      ?["09:00","11:00"]
      :["09:00","10:00","11:00"]);
    assert.ok(result.candidateAssignments.every(shift=>
      clockMinutes(shift.start)%60===0));
    assert.equal(JSON.stringify(data),snapshot);
  }
});

test("O motor usa meias horas automaticamente quando há mais pessoas",()=>{
  const data=scenario(4);
  const result=generateSchedule(data);
  assert.equal(result.status,"valid");
  const starts=[...new Set(result.candidateAssignments
    .filter(shift=>shift.date==="2026-11-02").map(shift=>shift.start))].sort();
  assert.deepEqual(starts,["09:00","09:30","10:30","11:00"]);
  assert.ok(result.candidateAssignments.every(shift=>
    clockMinutes(shift.start)%30===0));
  assert.equal(result.certification.weeks.every(w=>w.actualMinutes===2400),true);
});


test("Equidade em cinco semanas: 200 colaboradores percorrem as cinco posições",()=>{
  const data=scenario(200);
  const baseline=generateSchedule(data);
  const next=generateSchedule(scenario(200,{
    mode:"weekly",start:"2026-11-30",
  }));
  assert.equal(baseline.status,"valid");
  assert.equal(next.status,"valid");
  const mondayDates=[
    "2026-11-02","2026-11-09","2026-11-16",
    "2026-11-23","2026-11-30",
  ];
  const all=[...baseline.candidateAssignments,...next.candidateAssignments];
  for(const member of (data.team as {members:{id:string}[]}).members){
    const starts=mondayDates.map(date=>{
      const shift=all.find(a=>a.memberId===member.id&&a.date===date);
      assert.ok(shift,"Falta uma segunda-feira de trabalho");
      return shift.start;
    });
    assert.deepEqual([...new Set(starts)].sort(),[
      "09:00","09:30","10:00","10:30","11:00",
    ]);
  }
});


test("Escalabilidade de 2 a 200 colaboradores com seis dias de duração diferente",()=>{
  for(const size of TEAM_SIZES){
    const data=scenario(size);
    (data.openingHours as WeeklyOpeningHours).days[5].intervals=[
      {start:"09:00",end:"13:00"},
    ];
    const snapshot=JSON.stringify(data);
    const before=performance.now();
    const first=generateSchedule(data);
    const elapsed=performance.now()-before;
    const second=generateSchedule(data);
    assert.equal(first.status,"valid",size+" colaboradores");
    assert.equal(first.certification.status,"valid");
    assert.equal(first.candidateAssignments.length,size*24);
    assert.equal(first.certification.weeks.length,size*4);
    assert.ok(first.certification.weeks.every(w=>
      w.complete&&w.actualMinutes===2400));
    assert.deepEqual(first,second,"Mesmo input deve gerar o mesmo horário");
    assert.equal(JSON.stringify(data),snapshot,"Sem mutação dos inputs");

    const perMemberWeek=new Map<string,WorkAssignment[]>();
    for(const assignment of first.candidateAssignments){
      const monday=addCivilDays(assignment.date,
        -civilDayOfWeek(assignment.date));
      const key=assignment.memberId+"|"+monday;
      perMemberWeek.set(key,[
        ...(perMemberWeek.get(key)??[]),assignment,
      ]);
      const minutes=assignmentMinutes(assignment);
      if(civilDayOfWeek(assignment.date)===5){
        assert.equal(minutes,240);
        assert.equal(assignment.start,"09:00");
        assert.equal(assignment.end,"13:00");
      }else{
        assert.ok(minutes===420||minutes===480,
          "Os cinco dias longos devem repartir 36h com turnos alinhados");
      }
    }
    assert.equal(perMemberWeek.size,size*4);
    for(const work of perMemberWeek.values()){
      assert.equal(work.length,6);
      assert.equal(work.reduce((sum,a)=>sum+assignmentMinutes(a),0),2400);
      const weekdays=work.filter(a=>civilDayOfWeek(a.date)<5);
      assert.equal(weekdays.length,5);
      assert.equal(weekdays.reduce((sum,a)=>sum+assignmentMinutes(a),0),2160);
      assert.deepEqual(weekdays.map(assignmentMinutes).sort((a,b)=>a-b),
        [420,420,420,420,480]);
      assert.ok(new Set(weekdays.map(a=>a.start)).size<=2);
      assert.ok(new Set(weekdays.map(a=>a.end)).size<=2);
      assert.equal(work.filter(a=>civilDayOfWeek(a.date)===5).length,1);
    }
    console.log("SCHEDULE_ALL_OPEN_DAYS_DIAGNOSTIC "+JSON.stringify({
      teamSize:size,weeks:4,openDays:6,
      assignments:first.candidateAssignments.length,
      weeklyMinutes:2400,
      weekdayMinutesTotal:2160,
      shortOpenDayMinutes:240,
      elapsedMs:Math.round(elapsed*100)/100,
    }));
  }
});
