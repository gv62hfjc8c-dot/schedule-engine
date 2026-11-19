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
 * Distribute required weekly minutes across the ACTUAL open days, regardless
 * of their weekday. The optimization is intentionally independent of staffing
 * coverage: an open day is eligible, not an obligation to supply any number
 * of colleagues. The same weekly load planning applies to every active person.
 *
 * Prefer using feasible open days and making full use of shorter windows
 * before spreading the remaining hours over longer, comparable days.
 * Repeated daily durations and avoiding tiny leftover shifts are softer
 * trade-offs; none of these preferences forces staffing coverage.
 *
 * Example: when a company has five 10h days plus a 4h day, that short
 * day may be assigned all 4h (no stagger) and the remaining 36h may be
 * allocated across the five longer days, without exceeding 40h.
 */
function allocateBalancedWeek(plans:DayPlan[],targetMinutes:number):void {
  const open=plans.filter(plan=>plan.capacity>0);
  if(targetMinutes<=0 || open.length===0)return;
  const totalCapacity=open.reduce((sum,plan)=>sum+plan.capacity,0);
  if(targetMinutes>=totalCapacity){
    for(const plan of open)plan.allocated=plan.capacity;
    return;
  }

  // The normal target is a full weekly 40h or the verified remaining hours
  // after immutable context. With very few remaining minutes, some open dates
  // may legitimately have no assignment.
  const minimums=open.map(plan=>Math.min(30,plan.capacity));
  const canUseEveryDay=targetMinutes>=minimums.reduce((a,b)=>a+b,0);
  const maximumCapacity=Math.max(...open.map(plan=>plan.capacity));
  const baselines=new Set<number>([0,maximumCapacity]);
  for(let minutes=30;minutes<=maximumCapacity;minutes+=30)
    baselines.add(minutes);

  type Candidate={
    allocations:number[];
    activeDays:number;
    consistency:number;
    shortWindowMinutes:number;
    smallestShift:number;
    targetDistance:number;
  };
  // Prefer clarity over a deeply nested quality comparator.
  function isBetter(next:Candidate,previous:Candidate):boolean {
    if(next.activeDays!==previous.activeDays)
      return next.activeDays>previous.activeDays;
    if(next.shortWindowMinutes!==previous.shortWindowMinutes)
      return next.shortWindowMinutes>previous.shortWindowMinutes;
    if(next.consistency!==previous.consistency)
      return next.consistency>previous.consistency;
    if(next.smallestShift!==previous.smallestShift)
      return next.smallestShift>previous.smallestShift;
    return next.targetDistance<previous.targetDistance;
  }
  let best:Candidate|null=null;
  for(const baseline of baselines){
    const allocations=open.map(plan=>Math.min(plan.capacity,baseline));
    let delta=targetMinutes-allocations.reduce((a,b)=>a+b,0);

    if(delta>0){
      // Concentrate unavoidable differences in as few workdays as possible.
      // Stable sort keeps the choice deterministic when capacities match.
      const order=open.map((plan,i)=>({i,capacity:plan.capacity}))
        .sort((a,b)=>(b.capacity-allocations[b.i])-
          (a.capacity-allocations[a.i]) || b.i-a.i);
      for(const {i,capacity} of order){
        const extra=Math.min(delta,capacity-allocations[i]);
        allocations[i]+=extra;
        delta-=extra;
        if(delta===0)break;
      }
    }else if(delta<0){
      let excess=-delta;
      const order=open.map((plan,i)=>({i,capacity:plan.capacity}))
        // Spare the shorter windows where feasible: when a day only opens
        // four hours, giving it the full four is more useful than carving
        // it into an unnecessary partial shift. Long windows can absorb
        // the unavoidable reduction.
        .sort((a,b)=>b.capacity-a.capacity || b.i-a.i);
      for(const {i} of order){
        const reserve=canUseEveryDay?minimums[i]:0;
        const reduction=Math.min(excess,allocations[i]-reserve);
        allocations[i]-=reduction;
        excess-=reduction;
        if(excess===0)break;
      }
      // When the target cannot support a shift on every open day, zero is
      // allowed: the engine must not invent work or minimum staffing.
      if(excess>0){
        for(const {i} of order){
          const reduction=Math.min(excess,allocations[i]);
          allocations[i]-=reduction;
          excess-=reduction;
          if(excess===0)break;
        }
      }
      delta=excess===0?0:-excess;
    }
    if(delta!==0)continue;

    const activeDays=allocations.filter(minutes=>minutes>0).length;
    // Repeated work duration is the measure of stable shifts for comparable
    // days; no preference is hard-coded for Saturday or Sunday.
    const capacityGroups=new Map<number,Map<number,number>>();
    for(let i=0;i<open.length;i++){
      const durations=capacityGroups.get(open[i].capacity)??new Map<number,number>();
      durations.set(allocations[i],(durations.get(allocations[i])??0)+1);
      capacityGroups.set(open[i].capacity,durations);
    }
    const consistency=[...capacityGroups.values()].reduce((sum,counts)=>
      sum+Math.max(...counts.values()),0);
    // Generic relative capacity: no weekday names and no fixed 4h cutoff.
    // Preferring full utilization of shorter windows remains a SOFT score.
    const shortWindowMinutes=allocations.reduce((sum,minutes,i)=>
      sum+(open[i].capacity<maximumCapacity?minutes:0),0);
    const smallestShift=Math.min(...allocations.filter(minutes=>minutes>0));
    // Tie-breaker: avoid extreme daily lengths when several equally stable
    // plans exist. 8h remains only a quality objective, not a daily cap.
    const targetDistance=allocations.reduce((sum,minutes,i)=>
      sum+Math.abs(minutes-Math.min(480,open[i].capacity)),0);
    const candidate={
      allocations,activeDays,shortWindowMinutes,consistency,
      smallestShift,targetDistance,
    };
    if(!best || isBetter(candidate,best))best=candidate;
  }
  if(!best)throw new Error("A carga semanal não pôde ser distribuída.");
  for(let i=0;i<open.length;i++)open[i].allocated=best.allocations[i];
}

