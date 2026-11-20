import {assignmentMinutes,type WorkAssignment} from "./workAssignments";

/** A calendar view is a projection only: never edit the candidate or saved proposal. */
export function calendarScheduleView(
  assignments:readonly WorkAssignment[],
  selectedMemberId:string|null,
){
  const visible=selectedMemberId===null
    ?assignments:[...assignments].filter(a=>a.memberId===selectedMemberId);
  const byDay=new Map<string,WorkAssignment[]>();
  let totalMinutes=0;
  for(const assignment of visible){
    const existing=byDay.get(assignment.date)??[];
    existing.push(assignment);
    byDay.set(assignment.date,existing);
    totalMinutes+=assignmentMinutes(assignment);
  }
  return {
    byDay,
    totalMinutes,
    workingDays:byDay.size,
    assignments:visible,
  };
}
