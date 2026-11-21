import {useRef,type CSSProperties,type KeyboardEvent,type PointerEvent} from "react";
import {TIMELINE_SNAP_MINUTES,type TimelineMove,type TimelineMoveKind} from "./timelineEditing";
import {type TimelineInterval} from "./dailyTimeline";
import type {WorkAssignment} from "./workAssignments";

interface Props {
  assignment:WorkAssignment;
  kind:TimelineMoveKind;
  bounds:TimelineInterval;
  style:CSSProperties;
  className:string;
  label:string;
  title:string;
  editable:boolean;
  onPreviewMove:(move:TimelineMove|null)=>void;
  onCommitMove:(move:TimelineMove)=>void;
}
interface Gesture {
  pointerId:number;
  startX:number;
  trackWidth:number;
  lastDelta:number;
  target:Omit<TimelineMove,"deltaMinutes">;
}

/** One gesture creates one undo step. Pointer movement updates ONLY a visual
 * candidate; the owner commits and independently certifies on pointer release.
 * ArrowLeft/ArrowRight give keyboard users the same 15-minute operation.
 */
export function TimelineDraggableBar({
  assignment,kind,bounds,style,className,label,title,editable,
  onPreviewMove,onCommitMove,
}:Props){
  const gesture=useRef<Gesture|null>(null);

  function makeTarget():Omit<TimelineMove,"deltaMinutes">{
    return {
      kind,memberId:assignment.memberId,date:assignment.date,
      start:assignment.start,end:assignment.end,bounds,
    };
  }
  function readDelta(e:PointerEvent<HTMLButtonElement>,g:Gesture){
    const duration=g.target.bounds.end-g.target.bounds.start;
    const raw=(e.clientX-g.startX)*duration/g.trackWidth;
    return Math.round(raw/TIMELINE_SNAP_MINUTES)*TIMELINE_SNAP_MINUTES;
  }
  function start(e:PointerEvent<HTMLButtonElement>){
    if(!editable || (e.pointerType==="mouse" && e.button!==0))return;
    const lane=e.currentTarget.closest(".daily-timeline-track");
    const width=lane?.getBoundingClientRect().width??0;
    if(width<=0)return;
    e.preventDefault();
    e.stopPropagation();
    gesture.current={
      pointerId:e.pointerId,startX:e.clientX,trackWidth:width,
      lastDelta:0,target:makeTarget(),
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e:PointerEvent<HTMLButtonElement>){
    const g=gesture.current;
    if(!g||g.pointerId!==e.pointerId)return;
    const delta=readDelta(e,g);
    if(delta===g.lastDelta)return;
    g.lastDelta=delta;
    onPreviewMove({...g.target,deltaMinutes:delta});
  }
  function finish(e:PointerEvent<HTMLButtonElement>){
    const g=gesture.current;
    if(!g||g.pointerId!==e.pointerId)return;
    gesture.current=null;
    const delta=readDelta(e,g);
    if(e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    if(delta!==0)onCommitMove({...g.target,deltaMinutes:delta});
    else onPreviewMove(null);
  }
  function cancel(e:PointerEvent<HTMLButtonElement>){
    const g=gesture.current;
    if(!g||g.pointerId!==e.pointerId)return;
    gesture.current=null;
    onPreviewMove(null);
  }
  function keyboard(e:KeyboardEvent<HTMLButtonElement>){
    if(!editable || (e.key!=="ArrowLeft" && e.key!=="ArrowRight"))return;
    e.preventDefault();
    e.stopPropagation();
    onCommitMove({...makeTarget(),
      deltaMinutes:(e.key==="ArrowRight"?1:-1)*TIMELINE_SNAP_MINUTES});
  }

  return <button type="button" className={className}
    style={style} title={title} aria-label={label}
    disabled={!editable}
    onPointerDown={start} onPointerMove={move}
    onPointerUp={finish} onPointerCancel={cancel}
    onLostPointerCapture={cancel}
    onKeyDown={keyboard}/>;
}
