/** PR96 phase 4 — apply certified cycle improvements only to generated proposals. */
import {certifySchedule,type CertificationInput} from "./certifySchedule";
import {evaluateRestDayExchangeCandidates} from "./restDayExchangeEvaluation";
import {WEEKDAYS,type WeeklyOpeningHours} from "./operatingHours";
import {addCivilDays,civilDayOfWeek,inRange,type PlanningPeriod} from "./schedulePeriods";
import {assignmentMinutes,clockMinutes,type WorkAssignment} from "./workAssignments";
import {effectiveMealDayCapacity} from "./mealBreaks";
import {shortOpeningDays} from "./shortOpenings";
import type {TeamRoster} from "./team";
import type {WeekendRotationResult} from "./weekendRotation";

export interface AppliedCycleExchange {
  cycleStart:string;
  cycleEndExclusive:string;
  memberId:string;
  newRestDate:string;
  newWorkDate:string;
  longDaysBefore:number;
  longDaysAfter:number;
  roleGapMinutesBefore:number|null;
  roleGapMinutesAfter:number|null;
  soloMinutesAfter:number;
  certificationStatus:"valid";
}
interface IntegrationInput {
  period:PlanningPeriod;
  team:TeamRoster;
  openingHours:WeeklyOpeningHours;
  assignments:readonly WorkAssignment[];
  rotation:WeekendRotationResult|null;
  certificationInput:Omit<CertificationInput,"candidateAssignments">;
}
export interface IntegratedCycleExchanges {
  assignments:WorkAssignment[];
  rotation:WeekendRotationResult|null;
  applied:AppliedCycleExchange[];
}

function dayCapacity(hours:WeeklyOpeningHours,date:string,
  short:ReadonlySet<number>):number{
  const weekday=civilDayOfWeek(date);
  const windows=hours.days[weekday].intervals.map(span=>({
    start:clockMinutes(span.start),end:clockMinutes(span.end),
  }));
  if(short.has(weekday))
    return windows.reduce((sum,w)=>sum+w.end-w.start,0);
  return effectiveMealDayCapacity(windows);
}

/** Reconcile the explicit rotation with the changed work/rest dates.
 * This is necessary: rotation metadata must not describe obsolete rests.
 * Other members and awarded full weekends remain unchanged.
 */
function reconcileRotation(original:WeekendRotationResult,
  opportunity:{memberId:string;weekStart:string;
    restInsteadOfWorking:string;workInsteadOfRest:string},
  next:readonly WorkAssignment[],hours:WeeklyOpeningHours,
):WeekendRotationResult|null{
  const week=original.weeks.find(w=>w.weekStart===opportunity.weekStart);
  const member=week?.members.find(m=>m.memberId===opportunity.memberId);
  if(!week||!member)return null;
  const originalOff=new Set(member.daysWithoutWork);
  if(originalOff.has(opportunity.restInsteadOfWorking)||
    !originalOff.has(opportunity.workInsteadOfRest))return null;
  const afterOff=new Set(originalOff);
  afterOff.add(opportunity.restInsteadOfWorking);
  afterOff.delete(opportunity.workInsteadOfRest);
  if(afterOff.size!==originalOff.size ||
    (afterOff.has(week.saturday)&&afterOff.has(week.sunday))!==
      member.fullWeekendOff)return null;
  const dates=Array.from({length:7},(_,i)=>addCivilDays(week.weekStart,i));
  // Compare explicit planned rest with actual absence, not with a guessed
  // holiday or an implicitly assigned free day.
  for(const person of week.members){
    const off=person.memberId===member.memberId?afterOff:
      new Set(person.daysWithoutWork);
    for(const date of dates){
      const hasWork=next.some(s=>s.memberId===person.memberId&&s.date===date);
      if(off.has(date)===hasWork)return null;
    }
  }
  const short=shortOpeningDays(hours);
  const upper=member.effectiveMinutesUpperBound===null?null:
    dates.reduce((sum,date)=>sum+
      (afterOff.has(date)?0:dayCapacity(hours,date,short)),0);
  const revised={
    ...member,daysWithoutWork:[...afterOff].sort(),
    effectiveMinutesUpperBound:upper,
  };
  const revisedWeek={
    ...week,
    members:week.members.map(m=>m.memberId===member.memberId?revised:m),
    presentByWeekday:Object.fromEntries(dates.map((date,i)=>[
      WEEKDAYS[i].id,new Set(next.filter(s=>s.date===date)
        .map(s=>s.memberId)).size,
    ])) as typeof week.presentByWeekday,
  };
  return {...original,weeks:original.weeks.map(w=>
    w.weekStart===week.weekStart?revisedWeek:w)};
}

