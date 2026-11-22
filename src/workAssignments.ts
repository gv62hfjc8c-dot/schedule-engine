import {civilDayOfWeek,parseCivilDate} from "./schedulePeriods";
import {WEEKDAYS,type WeeklyOpeningHours} from "./operatingHours";

/** One shift per person and day. An optional meal interval belongs INSIDE
 * the shift and is excluded from effective work. Old shifts without a meal
 * remain readable for backward compatibility; overnight shifts are unsupported.
 */
export interface WorkAssignment {
  memberId:string;
  date:string;
  start:string;
  end:string;
  mealBreak?:{start:string;end:string};
  /** Exclusive functional post for the entire shift. Absent in legacy shifts. */
  role?:string;
}

const TIME=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
const ROLE_ID=/^[a-z][a-z0-9_-]*$/;
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
    const start=clockMinutes(value.start),end=clockMinutes(value.end);
    if(end<=start)return null;
    if(value.role!==undefined &&
      (typeof value.role!=="string" || !ROLE_ID.test(value.role)))
      return null;
    let mealBreak:WorkAssignment["mealBreak"];
    if(value.mealBreak!==undefined){
      const meal=value.mealBreak;
      if(!meal||typeof meal!=="object"||Array.isArray(meal)||
        typeof meal.start!=="string"||typeof meal.end!=="string")
        return null;
      const bStart=clockMinutes(meal.start),bEnd=clockMinutes(meal.end);
      if(!(start<bStart&&bStart<bEnd&&bEnd<end))return null;
      mealBreak={start:meal.start,end:meal.end};
    }
    return {
      memberId:value.memberId,date:value.date,start:value.start,end:value.end,
      ...(mealBreak?{mealBreak}:{}),
      ...(value.role!==undefined?{role:value.role}:{}),
    };
  }catch{return null;}
}

/** Hours actually worked, never including the meal inside the shift. */
export function assignmentMinutes(assignment:WorkAssignment):number {
  const span=clockMinutes(assignment.end)-clockMinutes(assignment.start);
  return span-(assignment.mealBreak
    ?clockMinutes(assignment.mealBreak.end)-
      clockMinutes(assignment.mealBreak.start):0);
}

/** Work intervals for coverage checks; a shift is still one assignment. */
export function effectiveWorkIntervals(
  assignment:WorkAssignment
):{start:number;end:number}[]{
  const start=clockMinutes(assignment.start),end=clockMinutes(assignment.end);
  if(!assignment.mealBreak)return [{start,end}];
  return [
    {start,end:clockMinutes(assignment.mealBreak.start)},
    {start:clockMinutes(assignment.mealBreak.end),end},
  ];
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
  return effectiveWorkIntervals(assignment).every(work=>
    day.intervals.some(interval=>
      work.start>=clockMinutes(interval.start) &&
      work.end<=clockMinutes(interval.end)
    )
  );
}
