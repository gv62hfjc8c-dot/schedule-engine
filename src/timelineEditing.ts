import {clockMinutes,validateWorkAssignment,type WorkAssignment} from "./workAssignments";
import {minuteLabel,type TimelineInterval} from "./dailyTimeline";

/**
 * Editing an existing V2 single shift is deliberately distinct from
 * generating a schedule. This pure function changes exactly ONE assignment.
 * It never moves a different colleague or corrects a conflict automatically.
 *
 * A conflict with a business rule is allowed and belongs to the independent
 * certifier. Impossible time geometry (reversed times, a meal outside its
 * shift, or a shift outside the displayed daily axis) is not allowed.
 */
export const TIMELINE_SNAP_MINUTES=15;
/** Convert real pointer travel using this day's rendered axis width. */
export function dragMinutesForPixels(
  distancePixels:number,axisMinutes:number,trackPixels:number,
):number {
  if(!Number.isFinite(distancePixels) || !Number.isFinite(axisMinutes) ||
     !Number.isFinite(trackPixels) || axisMinutes<=0 || trackPixels<=0)
    return 0;
  return Math.round(distancePixels*axisMinutes/trackPixels/
    TIMELINE_SNAP_MINUTES)*TIMELINE_SNAP_MINUTES;
}
export type TimelineMoveKind="shift"|"meal";
export interface TimelineMove {
  kind:TimelineMoveKind;
  memberId:string;
  date:string;
  /** Identity of the shift at the BEGINNING of the gesture. */
  start:string;
  end:string;
  deltaMinutes:number;
  /** First opening to last closing for the selected day. */
  bounds:TimelineInterval;
}
export type TimelineMoveResult=
  | {changed:true;assignments:WorkAssignment[];deltaMinutes:number}
  | {changed:false;assignments:readonly WorkAssignment[];reason:
    "not_found"|"invalid"|"no_movement"|"missing_meal"};

function snappedDelta(requested:number,min:number,max:number):number|null {
  if(!Number.isFinite(requested)||!Number.isFinite(min)||!Number.isFinite(max))
    return null;
  const smallest=Math.ceil(min/TIMELINE_SNAP_MINUTES);
  const largest=Math.floor(max/TIMELINE_SNAP_MINUTES);
  if(smallest>largest)return null;
  const desired=Math.round(requested/TIMELINE_SNAP_MINUTES);
  return Math.max(smallest,Math.min(largest,desired))*TIMELINE_SNAP_MINUTES;
}

export function moveTimelineAssignment(
  assignments:readonly WorkAssignment[],move:TimelineMove,
):TimelineMoveResult {
  if(!move || !move.bounds || !Number.isSafeInteger(move.bounds.start) ||
    !Number.isSafeInteger(move.bounds.end) ||
    move.bounds.start<0 || move.bounds.end>1440 ||
    move.bounds.end<=move.bounds.start ||
    !Number.isFinite(move.deltaMinutes) ||
    (move.kind!=="shift" && move.kind!=="meal"))
    return {changed:false,assignments,reason:"invalid"};

  const index=assignments.findIndex(item=>
    item.memberId.toLowerCase()===move.memberId.toLowerCase() &&
    item.date===move.date && item.start===move.start && item.end===move.end);
  if(index<0)return {changed:false,assignments,reason:"not_found"};
  const current=assignments[index];
  const from=clockMinutes(current.start),to=clockMinutes(current.end);
  let delta:number|null;
  let updated:WorkAssignment;
  if(move.kind==="shift"){
    delta=snappedDelta(move.deltaMinutes,
      move.bounds.start-from,move.bounds.end-to);
    if(delta===null)return {changed:false,assignments,reason:"invalid"};
    if(delta===0)return {changed:false,assignments,reason:"no_movement"};
    updated={
      ...current,start:minuteLabel(from+delta),
      end:minuteLabel(to+delta),
      ...(current.mealBreak?{mealBreak:{
        start:minuteLabel(clockMinutes(current.mealBreak.start)+delta),
        end:minuteLabel(clockMinutes(current.mealBreak.end)+delta),
      }}:{}),
    };
  }else {
    const meal=current.mealBreak;
    if(!meal)return {changed:false,assignments,reason:"missing_meal"};
    const mealStart=clockMinutes(meal.start),mealEnd=clockMinutes(meal.end);
    // Preserve a meal STRICTLY inside its existing single shift.
    delta=snappedDelta(move.deltaMinutes,
      from+1-mealStart,to-1-mealEnd);
    if(delta===null)return {changed:false,assignments,reason:"invalid"};
    if(delta===0)return {changed:false,assignments,reason:"no_movement"};
    updated={
      ...current,mealBreak:{
        start:minuteLabel(mealStart+delta),
        end:minuteLabel(mealEnd+delta),
      },
    };
  }
  if(!validateWorkAssignment(updated))
    return {changed:false,assignments,reason:"invalid"};
  const next=[...assignments];
  next[index]=updated;
  return {changed:true,assignments:next,deltaMinutes:delta};
}
