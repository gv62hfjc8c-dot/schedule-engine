import test from "node:test";
import assert from "node:assert/strict";
import {performance} from "node:perf_hooks";
import {generateSchedule,type GenerationInput} from "../src/generateSchedule";
import {certifySchedule} from "../src/certifySchedule";
import {WEEKDAYS,type WeeklyOpeningHours} from "../src/operatingHours";
import {
  civilDayOfWeek,enumerateCivilDays,resolvePlanningPeriod,
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
    assert.ok(metric.distinctStartsPerDayMin>=2);
    assert.ok(metric.distinctStartsPerDayMax<=size);
    assert.ok(metric.meanStartGapMinutes>=0 && metric.meanStartGapMinutes<=120);
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
