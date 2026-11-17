import {civilDayOfWeek,parseCivilDate} from "./schedulePeriods";
import {WEEKDAYS,type WeeklyOpeningHours} from "./operatingHours";

/**
 * One uninterrupted interval of effective work on one civil day.
 * An unpaid break is represented by separate work intervals, not deducted
 * implicitly. Overnight intervals are deliberately outside this phase.
 */
export interface WorkAssignment {
  memberId:string;
  date:string;
  start:string;
  end:string;
}

const TIME=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
export function clockMinutes(time:string):number {
  if(!TIME.test(time))throw new Error("Hora HH:MM inválida.");
  const [hour,minute]=time.split(":").map(Number);
  return hour*60+minute;
}

export function validateWorkAssignment(raw:unknown):WorkAssignment|null {
  if(!raw || typeof raw!=="object" || Array.isArray(raw))return null;
  const value=raw as Partial<WorkAssignment>;
  if(typeof value.memberId!=="string" || !value.memberId.trim() ||
    typeof value.date!=="string" ||
    typeof value.start!=="string" || typeof value.end!=="string")
    return null;
  try{
    parseCivilDate(value.date);
    if(clockMinutes(value.end)<=clockMinutes(value.start))return null;
    return {
      memberId:value.memberId,
      date:value.date,
      start:value.start,
      end:value.end,
    };
  }catch{return null;}
}

export function assignmentMinutes(assignment:WorkAssignment):number {
  return clockMinutes(assignment.end)-clockMinutes(assignment.start);
}

export function assignmentsOverlap(a:WorkAssignment,b:WorkAssignment):boolean {
  return a.memberId===b.memberId && a.date===b.date &&
    clockMinutes(a.start)<clockMinutes(b.end) &&
    clockMinutes(b.start)<clockMinutes(a.end);
}

/**
 * Only assignments in the editable period are validated against the current
 * company's hours. Historical/other-month assignments are read-only context
 * and may have been made under a different operating-hours configuration.
 */
export function isWithinOpeningHours(
  assignment:WorkAssignment,hours:WeeklyOpeningHours
):boolean {
  const weekday=WEEKDAYS[civilDayOfWeek(assignment.date)].id;
  const day=hours.days.find(d=>d.day===weekday);
  if(!day)return false;
  const start=clockMinutes(assignment.start);
  const end=clockMinutes(assignment.end);
  return day.intervals.some(interval=>
    start>=clockMinutes(interval.start) && end<=clockMinutes(interval.end)
  );
}