/**
 * Choose EXACTLY the requested number of working dates, where the number of
 * non-working calendar dates is configured per person. This is a weekly HARD
 * constraint, independent of the SOFT time distribution and without assigning
 * official "Folga" labels to otherwise empty calendar dates.
 *
 * Up to seven eligible dates means the entire power set is small (<=128).
 * Compare viable subsets, preferring full use of shorter opening windows and
 * stable repeated shifts. No weekday is pinned and no coverage is required.
 */
function allocateConfiguredDays(
  plans:DayPlan[],targetMinutes:number,editableWorkdays:number
):void {
  const open=plans.filter(plan=>plan.capacity>0);
  if(targetMinutes<=0 || editableWorkdays<=0)return;

  const slots=Math.min(editableWorkdays,open.length);
  const maximumCapacity=Math.max(...open.map(plan=>plan.capacity),0);
  interface Option {
    days:DayPlan[];
    shortUse:number;
    consistency:number;
    minShift:number;
    distance:number;
  }
  let best:Option|null=null;
  const choose=(start:number,selected:DayPlan[]):void=>{
    if(selected.length===slots){
      const totalCapacity=selected.reduce((sum,plan)=>sum+plan.capacity,0);
      if(totalCapacity<targetMinutes)return;
      const candidate=selected.map(plan=>({...plan,allocated:0}));
      allocateBalancedWeek(candidate,targetMinutes);
      if(candidate.some(plan=>plan.allocated===0) ||
        candidate.reduce((sum,plan)=>sum+plan.allocated,0)!==targetMinutes)return;

      const shortUse=candidate.reduce((sum,plan)=>
        sum+(plan.capacity<maximumCapacity?plan.allocated:0),0);
      const groups=new Map<number,Map<number,number>>();
      for(const plan of candidate){
        const count=groups.get(plan.capacity)??new Map<number,number>();
        count.set(plan.allocated,(count.get(plan.allocated)??0)+1);
        groups.set(plan.capacity,count);
      }
      const consistency=[...groups.values()].reduce((sum,counts)=>
        sum+Math.max(...counts.values()),0);
      const minShift=Math.min(...candidate.map(plan=>plan.allocated));
      const distance=candidate.reduce((sum,plan)=>
        sum+Math.abs(plan.allocated-Math.min(480,plan.capacity)),0);
      const next={days:candidate,shortUse,consistency,minShift,distance};
      if(!best || next.shortUse>best.shortUse ||
        (next.shortUse===best.shortUse && (
          next.consistency>best.consistency ||
          (next.consistency===best.consistency && (
            next.minShift>best.minShift ||
            (next.minShift===best.minShift && next.distance<best.distance)
          ))
        )))best=next;
      return;
    }
    for(let i=start;i<=open.length-(slots-selected.length);i++)
      choose(i+1,[...selected,open[i]]);
  };
  if(slots>0)choose(0,[]);

  // The recursive chooser updates best through a closure; make this
  // mutation explicit to TypeScript's control-flow analysis.
  const winner=best as Option|null;
  if(winner){
    for(const plan of winner.days){
      const matching=plans.find(p=>p.date===plan.date);
      if(matching)matching.allocated=plan.allocated;
    }
    return;
  }

  // Infeasible conditions are NOT fixed by silently adding extra workdays
  // or fabricating closed hours. Produce a bounded proposal; the independent
  // certifier will report the violated hard constraint(s).
  const fallback=[...open].sort((a,b)=>
    b.capacity-a.capacity || a.date.localeCompare(b.date)).slice(0,slots);
  allocateBalancedWeek(fallback,targetMinutes);
}

