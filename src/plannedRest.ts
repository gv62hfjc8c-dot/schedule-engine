import {
  addCivilDays,civilDayOfWeek,inRange,parseCivilDate,
  resolvePlanningPeriod,
} from "./schedulePeriods";
import type {WorkAssignment} from "./workAssignments";
import type {WeekendRotationResult} from "./weekendRotation";

/**
 * Explicit rest decisions made at generation time. Unlike the mere absence
 * of a shift, these may be labelled as planned rest, but NEVER as paid leave.
 * Records belong to full civil weeks inside this one editable month.
 */
export interface PlannedRestWeekMember {
  memberId:string;
  weekStart:string;
  daysWithoutWork:string[];
  fullWeekendOff:boolean;
}
const UUID_V4=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function restRecordsFromRotation(
  rotation:WeekendRotationResult,
):PlannedRestWeekMember[] {
  return rotation.weeks.flatMap(week=>
    week.members.map(member=>({
      memberId:member.memberId,weekStart:week.weekStart,
      daysWithoutWork:[...member.daysWithoutWork],
      fullWeekendOff:member.fullWeekendOff,
    })));
}

/**
 * Preserve only structurally sound explicit rest records. Every planned
 * rest day must be inside the month and free of assigned work; otherwise a
 * manually edited schedule cannot silently keep obsolete 'rest' metadata.
 * The certifier still checks the team's actual rest policy independently.
 */
export function validatePlannedRest(
  input:unknown,year:number,month:number,
  assignments:readonly WorkAssignment[],
):PlannedRestWeekMember[]|null {
  if(!Array.isArray(input)||input.length>500*6)return null;
  const period=resolvePlanningPeriod({mode:"monthly",year,month});
  const occupied=new Set(assignments.map(shift=>
    shift.memberId.toLowerCase()+"|"+shift.date));
  const seen=new Set<string>();
  const records:PlannedRestWeekMember[]=[];
  for(const item of input){
    if(!item||typeof item!=="object"||Array.isArray(item))return null;
    const raw=item as Partial<PlannedRestWeekMember>;
    if(typeof raw.memberId!=="string"||!UUID_V4.test(raw.memberId)||
      typeof raw.weekStart!=="string"||
      typeof raw.fullWeekendOff!=="boolean"||
      !Array.isArray(raw.daysWithoutWork)||
      raw.daysWithoutWork.length>7)return null;
    const memberId=raw.memberId.toLowerCase();
    try{
      parseCivilDate(raw.weekStart);
      if(civilDayOfWeek(raw.weekStart)!==0||
        !inRange(raw.weekStart,period)||
        !inRange(addCivilDays(raw.weekStart,6),period))return null;
      const key=memberId+"|"+raw.weekStart;
      if(seen.has(key))return null;
      seen.add(key);
      const dates=new Set<string>();
      for(const day of raw.daysWithoutWork){
        if(typeof day!=="string")return null;
        parseCivilDate(day);
        if(day<raw.weekStart||day>=addCivilDays(raw.weekStart,7)||
          !inRange(day,period)||dates.has(day)||
          occupied.has(memberId+"|"+day))return null;
        dates.add(day);
      }
      const sat=addCivilDays(raw.weekStart,5);
      const sun=addCivilDays(raw.weekStart,6);
      const full=dates.has(sat)&&dates.has(sun);
      if(raw.fullWeekendOff!==full)return null;
      records.push({
        memberId,weekStart:raw.weekStart,
        daysWithoutWork:[...dates].sort(),
        fullWeekendOff:raw.fullWeekendOff,
      });
    }catch{return null;}
  }
  return records;
}
