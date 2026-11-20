import {addCivilDays,enumerateCivilDays} from "./schedulePeriods";
import {REQUIRED_WEEKLY_MINUTES} from "./weeklyHours";

/**
 * Deterministic soft load target for one Monday–Sunday scheduling decision.
 * The preceding 21 days plus the new 7-day week form a rolling 28-day window.
 * An incomplete 21-day history NEVER means zero hours worked; the safe
 * fallback is the existing 40h reference.
 *
 * The +/- 4h range only limits the strength of ONE optimizer step; it is not
 * a weekly legal limit, a contract rule or a certification threshold.
 */
export const SOFT_VARIATION_MINUTES=240;
export interface RollingWeekGuidance {
  targetMinutes:number;
  contextComplete:boolean;
  preceding21Minutes:number|null;
}

export function rollingWeekGuidance(
  weekStart:string,memberId:string,
  completeDates:ReadonlySet<string>,
  minutesByMemberAndDate:ReadonlyMap<string,number>,
):RollingWeekGuidance {
  const previous=enumerateCivilDays({
    start:addCivilDays(weekStart,-21),endExclusive:weekStart,
  });
  if(previous.some(date=>!completeDates.has(date)))
    return {
      targetMinutes:REQUIRED_WEEKLY_MINUTES,
      contextComplete:false,
      preceding21Minutes:null,
    };
  const preceding21Minutes=previous.reduce((sum,date)=>
    sum+(minutesByMemberAndDate.get(memberId.toLowerCase()+"|"+date)??0),0);
  const ideal=4*REQUIRED_WEEKLY_MINUTES-preceding21Minutes;
  const targetMinutes=Math.max(
    REQUIRED_WEEKLY_MINUTES-SOFT_VARIATION_MINUTES,
    Math.min(REQUIRED_WEEKLY_MINUTES+SOFT_VARIATION_MINUTES,ideal),
  );
  return {targetMinutes,contextComplete:true,preceding21Minutes};
}
