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

export type CertificationStatus="valid"|"invalid"|"insufficient_context";
export type CertificationIssueCode=
  | "INVALID_PERIOD"|"INVALID_TEAM"|"NO_ACTIVE_MEMBERS"
  | "INVALID_OPENING_HOURS"|"INVALID_ASSIGNMENT"
  | "UNKNOWN_MEMBER"|"INACTIVE_MEMBER"
  | "OUTSIDE_EDITABLE_PERIOD"|"OUTSIDE_CONTEXT_RANGE"
  | "CONTEXT_IN_EDITABLE_PERIOD"|"INVALID_CONTEXT_DAY"
  | "DUPLICATE_CONTEXT_DAY"|"OVERLAPPING_WORK"
  | "OUTSIDE_OPENING_HOURS"|"WEEKLY_HOURS_MISSING"
  | "WEEKLY_HOURS_EXCESS"|"CONTEXT_INCOMPLETE";

export interface CertificationIssue {
  code:CertificationIssueCode;
  message:string;
  memberId?:string;
  date?:string;
  weekStart?:string;
  missingDates?:string[];
  requiredMinutes?:number;
  actualMinutes?:number;
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
      const summary:WeeklyWorkSummary={
        memberId:member.id,weekStart:week.start,
        weekEndExclusive:week.endExclusive,
        actualMinutes:total,requiredMinutes:REQUIRED_WEEKLY_MINUTES,
        differenceMinutes:complete?total-REQUIRED_WEEKLY_MINUTES:null,
        complete,
      };
      weeks.push(summary);
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
