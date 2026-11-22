import {
  WEEKDAYS,type Weekday,type WeeklyOpeningHours,
} from "./operatingHours";
import {
  enumerateCivilDays,civilDayOfWeek,inRange,type PlanningPeriod,
} from "./schedulePeriods";
import type {WorkAssignment} from "./workAssignments";

/**
 * A SOFT objective, NEVER a legal or mandatory minimum. 60% of 8 active
 * people means ceil(4.8) = 5 people with at least one scheduled shift.
 * It does not mean five people working simultaneously every minute.
 */
export function desiredDailyHeadcount(activeCount:number,percent:number):number {
  if(!Number.isSafeInteger(activeCount)||activeCount<0 ||
    !Number.isInteger(percent)||percent<1||percent>100)
    throw new Error("Objetivo de presença diária inválido.");
  return Math.ceil(activeCount*percent/100);
}

export interface DailyStaffingScore {
  /** Understaffing is the primary soft objective (convex penalty). */
  shortfallPenalty:number;
  /** Balanced workday staffing is a secondary soft tie-breaker. */
  concentrationPenalty:number;
  missingDays:number;
}

export function scoreDailyStaffing(
  present:readonly number[],targets:readonly number[],
  open:readonly boolean[],
):DailyStaffingScore {
  if(present.length!==targets.length||targets.length!==open.length)
    throw new Error("As dimensões da cobertura não coincidem.");
  let shortfallPenalty=0,concentrationPenalty=0,missingDays=0;
  for(let index=0;index<open.length;index++){
    if(!open[index])continue;
    const n=present[index],target=targets[index];
    if(!Number.isSafeInteger(n)||n<0||!Number.isSafeInteger(target)||
      target<0)throw new Error("Contagem diária inválida.");
    const deficit=Math.max(0,target-n);
    shortfallPenalty+=deficit*deficit;
    missingDays+=deficit>0?1:0;
    concentrationPenalty+=(n-target)*(n-target);
  }
  return {shortfallPenalty,concentrationPenalty,missingDays};
}

/** Negative => first plan is better; zero => equal soft score. */
export function compareDailyStaffing(
  a:DailyStaffingScore,b:DailyStaffingScore,
):number {
  return a.shortfallPenalty-b.shortfallPenalty ||
    a.missingDays-b.missingDays ||
    a.concentrationPenalty-b.concentrationPenalty;
}

export interface DailyStaffingEntry {
  date:string;
  weekday:Weekday;
  present:number;
  desired:number;
  missing:number;
}

export interface DailyStaffingReport {
  targetPercent:number;
  activeCount:number;
  desired:number;
  days:DailyStaffingEntry[];
  daysBelowTarget:number;
  totalMissingPersonDays:number;
}

/** Display diagnostics from the ACTUAL generated shifts, never the planned
 * rest masks. An employee with multiple intervals counts only once per day.
 * Missing historical context is not treated as an observed shift. */
export function evaluateDailyStaffing(
  assignments:readonly WorkAssignment[],
  period:PlanningPeriod,
  opening:WeeklyOpeningHours,
  activeMemberIds:readonly string[],
  targetPercent:number,
):DailyStaffingReport {
  const desired=desiredDailyHeadcount(activeMemberIds.length,targetPercent);
  const active=new Set(activeMemberIds);
  const dates=new Map<string,Set<string>>();
  for(const shift of assignments){
    if(!inRange(shift.date,period)||!active.has(shift.memberId))continue;
    const people=dates.get(shift.date)??new Set<string>();
    people.add(shift.memberId);
    dates.set(shift.date,people);
  }
  const days=enumerateCivilDays(period).flatMap(date=>{
    const weekday=WEEKDAYS[civilDayOfWeek(date)].id;
    if(opening.days[civilDayOfWeek(date)].intervals.length===0)return [];
    const present=dates.get(date)?.size??0;
    return [{date,weekday,present,desired,
      missing:Math.max(0,desired-present)}];
  });
  return {
    targetPercent,activeCount:activeMemberIds.length,desired,days,
    daysBelowTarget:days.filter(day=>day.missing>0).length,
    totalMissingPersonDays:days.reduce((sum,day)=>sum+day.missing,0),
  };
}
