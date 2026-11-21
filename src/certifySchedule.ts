import {validateTeamRoster} from "./team";
import {validateWeeklyOpeningHours} from "./operatingHours";
import {
  enumerateCivilDays,inRange,resolvePlanningPeriod,
  type DateRange,type PeriodRequest,type PlanningPeriod,
} from "./schedulePeriods";
import {
  assignmentMinutes,assignmentsOverlap,isWithinOpeningHours,
  effectiveWorkIntervals,validateWorkAssignment,type WorkAssignment,
} from "./workAssignments";
import {compareWeeklyHours,REQUIRED_WEEKLY_MINUTES} from "./weeklyHours";
import {validateMealBreak,SHORT_SHIFT_MAX_WORK_MINUTES,
  MEAL_BREAK_EARLIEST_AFTER_ENTRY_MINUTES,
  type MealBreak} from "./mealBreaks";
import {clockMinutes} from "./workAssignments";
import {shortOpeningDays} from "./shortOpenings";
import {requiredRestDayCount} from "./weekendRotation";
import {addCivilDays,civilDayOfWeek} from "./schedulePeriods";

export type CertificationStatus="valid"|"invalid"|"insufficient_context";
export type CertificationIssueCode=
  | "INVALID_PERIOD"|"INVALID_TEAM"|"NO_ACTIVE_MEMBERS"
  | "INVALID_OPENING_HOURS"|"INVALID_ASSIGNMENT"
  | "UNKNOWN_MEMBER"|"INACTIVE_MEMBER"
  | "OUTSIDE_EDITABLE_PERIOD"|"OUTSIDE_CONTEXT_RANGE"
  | "CONTEXT_IN_EDITABLE_PERIOD"|"INVALID_CONTEXT_DAY"
  | "DUPLICATE_CONTEXT_DAY"|"OVERLAPPING_WORK"
  | "OUTSIDE_OPENING_HOURS"|"WEEKLY_HOURS_MISSING"
  | "WEEKLY_HOURS_EXCESS"|"WEEKLY_DAYS_OFF_MISMATCH"|"CONTEXT_INCOMPLETE"
  | "INVALID_MEAL_BREAK"|"INVALID_MEAL_POLICY"|"MEAL_BREAK_MISSING"
  | "MEAL_BREAK_UNNECESSARY"|"MEAL_BREAK_TOO_EARLY"
  | "MEAL_BREAK_OVERLAP"|"MULTIPLE_SHIFTS_SAME_DAY"|"OPENING_UNCOVERED"
  | "SHORT_OPENING_INCOMPLETE" | "INVALID_HOURS_POLICY"
  | "FIXED_DAY_OFF_VIOLATED"|"WEEKEND_WEEKDAY_REST_MISSING"
  | "INVALID_REST_POLICY";

export interface CertificationIssue {
  code:CertificationIssueCode;
  message:string;
  memberId?:string;
  date?:string;
  weekStart?:string;
  missingDates?:string[];
  requiredMinutes?:number;
  actualMinutes?:number;
  requiredDaysOff?:number;
  actualDaysOff?:number;
  gapStart?:string;
  gapEnd?:string;
}

export interface WeeklyWorkSummary {
  memberId:string;
  weekStart:string;
  weekEndExclusive:string;
  actualMinutes:number;
  requiredMinutes:number;
  /** null until all civil dates in that week have authoritative data. */
  differenceMinutes:number|null;
  complete:boolean;
}

export interface ExternalScheduleContext {
  /**
   * Actual assignments outside the editable period, loaded read-only.
   * No approval/draft status grants write access to these dates.
   */
  assignments:unknown;
  /**
   * Explicitly known dates, including dates with zero assigned hours.
   * Absence is UNKNOWN, never interpreted as a day off.
   */
  completeDates:unknown;
}
export interface CertificationInput {
  period:PeriodRequest;
  team:unknown;
  openingHours:unknown;
  /** Entire proposed schedule within the selected period. Never a patch. */
  candidateAssignments:unknown;
  /** Explicit V1 rule for newly generated schedules; old drafts remain legacy. */
  mealBreakPolicy?:"v1"|"v2";
  /** Rolling 28 days is an optimization target, not an exact weekly debt. */
  hoursPolicy?:"rolling28";
  mealBreaks?:unknown;
  externalContext?:ExternalScheduleContext;
}
export interface CertificationReport {
  status:CertificationStatus;
  period:PlanningPeriod|null;
  issues:CertificationIssue[];
  weeks:WeeklyWorkSummary[];
}

