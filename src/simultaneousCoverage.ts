import {
  clockMinutes,effectiveWorkIntervals,type WorkAssignment,
} from "./workAssignments";
import type {NumericOpening} from "./mealBreaks";

export interface SimultaneousCoverageQuality {
  /** HARD: must be zero for a valid proposal. */
  uncoveredMinutes:number;
  /** SOFT: open minutes with exactly one person actively working. */
  soloMinutes:number;
}

type Interval={start:number;end:number};
function intervals(shift:WorkAssignment):Interval[] {
  return effectiveWorkIntervals(shift);
}
function markOpen(opening:readonly NumericOpening[]):Uint8Array {
  const open=new Uint8Array(1440);
  for(const window of opening)
    for(let t=window.start;t<window.end;t++)open[t]=1;
  return open;
}
function buildPresence(assignments:readonly WorkAssignment[]):Uint16Array {
  const presence=new Uint16Array(1440);
  for(const shift of assignments)
    for(const part of intervals(shift))
      for(let t=part.start;t<part.end;t++)presence[t]++;
  return presence;
}
function tally(open:Uint8Array,presence:Uint16Array):
  SimultaneousCoverageQuality {
  let uncoveredMinutes=0,soloMinutes=0;
  for(let t=0;t<1440;t++){
    if(!open[t])continue;
    if(presence[t]===0)uncoveredMinutes++;
    if(presence[t]===1)soloMinutes++;
  }
  return {uncoveredMinutes,soloMinutes};
}

/** Evaluates actual work intervals, excluding embedded meal pauses.
 * No configurable staffing minimum and no independent certification claim. */
export function measureSimultaneousCoverage(
  assignments:readonly WorkAssignment[],
  opening:readonly NumericOpening[],
):SimultaneousCoverageQuality {
  return tally(markOpen(opening),buildPresence(assignments));
}

/**
 * SOFT, deterministic local improvement AFTER hard opening coverage.
 * Prefer repositioning a meal inside an unchanged shift before touching
 * shift start/end times. All choices come from the original already
 * validated day options, so effective hours, worker, workday, and break
 * duration remain unchanged. Strictly decrease solo minutes; never
 * trade away a minute of hard opening coverage.
 *
 * To evaluate a candidate in O(1), calculate the minute-count prefixes
 * with the employee temporarily removed. Adding their work intervals:
 *   - covers any minute with 0 other workers;
 *   - removes solo status when 1 other worker is present;
 *   - adds solo status when no other worker was present.
 * A small bound on iterations avoids quadratic scaling on large teams.
 */
export function improveSimultaneousCoverage(
  selected:readonly WorkAssignment[],
  optionsBySelected:readonly (readonly WorkAssignment[])[],
  opening:readonly NumericOpening[],
):WorkAssignment[] {
  if(selected.length!==optionsBySelected.length)
    throw new Error("Opções de pausa desalinhadas com os turnos.");
  const chosen=[...selected];
  if(chosen.length<=1 || chosen.length>24)return chosen;
  const open=markOpen(opening);
  const presence=buildPresence(chosen);
  let quality=tally(open,presence);
  if(quality.uncoveredMinutes>0 || quality.soloMinutes===0)return chosen;

  const optionsCache=new WeakMap<WorkAssignment,Interval[]>();
  const parts=(shift:WorkAssignment):Interval[]=>{
    const cached=optionsCache.get(shift);
    if(cached)return cached;
    const value=intervals(shift);
    optionsCache.set(shift,value);
    return value;
  };
  const adjust=(shift:WorkAssignment,delta:1|-1):void=>{
    for(const part of parts(shift))
      for(let t=part.start;t<part.end;t++)
        presence[t]+=delta;
  };
  const sum=(prefix:Uint16Array,spans:readonly Interval[]):number=>
    spans.reduce((total,part)=>total+
      prefix[part.end]-prefix[part.start],0);

  const maximumSteps=Math.min(24,chosen.length*4);
  let steps=0;
  for(const mealOnly of [true,false]){
    while(steps<maximumSteps && quality.soloMinutes>0){
      let best:{
        index:number;option:WorkAssignment;solo:number;movement:number;
      }|null=null;
      for(let index=0;index<chosen.length;index++){
        const original=chosen[index];
        const originalParts=parts(original);
        const zero=new Uint16Array(1441);
        const one=new Uint16Array(1441);
        let baseUncovered=0,baseSolo=0;
        for(let t=0;t<1440;t++){
          let wasWorking=false;
          for(const part of originalParts){
            if(part.start<=t&&t<part.end){wasWorking=true;break;}
          }
          const others=presence[t]-(wasWorking?1:0);
          const active=open[t]===1;
          const zeroNow=active&&others===0?1:0;
          const oneNow=active&&others===1?1:0;
          baseUncovered+=zeroNow;
          baseSolo+=oneNow;
          zero[t+1]=zero[t]+zeroNow;
          one[t+1]=one[t]+oneNow;
        }
        for(const option of optionsBySelected[index]){
          if(option===original)continue;
          if(mealOnly && (option.start!==original.start ||
            option.end!==original.end))continue;
          const chosenParts=parts(option);
          const regained=sum(zero,chosenParts);
          const uncovered=baseUncovered-regained;
          // HARD coverage is already complete. Never worsen it.
          if(uncovered!==0)continue;
          const solo=baseSolo+regained-sum(one,chosenParts);
          if(solo>=quality.soloMinutes)continue;
          const startMove=Math.abs(clockMinutes(option.start)-
            clockMinutes(original.start));
          const lunchMove=option.mealBreak&&original.mealBreak
            ?Math.abs(clockMinutes(option.mealBreak.start)-
              clockMinutes(original.mealBreak.start)):0;
          const movement=startMove*2+lunchMove;
          if(!best||solo<best.solo ||
            (solo===best.solo&&movement<best.movement))
            best={index,option,solo,movement};
        }
      }
      if(!best)break;
      adjust(chosen[best.index],-1);
      chosen[best.index]=best.option;
      adjust(best.option,1);
      quality=tally(open,presence);
      steps++;
    }
  }
  return chosen;
}
