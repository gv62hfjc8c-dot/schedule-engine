import {validateTeamRoster,type TeamRoster} from "./team";
import {
  WEEKDAYS,validateWeeklyOpeningHours,type WeeklyOpeningHours,
} from "./operatingHours";
import {
  addCivilDays,civilDayOfWeek,parseCivilDate,
} from "./schedulePeriods";
import {
  assignmentMinutes,clockMinutes,validateWorkAssignment,
  type WorkAssignment,
} from "./workAssignments";
import {effectiveMealDayCapacity} from "./mealBreaks";
import {shortOpeningDays} from "./shortOpenings";
import {
  analyzeFixedWorkdayLongDayBound,type CycleWorkday,
} from "./cycleWorkloadOptimization";
import {
  DAILY_STAFFING_REFERENCE_PERCENT,desiredDailyHeadcount,
} from "./dailyStaffingBalance";
import type {WeekendRotationResult} from "./weekendRotation";

const CYCLE_MINUTES=9600;
const PREFERRED_MAX=540;
const MAX_SUGGESTIONS=20;

/** One candidate to investigate, NOT a replacement shift schedule. */
export interface RestDayExchangeOpportunity {
  memberId:string;
  /** Existing short-opening shift that would become an explicitly planned rest. */
  restInsteadOfWorking:string;
  /** Existing planned weekday rest that would become a working day. */
  workInsteadOfRest:string;
  weekStart:string;
  roleToCover:string|null;
  sundayHeadcountBefore:number;
  sundayHeadcountAfter:number;
  baselineMemberMinimumLongDays:number;
  hypotheticalMemberMinimumLongDays:number;
  /** Optimistic bound only; could fail exact shift/meal/role coverage. */
  potentialLongDayReduction:number;
}
export interface RestDayExchangeResearch {
  cycleStart:string;
  cycleEndExclusive:string;
  baselineObservedLongDays:number;
  baselineMathematicalMinimum:number;
  targetDailyHeadcount:number;
  /** No candidate has been applied to the actual schedule. */
  opportunities:RestDayExchangeOpportunity[];
  certainty:"necessary_conditions_only";
}

/**
 * A lower bound for an UNALLOCATED set of working dates. If the best
 * theoretical capacity of those dates is less than 160h, return null.
 * This deliberately ignores exact start/meal placement and team coverage;
 * therefore it can NEVER serve as a feasibility certificate.
 */
function hypotheticalLongDayFloor(
  days:readonly Pick<CycleWorkday,"capacity"|"locked">[],
):number|null {
  if(days.some(day=>!Number.isSafeInteger(day.capacity)||
    day.capacity<=0))return null;
  const base=days.reduce((sum,day)=>
    sum+Math.min(day.capacity,PREFERRED_MAX),0);
  const total=days.reduce((sum,day)=>sum+day.capacity,0);
  if(total<CYCLE_MINUTES)return null;
  let missing=CYCLE_MINUTES-base;
  if(missing<=0)return 0;
  const extras=days.filter(day=>!day.locked && day.capacity>PREFERRED_MAX)
    .map(day=>day.capacity-PREFERRED_MAX)
    .sort((a,b)=>b-a);
  for(let n=0;n<extras.length;n++){
    missing-=extras[n];
    if(missing<=0)return n+1;
  }
  return null;
}

/**
 * PR96 phase 1: read-only search for exchanging ONE worked short Sunday
 * with ONE explicitly rested weekday in the SAME civil week.
 *
 * Necessary conditions checked: exact 160h baseline for each active member,
 * four complete consecutive weeks with consistent explicit rest, no fixed
 * day off touched, existing full-weekend awards preserved, and no fall
 * below the existing internal 60% headcount goal on the affected Sunday.
 * An occupied role may not become completely absent on that Sunday.
 *
 * Crucially, NO new shift times, meals or real coverage are constructed
 * here. Suggestions are NOT valid schedules. Later stages must construct
 * candidates, independently certify HARD constraints and compare SOFT
 * quality before any such change can enter the generator.
 */
