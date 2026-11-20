import {addCivilDays,enumerateCivilDays,parseCivilDate} from "./schedulePeriods";
import {
  assignmentMinutes,assignmentsOverlap,validateWorkAssignment,
  type WorkAssignment,
} from "./workAssignments";
import {REQUIRED_WEEKLY_MINUTES} from "./weeklyHours";

/**
 * Rolling 28-day hours is an informational balancing target, NOT an approved
 * time-bank, a payroll debt or a replacement for legal hard constraints.
 *
 * A window ends on any civil date and includes that date and its 27
 * predecessors. It has no anchor or fixed starting weekday.
 */
export interface Rolling28DayInput {
  memberId:string;
  throughDate:string;
  assignments:unknown;
  /** Explicitly known days, including known days with no shift. */
  completeDates:unknown;
  /** Defaults to the current 40h/week reference; future contracts may vary. */
  weeklyTargetMinutes?:number;
}

export interface Rolling28DayReport {
  status:"complete"|"insufficient_context"|"invalid_input";
  start:string|null;
  endInclusive:string|null;
  endExclusive:string|null;
  targetMinutes:number|null;
  /** Null unless every one of the 28 days is explicitly known. */
  actualMinutes:number|null;
  differenceMinutes:number|null;
  averageWeeklyMinutes:number|null;
  /** Number of unique dates with work in the window, when complete. */
  workingDays:number|null;
  missingDates:string[];
}

function invalid():Rolling28DayReport {
  return {
    status:"invalid_input",start:null,endInclusive:null,endExclusive:null,
    targetMinutes:null,actualMinutes:null,differenceMinutes:null,
    averageWeeklyMinutes:null,workingDays:null,missingDates:[],
  };
}

export function calculateRolling28Day(input:Rolling28DayInput):Rolling28DayReport {
  if(!input||typeof input.memberId!=="string"||!input.memberId.trim()||
     !Array.isArray(input.assignments)||!Array.isArray(input.completeDates))
    return invalid();

  const weeklyTarget=input.weeklyTargetMinutes??REQUIRED_WEEKLY_MINUTES;
  if(!Number.isSafeInteger(weeklyTarget)||weeklyTarget<0||
     weeklyTarget>7*24*60)
    return invalid();

  let start:string,endExclusive:string,days:string[];
  try {
    parseCivilDate(input.throughDate);
    start=addCivilDays(input.throughDate,-27);
    endExclusive=addCivilDays(input.throughDate,1);
    days=enumerateCivilDays({start,endExclusive});
  }catch {return invalid();}

  const complete=new Set<string>();
  for(const day of input.completeDates){
    if(typeof day!=="string")return invalid();
    try {parseCivilDate(day);} catch{return invalid();}
    // The caller may pass complete dates for other months. Ignore them.
    if(day>=start&&day<endExclusive){
      if(complete.has(day))return invalid();
      complete.add(day);
    }
  }

  const memberId=input.memberId.toLowerCase();
  const observed:WorkAssignment[]=[];
  const workedDays=new Set<string>();
  let observedMinutes=0;
  for(const raw of input.assignments){
    const assignment=validateWorkAssignment(raw);
    if(!assignment)return invalid();
    if(assignment.memberId.toLowerCase()!==memberId||
       assignment.date<start||assignment.date>=endExclusive)continue;
    const normalized={...assignment,memberId};
    if(observed.some(other=>assignmentsOverlap(other,normalized)))
      return invalid(); // An overlap must not inflate working time.
    observed.push(normalized);
    observedMinutes+=assignmentMinutes(normalized);
    workedDays.add(normalized.date);
  }

  const missingDates=days.filter(date=>!complete.has(date));
  const targetMinutes=weeklyTarget*4;
  if(missingDates.length>0){
    return {
      status:"insufficient_context",start,endInclusive:input.throughDate,
      endExclusive,targetMinutes,actualMinutes:null,differenceMinutes:null,
      averageWeeklyMinutes:null,workingDays:null,missingDates,
    };
  }
  return {
    status:"complete",start,endInclusive:input.throughDate,endExclusive,
    targetMinutes,actualMinutes:observedMinutes,
    differenceMinutes:observedMinutes-targetMinutes,
    averageWeeklyMinutes:observedMinutes/4,
    workingDays:workedDays.size,missingDates:[],
  };
}
