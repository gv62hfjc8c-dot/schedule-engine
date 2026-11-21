import {parseCivilDate} from "./schedulePeriods";
import {clockMinutes,type WorkAssignment} from "./workAssignments";

export const MEAL_BREAK_DURATION_MINUTES=60;
export const MEAL_BREAK_EARLIEST_AFTER_ENTRY_MINUTES=180;
/** First-phase operational definition, not a general legal threshold. */
export const SHORT_SHIFT_MAX_WORK_MINUTES=240;

/** Only used to read experimental PR84 drafts written before the single-shift
 * model. New proposals store their pause INSIDE WorkAssignment. */
export interface MealBreak {
  memberId:string;date:string;start:string;end:string;
}
export interface NumericOpening {start:number;end:number}
export interface DayMealPlan {assignment:WorkAssignment;mealBreak:MealBreak}

function hhmm(value:number):string {
  return String(Math.floor(value/60)).padStart(2,"0")+":"+
    String(value%60).padStart(2,"0");
}

export function validateMealBreak(raw:unknown):MealBreak|null {
  if(!raw||typeof raw!=="object"||Array.isArray(raw))return null;
  const value=raw as Partial<MealBreak>;
  if(typeof value.memberId!=="string"||!value.memberId.trim()||
    typeof value.date!=="string"||typeof value.start!=="string"||
    typeof value.end!=="string")return null;
  try{
    parseCivilDate(value.date);
    const start=clockMinutes(value.start),end=clockMinutes(value.end);
    if(end-start!==MEAL_BREAK_DURATION_MINUTES)return null;
    return {memberId:value.memberId,date:value.date,
      start:value.start,end:value.end};
  }catch{return null;}
}

export function candidateDayStarts(
  intervals:readonly NumericOpening[],spacingMinutes:15|30=30,
):number[] {
  const starts=new Set<number>();
  for(const interval of intervals){
    starts.add(interval.start);
    for(let t=Math.ceil(interval.start/spacingMinutes)*spacingMinutes;
      t<interval.end;t+=spacingMinutes)
      starts.add(t);
  }
  return [...starts].sort((a,b)=>a-b);
}

function inside(
  intervals:readonly NumericOpening[],start:number,end:number
):boolean {
  return intervals.some(i=>start>=i.start&&end<=i.end);
}

/** Build a single shift containing a one-hour meal break, never two shifts.
 * Both actual work portions must fit opening hours; the pause may coincide
 * with closure between opening windows. */
export function mealShiftOptions(
  memberId:string,date:string,intervals:readonly NumericOpening[],
  workMinutes:number,start:number,
):DayMealPlan[] {
  if(workMinutes<=SHORT_SHIFT_MAX_WORK_MINUTES)return [];
  const end=start+workMinutes+MEAL_BREAK_DURATION_MINUTES;
  if(end>1439)return [];
  const earliest=start+MEAL_BREAK_EARLIEST_AFTER_ENTRY_MINUTES;
  const last=end-MEAL_BREAK_DURATION_MINUTES-1;
  if(earliest>last)return [];
  const starts=new Set<number>([earliest]);
  for(let t=Math.ceil(earliest/30)*30;t<=last;t+=30)starts.add(t);
  for(const i of intervals){
    if(i.start>=earliest && i.start<=last)starts.add(i.start);
    if(i.end>=earliest && i.end<=last)starts.add(i.end);
  }
  return [...starts].sort((a,b)=>a-b)
    .filter(t=>inside(intervals,start,t) &&
      inside(intervals,t+MEAL_BREAK_DURATION_MINUTES,end))
    .map(t=>({
      assignment:{
        memberId,date,start:hhmm(start),end:hhmm(end),
        mealBreak:{start:hhmm(t),end:hhmm(t+MEAL_BREAK_DURATION_MINUTES)},
      },
      mealBreak:{
        memberId,date,start:hhmm(t),
        end:hhmm(t+MEAL_BREAK_DURATION_MINUTES),
      },
    }));
}

/** Short shifts have no meal; a short shift also cannot silently work
 * through an intervening closed business period. */
export function shortShiftOptions(
  memberId:string,date:string,intervals:readonly NumericOpening[],
  workMinutes:number,start:number,
):WorkAssignment[] {
  if(workMinutes<=0||workMinutes>SHORT_SHIFT_MAX_WORK_MINUTES)return [];
  const end=start+workMinutes;
  return inside(intervals,start,end)
    ?[{memberId,date,start:hhmm(start),end:hhmm(end)}]:[];
}

export function mealDayOptions(
  memberId:string,date:string,intervals:readonly NumericOpening[],
  workMinutes:number,
  shortOpening=false,
):WorkAssignment[] {
  if(shortOpening){
    const total=intervals.reduce((sum,i)=>sum+i.end-i.start,0);
    // Every person assigned to a short business opening works all of it.
    // One continuous shift cannot silently cross a closed business gap.
    return intervals.length===1 && workMinutes===total && total>0
      ?[{memberId,date,start:hhmm(intervals[0].start),
        end:hhmm(intervals[0].end)}]:[];
  }
  // For 8h45 effective days a 09:15 start may be the only way to cover
  // the 19:00 closing. Preserve established 30-minute positions whenever
  // work duration is compatible with them.
  return candidateDayStarts(intervals,workMinutes%30===0?30:15)
    .flatMap(start=>
    workMinutes<=SHORT_SHIFT_MAX_WORK_MINUTES
      ?shortShiftOptions(memberId,date,intervals,workMinutes,start)
      :mealShiftOptions(memberId,date,intervals,workMinutes,start)
        .map(plan=>plan.assignment)
  );
}

/** Deterministic first feasible option for unit tests / single-person use. */
export function planMealDay(
  memberId:string,date:string,intervals:readonly NumericOpening[],
  requiredWorkMinutes:number,selectedStart:number,
):DayMealPlan|null {
  return mealShiftOptions(memberId,date,intervals,requiredWorkMinutes,
    selectedStart)[0]??null;
}

export function effectiveMealDayCapacity(
  intervals:readonly NumericOpening[],
):number {
  const totalOpen=intervals.reduce((sum,i)=>sum+i.end-i.start,0);
  const maxShort=Math.min(SHORT_SHIFT_MAX_WORK_MINUTES,
    Math.max(...intervals.map(i=>i.end-i.start),0));
  if(totalOpen<=SHORT_SHIFT_MAX_WORK_MINUTES)return maxShort;
  const starts=candidateDayStarts(intervals);
  const feasible=(minutes:number)=>starts.some(start=>
    mealShiftOptions("capacity-test","2000-01-01",intervals,
      minutes,start).length>0);
  if(!feasible(SHORT_SHIFT_MAX_WORK_MINUTES+1))return maxShort;
  let low=SHORT_SHIFT_MAX_WORK_MINUTES+1,high=totalOpen;
  while(low<high){
    const midpoint=Math.ceil((low+high+1)/2);
    if(feasible(midpoint))low=midpoint;
    else high=midpoint-1;
  }
  return Math.max(maxShort,low);
}
