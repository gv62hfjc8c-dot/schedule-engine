import {
  certifySchedule,type CertificationInput,type CertificationReport,
  type CertificationIssueCode,
} from "./certifySchedule";
import {validateTeamRoster} from "./team";
import {WEEKDAYS,validateWeeklyOpeningHours} from "./operatingHours";
import {
  civilDayOfWeek,daysBetween,enumerateCivilDays,inRange,type DateRange,
} from "./schedulePeriods";
import {
  assignmentMinutes,clockMinutes,validateWorkAssignment,
  type WorkAssignment,
} from "./workAssignments";
import {REQUIRED_WEEKLY_MINUTES} from "./weeklyHours";

export type GenerationInput=Omit<CertificationInput,"candidateAssignments">;
export interface GenerationShortfall {
  memberId:string;
  weekStart:string;
  /** Hours already assigned in read-only dates of this week. */
  externalMinutes:number;
  /** Work minutes that this generator could place in the editable dates. */
  generatedMinutes:number;
  /** A positive deficit is proven only when external data is complete. */
  missingMinutes:number;
  contextComplete:boolean;
}
export interface GenerationResult {
  /** Never saved automatically. Even an invalid result can contain a proposal. */
  candidateAssignments:WorkAssignment[];
  certification:CertificationReport;
  /** "invalid_input" means the generator refused to plan from corrupt input. */
  status:"valid"|"invalid"|"insufficient_context"|"invalid_input";
  shortfalls:GenerationShortfall[];
}

const FATAL_INPUT_CODES=new Set<CertificationIssueCode>([
  "INVALID_PERIOD","INVALID_TEAM","NO_ACTIVE_MEMBERS",
  "INVALID_OPENING_HOURS","INVALID_ASSIGNMENT","UNKNOWN_MEMBER",
  "INACTIVE_MEMBER","OUTSIDE_EDITABLE_PERIOD","OUTSIDE_CONTEXT_RANGE",
  "CONTEXT_IN_EDITABLE_PERIOD","INVALID_CONTEXT_DAY",
  "DUPLICATE_CONTEXT_DAY","OVERLAPPING_WORK","OUTSIDE_OPENING_HOURS",
]);

interface DayPlan {
  date:string;
  capacity:number;
  allocated:number;
  intervals:{start:number;end:number}[];
}

function formatClock(minutes:number):string {
  return String(Math.floor(minutes/60)).padStart(2,"0")+":"+
    String(minutes%60).padStart(2,"0");
}

function availableDays(
  week:DateRange,
  editable:DateRange,
  hours:NonNullable<ReturnType<typeof validateWeeklyOpeningHours>["value"]>,
):DayPlan[] {
  return enumerateCivilDays(week)
    .filter(date=>inRange(date,editable))
    .map(date=>{
      const day=hours.days[ civilDayOfWeek(date) ];
      if(day.day!==WEEKDAYS[civilDayOfWeek(date)].id)
        throw new Error("Funcionamento semanal desordenado.");
      const intervals=day.intervals.map(interval=>({
        start:clockMinutes(interval.start),end:clockMinutes(interval.end),
      }));
      return {
        date,intervals,capacity:intervals.reduce((sum,x)=>sum+x.end-x.start,0),
        allocated:0,
      };
    });
}

/**
 * Deterministic baseline: first prefer up to 8 hours per open day, from
 * Monday onwards. If all external dates of the week are known, spread
 * necessary excess capacity in one-hour rounds over the same days.
 *
 * Eight hours is a planning heuristic, NOT a hard daily limit: a week with
 * four 10-hour business days can still receive four 10-hour assignments.
 * Other rules (daily rest, legal breaks, etc.) are NOT implemented here.
 */
function allocateWeek(plans:DayPlan[],targetMinutes:number,
  externalComplete:boolean):void {
  let remaining=targetMinutes;
  for(const plan of plans){
    const slice=Math.min(remaining,480,plan.capacity);
    plan.allocated+=slice;
    remaining-=slice;
  }
  if(!externalComplete)return; // Do not consume unknown next/previous-month hours.
  while(remaining>0){
    let progress=0;
    for(const plan of plans){
      const extra=Math.min(60,remaining,plan.capacity-plan.allocated);
      if(extra<=0)continue;
      plan.allocated+=extra;
      progress+=extra;
      remaining-=extra;
      if(remaining===0)break;
    }
    if(progress===0)break;
  }
}

/**
 * A non-mandatory spacing preference between active colleagues.
 * When an opening window is longer than the allocated work, rotate the
 * available start positions over consecutive civil days. This changes neither
 * the allocated minutes nor any hard constraint and never imposes coverage.
 *
 * Civil-day rotation (rather than resetting every Monday or month) avoids
 * systematically giving the same employee the opening shift.
 */
