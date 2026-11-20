import {clockMinutes,type WorkAssignment} from "./workAssignments";

export const MEAL_BREAK_DURATION_MINUTES=60;
export const MEAL_BREAK_EARLIEST_AFTER_ENTRY_MINUTES=180;
/** First experiment: an effective workday up to four hours is a short shift. */
export const SHORT_SHIFT_MAX_WORK_MINUTES=240;

export interface MealBreak {
  memberId:string;
  date:string;
  start:string;
  end:string;
}
export interface NumericOpening {
  start:number;
  end:number;
}
export interface DayMealPlan {
  assignments:WorkAssignment[];
  mealBreak:MealBreak;
}

function asClock(value:number):string {
  return String(Math.floor(value/60)).padStart(2,"0")+":"+
    String(value%60).padStart(2,"0");
}

/** Validate structure without confusing meal minutes with work minutes. */
export function validateMealBreak(raw:unknown):MealBreak|null {
  if(!raw||typeof raw!=="object"||Array.isArray(raw))return null;
  const value=raw as Partial<MealBreak>;
  if(typeof value.memberId!=="string"||!value.memberId.trim()||
    typeof value.date!=="string"||typeof value.start!=="string"||
    typeof value.end!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value.date))
    return null;
  try {
    const start=clockMinutes(value.start),end=clockMinutes(value.end);
    if(end-start!==MEAL_BREAK_DURATION_MINUTES)return null;
    return {memberId:value.memberId,date:value.date,
      start:value.start,end:value.end};
  }catch{return null;}
}

/** Candidate shift starts on whole/half-hour clock boundaries, plus opening
 * starts for companies whose opening hours are not aligned to those grids. */
export function candidateDayStarts(intervals:readonly NumericOpening[]):number[] {
  const starts=new Set<number>();
  for(const interval of intervals){
    starts.add(interval.start);
    for(let m=Math.ceil(interval.start/30)*30;m<interval.end;m+=30)
      starts.add(m);
  }
  return [...starts].sort((a,b)=>a-b);
}

/** Place actual work on both sides of a 60-minute meal break.
 * Closed business intervals are skipped, never interpreted as work.
 * Meal pauses may coincide with a closure; they are explicitly identified. */
export function planMealDay(
  memberId:string,date:string,
  intervals:readonly NumericOpening[],
  requiredWorkMinutes:number,
  selectedStart:number,
):DayMealPlan|null {
  if(requiredWorkMinutes<=SHORT_SHIFT_MAX_WORK_MINUTES)return null;
  const lastClose=Math.max(...intervals.map(i=>i.end),0);
  const earliest=selectedStart+MEAL_BREAK_EARLIEST_AFTER_ENTRY_MINUTES;
  const mealStarts=new Set<number>([earliest]);
  for(let t=Math.ceil(earliest/30)*30;
    t+MEAL_BREAK_DURATION_MINUTES<=lastClose;t+=30)
    mealStarts.add(t);
  // Include boundary times in a split business opening (e.g. 12:15).
  for(const interval of intervals){
    if(interval.start>=earliest)mealStarts.add(interval.start);
    if(interval.end>=earliest)mealStarts.add(interval.end);
  }
  const ordered=[...mealStarts].sort((a,b)=>a-b);
  for(const lunchStart of ordered){
    const lunchEnd=lunchStart+MEAL_BREAK_DURATION_MINUTES;
    if(lunchStart<earliest||lunchEnd>lastClose)continue;
    let remaining=requiredWorkMinutes;
    const work:WorkAssignment[]=[];
    // Reserve some work after the break: a break cannot be placed after
    // a completed shift just to make the schedule look compliant.
    for(const interval of intervals){
      const start=Math.max(interval.start,selectedStart);
      const end=Math.min(interval.end,lunchStart);
      if(end<=start||remaining<=1)continue;
      const take=Math.min(end-start,remaining-1);
      if(take<=0)continue;
      work.push({memberId,date,start:asClock(start),end:asClock(start+take)});
      remaining-=take;
    }
    const before=requiredWorkMinutes-remaining;
    if(before<=0||remaining<=0)continue;
    for(const interval of intervals){
      const start=Math.max(interval.start,lunchEnd);
      const end=interval.end;
      if(end<=start||remaining===0)continue;
      const take=Math.min(end-start,remaining);
      if(take<=0)continue;
      work.push({memberId,date,start:asClock(start),end:asClock(start+take)});
      remaining-=take;
    }
    if(remaining===0 && work.some(w=>clockMinutes(w.end)<=lunchStart) &&
      work.some(w=>clockMinutes(w.start)>=lunchEnd)){
      return {assignments:work,mealBreak:{
        memberId,date,start:asClock(lunchStart),end:asClock(lunchEnd),
      }};
    }
  }
  return null;
}

/** Work capacity after including an explicit one-hour meal break.
 * A four-hour short day remains four hours of uninterrupted work.
 * The binary search relies on feasibility being monotone with work minutes.
 */
export function effectiveMealDayCapacity(
  intervals:readonly NumericOpening[]
):number {
  const totalOpen=intervals.reduce((sum,i)=>sum+i.end-i.start,0);
  if(totalOpen<=SHORT_SHIFT_MAX_WORK_MINUTES)return totalOpen;
  const starts=candidateDayStarts(intervals);
  const feasible=(minutes:number)=>starts.some(start=>
    planMealDay("capacity-test","2000-01-01",intervals,minutes,start)!==null);
  let low=SHORT_SHIFT_MAX_WORK_MINUTES,high=totalOpen;
  while(low<high){
    const midpoint=Math.ceil((low+high+1)/2);
    if(feasible(midpoint))low=midpoint;
    else high=midpoint-1;
  }
  return low;
}

export function selectWeeklyMealPlan(
  memberId:string,date:string,
  intervals:readonly NumericOpening[],
  minutes:number,memberIndex:number,activeCount:number,
  weekIndex:number,
):DayMealPlan|null {
  const starts=candidateDayStarts(intervals);
  const possible=starts.map(start=>({
    start,plan:planMealDay(memberId,date,intervals,minutes,start),
  })).filter((entry):entry is {start:number;plan:DayMealPlan}=>entry.plan!==null);
  if(possible.length===0)return null;
  const onHour=possible.filter(entry=>entry.start%60===0);
  const choices=onHour.length>=activeCount?onHour:possible;
  const slots=Math.min(activeCount,choices.length);
  const position=((weekIndex+memberIndex)%slots+slots)%slots;
  const index=slots<=1?0:
    Math.round(position*(choices.length-1)/(slots-1));
  return choices[index].plan;
}
