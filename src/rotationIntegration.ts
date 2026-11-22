import {addCivilDays,inRange,type PlanningPeriod} from "./schedulePeriods";
import {clockMinutes} from "./workAssignments";
import type {TeamRoster} from "./team";
import {WEEKDAYS,type WeeklyOpeningHours,type Weekday} from "./operatingHours";
import {effectiveMealDayCapacity} from "./mealBreaks";
import {shortOpeningDays} from "./shortOpenings";
import {
  planWeekendRotation,type WeekendRotationResult,type WeekdayNumbers,
  type RotationHistoryEntry,
} from "./weekendRotation";

export interface RotationPreparation {
  rotation:WeekendRotationResult;
  daysWithoutWorkByMemberWeek:ReadonlyMap<string,ReadonlySet<string>>;
  weeklySoftTargets:ReadonlyMap<string,number>;
  /** A target shortfall is a soft diagnostic, never invented work. */
  fourWeekTargetShortfalls:readonly {
    memberId:string;startWeek:string;missingMinutes:number;
  }[];
}

/** Keep hard coverage by minute in the certifier; this is only the
 * necessary minimum number of people to cover a day's total duration. */
export function provisionalDailyCoverageLowerBound(
  openMinutes:number,maxEffectivePerMember:number,
):number {
  if(openMinutes===0)return 0;
  if(maxEffectivePerMember<=0)return 1;
  return Math.max(1,Math.ceil(openMinutes/maxEffectivePerMember));
}

/**
 * Soft goal across four full, consecutive civil weeks. First respect every
 * weekly feasible capacity, then distribute the remaining 160h target to
 * weeks with room, preferring the smallest overload above 40h.
 *
 * This is a reference for four 7-day slices, not an assertion about ALL
 * possible rolling 28-day windows or a legal/contractual hours balance.
 */
export function fourWeekSoftTargets(
  capacities:readonly number[],weekReference=2400,cycleReference=9600,
):{targets:number[];missingMinutes:number} {
  if(capacities.length!==4 || capacities.some(c=>
    !Number.isSafeInteger(c)||c<0))
    throw new Error("São necessárias quatro capacidades semanais válidas.");
  const targets=capacities.map(cap=>Math.min(cap,weekReference));
  const maxWeek=weekReference+240; // existing soft 36..44h guidance
  let missing=Math.max(0,cycleReference-
    targets.reduce((sum,value)=>sum+value,0));
  while(missing>0){
    let winner=-1;
    for(let i=0;i<4;i++){
      if(targets[i]>=Math.min(capacities[i],maxWeek))continue;
      if(winner<0 || targets[i]<targets[winner] ||
        (targets[i]===targets[winner]&&i<winner))winner=i;
    }
    if(winner<0)break;
    const step=Math.min(15,missing,capacities[winner]-targets[winner],
      maxWeek-targets[winner]);
    targets[winner]+=step;
    missing-=step;
  }
  return {targets,missingMinutes:missing};
}

/**
 * Pre-plan full civil weeks only. Weeks crossing the editable-month boundary
 * keep their historic, read-only context and use the legacy cautious path.
 * Historical rest requires an explicit prior decision, never just no shift.
 */
export function prepareRotation(
  period:PlanningPeriod,
  team:TeamRoster,
  opening:WeeklyOpeningHours,
  confirmedFullWeekends:readonly RotationHistoryEntry[]=[],
):RotationPreparation|null {
  const active=team.members.filter(person=>person.active);
  if(!active.some(person=>person.weekendRest))return null;

  const weeks=period.weeks.filter(week=>
    inRange(week.start,period) &&
    inRange(addCivilDays(week.endExclusive,-1),period));
  if(weeks.length===0)return null;
  const first=weeks[0].start;
  const shortDays=shortOpeningDays(opening);
  const closed:Weekday[]=[];
  const capacities:number[]=[];
  const minima:number[]=[];
  for(const [index,day] of opening.days.entries()){
    const intervals=day.intervals.map(d=>({
      start:clockMinutes(d.start),end:clockMinutes(d.end),
    }));
    const open=intervals.reduce((sum,window)=>
      sum+window.end-window.start,0);
    if(open===0)closed.push(day.day);
    const max=open===0?0:
      shortDays.has(index)?open:effectiveMealDayCapacity(intervals);
    capacities.push(max);
    minima.push(provisionalDailyCoverageLowerBound(open,max));
  }
  // Missing a shift in a saved period is NOT evidence of a planned rest day.
  // Only explicit records from previously saved rotation decisions count.
  const previousFullWeekends=[...confirmedFullWeekends].filter(item=>
    item.weekStart<first && active.some(person=>
      person.id===item.memberId && person.weekendRest!==undefined));
  const rotation=planWeekendRotation({
    startWeek:first,weeks:weeks.length,
    members:active.map(person=>({
      id:person.id,weeklyDaysOff:person.weeklyDaysOff!,
      fixedDaysOff:person.fixedDaysOff??[],
      minimumWeekdayDaysOffOnFullWeekend:
        person.weekendRest?.minimumWeekdayDaysOffOnFullWeekend??0,
      eligibleFullWeekend:person.weekendRest!==undefined,
    })),
    minimumPresentByWeekday:Object.fromEntries(
      WEEKDAYS.map((d,index)=>[d.id,minima[index]])) as WeekdayNumbers,
    closedWeekdays:closed,
    maximumEffectiveMinutesByWeekday:Object.fromEntries(
      WEEKDAYS.map((d,index)=>[d.id,capacities[index]])) as WeekdayNumbers,
    ...(opening.dailyStaffingTargetPercent===undefined?{}:
      {dailyStaffingTargetPercent:opening.dailyStaffingTargetPercent}),
    // 160h/28d is a SOFT reference; 9h is a workload-quality threshold,
    // NOT a hard daily limit. Weekend frequency follows from both.
    workloadPreference:{
      cycleReferenceMinutes:9600,
      preferredUpperDailyMinutes:540,
      cycleWeeks:4,
    },
    ...(previousFullWeekends.length>0?{previousFullWeekends}:{}),
  });

  const daysWithoutWorkByMemberWeek=new Map<string,ReadonlySet<string>>();
  const weeklySoftTargets=new Map<string,number>();
  const fourWeekTargetShortfalls:{
    memberId:string;startWeek:string;missingMinutes:number
  }[]=[];
  for(const week of rotation.weeks)
    for(const member of week.members)
      daysWithoutWorkByMemberWeek.set(
        member.memberId+"|"+week.weekStart,
        new Set(member.daysWithoutWork),
      );

  // Only complete four-week blocks are softly balanced within themselves.
  // The other weeks use the existing history-aware rolling guidance.
  for(const member of active){
    for(let block=0;block+4<=rotation.weeks.length;block+=4){
      const window=rotation.weeks.slice(block,block+4);
      const caps=window.map(week=>week.members.find(
        item=>item.memberId===member.id)?.effectiveMinutesUpperBound??0);
      const budget=fourWeekSoftTargets(caps);
      for(let i=0;i<4;i++)
        weeklySoftTargets.set(member.id+"|"+window[i].weekStart,
          budget.targets[i]);
      if(budget.missingMinutes>0)
        fourWeekTargetShortfalls.push({
          memberId:member.id,startWeek:window[0].weekStart,
          missingMinutes:budget.missingMinutes,
        });
    }
  }
  return {
    rotation,daysWithoutWorkByMemberWeek,
    weeklySoftTargets,fourWeekTargetShortfalls,
  };
}