function suggestedStartOffset(plan:DayPlan,memberIndex:number,activeCount:number):number {
  if(activeCount<2 || plan.allocated===0)return 0;
  const spare=plan.capacity-plan.allocated;
  if(spare<=0)return 0; // e.g. four 10-hour working days.
  const dayIndex=daysBetween("1970-01-01",plan.date);
  const slot=((dayIndex+memberIndex)%activeCount+activeCount)%activeCount;
  return Math.round(spare*slot/(activeCount-1));
}

function toAssignments(
  memberId:string,plan:DayPlan,memberIndex:number,activeCount:number
):WorkAssignment[] {
  let minutesLeft=plan.allocated;
  let skip=suggestedStartOffset(plan,memberIndex,activeCount);
  const assignments:WorkAssignment[]=[];
  for(const interval of plan.intervals){
    if(minutesLeft===0)break;
    const length=interval.end-interval.start;
    if(skip>=length){
      skip-=length;
      continue;
    }
    const start=interval.start+skip;
    skip=0;
    const amount=Math.min(minutesLeft,interval.end-start);
    if(amount<=0)continue;
    assignments.push({
      memberId,date:plan.date,
      start:formatClock(start),
      end:formatClock(start+amount),
    });
    minutesLeft-=amount;
  }
  if(minutesLeft!==0)throw new Error("A geração excedeu a capacidade do dia.");
  return assignments;
}

/**
 * Pure first-pass generator. Builds only the selected editable period, never
 * writes to storage, and ALWAYS runs the independent certifier afterward.
 *
 * External dates are read-only irrespective of their saved/approved state.
 * A day without external data is UNKNOWN, not implicitly free or a rest day.
 * Candidate assignments must be treated as a proposal until certification.
 */
export function generateSchedule(input:GenerationInput):GenerationResult {
  const emptyCertification=certifySchedule({...input,candidateAssignments:[]});
  const hours=validateWeeklyOpeningHours(input.openingHours);
  const team=validateTeamRoster(input.team);
  const fatal=emptyCertification.issues.some(x=>FATAL_INPUT_CODES.has(x.code));
  if(fatal || !emptyCertification.period || !hours.valid || !team.valid){
    return {
      status:"invalid_input",candidateAssignments:[],
      certification:emptyCertification,shortfalls:[],
    };
  }

  const period=emptyCertification.period;
  const externalRaw=input.externalContext?.assignments??[];
  const externalAssignments=(externalRaw as unknown[])
    .map(validateWorkAssignment)
    .filter((x):x is WorkAssignment=>x!==null);
  const completeDates=new Set(input.externalContext?.completeDates as string[]|undefined??[]);
  const candidates:WorkAssignment[]=[];
  const shortfalls:GenerationShortfall[]=[];

  const activeMembers=team.value.members.filter(member=>member.active);
  for(const week of period.weeks){
    const unknownExternalDays=enumerateCivilDays(week)
      .filter(date=>!inRange(date,period) && !completeDates.has(date));
    const contextComplete=unknownExternalDays.length===0;
    for(const [memberIndex,member] of activeMembers.entries()){
      const externalMinutes=externalAssignments.reduce((sum,entry)=>
        entry.memberId.toLowerCase()===member.id && inRange(entry.date,week)
          ? sum+assignmentMinutes(entry):sum,0);
      const target=Math.max(0,REQUIRED_WEEKLY_MINUTES-externalMinutes);
      const plans=availableDays(week,period,hours.value);
      allocateWeek(plans,target,contextComplete);
      const generatedMinutes=plans.reduce((sum,plan)=>sum+plan.allocated,0);
      for(const plan of plans)candidates.push(...toAssignments(
        member.id,plan,memberIndex,activeMembers.length));
      if(contextComplete && generatedMinutes+externalMinutes<REQUIRED_WEEKLY_MINUTES){
        shortfalls.push({
          memberId:member.id,weekStart:week.start,
          externalMinutes,generatedMinutes,
          missingMinutes:Math.max(0,REQUIRED_WEEKLY_MINUTES-
            generatedMinutes-externalMinutes),
          contextComplete,
        });
      }
    }
  }
  candidates.sort((a,b)=>a.date.localeCompare(b.date) ||
    a.memberId.localeCompare(b.memberId) || a.start.localeCompare(b.start));
  const certification=certifySchedule({...input,candidateAssignments:candidates});
  return {
    status:certification.status,
    candidateAssignments:candidates,
    certification,shortfalls,
  };
}
