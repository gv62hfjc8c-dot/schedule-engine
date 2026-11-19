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

/** Soft preference for candidate shift starts, not a certification rule. */
export type StartSpacingMinutes=30|60;
export const DEFAULT_START_SPACING_MINUTES:StartSpacingMinutes=30;
export interface GenerationPreferences {
  /** Candidate starts favor actual clock boundaries (:00/:30 or :00). */
  startSpacingMinutes?:StartSpacingMinutes;
}
export type GenerationInput=Omit<CertificationInput,"candidateAssignments"> & {
  preferences?:GenerationPreferences;
};

/** Treat malformed runtime preferences as an input error, never silently ignore. */
function resolveSpacing(preferences:unknown):StartSpacingMinutes|null {
  if(preferences===undefined)return DEFAULT_START_SPACING_MINUTES;
  if(!preferences||typeof preferences!=="object"||Array.isArray(preferences))
    return null;
  const value=(preferences as {startSpacingMinutes?:unknown}).startSpacingMinutes;
  if(value===undefined)return DEFAULT_START_SPACING_MINUTES;
  return value===30||value===60?value:null;
}
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
 * Deterministic, fair candidate start rotation on a configurable grid.
 * The grid is a SOFT preference: it is not checked by the certifier, never
 * requires minimum staffing, and never moves work outside opening hours.
 *
 * Use at most one position per active colleague when few people are present,
 * spread these positions across the entire feasible span (2 staff continue
 * to open/close). For larger teams share aligned positions instead of
 * fabricating 09:15, 09:17 etc. Irregular opening intervals use the actual
 * clock grid, not elapsed open minutes, and permit a fallback if unavoidable. Each person's position rotates by civil
 * date; on a five-day 09:00-19:00 week with five 30-minute positions every
 * person visits each position exactly once regardless of team size.
 *
 * The reference date is global, not a month/week boundary: the sequence does
 * not restart just because a new calendar month is generated.
 */
function suggestedStartOffset(
  plan:DayPlan,memberIndex:number,activeCount:number,
  startSpacingMinutes:StartSpacingMinutes
):number {
  if(activeCount<2 || plan.allocated===0)return 0;
  // Actual clock grid (:00/:30 or :00), not simply "minutes of opening
  // capacity": a split interval of 09:00-09:45 + 10:00-18:15 must not
  // produce a shift starting at 10:15 from a 60-minute offset.
  const remainingCapacity=plan.capacity-plan.allocated;
  const feasibleOffsets:number[]=[];
  let precedingOpenMinutes=0;
  for(const interval of plan.intervals){
    const first=Math.ceil(interval.start/startSpacingMinutes)*startSpacingMinutes;
    for(let start=first;start<interval.end;start+=startSpacingMinutes){
      const offset=precedingOpenMinutes+start-interval.start;
      if(offset<=remainingCapacity)feasibleOffsets.push(offset);
    }
    precedingOpenMinutes+=interval.end-interval.start;
  }
  // A start that is not grid-aligned is a last-resort soft fallback when the
  // business has no aligned, feasible start at all. It remains certifiable.
  if(feasibleOffsets.length===0)return 0;
  const usedSlots=Math.min(activeCount,feasibleOffsets.length);
  if(usedSlots<2)return feasibleOffsets[0];
  const dayIndex=daysBetween("1970-01-01",plan.date);
  const position=((dayIndex+memberIndex)%usedSlots+usedSlots)%usedSlots;
  const alignedIndex=Math.round(
    position*(feasibleOffsets.length-1)/(usedSlots-1)
  );
  return feasibleOffsets[alignedIndex];
}

function toAssignments(
  memberId:string,plan:DayPlan,memberIndex:number,activeCount:number,
  startSpacingMinutes:StartSpacingMinutes
):WorkAssignment[] {
  let minutesLeft=plan.allocated;
  let skip=suggestedStartOffset(
    plan,memberIndex,activeCount,startSpacingMinutes
  );
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

  const startSpacingMinutes=resolveSpacing(input.preferences);
  if(startSpacingMinutes===null){
    return {
      status:"invalid_input",candidateAssignments:[],shortfalls:[],
      certification:{
        ...emptyCertification,status:"invalid",
        issues:[...emptyCertification.issues,{
          code:"INVALID_GENERATION_PREFERENCE",
          message:"O intervalo de entradas deve ser 30 ou 60 minutos.",
        }],
      },
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
        member.id,plan,memberIndex,activeMembers.length,startSpacingMinutes));
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
