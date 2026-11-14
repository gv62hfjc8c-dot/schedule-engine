import type { TimeInterval } from "../types";
import type { GenerateConstrainedPeriodInput } from "./constrainedPeriodGenerator";
import { getOperatingIntervalsForDate } from "./operatingCalendar";
import { getEffectiveWorkMinutesInTimeZone } from "./workConstraints";
import { personWeeklyHardMax } from "./personSchedulingPolicies";
import { getPresencePhaseWindows, resolvePresenceForDate } from "./presence";

// Conservative precheck only: can prove a shortage, never certify feasibility.
// Keep this independent of search so V1 has one obvious place for early checks.
const DAY = 86_400_000;
function dayString(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

/**
 * Conservative weekly capacity lower bound. Each required person-minute
 * must be supplied by one person's effective work minute. This ignores
 * availability, meal placement and rest, so it can only PROVE infeasibility
 * when demand already exceeds the maximum possible weekly supply.
 * Ambiguous or invalid operational input falls through to normal validation.
 */
export function provenWeeklyCapacityShortage(
  input: GenerateConstrainedPeriodInput,
  dates: string[]
): string | null {
  try {
    const maxWeekly = input.workConstraints.maximumWeeklyEffectiveMinutes;
    if (!Number.isSafeInteger(maxWeekly) || maxWeekly < 0 ||
        !Array.isArray(input.people)) return null;
    const activeIds = new Set(input.people.filter(p => p?.active).map(p => p.id));
    // Preserve existing daily shortage diagnostics when nobody is active.
    if (activeIds.size === 0) return null;
    // Person-specific contracts are HARD ceilings, even when the company
    // maximum is higher. Ignoring existing external hours makes this supply
    // estimate optimistic, so it remains a mathematically safe upper bound.
    const supply = input.people.filter(p=>p.active)
      .reduce((n,p)=>n+personWeeklyHardMax(p,maxWeekly),0);
    const byWeek = new Map<string, number>();
    const mins = (value: string) => {
      const [h, m] = value.split(":").map(Number);
      return h * 60 + m;
    };
    for (const date of dates) {
      const intervals = getOperatingIntervalsForDate(
        date, input.operatingCalendar.weeklyOperatingHours,
        input.operatingCalendar.exceptions
      );
      if (!intervals.length) continue;
      const resolved = resolvePresenceForDate(
        date, input.presence.weeklyPresenceRequirements,
        input.presence.presenceExceptions,
        input.operatingCalendar.weeklyOperatingHours,
        input.operatingCalendar.exceptions
      );
      if (resolved.status !== "configured") return null;
      const windows = getPresencePhaseWindows(intervals);
      if (!windows) return null;
      // Overlapping opening/closing windows on short days cannot be
      // summed safely. Leave them to the exact daily validator.
      const all = [...windows.opening, ...windows.central, ...windows.closing];
      const ordered = all.map(w => [mins(w.start), mins(w.end)]).sort((a,b) => a[0]-b[0]);
      if (ordered.some((w,i) => !Number.isFinite(w[0]) ||
          !Number.isFinite(w[1]) || w[1] <= w[0] ||
          (i > 0 && w[0] < ordered[i-1][1]))) return null;
      const r = resolved.requirements;
      // Wall-clock hours are not effective elapsed minutes across DST.
      // Unresolvable clock boundaries disable this shortcut rather than
      // allowing a false "proven infeasible" classification.
      const workMinutes=(w:TimeInterval)=>
        getEffectiveWorkMinutesInTimeZone({
          date,personId:"__coverage_lower_bound__",interval:w,mealBreak:null,
        },input.timeZone);
      const allMinutes=all.map(workMinutes);
      if(allMinutes.some(n=>n===null)) return null;
      const nOpen=windows.opening.length,nCentral=windows.central.length;
      const sums=(from:number,to:number)=>
        (allMinutes.slice(from,to) as number[]).reduce((a,b)=>a+b,0);
      const demand=sums(0,nOpen)*r.minimumAtOpening +
        sums(nOpen,nOpen+nCentral)*r.minimumDuringOperation +
        sums(nOpen+nCentral,all.length)*r.minimumAtClosing;
      const ms = Date.parse(date+"T00:00:00Z");
      const weekday = new Date(ms).getUTCDay();
      const monday = dayString(ms - ((weekday+6)%7)*DAY);
      byWeek.set(monday, (byWeek.get(monday) ?? 0) + demand);
    }
    for (const [monday, needed] of byWeek) {
      if (needed > supply) {
        return `Semana de ${monday}: a cobertura exige pelo menos ${needed} minutos efetivos, mas ${activeIds.size} pessoas ativas só podem fornecer até ${supply} minutos semanais. Inviabilidade comprovada pelo limite superior de capacidade.`;
      }
    }
  } catch {
    // Never use the shortcut to assert validity or mask invalid inputs.
  }
  return null;
}
