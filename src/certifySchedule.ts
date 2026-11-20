import {validateTeamRoster} from "./team";
import {validateWeeklyOpeningHours} from "./operatingHours";
import {
  enumerateCivilDays,inRange,resolvePlanningPeriod,
  type DateRange,type PeriodRequest,type PlanningPeriod,
} from "./schedulePeriods";
import {
  assignmentMinutes,assignmentsOverlap,isWithinOpeningHours,
  validateWorkAssignment,type WorkAssignment,
} from "./workAssignments";
import {compareWeeklyHours,REQUIRED_WEEKLY_MINUTES} from "./weeklyHours";
import {validateMealBreak,SHORT_SHIFT_MAX_WORK_MINUTES,
  MEAL_BREAK_EARLIEST_AFTER_ENTRY_MINUTES,
  type MealBreak} from "./mealBreaks";
import {clockMinutes} from "./workAssignments";

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
  | "MEAL_BREAK_OVERLAP";

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
  mealBreakPolicy?:"v1";
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
 * The 40-hour requirement is checked per COMPLETE Monday-Sunday week, never
 * averaged across 14/21/28 days or across a calendar month.
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

  const hours=validateWeeklyOpeningHours(input.openingHours);
  if(!hours.valid)
    return report("invalid",period,[
      issue("INVALID_OPENING_HOURS","O funcionamento da empresa é inválido."),
    ]);

  const validatedOpeningHours=hours.value;
  const problems:CertificationIssue[]=[];
  const contextProblems:CertificationIssue[]=[];
  const rawCandidate=input.candidateAssignments;
  const rawExternal=input.externalContext?.assignments??[];
  const rawDates=input.externalContext?.completeDates??[];
  const mealPolicy=input.mealBreakPolicy;
  const rawMealBreaks=input.mealBreaks??[];
  if((mealPolicy!==undefined && mealPolicy!=="v1") ||
    (mealPolicy==="v1" && !Array.isArray(rawMealBreaks)))
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
      const knownWorkedDays=new Set(assignments.filter(entry=>
        entry.memberId===member.id && inRange(entry.date,week)
      ).map(entry=>entry.date)).size;
      const knownDaysOff=7-knownWorkedDays;
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
        if(total>REQUIRED_WEEKLY_MINUTES)
          problems.push(issue("WEEKLY_HOURS_EXCESS",
            "A semana excede 40 horas mesmo sem o contexto completo.",{
              memberId:member.id,weekStart:week.start,
              requiredMinutes:REQUIRED_WEEKLY_MINUTES,actualMinutes:total,
            }));
        continue;
      }
      if(member.weeklyDaysOff!==undefined &&
        knownDaysOff!==member.weeklyDaysOff)
        problems.push(issue("WEEKLY_DAYS_OFF_MISMATCH",
          "O número de dias sem trabalho não corresponde à configuração semanal.",{
            memberId:member.id,weekStart:week.start,
            requiredDaysOff:member.weeklyDaysOff,actualDaysOff:knownDaysOff,
          }));
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
