import {
  civilDayOfWeek,enumerateCivilDays,resolvePlanningPeriod,
  type PeriodRequest,
} from "./schedulePeriods";
import {
  clockMinutes,effectiveWorkIntervals,validateWorkAssignment,
  type WorkAssignment,
} from "./workAssignments";
import {validateWeeklyOpeningHours,type WeeklyOpeningHours} from "./operatingHours";
import {
  DEFAULT_OPERATIONAL_ROLE_DEFINITIONS,validateTeamRoster,
  type TeamRoster,
} from "./team";
import {certifyFunctionalCoverage} from "./functionalCoverage";

export interface FunctionalCapacityByRole {
  role:string;
  qualifiedPeople:number;
  minimumConcurrent:number;
  monthlyDemandMinutes:number;
  observedGapMinutes:number;
}
export interface FunctionalCapacityDay {
  date:string;
  openingMinutes:number;
  requiredMinutes:number;
  scheduledInsideOpeningMinutes:number;
  /** Shortfall against the SOFT goal if this day's work is fixed. */
  dailyCapacityDeficitMinutes:number;
  /** SOFT target shortfall with clock positions fixed, before skills. */
  simultaneousDeficitMinutes:number;
  /** Exact SOFT-target deviations of this proposal if posts are valid. */
  observedRoleGapMinutes:number;
}
export interface FunctionalCapacityAnalysis {
  /** A missing/invalid role makes the observed gaps non-exhaustive. */
  status:"complete"|"incomplete_assignments";
  minimumPercent:number;
  roleTargets:FunctionalCapacityByRole[];
  days:FunctionalCapacityDay[];
  openingMinutes:number;
  requiredMinutes:number;
  scheduledInsideOpeningMinutes:number;
  /** Gap to the SOFT monthly target with the currently scheduled hours. */
  periodCapacityDeficitMinutes:number;
  /** SOFT goal gap if the same effective hours stay on each date. */
  dayLockedCapacityDeficitMinutes:number;
  /** SOFT goal gap with positions and meal breaks unchanged. */
  simultaneousDeficitMinutes:number;
  /** SOFT goal deviation for the existing assignment of functions. */
  observedRoleGapMinutes:number;
  /** Observed minus unavoidable active-headcount deficit at those times.
   * Not necessarily recoverable: skill scarcity/fixed role prevents it.
   */
  roleAndAllocationGapMinutes:number|null;
}

type ClockInterval={start:number;end:number};
function sumMinutes(intervals:readonly ClockInterval[]):number {
  return intervals.reduce((total,i)=>total+i.end-i.start,0);
}
function insideOpeningMinutes(
  work:readonly WorkAssignment[],opening:readonly ClockInterval[],
):number {
  let count=0;
  for(const shift of work)
    for(const interval of effectiveWorkIntervals(shift))
      for(const window of opening)
        count+=Math.max(0,Math.min(window.end,interval.end)-
          Math.max(window.start,interval.start));
  return count;
}
function simultaneousMinimumGap(
  work:readonly WorkAssignment[],opening:readonly ClockInterval[],
  requiredPeople:number,
):number {
  if(requiredPeople===0)return 0;
  const byMember=work.map(shift=>effectiveWorkIntervals(shift));
  const cuts=[...new Set([
    ...opening.flatMap(w=>[w.start,w.end]),
    ...byMember.flatMap(w=>w.flatMap(i=>[i.start,i.end])),
  ])].sort((a,b)=>a-b);
  let total=0;
  for(let i=0;i+1<cuts.length;i++){
    const start=cuts[i],end=cuts[i+1];
    if(!opening.some(w=>w.start<=start&&end<=w.end))continue;
    const active=byMember.filter(spans=>
      spans.some(w=>w.start<=start&&end<=w.end)).length;
    total+=Math.max(0,requiredPeople-active)*(end-start);
  }
  return total;
}

/** Read-only, independently computed explanation of deviation from
 * the aspirational 50% role-distribution target (SOFT).
 *
 * Historic field names contain "Deficit" for schema compatibility. These
 * figures are NOT mandatory staffing shortages or HARD violations.
 * They quantify opportunity against a GOAL only. Actual operational
 * safety is certified independently by certifySchedule.
 *
 * This never certifies or changes a schedule.
 */
