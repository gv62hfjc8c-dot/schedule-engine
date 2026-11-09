import type { DatedWorkShift, Person } from "../types";
import { getEffectiveWorkMinutesInTimeZone } from "./workConstraints";
import { personWeeklyHardMax, personWeeklyTarget } from "./personSchedulingPolicies";

/**
 * Read model for the generator's weekly results. Display exactly the same
 * effective elapsed minutes, per-person contract cap and soft target that
 * the independent certification uses. This is NOT an additional validator.
 */
export interface WeeklyPersonWorkSummary {
  personId: string;
  effectiveMinutes: number | null;
  hardMaximumMinutes: number;
  targetMinutes: number;
  deficitMinutes: number | null;
  aboveTargetMinutes: number | null;
}

export function weeklyPersonWorkSummary(
  person: Person,
  assignments: DatedWorkShift[],
  timeZone: string,
  companyMaximum: number,
): WeeklyPersonWorkSummary {
  const effective = assignments.filter(s=>s.personId===person.id)
    .map(s=>getEffectiveWorkMinutesInTimeZone(s,timeZone));
  const known = effective.every((minutes):minutes is number=>minutes!==null);
  const minutes = known ? (effective as number[]).reduce((a,b)=>a+b,0) : null;
  const target=personWeeklyTarget(person,companyMaximum);
  return {
    personId:person.id,
    effectiveMinutes:minutes,
    hardMaximumMinutes:personWeeklyHardMax(person,companyMaximum),
    targetMinutes:target,
    deficitMinutes:minutes===null ? null : Math.max(0,target-minutes),
    aboveTargetMinutes:minutes===null ? null : Math.max(0,minutes-target),
  };
}
export function formatWorkMinutes(minutes:number | null):string {
  if(minutes===null || !Number.isFinite(minutes) || minutes<0)
    return "Por confirmar";
  const rounded=Math.round(minutes);
  return String(Math.floor(rounded/60))+"h"+
    String(rounded%60).padStart(2,"0");
}