function issue(code:CertificationIssueCode,message:string,
  extra:Omit<CertificationIssue,"code"|"message">={}):CertificationIssue {
  return {code,message,...extra};
}
function report(status:CertificationStatus,period:PlanningPeriod|null,
  issues:CertificationIssue[],weeks:WeeklyWorkSummary[]=[]):CertificationReport {
  return {status,period,issues,weeks};
}
function inValidation(date:string,period:PlanningPeriod):boolean {
  return inRange(date,period.validation);
}
function externalDatesFor(week:DateRange,period:PlanningPeriod):string[] {
  return enumerateCivilDays(week).filter(date=>!inRange(date,period));
}

/**
 * Pure independent certification. Does not generate, persist, approve, or
 * modify candidate/context assignments.
 *
 * Priority: a provable violation => invalid; otherwise missing external
 * context => insufficient_context; otherwise all hard constraints => valid.
 *
 * Legacy proposals require exactly 40h on every complete civil week.
 * The rolling28 opt-in retains structural hard constraints but treats 40h
 * per week as a balancing reference, not an obligatory exact total.
 */
export function certifySchedule(input:CertificationInput):CertificationReport {
  let period:PlanningPeriod;
  try {
    period=resolvePlanningPeriod(input.period);
  }catch {
    return report("invalid",null,[
      issue("INVALID_PERIOD","O período de planeamento é inválido."),
    ]);
  }

  const team=validateTeamRoster(input.team);
  if(!team.valid)
    return report("invalid",period,[
      issue("INVALID_TEAM","Não foi possível validar a lista de colaboradores."),
    ]);
  const active=team.value.members.filter(member=>member.active);
  if(active.length===0)
    return report("invalid",period,[
      issue("NO_ACTIVE_MEMBERS","A equipa não tem colaboradores ativos."),
    ]);
  if(active.some(member=>member.weekendRest) &&
    active.some(member=>member.weeklyDaysOff===undefined))
    return report("invalid",period,[
      issue("INVALID_REST_POLICY",
        "Para planear a rotação, configura os dias habituais de descanso de toda a equipa ativa."),
    ]);

  const hours=validateWeeklyOpeningHours(input.openingHours);
  if(!hours.valid)
    return report("invalid",period,[
      issue("INVALID_OPENING_HOURS","O funcionamento da empresa é inválido."),
    ]);

  const validatedOpeningHours=hours.value;
  const shortDays=shortOpeningDays(validatedOpeningHours);
  const problems:CertificationIssue[]=[];
  const contextProblems:CertificationIssue[]=[];
  const rawCandidate=input.candidateAssignments;
  const rawExternal=input.externalContext?.assignments??[];
  const rawDates=input.externalContext?.completeDates??[];
  const mealPolicy=input.mealBreakPolicy;
  if(input.hoursPolicy!==undefined && input.hoursPolicy!=="rolling28")
    return report("invalid",period,[issue("INVALID_HOURS_POLICY",
      "A política de distribuição das horas é inválida.")]);
  const rawMealBreaks=input.mealBreaks??[];
  if((mealPolicy!==undefined && mealPolicy!=="v1" &&
      mealPolicy!=="v2") ||
    (mealPolicy==="v1" && !Array.isArray(rawMealBreaks)) ||
    (mealPolicy==="v2" && (
      !Array.isArray(rawMealBreaks)||rawMealBreaks.length>0
    )))
    return report("invalid",period,[
      issue("INVALID_MEAL_POLICY","A configuração de pausa de refeição é inválida."),
    ]);
  if(!Array.isArray(rawCandidate) || !Array.isArray(rawExternal) ||
    !Array.isArray(rawDates))
    return report("invalid",period,[
      issue("INVALID_ASSIGNMENT","O formato das atribuições ou do contexto é inválido."),
    ]);

  const members=new Map(team.value.members.map(m=>[m.id,m]));
  const assignments:WorkAssignment[]=[];

  function consume(raw:unknown,source:"candidate"|"external"):void {
    const entry=validateWorkAssignment(raw);
    if(!entry){
      problems.push(issue("INVALID_ASSIGNMENT",
        "Existe um intervalo de trabalho com dados inválidos."));
      return;
    }
    const normalized={...entry,memberId:entry.memberId.toLowerCase()};
    const member=members.get(normalized.memberId);
    if(!member){
      problems.push(issue("UNKNOWN_MEMBER","A atribuição refere um colaborador desconhecido.",{
        memberId:normalized.memberId,date:normalized.date,
      }));
      return;
    }
    if(source==="candidate"){
      if(!inRange(normalized.date,period)){
        problems.push(issue("OUTSIDE_EDITABLE_PERIOD",
          "A proposta tenta atribuir trabalho fora do período selecionado.",{
            memberId:normalized.memberId,date:normalized.date,
          }));
        return;
      }
      if(!member.active){
        problems.push(issue("INACTIVE_MEMBER",
          "Não é permitido atribuir novos turnos a um colaborador inativo.",{
            memberId:normalized.memberId,date:normalized.date,
          }));
        return;
      }
      if(!isWithinOpeningHours(normalized,validatedOpeningHours))
        problems.push(issue("OUTSIDE_OPENING_HOURS",
          "O turno está fora dos períodos de funcionamento da empresa.",{
            memberId:normalized.memberId,date:normalized.date,
          }));
    }else{
      if(inRange(normalized.date,period)){
        problems.push(issue("CONTEXT_IN_EDITABLE_PERIOD",
          "O contexto externo contém um turno do período editável.",{
            memberId:normalized.memberId,date:normalized.date,
          }));
        return;
      }
      if(!inValidation(normalized.date,period)){
        problems.push(issue("OUTSIDE_CONTEXT_RANGE",
          "O contexto inclui um turno fora das semanas necessárias.",{
            memberId:normalized.memberId,date:normalized.date,
          }));
        return;
      }
      // Other months are immutable context: current opening hours and
      // current active status must not rewrite or invalidate their history.
    }
    assignments.push(normalized);
  }
  rawCandidate.forEach(value=>consume(value,"candidate"));
  rawExternal.forEach(value=>consume(value,"external"));

  // Fixed weekly rest is independent of the particular rotation selected.
  // Never reinterpret immutable external assignments against new team rules.
  for(const entry of assignments){
    if(!inRange(entry.date,period))continue;
    const member=members.get(entry.memberId);
    const weekday=validatedOpeningHours.days[civilDayOfWeek(entry.date)].day;
    if(member?.fixedDaysOff?.includes(weekday))
      problems.push(issue("FIXED_DAY_OFF_VIOLATED",
        "Foi atribuído trabalho num dia de folga fixa.",{
          memberId:entry.memberId,date:entry.date,
        }));
  }

  const completeDates=new Set<string>();
  for(const value of rawDates){
    if(typeof value!=="string"){
      contextProblems.push(issue("INVALID_CONTEXT_DAY","Data de contexto inválida."));
      continue;
    }
    try {
      if(!inValidation(value,period) || inRange(value,period)){
        contextProblems.push(issue("INVALID_CONTEXT_DAY",
          "O contexto deve declarar apenas dias externos necessários.",{date:value}));
        continue;
      }
      if(completeDates.has(value)){
        contextProblems.push(issue("DUPLICATE_CONTEXT_DAY",
          "O contexto declara repetidamente o mesmo dia.",{date:value}));
        continue;
      }
      completeDates.add(value);
    }catch {
      contextProblems.push(issue("INVALID_CONTEXT_DAY","Data de contexto inválida."));
    }
  }
  problems.push(...contextProblems);

  const groups=new Map<string,WorkAssignment[]>();
  for(const entry of assignments){
    const key=entry.memberId+"|"+entry.date;
    const group=groups.get(key)??[];
    if(group.some(other=>assignmentsOverlap(other,entry)))
      problems.push(issue("OVERLAPPING_WORK",
        "Existem intervalos sobrepostos para o mesmo colaborador.",{
          memberId:entry.memberId,date:entry.date,
        }));
    group.push(entry);
    groups.set(key,group);
  }

  // PR84 v2: one actual shift per person per day, meal INSIDE the shift.
  // Coverage is a hard constraint only for newly generated v2 proposals.
  // Legacy saved proposals keep their original certification semantics.
  if(mealPolicy==="v2"){
    for(const [key,dayWork] of groups){
      const proposed=dayWork.filter(entry=>inRange(entry.date,period));
      if(proposed.length===0)continue;
      const [memberId,date]=key.split("|");
      if(proposed.length!==1)
        problems.push(issue("MULTIPLE_SHIFTS_SAME_DAY",
          "Um colaborador deve ter um único turno por dia.",{
            memberId,date,
          }));
      for(const shift of proposed){
        const effective=assignmentMinutes(shift);
        // A short day is defined by actual COMPANY opening, not by
        // which weekday it is. Every assigned worker covers the ENTIRE
        // short opening; nobody is allowed a partial shift there.
        const weekday=(new Date(date+"T12:00:00Z").getUTCDay()+6)%7;
        const opening=validatedOpeningHours.days[weekday].intervals;
        const isShortOpening=shortDays.has(weekday);
        const shortMinutes=opening.reduce((sum,span)=>
          sum+clockMinutes(span.end)-clockMinutes(span.start),0);
        if(isShortOpening){
          const first=opening[0];
          const last=opening[opening.length-1];
          if(effective!==shortMinutes ||
            shift.start!==first.start || shift.end!==last.end)
            problems.push(issue("SHORT_OPENING_INCOMPLETE",
              "Um colaborador escalado num dia curto deve cumprir toda a janela de funcionamento.",{
                memberId,date,
                requiredMinutes:shortMinutes,actualMinutes:effective,
              }));
        }
        const meal=shift.mealBreak;
        if(!meal && !isShortOpening &&
          effective>SHORT_SHIFT_MAX_WORK_MINUTES){
          problems.push(issue("MEAL_BREAK_MISSING",
            "Uma jornada normal exige pausa dentro do próprio turno.",{
              memberId,date,
            }));
          continue;
        }
        if(!meal)continue;
        const start=clockMinutes(meal.start),end=clockMinutes(meal.end);
        if(end-start!==60)
          problems.push(issue("INVALID_MEAL_BREAK",
            "A pausa para refeição deve durar exatamente uma hora.",{
              memberId,date,
            }));
        if(isShortOpening || effective<=SHORT_SHIFT_MAX_WORK_MINUTES)
          problems.push(issue("MEAL_BREAK_UNNECESSARY",
            "Uma jornada curta não admite pausa de refeição.",{
              memberId,date,
            }));
        if(start<clockMinutes(shift.start)+
          MEAL_BREAK_EARLIEST_AFTER_ENTRY_MINUTES)
          problems.push(issue("MEAL_BREAK_TOO_EARLY",
            "A pausa só pode começar três horas após a entrada.",{
              memberId,date,
            }));
      }
    }
    function hhmm(t:number):string {
      return String(Math.floor(t/60)).padStart(2,"0")+":"+
        String(t%60).padStart(2,"0");
    }
    for(const date of enumerateCivilDays(period)){
      const weekdayIndex=(new Date(date+"T12:00:00Z").getUTCDay()+6)%7;
      const opening=validatedOpeningHours.days[weekdayIndex];
      const dateWork=assignments.filter(entry=>
        entry.date===date && members.get(entry.memberId)?.active);
      const segments=dateWork.flatMap(e=>effectiveWorkIntervals(e))
        .sort((a,b)=>a.start-b.start||a.end-b.end);
      for(const window of opening.intervals){
        const open=clockMinutes(window.start),close=clockMinutes(window.end);
        let cursor=open;
        for(const part of segments){
          if(part.end<=cursor||part.start>=close)continue;
          if(part.start>cursor)break;
          cursor=Math.min(close,Math.max(cursor,part.end));
          if(cursor===close)break;
        }
        if(cursor<close){
          const next=segments.filter(s=>s.start>cursor&&s.start<close)
            .map(s=>s.start).sort((a,b)=>a-b)[0]??close;
          problems.push(issue("OPENING_UNCOVERED",
            "A empresa fica sem colaboradores a trabalhar num período de funcionamento.",{
              date,gapStart:hhmm(cursor),gapEnd:hhmm(next),
            }));
        }
      }
    }
  }

  // The new meal policy validates only editable proposed days. Historical
  // context may belong to an older schedule version and remains immutable.
  if(mealPolicy==="v1"){
    const mealsByDay=new Map<string,MealBreak[]>();
    for(const raw of rawMealBreaks as unknown[]){
      const meal=validateMealBreak(raw);
      if(!meal){
        problems.push(issue("INVALID_MEAL_BREAK",
          "A pausa para refeição tem dados ou duração inválidos."));
        continue;
      }
      const memberId=meal.memberId.toLowerCase();
      const member=members.get(memberId);
      if(!member || !member.active || !inRange(meal.date,period)){
        problems.push(issue("INVALID_MEAL_BREAK",
          "A pausa refere um colaborador ou dia não editável.",{
            memberId,date:meal.date,
          }));
        continue;
      }
      const key=memberId+"|"+meal.date;
      const list=mealsByDay.get(key)??[];
      list.push({...meal,memberId});
      mealsByDay.set(key,list);
    }
    const allKeys=new Set([...groups.keys(),...mealsByDay.keys()]);
    for(const key of allKeys){
      const work=(groups.get(key)??[]).filter(a=>inRange(a.date,period));
      const meals=mealsByDay.get(key)??[];
      const totalMinutes=work.reduce((sum,a)=>sum+assignmentMinutes(a),0);
      const first=work.reduce((min,a)=>
        Math.min(min,clockMinutes(a.start)),Infinity);
      const [memberId,date]=key.split("|");
      if(totalMinutes<=SHORT_SHIFT_MAX_WORK_MINUTES){
        if(meals.length>0)problems.push(issue("MEAL_BREAK_UNNECESSARY",
          "Não se atribui pausa de refeição a uma jornada curta.",{
            memberId,date,
          }));
        continue;
      }
      if(meals.length===0){
        problems.push(issue("MEAL_BREAK_MISSING",
          "A jornada exige uma pausa de refeição de uma hora.",{
            memberId,date,
          }));
        continue;
      }
      if(meals.length!==1){
        problems.push(issue("INVALID_MEAL_BREAK",
          "A jornada deve conter exatamente uma pausa de refeição.",{
            memberId,date,
          }));
        continue;
      }
      const meal=meals[0];
      const start=clockMinutes(meal.start),end=clockMinutes(meal.end);
      if(start<first+MEAL_BREAK_EARLIEST_AFTER_ENTRY_MINUTES)
        problems.push(issue("MEAL_BREAK_TOO_EARLY",
          "A pausa só pode começar três horas após a entrada.",{
            memberId,date,
          }));
      if(work.some(a=>
        clockMinutes(a.start)<end && start<clockMinutes(a.end)))
        problems.push(issue("MEAL_BREAK_OVERLAP",
          "A pausa para refeição não pode coincidir com trabalho.",{
            memberId,date,
          }));
      if(!work.some(a=>clockMinutes(a.end)<=start) ||
        !work.some(a=>clockMinutes(a.start)>=end))
        problems.push(issue("INVALID_MEAL_BREAK",
          "A pausa deve separar dois períodos de trabalho.",{
            memberId,date,
          }));
    }
  }

  const weeks:WeeklyWorkSummary[]=[];
  for(const week of period.weeks){
    const absent=externalDatesFor(week,period).filter(day=>!completeDates.has(day));
    if(absent.length>0)
      contextProblems.push(issue("CONTEXT_INCOMPLETE",
        "Não existem dados completos para a semana de fronteira.",{
          weekStart:week.start,missingDates:absent,
        }));

    for(const member of active){
      const total=assignments.reduce((sum,entry)=>
        entry.memberId===member.id && inRange(entry.date,week)
          ? sum+assignmentMinutes(entry):sum,0);
      const complete=absent.length===0;
      const workedDates=new Set(assignments.filter(entry=>
        entry.memberId===member.id && inRange(entry.date,week)
      ).map(entry=>entry.date));
      const knownWorkedDays=workedDates.size;
      const knownDaysOff=7-knownWorkedDays;
      const saturday=addCivilDays(week.start,5);
      const sunday=addCivilDays(week.start,6);
      const weekendComplete=!workedDates.has(saturday) &&
        !workedDates.has(sunday);
      // A newly enabled rotation rule must not retroactively reinterpret a
      // weekend belonging entirely to another, immutable saved month.
      const weekendInEditable=inRange(saturday,period)||
        inRange(sunday,period);
      const closedWeekdays=validatedOpeningHours.days.filter(d=>
        d.intervals.length===0).map(day=>day.day);
      const requiredDaysOff=member.weekendRest!==undefined &&
        absent.length===0 && weekendComplete && weekendInEditable &&
        member.weeklyDaysOff!==undefined
        ?requiredRestDayCount({
          id:member.id,weeklyDaysOff:member.weeklyDaysOff,
          fixedDaysOff:member.fixedDaysOff??[],
          minimumWeekdayDaysOffOnFullWeekend:
            member.weekendRest.minimumWeekdayDaysOffOnFullWeekend,
        },true,closedWeekdays)
        :member.weeklyDaysOff;
      const summary:WeeklyWorkSummary={
        memberId:member.id,weekStart:week.start,
        weekEndExclusive:week.endExclusive,
        actualMinutes:total,requiredMinutes:REQUIRED_WEEKLY_MINUTES,
        differenceMinutes:complete?total-REQUIRED_WEEKLY_MINUTES:null,
        complete,
      };
      weeks.push(summary);
      // Unknown external dates are never counted as confirmed days off.
      // More known workdays than permitted is still a provable violation.
      if(!complete && member.weeklyDaysOff!==undefined &&
        knownWorkedDays>7-member.weeklyDaysOff)
        problems.push(issue("WEEKLY_DAYS_OFF_MISMATCH",
          "A semana já contém mais dias de trabalho do que o permitido.",{
            memberId:member.id,weekStart:week.start,
            requiredDaysOff:member.weeklyDaysOff,actualDaysOff:knownDaysOff,
          }));
      // With incomplete context a known EXCESS is still provably invalid.
      if(!complete){
        if(input.hoursPolicy!=="rolling28" &&
          total>REQUIRED_WEEKLY_MINUTES)
          problems.push(issue("WEEKLY_HOURS_EXCESS",
            "A semana excede 40 horas mesmo sem o contexto completo.",{
              memberId:member.id,weekStart:week.start,
              requiredMinutes:REQUIRED_WEEKLY_MINUTES,actualMinutes:total,
            }));
        continue;
      }
      if(member.weekendRest!==undefined && weekendComplete &&
        weekendInEditable &&
        !closedWeekdays.includes("saturday") &&
        !closedWeekdays.includes("sunday")){
        const actualWeekdayRest=5-[...workedDates].filter(date=>
          civilDayOfWeek(date)<5).length;
        if(actualWeekdayRest<member.weekendRest.minimumWeekdayDaysOffOnFullWeekend)
          problems.push(issue("WEEKEND_WEEKDAY_REST_MISSING",
            "O fim de semana completo exige descanso adicional durante a semana.",{
              memberId:member.id,weekStart:week.start,
              requiredDaysOff,actualDaysOff:knownDaysOff,
            }));
      }
      if(requiredDaysOff!==undefined &&
        knownDaysOff!==requiredDaysOff)
        problems.push(issue("WEEKLY_DAYS_OFF_MISMATCH",
          "O número de dias sem trabalho não corresponde à política de descanso desta semana.",{
            memberId:member.id,weekStart:week.start,
            requiredDaysOff,actualDaysOff:knownDaysOff,
          }));
      // Rolling 28-day hours are a SOFT reference. No arbitrary payroll
      // credit or legal compliance is inferred from this certification.
      if(input.hoursPolicy==="rolling28")continue;
      const comparison=compareWeeklyHours(total);
      if(comparison.kind==="missing")
        problems.push(issue("WEEKLY_HOURS_MISSING",
          "O colaborador não cumpre as 40 horas semanais.",{
            memberId:member.id,weekStart:week.start,
            requiredMinutes:REQUIRED_WEEKLY_MINUTES,actualMinutes:total,
          }));
      if(comparison.kind==="excess")
        problems.push(issue("WEEKLY_HOURS_EXCESS",
          "O colaborador excede as 40 horas semanais.",{
            memberId:member.id,weekStart:week.start,
            requiredMinutes:REQUIRED_WEEKLY_MINUTES,actualMinutes:total,
          }));
    }
  }

  if(problems.length>0)
    return report("invalid",period,problems.concat(
      contextProblems.filter(item=>item.code==="CONTEXT_INCOMPLETE")
    ),weeks);
  if(contextProblems.length>0)
    return report("insufficient_context",period,contextProblems,weeks);
  return report("valid",period,[],weeks);
}