export function analyzeRestDayExchangeOpportunities(input:{
  cycleStart:string;
  team:TeamRoster;
  openingHours:WeeklyOpeningHours;
  assignments:readonly WorkAssignment[];
  rotation:WeekendRotationResult|null;
}):RestDayExchangeResearch|null {
  let cycleEndExclusive:string;
  try {
    parseCivilDate(input.cycleStart);
    if(civilDayOfWeek(input.cycleStart)!==0)return null;
    cycleEndExclusive=addCivilDays(input.cycleStart,28);
  }catch{return null;}
  const team=validateTeamRoster(input.team);
  const opening=validateWeeklyOpeningHours(input.openingHours);
  if(!team.valid||!opening.valid||
    !input.rotation||input.rotation.status!=="planned")return null;
  const active=team.value.members.filter(member=>member.active);
  if(!active.length)return null;
  const ids=new Set(active.map(member=>member.id));
  const weeks=Array.from({length:4},(_,i)=>
    addCivilDays(input.cycleStart,7*i));
  const rotationWeeks=weeks.map(week=>
    input.rotation!.weeks.find(entry=>entry.weekStart===week));
  if(rotationWeeks.some(week=>week===undefined))return null;
  const short=shortOpeningDays(opening.value);
  const capacities=opening.value.days.map((day,weekday)=>{
    const windows=day.intervals.map(interval=>({
      start:clockMinutes(interval.start),
      end:clockMinutes(interval.end),
    }));
    const minutes=windows.reduce((sum,w)=>sum+w.end-w.start,0);
    return {
      short:short.has(weekday),
      capacity:short.has(weekday)
        ?minutes:(minutes?effectiveMealDayCapacity(windows):0),
    };
  });
  const byMember=new Map<string,Map<string,WorkAssignment>>();
  const byDate=new Map<string,WorkAssignment[]>();
  for(const member of active)byMember.set(member.id,new Map());
  for(const raw of input.assignments){
    if(raw.date<input.cycleStart||raw.date>=cycleEndExclusive)continue;
    const shift=validateWorkAssignment(raw);
    if(!shift || !ids.has(shift.memberId))return null;
    const memberDays=byMember.get(shift.memberId)!;
    if(memberDays.has(shift.date))return null;
    const cap=capacities[civilDayOfWeek(shift.date)];
    if(!cap || assignmentMinutes(shift)<=0 ||
      assignmentMinutes(shift)>cap.capacity)return null;
    if(cap.short){
      const openingWindows=opening.value.days[civilDayOfWeek(shift.date)]
        .intervals;
      if(openingWindows.length!==1 ||
        shift.start!==openingWindows[0].start ||
        shift.end!==openingWindows[0].end ||
        assignmentMinutes(shift)!==cap.capacity)return null;
    }
    memberDays.set(shift.date,shift);
    const group=byDate.get(shift.date)??[];
    group.push(shift);
    byDate.set(shift.date,group);
  }
  const memberBounds=new Map<string,{
    floor:number;workdays:CycleWorkday[];
  }>();
  for(const member of active){
    const shifts=byMember.get(member.id)!;
    if([...shifts.values()].reduce((sum,s)=>
      sum+assignmentMinutes(s),0)!==CYCLE_MINUTES)return null;
    const workdays:CycleWorkday[]=[...shifts.values()].map(shift=>{
      const weekIndex=Math.floor(
        (Date.parse(shift.date+"T12:00:00Z")-
          Date.parse(input.cycleStart+"T12:00:00Z"))/604800000);
      const cap=capacities[civilDayOfWeek(shift.date)];
      return {
        date:shift.date,weekStart:weeks[weekIndex],
        minutes:assignmentMinutes(shift),
        capacity:cap.capacity,locked:cap.short,
      };
    });
    const bound=analyzeFixedWorkdayLongDayBound(workdays);
    if(!bound)return null;
    memberBounds.set(member.id,{
      floor:bound.minimumLongDays,workdays,
    });
    // Rotation decisions are explicit, not inferred from lack of a shift.
    for(const week of rotationWeeks){
      const planned=week!.members.find(m=>m.memberId===member.id);
      if(!planned)return null;
      const off=new Set(planned.daysWithoutWork);
      if(off.size!==planned.daysWithoutWork.length)return null;
      const saturday=addCivilDays(week!.weekStart,5);
      const sunday=addCivilDays(week!.weekStart,6);
      const full=off.has(saturday)&&off.has(sunday);
      if(full!==planned.fullWeekendOff ||
        full!==week!.fullWeekendOffMemberIds.includes(member.id))
        return null;
      for(let weekday=0;weekday<7;weekday++){
        const date=addCivilDays(week!.weekStart,weekday);
        if(off.has(date)===shifts.has(date))return null;
        if(member.fixedDaysOff?.includes(WEEKDAYS[weekday].id) &&
          shifts.has(date))return null;
      }
    }
  }

  const targetDailyHeadcount=desiredDailyHeadcount(
    active.length,DAILY_STAFFING_REFERENCE_PERCENT);
  const baselineMathematicalMinimum=[...memberBounds.values()]
    .reduce((sum,bound)=>sum+bound.floor,0);
  const baselineObservedLongDays=[...byMember.values()].reduce(
    (sum,days)=>sum+[...days.values()].filter(s=>
      assignmentMinutes(s)>PREFERRED_MAX).length,0);
  const opportunities:RestDayExchangeOpportunity[]=[];
  if(!capacities[6].short)return {
    cycleStart:input.cycleStart,cycleEndExclusive,
    baselineObservedLongDays,baselineMathematicalMinimum,
    targetDailyHeadcount,opportunities,
    certainty:"necessary_conditions_only",
  };
  for(const week of rotationWeeks){
    const sunday=addCivilDays(week!.weekStart,6);
    const saturday=addCivilDays(week!.weekStart,5);
    const sundayShifts=byDate.get(sunday)??[];
    // Never trade away the current 60% staffing goal on a short Sunday.
    if(sundayShifts.length<=targetDailyHeadcount)continue;
    for(const member of active){
      const days=byMember.get(member.id)!;
      const sundayShift=days.get(sunday);
      const bound=memberBounds.get(member.id)!;
      const planned=week!.members.find(m=>m.memberId===member.id)!;
      // This swap must not change the full-weekend rotation/fairness.
      if(!sundayShift||!days.has(saturday)||
        planned.fullWeekendOff||bound.floor===0)continue;
      if(sundayShift.role!==undefined &&
        sundayShifts.filter(s=>s.role===sundayShift.role).length<=1)
        continue;
      for(let weekday=0;weekday<5;weekday++){
        const replacement=addCivilDays(week!.weekStart,weekday);
        if(days.has(replacement)||
          !planned.daysWithoutWork.includes(replacement)||
          member.fixedDaysOff?.includes(WEEKDAYS[weekday].id))
          continue;
        const cap=capacities[weekday];
        if(cap.short||cap.capacity<=PREFERRED_MAX)continue;
        const nextDays=bound.workdays.filter(d=>d.date!==sunday)
          .map(d=>({capacity:d.capacity,locked:d.locked}));
        nextDays.push({capacity:cap.capacity,locked:false});
        const nextFloor=hypotheticalLongDayFloor(nextDays);
        if(nextFloor===null||nextFloor>=bound.floor)continue;
        opportunities.push({
          memberId:member.id,
          restInsteadOfWorking:sunday,
          workInsteadOfRest:replacement,
          weekStart:week!.weekStart,
          roleToCover:sundayShift.role??null,
          sundayHeadcountBefore:sundayShifts.length,
          sundayHeadcountAfter:sundayShifts.length-1,
          baselineMemberMinimumLongDays:bound.floor,
          hypotheticalMemberMinimumLongDays:nextFloor,
          potentialLongDayReduction:bound.floor-nextFloor,
        });
      }
    }
  }
  opportunities.sort((a,b)=>
    b.potentialLongDayReduction-a.potentialLongDayReduction ||
    a.restInsteadOfWorking.localeCompare(b.restInsteadOfWorking) ||
    a.workInsteadOfRest.localeCompare(b.workInsteadOfRest) ||
    a.memberId.localeCompare(b.memberId));
  return {
    cycleStart:input.cycleStart,cycleEndExclusive,
    baselineObservedLongDays,baselineMathematicalMinimum,
    targetDailyHeadcount,
    opportunities:opportunities.slice(0,MAX_SUGGESTIONS),
    certainty:"necessary_conditions_only",
  };
}
