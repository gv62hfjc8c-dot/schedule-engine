/**
 * A SOFT daily-workload quality rule, independent from certification.
 * 8h of EFFECTIVE work is the preferred daily duration, with a substantially
 * stronger penalty for minutes beyond 9h. Neither is a legal limit here.
 *
 * Use lexicographic comparisons rather than arbitrary multipliers:
 * 1. avoid time above 9h;
 * 2. reduce the total time above 8h;
 * 3. spread unavoidable excess instead of concentrating it on one day.
 *
 * This module must not alter active workdays, short-opening assignments,
 * weekly hours or other workers' schedules.
 */
export const DAILY_PREFERRED_WORK_MINUTES=8*60;
export const DAILY_STRONG_AVOID_MINUTES=9*60;
export const DAILY_BALANCING_STEP_MINUTES=15;

export interface DailyWorkloadQuality {
  beyondNineMinutes:number;
  beyondEightMinutes:number;
  excessConcentration:number;
  longestMinutes:number;
}

export interface DailyWorkloadPlan {
  capacity:number;
  allocated:number;
  shortOpening:boolean;
}

/** Exact and deterministic for every arrangement, including zero-work days. */
export function dailyWorkloadQuality(
  durations:readonly number[],
):DailyWorkloadQuality {
  let beyondNineMinutes=0;
  let beyondEightMinutes=0;
  let excessConcentration=0;
  let longestMinutes=0;
  for(const minutes of durations){
    if(!Number.isSafeInteger(minutes)||minutes<0)
      throw new Error("Duração diária inválida.");
    const extra=Math.max(0,minutes-DAILY_PREFERRED_WORK_MINUTES);
    beyondEightMinutes+=extra;
    beyondNineMinutes+=Math.max(0,minutes-DAILY_STRONG_AVOID_MINUTES);
    excessConcentration+=extra*extra;
    longestMinutes=Math.max(longestMinutes,minutes);
  }
  return {
    beyondNineMinutes,beyondEightMinutes,
    excessConcentration,longestMinutes,
  };
}

/** Negative means A is preferred; zero means equally good on this dimension. */
export function compareDailyWorkload(
  a:DailyWorkloadQuality,b:DailyWorkloadQuality,
):number {
  return a.beyondNineMinutes-b.beyondNineMinutes ||
    a.beyondEightMinutes-b.beyondEightMinutes ||
    a.excessConcentration-b.excessConcentration ||
    a.longestMinutes-b.longestMinutes;
}

/**
 * Smooth only already-assigned normal working days. Never create/remove
 * a working day, increase weekly minutes, split a shift, or modify any
 * short-opening day (where everyone assigned must work the whole opening).
 *
 * Every accepted 15-minute transfer STRICTLY improves the soft quality,
 * so the algorithm terminates and is deterministic. It is capacity-aware:
 * a recipient cannot exceed the effective minutes feasible on that day.
 */
export function balanceLongWorkdays(
  plans:DailyWorkloadPlan[],
):void {
  const normal=plans.filter(plan=>
    !plan.shortOpening && plan.allocated>0 && plan.capacity>0);
  if(normal.length<2)return;
  for(;;){
    const before=dailyWorkloadQuality(normal.map(plan=>plan.allocated));
    let best:{from:number;to:number;quality:DailyWorkloadQuality}|null=null;
    for(let from=0;from<normal.length;from++){
      if(normal[from].allocated<=DAILY_PREFERRED_WORK_MINUTES)continue;
      for(let to=0;to<normal.length;to++){
        if(to===from ||
          normal[to].allocated+DAILY_BALANCING_STEP_MINUTES>
            normal[to].capacity)continue;
        const durations=normal.map((plan,index)=>
          plan.allocated+
          (index===from?-DAILY_BALANCING_STEP_MINUTES:0)+
          (index===to?DAILY_BALANCING_STEP_MINUTES:0));
        const quality=dailyWorkloadQuality(durations);
        if(compareDailyWorkload(quality,before)>=0)continue;
        if(!best || compareDailyWorkload(quality,best.quality)<0)
          best={from,to,quality};
      }
    }
    if(!best)break;
    normal[best.from].allocated-=DAILY_BALANCING_STEP_MINUTES;
    normal[best.to].allocated+=DAILY_BALANCING_STEP_MINUTES;
  }
}
