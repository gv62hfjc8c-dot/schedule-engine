import {civilDayOfWeek} from "./schedulePeriods";
import {WEEKDAYS,type WeeklyOpeningHours} from "./operatingHours";
import {
  assignmentMinutes,clockMinutes,effectiveWorkIntervals,
  type WorkAssignment,
} from "./workAssignments";

export interface TimelineInterval {start:number;end:number}
export interface TimelineShift {
  assignment:WorkAssignment;
  start:number;
  end:number;
  meals:TimelineInterval[];
}
export interface TimelineMember {
  memberId:string;
  shifts:TimelineShift[];
  /** Effective minutes as recorded in the assignments (meals excluded). */
  workMinutes:number;
}
export interface TimelineCoverage extends TimelineInterval {
  count:number;
}
export interface DailyTimeline {
  date:string;
  /** "missing" is NOT the same as a day when the company is closed. */
  openingStatus:"loaded"|"missing"|"closed";
  bounds:TimelineInterval|null;
  opening:TimelineInterval[];
  ticks:number[];
  members:TimelineMember[];
  coverage:TimelineCoverage[];
  openingMinutes:number;
  scheduledMinutes:number;
  workingMembers:number;
  uncoveredMinutes:number;
  peakConcurrent:number;
}

export interface LegacyTimelineMeal {
  memberId:string;date:string;start:string;end:string;
}

export function minuteLabel(minutes:number):string {
  return String(Math.floor(minutes/60)).padStart(2,"0")+":"+
    String(minutes%60).padStart(2,"0");
}

/** Single wall-clock scale from the first opening to the last closing. */
export function dailyTimelineTicks(start:number,end:number):number[] {
  if(!(end>start))return [];
  const duration=end-start;
  const step=duration>900?180:duration>540?120:duration>240?60:30;
  const ticks=[start];
  for(let minute=Math.ceil((start+1)/step)*step;minute<end;minute+=step){
    if(minute-start>=Math.min(40,step/2) &&
       end-minute>=Math.min(40,step/2))
      ticks.push(minute);
  }
  ticks.push(end);
  return ticks;
}

/** A read-only day projection. No turn is created, moved or split here. */
export function buildDailyTimeline(
  date:string,
  assignments:readonly WorkAssignment[],
  activeMemberIds:readonly string[],
  openingHours:WeeklyOpeningHours|null,
  legacyMeals:readonly LegacyTimelineMeal[]=[],
):DailyTimeline {
  const weekday=WEEKDAYS[civilDayOfWeek(date)].id;
  const configured=openingHours?.days.find(day=>day.day===weekday);
  const opening=(configured?.intervals??[]).map(interval=>({
    start:clockMinutes(interval.start),end:clockMinutes(interval.end),
  }));
  const openingStatus:DailyTimeline["openingStatus"]=!configured
    ?"missing":opening.length===0?"closed":"loaded";
  const bounds=opening.length>0
    ?{start:opening[0].start,end:opening[opening.length-1].end}
    :null;
  const work=assignments.filter(shift=>shift.date===date);
  const meals=legacyMeals.filter(meal=>meal.date===date);
  const ids=new Set<string>(activeMemberIds.map(id=>id.toLowerCase()));
  for(const shift of work)ids.add(shift.memberId.toLowerCase());
  for(const meal of meals)ids.add(meal.memberId.toLowerCase());
  const members:TimelineMember[]=[...ids].map(memberId=>{
    const shifts=work.filter(shift=>shift.memberId.toLowerCase()===memberId)
      .map(assignment=>({
        assignment,start:clockMinutes(assignment.start),
        end:clockMinutes(assignment.end),
        meals:assignment.mealBreak?[{
          start:clockMinutes(assignment.mealBreak.start),
          end:clockMinutes(assignment.mealBreak.end),
        }]:[],
      })).sort((a,b)=>a.start-b.start||a.end-b.end);
    const workMinutes=shifts.reduce((sum,shift)=>
      sum+assignmentMinutes(shift.assignment),0);
    return {memberId,shifts,workMinutes};
  });

  const scheduledMinutes=members.reduce((sum,row)=>sum+row.workMinutes,0);
  const workingMembers=members.filter(row=>row.shifts.length>0).length;
  const intervalsByMember=new Map<string,TimelineInterval[]>();
  for(const row of members){
    const legacy=meals.filter(m=>m.memberId.toLowerCase()===row.memberId)
      .map(m=>({start:clockMinutes(m.start),end:clockMinutes(m.end)}));
    const workIntervals=row.shifts.flatMap(s=>
      effectiveWorkIntervals(s.assignment));
    // In historical drafts, pauses were separate records. Count those
    // minutes as not working even if the historical input has a conflict.
    const effective=workIntervals.flatMap(workInterval=>{
      const boundaries=[workInterval.start,workInterval.end];
      for(const pause of legacy){
        if(pause.end>workInterval.start&&pause.start<workInterval.end)
          boundaries.push(
            Math.max(workInterval.start,pause.start),
            Math.min(workInterval.end,pause.end),
          );
      }
      const sorted=[...new Set(boundaries)].sort((a,b)=>a-b);
      const result:TimelineInterval[]=[];
      for(let i=0;i<sorted.length-1;i++){
        const start=sorted[i],end=sorted[i+1];
        if(end>start && !legacy.some(m=>m.start<end&&m.end>start))
          result.push({start,end});
      }
      return result;
    });
    intervalsByMember.set(row.memberId,effective);
  }

  const coverage:TimelineCoverage[]=[];
  let uncoveredMinutes=0,peakConcurrent=0;
  for(const window of opening){
    const boundaries=new Set([window.start,window.end]);
    for(const intervals of intervalsByMember.values()){
      for(const interval of intervals){
        if(interval.end<=window.start||interval.start>=window.end)continue;
        boundaries.add(Math.max(window.start,interval.start));
        boundaries.add(Math.min(window.end,interval.end));
      }
    }
    const sorted=[...boundaries].sort((a,b)=>a-b);
    for(let i=0;i<sorted.length-1;i++){
      const start=sorted[i],end=sorted[i+1];
      if(end<=start)continue;
      const count=[...intervalsByMember.values()].filter(intervals=>
        intervals.some(value=>value.start<end&&value.end>start)).length;
      const previous=coverage[coverage.length-1];
      if(previous && previous.end===start && previous.count===count &&
         // Never merge across a closure even when two windows touch.
         previous.end>window.start){
        previous.end=end;
      }else coverage.push({start,end,count});
      peakConcurrent=Math.max(peakConcurrent,count);
      if(count===0)uncoveredMinutes+=end-start;
    }
  }

  return {
    date,openingStatus,bounds,opening,ticks:bounds
      ?dailyTimelineTicks(bounds.start,bounds.end):[],
    members,coverage,openingMinutes:opening.reduce((sum,interval)=>
      sum+interval.end-interval.start,0),
    scheduledMinutes,workingMembers,uncoveredMinutes,peakConcurrent,
  };
}

/** Constrain painted bars to the opening-derived axis; do not change data. */
export function timelinePosition(
  interval:TimelineInterval,bounds:TimelineInterval,
):{left:number;width:number}|null {
  const start=Math.max(bounds.start,interval.start);
  const end=Math.min(bounds.end,interval.end);
  if(end<=start)return null;
  const scale=100/(bounds.end-bounds.start);
  return {left:(start-bounds.start)*scale,width:(end-start)*scale};
}
