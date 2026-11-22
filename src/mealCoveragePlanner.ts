import {
  assignmentMinutes,clockMinutes,effectiveWorkIntervals,type WorkAssignment,
} from "./workAssignments";
import {mealDayOptions,type NumericOpening} from "./mealBreaks";

export interface MealDayRequest {
  memberId:string;
  date:string;
  workMinutes:number;
  shortOpening:boolean;
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
      request.memberId,request.date,opening,request.workMinutes,
      request.shortOpening
    ),
  }));
  // Workers with few available positions must be placed first.
  candidates.sort((a,b)=>a.options.length-b.options.length ||
    b.request.workMinutes-a.request.workMinutes ||
    a.request.memberIndex-b.request.memberIndex);
  const chosen:WorkAssignment[]=[];
  const chosenOptions:WorkAssignment[][]=[];
  for(const {request,options} of candidates){
    if(options.length===0)continue;
    const uncovered=new Uint16Array(1441);
    for(let t=0;t<1440;t++)
      uncovered[t+1]=uncovered[t]+(open[t] && !covered[t] ?1:0);
    const gain=(a:WorkAssignment):number=>
      effectiveWorkIntervals(a).reduce((sum,part)=>
        sum+uncovered[part.end]-uncovered[part.start],0);
    const wholeHours=options.filter(o=>clockMinutes(o.start)%60===0);
    const distinctWholeHourStarts=new Set(
      wholeHours.map(option=>clockMinutes(option.start))).size;
    // Lunch variants at the same start time are NOT distinct positions.
    // Otherwise a single 09:00 option with several meal placements may
    // falsely exclude the 09:15 closing shift needed for full coverage.
    const preferred=distinctWholeHourStarts>=request.activeCount
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
    chosenOptions.push(options);
    for(const portion of effectiveWorkIntervals(best))
      for(let t=portion.start;t<portion.end;t++)covered[t]=1;
  }
  // A greedy placement may leave a short gap despite a feasible coverage
  // pattern. Reposition an ALREADY SELECTED shift if it strictly reduces
  // uncovered opening minutes. No work hours, meal duration, days or people
  // are changed. The independent certifier remains the final authority.
  let remaining=open.reduce((sum,isOpen,t)=>
    sum+(isOpen&&!covered[t]?1:0),0);
  if(remaining>0 && chosen.length>0){
    const presence=new Uint16Array(1440);
    function adjust(shift:WorkAssignment,delta:1|-1){
      for(const interval of effectiveWorkIntervals(shift))
        for(let t=interval.start;t<interval.end;t++)
          presence[t]+=delta;
    }
    for(const shift of chosen)adjust(shift,1);
    const limit=Math.min(20,chosen.length*2);
    for(let iteration=0;iteration<limit&&remaining>0;iteration++){
      const missingPrefix=new Uint16Array(1441);
      for(let t=0;t<1440;t++)
        missingPrefix[t+1]=missingPrefix[t]+
          (open[t]&&presence[t]===0?1:0);
      let winner:{index:number;option:WorkAssignment;gain:number;
        movement:number}|null=null;
      for(let index=0;index<chosen.length;index++){
        const old=chosen[index];
        const oldIntervals=effectiveWorkIntervals(old);
        const uniquePrefix=new Uint16Array(1441);
        for(let t=0;t<1440;t++){
          const insideOld=oldIntervals.some(part=>
            part.start<=t&&t<part.end);
          uniquePrefix[t+1]=uniquePrefix[t]+
            (open[t]&&insideOld&&presence[t]===1?1:0);
        }
        const uniqueTotal=oldIntervals.reduce((sum,part)=>
          sum+uniquePrefix[part.end]-uniquePrefix[part.start],0);
        for(const option of chosenOptions[index]){
          if(option===old)continue;
          const next=effectiveWorkIntervals(option);
          const restored=next.reduce((sum,part)=>
            sum+missingPrefix[part.end]-missingPrefix[part.start],0);
          let uniqueStillCovered=0;
          for(const oldPart of oldIntervals)
            for(const newPart of next){
              const start=Math.max(oldPart.start,newPart.start);
              const end=Math.min(oldPart.end,newPart.end);
              if(end>start)
                uniqueStillCovered+=uniquePrefix[end]-uniquePrefix[start];
            }
          const gained=restored-uniqueTotal+uniqueStillCovered;
          if(gained<=0)continue;
          const movement=Math.abs(clockMinutes(option.start)-
            clockMinutes(old.start));
          if(!winner||gained>winner.gain||
            (gained===winner.gain&&movement<winner.movement))
            winner={index,option,gain:gained,movement};
        }
      }
      if(!winner)break;
      adjust(chosen[winner.index],-1);
      chosen[winner.index]=winner.option;
      adjust(winner.option,1);
      remaining-=winner.gain;
    }
    for(let t=0;t<1440;t++)
      covered[t]=presence[t]>0?1:0;
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
