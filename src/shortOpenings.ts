import type {WeeklyOpeningHours} from "./operatingHours";
import {clockMinutes} from "./workAssignments";

/**
 * First-phase automatic classification of a SHORT COMPANY OPENING.
 * Do not infer it from a person's shift duration or from "Saturday/Sunday".
 *
 * - An opening up to 4h is unconditionally short (existing behavior).
 * - An opening up to 6h is also short when it is at most two-thirds of
 *   the longest opening day in this company's CURRENT weekly calendar.
 *   This handles Sunday 14–19 (5h) vs Monday–Saturday 08:30–19 (10h30)
 *   without wrongly treating a normal 8h day as break-free.
 *
 * These are transparent provisional business rules, not labor law.
 * Classification is computed from operating hours only and is reusable by
 * both generator and INDEPENDENT certifier.
 */
export function shortOpeningDays(
  weekly:WeeklyOpeningHours,
):ReadonlySet<number> {
  const totals=weekly.days.map(day=>day.intervals.reduce((sum,window)=>
    sum+clockMinutes(window.end)-clockMinutes(window.start),0));
  const longest=Math.max(0,...totals);
  return new Set(totals.flatMap((duration,weekday)=>
    duration>0 &&
    (duration<=240 || (duration<=360 && duration*3<=longest*2))
      ?[weekday]:[]));
}
