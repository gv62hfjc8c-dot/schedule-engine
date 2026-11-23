/**
 * PR96 — Bounded, deterministic meal-break-only improvement.
 *
 * Keep each member's shift START, END, workday, effective minutes, and
 * qualified operational role exactly unchanged. Only existing internal
 * 60-minute meal breaks may move, using the V2 planner's legal options.
 *
 * A role-empty interval is a SOFT failure, not an invented HARD minimum.
 * On each studied day the optimizer cannot worsen coverage, lone-worker
 * minutes, the 50% role target deficit, or concurrent meal-break load.
 */
import {civilDayOfWeek,enumerateCivilDays,type PlanningPeriod} from "./schedulePeriods";
import {assignmentMinutes,clockMinutes,type WorkAssignment} from "./workAssignments";
import {mealShiftOptions,type NumericOpening} from "./mealBreaks";
import type {WeeklyOpeningHours} from "./operatingHours";
import type {TeamMember} from "./team";

export interface MealStaggerMetrics {
  uncoveredMinutes:number;
  soloMinutes:number;
  emptyRoleMinutes:number;
  roleGapMinutes:number;
  minutesWithThreeOrMoreBreaks:number;
  minutesWithFourOrMoreBreaks:number;
  peakSimultaneousBreaks:number;
}
export interface MealStaggerSummary {
  assessedDays:number;
  improvedDays:number;
  changedBreaks:number;
  before:MealStaggerMetrics;
  after:MealStaggerMetrics;
}
export interface MealStaggerResult {
  assignments:WorkAssignment[];
  summary:MealStaggerSummary|null;
}
const STEP=15;
const MAX_MOVES_PER_DAY=12;
const empty=():MealStaggerMetrics=>({
  uncoveredMinutes:0,soloMinutes:0,emptyRoleMinutes:0,
  roleGapMinutes:0,minutesWithThreeOrMoreBreaks:0,
  minutesWithFourOrMoreBreaks:0,peakSimultaneousBreaks:0,
});
const metricsKeys:(keyof Omit<MealStaggerMetrics,"peakSimultaneousBreaks">)[]=[
  "uncoveredMinutes","soloMinutes","emptyRoleMinutes",
  "roleGapMinutes","minutesWithThreeOrMoreBreaks",
  "minutesWithFourOrMoreBreaks",
];
function score(
  shifts:readonly WorkAssignment[],
  opening:readonly NumericOpening[],
  targets:ReadonlyMap<string,number>,
):MealStaggerMetrics {
  const result=empty();
  for(const window of opening){
    for(let minute=window.start;minute<window.end;minute+=STEP){
      const next=Math.min(minute+STEP,window.end);
      let working=0,breaks=0;
      const roles=new Map<string,number>();
      for(const shift of shifts){
        if(clockMinutes(shift.start)>minute ||
          clockMinutes(shift.end)<=minute)continue;
        const meal=shift.mealBreak;
        if(meal && clockMinutes(meal.start)<=minute &&
          clockMinutes(meal.end)>minute)breaks++;
        else{
          working++;
          if(shift.role)
            roles.set(shift.role,(roles.get(shift.role)??0)+1);
        }
      }
      const duration=next-minute;
      if(working===0)result.uncoveredMinutes+=duration;
      if(working===1)result.soloMinutes+=duration;
      for(const [role,target] of targets){
        const actual=roles.get(role)??0;
        result.roleGapMinutes+=Math.max(0,target-actual)*duration;
        if(target>0 && actual===0)
          result.emptyRoleMinutes+=duration;
      }
      if(breaks>=3)result.minutesWithThreeOrMoreBreaks+=duration;
      if(breaks>=4)result.minutesWithFourOrMoreBreaks+=duration;
      result.peakSimultaneousBreaks=Math.max(
        result.peakSimultaneousBreaks,breaks);
    }
  }
  return result;
}
function aggregated(rows:readonly MealStaggerMetrics[]):MealStaggerMetrics{
  const total=empty();
  for(const row of rows){
    for(const key of metricsKeys)total[key]+=row[key];
    total.peakSimultaneousBreaks=Math.max(
      total.peakSimultaneousBreaks,row.peakSimultaneousBreaks);
  }
  return total;
}
function nonWorsening(a:MealStaggerMetrics,b:MealStaggerMetrics):boolean{
  return metricsKeys.every(key=>a[key]<=b[key]) &&
    a.peakSimultaneousBreaks<=b.peakSimultaneousBreaks;
}
function compare(a:readonly number[],b:readonly number[]):number{
  for(let i=0;i<a.length;i++){
    if(a[i]!==b[i])return a[i]-b[i];
  }
  return 0;
}
function movement(
  current:readonly WorkAssignment[],original:readonly WorkAssignment[],
):number{
  return current.reduce((sum,shift,index)=>{
    const currentMeal=shift.mealBreak,originalMeal=original[index].mealBreak;
    return sum+(currentMeal&&originalMeal?
      Math.abs(clockMinutes(currentMeal.start)-
        clockMinutes(originalMeal.start)):0);
  },0);
}
function rank(q:MealStaggerMetrics,motion:number):number[]{
  // Empty roles first. Do not trade a lost operational role for a lower
  // number of simultaneous breaks. Role-target shortfall stays SOFT.
  return [
    q.emptyRoleMinutes,q.roleGapMinutes,
    q.minutesWithFourOrMoreBreaks,
    q.minutesWithThreeOrMoreBreaks,
    q.peakSimultaneousBreaks,motion,
  ];
}
function aligned(opening:readonly NumericOpening[],
  shifts:readonly WorkAssignment[]):boolean {
  return opening.every(w=>w.start%STEP===0&&w.end%STEP===0) &&
    shifts.every(s=>
      clockMinutes(s.start)%STEP===0&&
      clockMinutes(s.end)%STEP===0&&
      (!s.mealBreak||(
        clockMinutes(s.mealBreak.start)%STEP===0&&
        clockMinutes(s.mealBreak.end)%STEP===0)));
}
function optimizeOneDay(
  day:readonly WorkAssignment[],opening:readonly NumericOpening[],
  targets:ReadonlyMap<string,number>,
):{assignments:WorkAssignment[];before:MealStaggerMetrics;
  after:MealStaggerMetrics;changes:number}|null{
  if(!aligned(opening,day))return null;
  const original=[...day];
  const selected=[...day];
  const baseline=score(selected,opening,targets);
  let current=baseline;
  let currentRank=rank(current,0);
  const ordered=[...day.keys()].sort((a,b)=>
    day[a].memberId.localeCompare(day[b].memberId));
  for(let move=0;move<MAX_MOVES_PER_DAY;move++){
    let winner:{index:number;assignment:WorkAssignment;
      metrics:MealStaggerMetrics;rank:number[]}|null=null;
    for(const index of ordered){
      const shift=selected[index];
      if(!shift.mealBreak)continue;
      const existing=clockMinutes(shift.mealBreak.start);
      const variants=mealShiftOptions(
        shift.memberId,shift.date,opening,assignmentMinutes(shift),
        clockMinutes(shift.start));
      for(const {assignment} of variants){
        if(assignment.end!==shift.end || !assignment.mealBreak ||
          clockMinutes(assignment.mealBreak.start)===existing)continue;
        const trial={...shift,mealBreak:assignment.mealBreak};
        selected[index]=trial;
        const quality=score(selected,opening,targets);
        if(nonWorsening(quality,baseline)){
          const motion=movement(selected,original);
          const next=rank(quality,motion);
          if(compare(next,currentRank)<0 &&
            (!winner||compare(next,winner.rank)<0)){
            winner={index,assignment:trial,metrics:quality,rank:next};
          }
        }
      }
      selected[index]=shift;
    }
    if(!winner)break;
    selected[winner.index]=winner.assignment;
    current=winner.metrics;
    currentRank=winner.rank;
  }
  const changes=selected.filter((shift,index)=>
    shift.mealBreak?.start!==original[index].mealBreak?.start).length;
  return {assignments:selected,before:baseline,after:current,changes};
}

