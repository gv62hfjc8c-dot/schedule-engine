import type {OperatingHoursException, TimeInterval, WeeklyOperatingHours} from "../types";
import {validateEditedIntervals, type IntervalEditResult} from "./intervalEditing";

export interface OperationExceptionDraft {
  date: string;
  reason: string;
  mode: "closed" | "open";
  intervals: TimeInterval[];
}

export function isValidCivilDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T12:00:00Z");
  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value;
}

export function createOperationExceptionDraft(
  existing?: OperatingHoursException,
): OperationExceptionDraft {
  return {
    date: existing?.date ?? "",
    reason: existing?.reason ?? "",
    mode: existing && existing.intervals.length ? "open" : "closed",
    intervals: existing?.intervals.map(interval => ({...interval})) ?? [],
  };
}

export type ExceptionDraftValidation =
  | {valid: true; value: OperatingHoursException}
  | {valid: false; issue: string};

/** One explicit action must precede persistence; no default exception is written. */
export function validateOperationExceptionDraft(
  draft: OperationExceptionDraft,
  existing: OperatingHoursException[],
  editingIndex: number | null,
): ExceptionDraftValidation {
  if (!isValidCivilDate(draft.date))
    return {valid:false,issue:"Escolhe uma data válida para a exceção."};
  if (existing.some((entry,index)=>index!==editingIndex && entry.date===draft.date))
    return {valid:false,issue:"Já existe uma exceção para essa data."};
  const reason=draft.reason.trim();
  if (!reason || reason.length>160)
    return {valid:false,issue:"Indica o motivo da exceção (até 160 caracteres)."};
  if (draft.mode==="closed")
    return {valid:true,value:{date:draft.date,reason,intervals:[]}};
  if (!draft.intervals.length)
    return {valid:false,issue:"Define pelo menos um intervalo para o dia aberto."};
  const checked=validateEditedIntervals(draft.intervals);
  if (!checked.valid) return {valid:false,issue:checked.issue};
  return {valid:true,value:{date:draft.date,reason,intervals:checked.intervals}};
}

export function mergeAdjacentOperatingIntervals(
  intervals: TimeInterval[],
): IntervalEditResult {
  const checked=validateEditedIntervals(intervals);
  if (!checked.valid) return checked;
  const combined:TimeInterval[]=[];
  for (const interval of checked.intervals) {
    const last=combined[combined.length-1];
    if (last && last.end===interval.start) {
      combined[combined.length-1]={start:last.start,end:interval.end};
    } else {
      combined.push({...interval});
    }
  }
  return {valid:true,intervals:combined};
}

export function hasAdjacentOperatingIntervals(intervals:TimeInterval[]):boolean {
  const ordered=[...intervals].sort((a,b)=>a.start.localeCompare(b.start));
  return ordered.some((interval,i)=>i>0 && ordered[i-1].end===interval.start);
}

/** A UI hint only: the engine always receives a single interval-based model. */
export function operatingPresentation(
  week: WeeklyOperatingHours,
): "continuous" | "interrupted" | "adjacent" {
  let hasAdjacent=false;
  for(const intervals of Object.values(week)) {
    const ordered=[...intervals].sort((a,b)=>a.start.localeCompare(b.start));
    for(let i=1;i<ordered.length;i++){
      if(ordered[i-1].end < ordered[i].start) return "interrupted";
      if(ordered[i-1].end === ordered[i].start) hasAdjacent=true;
    }
  }
  return hasAdjacent?"adjacent":"continuous";
}