export function analyzeFunctionalCapacity(input:{
  period:PeriodRequest;
  team:TeamRoster;
  openingHours:WeeklyOpeningHours;
  assignments:readonly WorkAssignment[];
  minimumPercent:number;
}):FunctionalCapacityAnalysis|null {
  const checkedTeam=validateTeamRoster(input.team);
  const checkedOpening=validateWeeklyOpeningHours(input.openingHours);
  if(!checkedTeam.valid||!checkedOpening.valid||
    !Array.isArray(input.assignments)||
    !Number.isFinite(input.minimumPercent)||
    input.minimumPercent<0||input.minimumPercent>100)return null;
  let days:string[];
  try {
    days=enumerateCivilDays(resolvePlanningPeriod(input.period));
  }catch{return null;}
  const active=checkedTeam.value.members.filter(m=>m.active);
  const roles=checkedTeam.value.roles??DEFAULT_OPERATIONAL_ROLE_DEFINITIONS;
  const roleTargets=roles.map(role=>{
    const qualifiedPeople=active.filter(m=>
      m.qualifiedRoles?.includes(role.id)).length;
    return {role:role.id,qualifiedPeople,
      minimumConcurrent:Math.ceil(qualifiedPeople*input.minimumPercent/100),
      monthlyDemandMinutes:0,observedGapMinutes:0};
  });
  const totalConcurrent=roleTargets.reduce((sum,r)=>
    sum+r.minimumConcurrent,0);
  const calendar=new Set(days);
  const byDate=new Map<string,WorkAssignment[]>();
  for(const raw of input.assignments){
    const shift=validateWorkAssignment(raw);
    if(!shift||!calendar.has(shift.date)||
      !active.some(m=>m.id===shift.memberId))return null;
    const work=byDate.get(shift.date)??[];
    if(work.some(w=>w.memberId===shift.memberId))return null;
    work.push(shift);
    byDate.set(shift.date,work);
  }
  let incomplete=false;
  const daily:FunctionalCapacityDay[]=days.map(date=>{
    const opening=checkedOpening.value.days[civilDayOfWeek(date)].intervals;
    const windows=opening.map(w=>({
      start:clockMinutes(w.start),end:clockMinutes(w.end),
    }));
    const work=byDate.get(date)??[];
    const openingMinutes=sumMinutes(windows);
    const requiredMinutes=openingMinutes*totalConcurrent;
    const scheduledInsideOpeningMinutes=insideOpeningMinutes(work,windows);
    const simultaneousDeficitMinutes=simultaneousMinimumGap(
      work,windows,totalConcurrent);
    const coverage=opening.length===0?null:certifyFunctionalCoverage({
      date,members:active,roles:roleTargets.map(r=>r.role),
      minimumPercent:input.minimumPercent,assignments:work,opening,
    },work.filter(shift=>shift.role!==undefined).map(shift=>({
      memberId:shift.memberId,role:shift.role!,
    })));
    if(coverage?.status==="invalid_input" ||
      coverage?.issues.some(i=>i.code==="NO_QUALIFIED_MEMBERS"))
      incomplete=true;
    let observedRoleGapMinutes=0;
    for(const i of coverage?.issues??[]){
      if(i.code!=="ROLE_COVERAGE_GAP" || !i.role ||
        !i.start || !i.end || !i.missing)continue;
      const missingMinutes=i.missing*
        (clockMinutes(i.end)-clockMinutes(i.start));
      observedRoleGapMinutes+=missingMinutes;
      const target=roleTargets.find(target=>target.role===i.role);
      if(target)target.observedGapMinutes+=missingMinutes;
    }
    for(const role of roleTargets)
      role.monthlyDemandMinutes+=openingMinutes*role.minimumConcurrent;
    return {date,openingMinutes,requiredMinutes,
      scheduledInsideOpeningMinutes,
      dailyCapacityDeficitMinutes:Math.max(0,
        requiredMinutes-scheduledInsideOpeningMinutes),
      simultaneousDeficitMinutes,observedRoleGapMinutes};
  });
  const sum=(key:keyof FunctionalCapacityDay)=>
    daily.reduce((total,day)=>total+Number(day[key]??0),0);
  const requiredMinutes=sum("requiredMinutes");
  const scheduledInsideOpeningMinutes=sum("scheduledInsideOpeningMinutes");
  const simultaneousDeficitMinutes=sum("simultaneousDeficitMinutes");
  const observedRoleGapMinutes=sum("observedRoleGapMinutes");
  return {
    status:incomplete?"incomplete_assignments":"complete",
    minimumPercent:input.minimumPercent,roleTargets,days:daily,
    openingMinutes:sum("openingMinutes"),requiredMinutes,
    scheduledInsideOpeningMinutes,
    periodCapacityDeficitMinutes:Math.max(0,
      requiredMinutes-scheduledInsideOpeningMinutes),
    dayLockedCapacityDeficitMinutes:sum("dailyCapacityDeficitMinutes"),
    simultaneousDeficitMinutes,observedRoleGapMinutes,
    roleAndAllocationGapMinutes:incomplete?null:Math.max(0,
      observedRoleGapMinutes-simultaneousDeficitMinutes),
  };
}