/**
 * Deliberately read-only with respect to input. The caller must still
 * recertify the complete monthly proposal after applying the returned
 * assignments and discard the result if any monthly issue changes.
 */
export function improveMealBreakStaggering(input:{
  assignments:readonly WorkAssignment[];
  period:PlanningPeriod;
  openingHours:WeeklyOpeningHours;
  members:readonly TeamMember[];
  roles:readonly string[];
}):MealStaggerResult{
  const unchanged=():MealStaggerResult=>({
    assignments:[...input.assignments],summary:null,
  });
  if(!input.roles.length||input.assignments.some(s=>!s.role||
    !input.roles.includes(s.role)))return unchanged();
  const targets=new Map(input.roles.map(role=>[
    role,Math.ceil(input.members.filter(member=>
      member.active&&member.qualifiedRoles?.includes(role)).length/2),
  ]));
  const days=new Map<string,WorkAssignment[]>();
  for(const shift of input.assignments){
    const existing=days.get(shift.date)??[];
    existing.push(shift);
    days.set(shift.date,existing);
  }
  const changed=new Map<string,WorkAssignment[]>();
  const before:MealStaggerMetrics[]=[];
  const after:MealStaggerMetrics[]=[];
  let improvedDays=0,changedBreaks=0,assessedDays=0;
  for(const date of enumerateCivilDays(input.period)){
    const windows=input.openingHours.days[civilDayOfWeek(date)].intervals
      .map(w=>({start:clockMinutes(w.start),end:clockMinutes(w.end)}));
    if(windows.length===0)continue;
    const day=days.get(date)??[];
    const result=optimizeOneDay(day,windows,targets);
    if(!result)continue;
    assessedDays++;
    before.push(result.before);after.push(result.after);
    if(result.changes>0){
      improvedDays++;
      changedBreaks+=result.changes;
      changed.set(date,result.assignments);
    }
  }
  if(changedBreaks===0)return unchanged();
  return {
    assignments:input.assignments.map(shift=>
      changed.get(shift.date)?.find(s=>s.memberId===shift.memberId)??shift),
    summary:{
      assessedDays,improvedDays,changedBreaks,
      before:aggregated(before),after:aggregated(after),
    },
  };
}