/** Pure, bounded optional pass. Keep the entire original proposal when any
 * necessary evidence is absent; do not modify historical or saved periods.
 */
export function applyCertifiedCycleExchanges(
  input:IntegrationInput,
):IntegratedCycleExchanges{
  const original=():IntegratedCycleExchanges=>({
    assignments:[...input.assignments],rotation:input.rotation,applied:[],
  });
  if(input.certificationInput.hoursPolicy!=="rolling28"||
    input.certificationInput.mealBreakPolicy!=="v2"||
    input.certificationInput.functionalCoveragePolicy!=="qualified50"||
    !input.rotation||input.rotation.status!=="planned")return original();
  const starts=input.rotation.weeks.map(w=>w.weekStart).sort();
  let assignments=[...input.assignments];
  let rotation=input.rotation;
  const applied:AppliedCycleExchange[]=[];
  for(let i=0;i+4<=starts.length;i+=4){
    const block=starts.slice(i,i+4);
    if(block.some((start,j)=>start!==addCivilDays(block[0],7*j)))
      continue;
    const cycleStart=block[0];
    const cycleEndExclusive=addCivilDays(cycleStart,28);
    if(!inRange(cycleStart,input.period)||
      !inRange(addCivilDays(cycleEndExclusive,-1),input.period))
      continue;
    const analysis=evaluateRestDayExchangeCandidates({
      cycleStart,team:input.team,openingHours:input.openingHours,
      assignments,rotation,
    });
    const best=analysis?.best;
    if(!best||best.certification.status!=="valid"||
      best.longDays>=analysis.baselineLongDays)continue;
    const next=[...assignments.filter(s=>
      s.date<cycleStart||s.date>=cycleEndExclusive),
      ...best.candidateAssignments].sort((a,b)=>
      a.date.localeCompare(b.date)||a.memberId.localeCompare(b.memberId));
    const nextRotation=reconcileRotation(rotation,best.opportunity,
      next,input.openingHours);
    if(!nextRotation)continue;
    const before=certifySchedule({
      ...input.certificationInput,candidateAssignments:assignments,
    });
    if(before.status==="invalid")continue;
    const after=certifySchedule({
      ...input.certificationInput,candidateAssignments:next,
    });
    // A monthly report may remain insufficient_context because October or
    // December isn't loaded. Preserve status and EXACT issues: certification
    // over the complete internal 28-day window was separately valid.
    if(before.status!==after.status ||
      JSON.stringify(before.issues)!==JSON.stringify(after.issues))continue;
    // Never silently change total minutes, including outside the cycle.
    if(input.team.members.some(person=>person.active &&
      assignments.reduce((sum,s)=>sum+(s.memberId===person.id?
        assignmentMinutes(s):0),0)!==
      next.reduce((sum,s)=>sum+(s.memberId===person.id?
        assignmentMinutes(s):0),0)))continue;
    assignments=next;
    rotation=nextRotation;
    applied.push({
      cycleStart,cycleEndExclusive,
      memberId:best.opportunity.memberId,
      newRestDate:best.opportunity.restInsteadOfWorking,
      newWorkDate:best.opportunity.workInsteadOfRest,
      longDaysBefore:analysis.baselineLongDays,
      longDaysAfter:best.longDays,
      roleGapMinutesBefore:analysis.baselineRoleGapMinutes,
      roleGapMinutesAfter:best.roleGapMinutes,
      soloMinutesAfter:best.soloMinutes,
      certificationStatus:"valid",
    });
  }
  return {assignments,rotation,applied};
}
