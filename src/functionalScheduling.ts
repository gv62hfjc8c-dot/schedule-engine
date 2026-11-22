import {
  allocateFunctionalCoverage,type FunctionalCoverageInput,
  type FunctionalRoleAssignment,type FunctionalCoverageReport,
} from "./functionalCoverage";
import {clockMinutes,effectiveWorkIntervals,type WorkAssignment} from "./workAssignments";
import {measureSimultaneousCoverage} from "./simultaneousCoverage";
import {civilDayOfWeek,enumerateCivilDays,type PlanningPeriod} from "./schedulePeriods";
import type {TeamMember} from "./team";
import type {WeeklyOpeningHours} from "./operatingHours";

type Interval={start:string;end:string};
function clock(min:number):string {
  return String(Math.floor(min/60)).padStart(2,"0")+":"+
    String(min%60).padStart(2,"0");
}
function roleInput(
  date:string,day:readonly WorkAssignment[],members:readonly TeamMember[],
  opening:readonly Interval[],roles:readonly string[],
):FunctionalCoverageInput{
  return {date,assignments:day,members,opening,roles,minimumPercent:50};
}
interface FunctionalQuality {
  /** SOFT: minutes when a qualified function has no active worker. */
  absentRoleMinutes:number;
  /** SOFT: total worker-minutes below the 50% distribution target. */
  missingTargetMinutes:number;
}
function functionalLoss(report:FunctionalCoverageReport):FunctionalQuality {
  let absentRoleMinutes=0,missingTargetMinutes=0;
  for(const slot of report.slots){
    const duration=clockMinutes(slot.end)-clockMinutes(slot.start);
    for(const [role,target] of Object.entries(report.targets)){
      const actual=slot.counts[role]??0;
      if(target>0 && actual===0)absentRoleMinutes+=duration;
      missingTargetMinutes+=Math.max(0,target-actual)*duration;
    }
  }
  return {absentRoleMinutes,missingTargetMinutes};
}
function betterQuality(a:FunctionalQuality,b:FunctionalQuality):boolean {
  return a.absentRoleMinutes<b.absentRoleMinutes ||
    (a.absentRoleMinutes===b.absentRoleMinutes &&
      a.missingTargetMinutes<b.missingTargetMinutes);
}
function hasGap(q:FunctionalQuality):boolean{
  return q.absentRoleMinutes>0||q.missingTargetMinutes>0;
}
function movement(now:readonly WorkAssignment[],baseline:readonly WorkAssignment[]):number {
  return now.reduce((sum,shift,i)=>sum+
    Math.abs(clockMinutes(shift.start)-clockMinutes(baseline[i].start))+
    (shift.mealBreak&&baseline[i].mealBreak
      ?Math.abs(clockMinutes(shift.mealBreak.start)-
        clockMinutes(baseline[i].mealBreak.start)):0),0);
}
function optimizeDay(
  date:string,day:WorkAssignment[],members:readonly TeamMember[],
  opening:readonly Interval[],roles:readonly string[],
):WorkAssignment[]{
  if(day.length===0)return [];
  const input=roleInput(date,day,members,opening,roles);
  const baseline=allocateFunctionalCoverage(input);
  let shifts=day.map(shift=>({...shift}));
  let chosen=baseline;
  let loss=functionalLoss(chosen.certification);
  if(!hasGap(loss))return applyRoles(shifts,chosen.allocations);
  // An unreachable 50% SOFT target must NOT disable partial improvements:
  // a lunch can often be staggered to avoid leaving one function unstaffed
  // even when the available total person-hours cannot achieve the target.
  const demand=Object.values(chosen.certification.targets)
    .reduce((sum,n)=>sum+n,0)*
    opening.reduce((sum,w)=>sum+clockMinutes(w.end)-clockMinutes(w.start),0);
  const capacity=shifts.flatMap(effectiveWorkIntervals)
    .reduce((sum,w)=>sum+w.end-w.start,0);
  const limited=capacity<demand;

  const baselineShifts=[...shifts];
  const numericOpen=opening.map(w=>({
    start:clockMinutes(w.start),end:clockMinutes(w.end),
  }));
  // Preserve the existing HARD minimum of at least one worker actively
  // covering the business opening. A soft percentage improvement must
  // never create new uncovered opening minutes.
  const hardBaseline=measureSimultaneousCoverage(shifts,numericOpen);
  // Both zero-person gaps (HARD) and one-person gaps (existing SOFT
  // presence priority) may only improve, not worsen for a functional
  // improvement. No new operational minimum per function is introduced.
  const ordered=[...shifts.keys()].sort((a,b)=>
    shifts[a].memberId.localeCompare(shifts[b].memberId));
  // Bounded deterministic coordinate descent: preserves each person's
  // effective minutes, existing workdays and ONE-shift identity. It may
  // fail to find a feasible solution; the certifier never hides that.
  for(let pass=0;pass<(limited?1:3)&&hasGap(loss);pass++){
    let improved=false;
    for(const index of ordered){
      const original=shifts[index];
      const span=clockMinutes(original.end)-clockMinutes(original.start);
      const bestAtStart=clockMinutes(original.start);
      let bestShift=original,bestAllocation=chosen;
      let bestLoss=loss;
      let bestMotion=movement(shifts,baselineShifts);
      const tryVariant=(candidate:WorkAssignment)=>{
        shifts[index]=candidate;
        const hard=measureSimultaneousCoverage(shifts,numericOpen);
        // HARD uncovered minutes dominate the SOFT solo metric:
        // turning an entirely uncovered hour into a solo hour is an
        // improvement, not a regression. When HARD is tied, never
        // worsen single-person presence just to pursue 50%.
        if(hard.uncoveredMinutes>hardBaseline.uncoveredMinutes ||
          (hard.uncoveredMinutes===hardBaseline.uncoveredMinutes &&
            hard.soloMinutes>hardBaseline.soloMinutes))return;
        const trial=allocateFunctionalCoverage(roleInput(
          date,shifts,members,opening,roles));
        const trialLoss=functionalLoss(trial.certification);
        const trialMotion=movement(shifts,baselineShifts);
        if(betterQuality(trialLoss,bestLoss) ||
          (!betterQuality(bestLoss,trialLoss) &&
            trialMotion<bestMotion)){
          bestShift=candidate;
          bestAllocation=trial;
          bestLoss=trialLoss;
          bestMotion=trialMotion;
        }
      };
      for(const window of opening){
        const open=clockMinutes(window.start),close=clockMinutes(window.end);
        if(close-open<span)continue;
        const starts=new Set<number>([bestAtStart,open,close-span]);
        for(let step=-(limited?2:4);step<=(limited?2:4);step++)
          starts.add(bestAtStart+step*30);
        for(const start of [...starts].sort((a,b)=>a-b)){
          if(start<open||start+span>close)continue;
          const end=start+span;
          if(!original.mealBreak){
            tryVariant({...original,start:clock(start),end:clock(end)});
            continue;
          }
          const firstMeal=clockMinutes(original.mealBreak.start);
          const duration=clockMinutes(original.mealBreak.end)-firstMeal;
          const meals=new Set<number>([
            firstMeal+(start-bestAtStart),start+180,
            end-duration-30,
          ]);
          for(let step=-(limited?2:3);step<=(limited?2:3);step++)
            meals.add(firstMeal+(start-bestAtStart)+step*30);
          for(const meal of [...meals].sort((a,b)=>a-b)){
            if(meal<start+180||meal+duration>=end)continue;
            tryVariant({...original,start:clock(start),end:clock(end),
              mealBreak:{start:clock(meal),end:clock(meal+duration)}});
          }
        }
      }
      shifts[index]=bestShift;
      if(betterQuality(bestLoss,loss)){improved=true;}
      loss=bestLoss;chosen=bestAllocation;
      if(!hasGap(loss))break;
    }
    if(!improved)break;
  }
  return applyRoles(shifts,chosen.allocations);
}
function applyRoles(
  shifts:readonly WorkAssignment[],assignments:readonly FunctionalRoleAssignment[],
):WorkAssignment[]{
  const byId=new Map(assignments.map(a=>[a.memberId,a.role]));
  return shifts.map(shift=>{
    const role=byId.get(shift.memberId);
    return role?{...shift,role}:{...shift};
  });
}
/** Monthly output includes a single functional post for each scheduled person.
 * All open dates are considered; the 50% presence GOAL is SOFT.
 * Role qualification/integrity is checked separately as HARD.
 * Never changes the number of workdays or effective work minutes.
 */
export function allocateFunctionalMonth(
  assignments:readonly WorkAssignment[],
  period:PlanningPeriod,members:readonly TeamMember[],
  hours:WeeklyOpeningHours,roleCatalog:readonly string[],
):WorkAssignment[] {
  const roles=[...roleCatalog];
  const byDate=new Map<string,WorkAssignment[]>();
  for(const shift of assignments){
    const day=byDate.get(shift.date)??[];
    day.push(shift);
    byDate.set(shift.date,day);
  }
  const output:WorkAssignment[]=[];
  for(const date of enumerateCivilDays(period)){
    const opening=hours.days[civilDayOfWeek(date)].intervals;
    output.push(...optimizeDay(date,byDate.get(date)??[],members,opening,roles));
  }
  return output;
}
