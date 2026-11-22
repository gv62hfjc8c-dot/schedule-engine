import {
  analyzeFixedWorkdayLongDayBound,type CycleWorkday,
  type FixedWorkdayLongDayBound,
} from "./cycleWorkloadOptimization";
import {effectiveMealDayCapacity} from "./mealBreaks";
import type {WeeklyOpeningHours} from "./operatingHours";
import {shortOpeningDays} from "./shortOpenings";
import {addCivilDays,civilDayOfWeek,daysBetween,
  resolvePlanningPeriod} from "./schedulePeriods";
import type {TeamRoster} from "./team";
import {assignmentMinutes,clockMinutes,type WorkAssignment}
  from "./workAssignments";

export interface CycleLongDayFeasibility {
  /** Only four FULL, consecutive civil weeks within the displayed month. */
  cycleStart:string;
  cycleEndExclusive:string;
  /** Optimistic lower bound: other hard constraints may require more. */
  minimumLongDaysSameWorkdays:number;
  observedLongDays:number;
  potentiallyRemovableLongDays:number;
  byMember:(FixedWorkdayLongDayBound & {memberId:string;
    shortOpeningDaysWorked:number})[];
}

/**
 * Diagnostic ONLY. Do not alter a single assignment or treat this as a
 * staffing / rest solution. Workdays are fixed for the mathematical bound.
 * A monthly interval not containing four complete weeks or a person without
 * exactly 160h in that interval has no defensible cycle conclusion.
 */
export function analyzeMonthlyFixedWorkdayLongDayFloor(input:{
  year:number;month:number;
  team:TeamRoster;
  openingHours:WeeklyOpeningHours;
  assignments:readonly WorkAssignment[];
}):CycleLongDayFeasibility|null {
  let period:ReturnType<typeof resolvePlanningPeriod>;
  try {
    period=resolvePlanningPeriod({
      mode:"monthly",year:input.year,month:input.month,
    });
  }catch{return null;}
  const fullWeeks=period.weeks.filter(w=>
    w.start>=period.start && w.endExclusive<=period.endExclusive);
  if(fullWeeks.length<4)return null;
  const four=fullWeeks.slice(0,4);
  if(four.some((w,i)=>i>0 &&
    w.start!==addCivilDays(four[i-1].start,7)))return null;
  const cycleStart=four[0].start;
  const cycleEndExclusive=addCivilDays(cycleStart,28);
  const shortDays=shortOpeningDays(input.openingHours);
  const capacities=input.openingHours.days.map((day,weekday)=>{
    const windows=day.intervals.map(w=>({
      start:clockMinutes(w.start),end:clockMinutes(w.end),
    }));
    const short=shortDays.has(weekday);
    return {
      short,
      capacity:short
        ?windows.reduce((sum,w)=>sum+w.end-w.start,0)
        :effectiveMealDayCapacity(windows),
    };
  });
  const byMember:CycleLongDayFeasibility["byMember"]=[];
  for(const member of input.team.members.filter(m=>m.active)){
    const shifts=input.assignments.filter(shift=>
      shift.memberId.toLowerCase()===member.id.toLowerCase() &&
      shift.date>=cycleStart && shift.date<cycleEndExclusive);
    if(new Set(shifts.map(s=>s.date)).size!==shifts.length)return null;
    const days:CycleWorkday[]=shifts.map(shift=>{
      const weekday=civilDayOfWeek(shift.date);
      const {capacity,short}=capacities[weekday];
      const index=Math.floor(daysBetween(cycleStart,shift.date)/7);
      return {
        date:shift.date,weekStart:four[index].start,
        minutes:assignmentMinutes(shift),capacity,
        locked:short,
      };
    });
    if(days.some(day=>day.capacity<day.minutes ||
      (day.locked && day.minutes!==day.capacity)))return null;
    const bound=analyzeFixedWorkdayLongDayBound(days);
    if(!bound)return null;
    byMember.push({
      memberId:member.id,...bound,
      shortOpeningDaysWorked:days.filter(d=>d.locked).length,
    });
  }
  return {
    cycleStart,cycleEndExclusive,byMember,
    observedLongDays:byMember.reduce((sum,m)=>sum+m.observedLongDays,0),
    minimumLongDaysSameWorkdays:byMember.reduce((sum,m)=>
      sum+m.minimumLongDays,0),
    potentiallyRemovableLongDays:byMember.reduce((sum,m)=>
      sum+m.potentiallyRemovableLongDays,0),
  };
}
