import {
  assignmentMinutes,clockMinutes,effectiveWorkIntervals,type WorkAssignment,
} from "./workAssignments";
import {mealDayOptions,type NumericOpening} from "./mealBreaks";

export interface MealDayRequest {
  memberId:string;
  date:string;
  workMinutes:number;
  memberIndex:number;
  activeCount:number;
  weekIndex:number;
  /** Preferred clock start across comparable workdays of the same week. */
  preferredStart?:number;
}
export interface MealDayResult {
  assignments:WorkAssignment[];
  /** True only when every OPEN business minute has someone working. */
  covered:boolean;
}

/** A concrete, deterministic, read-only-on-input first-stage scheduler.
 * Coverage has priority over employee start preferences, but it does NOT
 * alter required weekly minutes or invent additional staff. The independent
 * certifier is authoritative if no coverage solution can be found. */
export function scheduleMealDay(
  requests:readonly MealDayRequest[],
  opening:readonly NumericOpening[],
):MealDayResult {
  const covered=new Uint8Array(1440);
  const open=new Uint8Array(1440);
  for(const window of opening)
    for(let t=window.start;t<window.end;t++)open[t]=1;

  type Candidate={request:MealDayRequest;options:WorkAssignment[]};
  const candidates:Candidate[]=requests.map(request=>({
    request,
    options:mealDayOptions(
      request.memberId,request.date,opening,request.workMinutes
    ),
  }));
  // Workers with few available positions must be placed first.
  candidates.sort((a,b)=>a.options.length-b.options.length ||
    b.request.workMinutes-a.request.workMinutes ||
    a.request.memberIndex-b.request.memberIndex);
  const chosen:WorkAssignment[]=[];
  for(const {request,options} of candidates){
    if(options.length===0)continue;
    const uncovered=new Uint16Array(1441);
    for(let t=0;t<1440;t++)
      uncovered[t+1]=uncovered[t]+(open[t] && !covered[t] ?1:0);
    const gain=(a:WorkAssignment):number=>
      effectiveWorkIntervals(a).reduce((sum,part)=>
        sum+uncovered[part.end]-uncovered[part.start],0);
    const wholeHours=options.filter(o=>clockMinutes(o.start)%60===0);
    const preferred=wholeHours.length>=request.activeCount
      ?wholeHours:options;
    const firstStarts=[...new Set(preferred.map(o=>clockMinutes(o.start)))];
    const usedSlots=Math.max(1,Math.min(request.activeCount,firstStarts.length));
    const position=((request.weekIndex+request.memberIndex)%usedSlots+
      usedSlots)%usedSlots;
    const desired=request.preferredStart??firstStarts[
      usedSlots===1?0:Math.round(
        position*(firstStarts.length-1)/(usedSlots-1)
      )
    ];
    let best=options[0];
    let bestGain=-1;
    let bestPreference=Infinity;
    for(const option of options){
      const nextGain=gain(option);
      const start=clockMinutes(option.start);
      const preference=Math.abs(start-desired)+
        (start%60===0?0:4)+
        (option.mealBreak
          ?Math.abs(clockMinutes(option.mealBreak.start)-
            start-180)/10:0);
      if(nextGain>bestGain ||
        (nextGain===bestGain&&preference<bestPreference)){
        bestGain=nextGain;
        bestPreference=preference;
        best=option;
      }
    }
    chosen.push(best);
    for(const portion of effectiveWorkIntervals(best))
      for(let t=portion.start;t<portion.end;t++)covered[t]=1;
  }
  return {
    assignments:chosen,
    covered:open.every((isOpen,t)=>!isOpen || covered[t]===1),
  };
}

export function totalEffectiveWork(
  assignments:readonly WorkAssignment[]
):number {
  return assignments.reduce((sum,a)=>sum+assignmentMinutes(a),0);
}