/**
 * Preserve the legacy conservative allocation on incomplete month-boundary
 * weeks. Unknown neighboring dates must never be assumed free or filled in.
 * When the whole week is known, optimize ALL its editable open days together.
 */
function allocateWeek(plans:DayPlan[],targetMinutes:number,
  externalComplete:boolean):void {
  if(externalComplete){
    allocateBalancedWeek(plans,targetMinutes);
    return;
  }
  let remaining=targetMinutes;
  for(const plan of plans){
    const slice=Math.min(remaining,480,plan.capacity);
    plan.allocated+=slice;
    remaining-=slice;
  }
}

/**
 * Candidate start selection is a SOFT optimization, not a hard rule or
 * setting exposed to the user. Prefer whole-hour starts if there are enough
 * distinct feasible positions for the active team; otherwise include half
 * hours. Multiple colleagues may share the same start time.
 *
 * Derive positions from the *actual wall-clock* within opening windows,
 * including split openings; capacity counts effective work only. Keep the
 * same preferred start within each Monday-Sunday week and rotate positions
 * between consecutive civil weeks, without resetting at month boundaries.
 * Different daily capacities may still require different starts to preserve
 * the mandatory weekly hours and opening constraints.
 */
function feasibleStartOffsets(plan:DayPlan,spacingMinutes:30|60):number[] {
  const remainingCapacity=plan.capacity-plan.allocated;
  const offsets:number[]=[];
  let precedingOpenMinutes=0;
  for(const interval of plan.intervals){
    const first=Math.ceil(interval.start/spacingMinutes)*spacingMinutes;
    for(let start=first;start<interval.end;start+=spacingMinutes){
      const offset=precedingOpenMinutes+start-interval.start;
      if(offset<=remainingCapacity)offsets.push(offset);
    }
    precedingOpenMinutes+=interval.end-interval.start;
  }
  return offsets;
}

function suggestedStartOffset(
  plan:DayPlan,memberIndex:number,activeCount:number
):number {
  if(activeCount<2 || plan.allocated===0)return 0;
  const fullHours=feasibleStartOffsets(plan,60);
  const feasibleOffsets=fullHours.length>=activeCount
    ? fullHours:feasibleStartOffsets(plan,30);
  // Validity prevails when even a half-hour position is impossible.
  if(feasibleOffsets.length===0)return 0;
  const usedSlots=Math.min(activeCount,feasibleOffsets.length);
  if(usedSlots<2)return feasibleOffsets[0];
  // Monday 1970-01-05 anchors the rotation to civil weeks, not days.
  // Floor works for dates before 1970 and ensures all seven days in the
  // same week get the same preferred slot, even across two civil months.
  const weekIndex=Math.floor(daysBetween("1970-01-05",plan.date)/7);
  const position=((weekIndex+memberIndex)%usedSlots+usedSlots)%usedSlots;
  const alignedIndex=Math.round(
    position*(feasibleOffsets.length-1)/(usedSlots-1)
  );
  return feasibleOffsets[alignedIndex];
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
      if(member.weeklyDaysOff!==undefined && contextComplete){
        const knownWorkedDates=new Set(externalAssignments
          .filter(entry=>entry.memberId.toLowerCase()===member.id &&
            inRange(entry.date,week)).map(entry=>entry.date));
        const editableWorkdays=7-member.weeklyDaysOff-knownWorkedDates.size;
        allocateConfiguredDays(plans,target,editableWorkdays);
      }else{
        allocateWeek(plans,target,contextComplete);
      }
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
