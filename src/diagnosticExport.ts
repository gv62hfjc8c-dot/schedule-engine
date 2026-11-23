import type {CertificationReport,ExternalScheduleContext} from "./certifySchedule";
import type {GenerationResult} from "./generateSchedule";
import type {WeeklyOpeningHours} from "./operatingHours";
import type {TeamRoster} from "./team";
import type {WorkAssignment} from "./workAssignments";
import {assignmentMinutes,clockMinutes} from "./workAssignments";
import {measureSimultaneousCoverage} from "./simultaneousCoverage";
import {analyzeFunctionalCapacity} from "./functionalCapacityAnalysis";
import {analyzeMonthlyFixedWorkdayLongDayFloor}
  from "./cycleLongDayFeasibility";
import {analyzeRestDayExchangeOpportunities} from "./rotationDayExchangeResearch";
import {evaluateRestDayExchangeCandidates} from "./restDayExchangeEvaluation";
import type {MealBreak} from "./mealBreaks";
import type {PlannedRestWeekMember} from "./plannedRest";
import {enumerateCivilDays,resolvePlanningPeriod,civilDayOfWeek} from "./schedulePeriods";

export const DIAGNOSTIC_SCHEMA_VERSION=1;

export type DiagnosticMode=
  |"generated_preview"|"manual_edits"|"saved_proposal"|"configuration_only";

export interface DiagnosticSourceStatuses {
  team:string;
  openingHours:string;
  adjacentMonths:string;
  rollingHistory:string;
  savedMonth:string;
}

/**
 * Explicit inputs only: never serialize localStorage wholesale, passwords,
 * browser tokens, network headers or raw storage revision strings.
 * Includes employee identities and shifts intentionally to reproduce a
 * real scenario: the user decides whether to share the downloaded file.
 */
export interface ReproductionSources {
  team:TeamRoster|null;
  openingHours:WeeklyOpeningHours|null;
  externalContext:ExternalScheduleContext|null;
  rollingHoursHistory:ExternalScheduleContext|null;
}

export interface ScheduleDiagnosticInput {
  exportedAt:string;
  year:number;
  month:number;
  mode:DiagnosticMode;
  team:TeamRoster|null;
  openingHours:WeeklyOpeningHours|null;
  assignments:readonly WorkAssignment[];
  savedAssignments:readonly WorkAssignment[]|null;
  mealBreaks:readonly MealBreak[];
  mealBreakPolicy:"v1"|"v2"|null;
  hoursPolicy:"rolling28"|null;
  functionalCoveragePolicy:"qualified50"|null;
  plannedRest:readonly PlannedRestWeekMember[];
  externalContext:ExternalScheduleContext|null;
  rollingHistory:ExternalScheduleContext|null;
  sourceStatuses:DiagnosticSourceStatuses;
  generation:GenerationResult|null;
  displayedCertification:CertificationReport|null;
  currentConfigurationCertification:CertificationReport|null;
  settingsMatchGeneratedPreview:boolean|null;
  /** Exact, originally loaded source data, even if settings have since changed. */
  generationInputSnapshot?:ReproductionSources|null;
}

function workdaySummary(
  input:ScheduleDiagnosticInput,
):{
  byDay:{
    date:string;open:boolean;employeesWithShifts:number;
    effectiveWorkMinutes:number;memberIds:string[];
    /** Minutes with exactly 1 active worker; null if opening unknown. */
    soloMinutes:number|null;
    /** True hard coverage gaps; null if opening unknown. */
    uncoveredMinutes:number|null;
  }[];
  byMember:{
    memberId:string;name:string;active:boolean;
    daysWithShifts:number;effectiveWorkMinutes:number;
    sundaysWorked:number;shiftsOverEightHours:number;
    shiftsOverNineHours:number;fullWeekendsOffPlanned:number;
  }[];
} {
  const period=resolvePlanningPeriod({
    mode:"monthly",year:input.year,month:input.month,
  });
  const memberDays=new Map<string,Set<string>>();
  const hoursByMember=new Map<string,number>();
  const sundays=new Map<string,Set<string>>();
  const over8=new Map<string,number>();
  const over9=new Map<string,number>();
  const dayAssignments=new Map<string,WorkAssignment[]>();
  for(const shift of input.assignments){
    const memberDates=memberDays.get(shift.memberId)??new Set<string>();
    memberDates.add(shift.date);
    memberDays.set(shift.memberId,memberDates);
    const minutes=assignmentMinutes(shift);
    hoursByMember.set(shift.memberId,(hoursByMember.get(shift.memberId)??0)+minutes);
    if(minutes>480)over8.set(shift.memberId,(over8.get(shift.memberId)??0)+1);
    if(minutes>540)over9.set(shift.memberId,(over9.get(shift.memberId)??0)+1);
    if(civilDayOfWeek(shift.date)===6){
      const dates=sundays.get(shift.memberId)??new Set<string>();
      dates.add(shift.date);
      sundays.set(shift.memberId,dates);
    }
    const daily=dayAssignments.get(shift.date)??[];
    daily.push(shift);
    dayAssignments.set(shift.date,daily);
  }
  const weekendCounts=new Map<string,number>();
  for(const record of input.plannedRest){
    if(!record.fullWeekendOff)continue;
    weekendCounts.set(record.memberId,
      (weekendCounts.get(record.memberId)??0)+1);
  }
  const byDay=enumerateCivilDays(period).map(date=>{
    const shifts=dayAssignments.get(date)??[];
    const opening=input.openingHours?.days[civilDayOfWeek(date)]
      ?.intervals??null;
    const simultaneous=opening===null?null:measureSimultaneousCoverage(
      shifts,opening.map(span=>({
        start:clockMinutes(span.start),end:clockMinutes(span.end),
      })),
    );
    return {
      date,
      open:(opening?.length??0)>0,
      soloMinutes:simultaneous?.soloMinutes??null,
      uncoveredMinutes:simultaneous?.uncoveredMinutes??null,
      employeesWithShifts:new Set(shifts.map(shift=>shift.memberId)).size,
      effectiveWorkMinutes:shifts.reduce((sum,shift)=>
        sum+assignmentMinutes(shift),0),
      memberIds:[...new Set(shifts.map(shift=>shift.memberId))].sort(),
    };
  });
  const people=[...input.team?.members??[]];
  const known=new Set(people.map(member=>member.id));
  for(const memberId of memberDays.keys())
    if(!known.has(memberId))
      people.push({id:memberId,name:"Colaborador não encontrado",
        active:false});
  const byMember=people.map(member=>({
    memberId:member.id,name:member.name,active:member.active,
    daysWithShifts:memberDays.get(member.id)?.size??0,
    effectiveWorkMinutes:hoursByMember.get(member.id)??0,
    sundaysWorked:sundays.get(member.id)?.size??0,
    shiftsOverEightHours:over8.get(member.id)??0,
    shiftsOverNineHours:over9.get(member.id)??0,
    fullWeekendsOffPlanned:weekendCounts.get(member.id)??0,
  }));
  return {byDay,byMember};
}

/**
 * Self-contained and replayable: the proposal is NEVER regenerated during
 * export. The snapshot contains precisely the assignments being displayed,
 * even if they are invalid or have not yet been saved.
 */
export function buildScheduleDiagnostic(input:ScheduleDiagnosticInput) {
  const {byDay,byMember}=workdaySummary(input);
  const cycleLongDays=input.hoursPolicy==="rolling28" &&
    input.mealBreakPolicy==="v2" && input.team && input.openingHours
    ?analyzeMonthlyFixedWorkdayLongDayFloor({
      year:input.year,month:input.month,
      team:input.team,openingHours:input.openingHours,
      assignments:input.assignments,
    }):null;
  const cycleRestExchange=cycleLongDays && input.team &&
    input.openingHours && input.generation?.rotation
    ?analyzeRestDayExchangeOpportunities({
      cycleStart:cycleLongDays.cycleStart,
      team:input.team,openingHours:input.openingHours,
      assignments:input.assignments,rotation:input.generation.rotation,
    }):null;
  // PR96: bounded concrete candidates are evaluated ONLY when exporting a
  // diagnostic. This has no effect on normal generation or the saved plan.
  const exchangeEvaluation=cycleRestExchange && input.team &&
    input.openingHours && input.generation?.rotation
    ?evaluateRestDayExchangeCandidates({
      cycleStart:cycleRestExchange.cycleStart,
      team:input.team,openingHours:input.openingHours,
      assignments:input.assignments,rotation:input.generation.rotation,
    }):null;
  // Export only the summary; never mistake an experimental proposal for
  // the currently displayed schedule.
  const cycleRestExchangeEvaluation=exchangeEvaluation?{
    ...exchangeEvaluation,
    best:exchangeEvaluation.best?{
      opportunity:exchangeEvaluation.best.opportunity,
      longDays:exchangeEvaluation.best.longDays,
      soloMinutes:exchangeEvaluation.best.soloMinutes,
      roleGapMinutes:exchangeEvaluation.best.roleGapMinutes,
      certificationStatus:exchangeEvaluation.best.certification.status,
    }:null,
  }:null;
  const functionalCapacity=input.functionalCoveragePolicy==="qualified50"&&
    input.team&&input.openingHours
    ?analyzeFunctionalCapacity({
      period:{mode:"monthly",year:input.year,month:input.month},
      team:input.team,openingHours:input.openingHours,
      assignments:input.assignments,minimumPercent:50,
    }):null;
  return {
    schema:"schedule-engine-diagnostic",
    schemaVersion:DIAGNOSTIC_SCHEMA_VERSION,
    exportedAt:input.exportedAt,
    period:{mode:"monthly" as const,year:input.year,month:input.month},
    origin:input.mode,
    sourceStatuses:input.sourceStatuses,
    settingsMatchGeneratedPreview:input.settingsMatchGeneratedPreview,
    generationInputsAtCreation:input.generationInputSnapshot??null,
    configuration:{
      team:input.team,
      openingHours:input.openingHours,
    },
    proposal:{
      assignments:input.assignments,
      mealBreaks:input.mealBreaks,
      mealBreakPolicy:input.mealBreakPolicy,
      hoursPolicy:input.hoursPolicy,
      functionalCoveragePolicy:input.functionalCoveragePolicy,
      explicitlyPlannedRest:input.plannedRest,
      savedAssignmentsForComparison:input.savedAssignments,
    },
    generation:input.generation?{
      status:input.generation.status,
      shortfalls:input.generation.shortfalls,
      rotation:input.generation.rotation??null,
      rotationTargetShortfalls:
        input.generation.rotationTargetShortfalls??[],
      dailyStaffing:input.generation.dailyStaffing??null,
    }:null,
    validation:{
      displayed:input.displayedCertification,
      recalculatedWithCurrentSettings:
        input.currentConfigurationCertification,
    },
    context:{
      adjacentMonths:input.externalContext,
      rollingHoursHistory:input.rollingHistory,
    },
    analysis:{
      byDay,byMember,functionalCapacity,cycleLongDays,cycleRestExchange,
      cycleRestExchangeEvaluation,
      quality:{
        shiftsOverNineHours:byMember.reduce((sum,member)=>
          sum+member.shiftsOverNineHours,0),
        soloMinutes:byDay.some(day=>day.soloMinutes===null)
          ?null:byDay.reduce((sum,day)=>sum+(day.soloMinutes??0),0),
        uncoveredMinutes:byDay.some(day=>day.uncoveredMinutes===null)
          ?null:byDay.reduce((sum,day)=>
            sum+(day.uncoveredMinutes??0),0),
      },
    },
    interpretation:{
      scheduleType:"proposta, não trabalho realizado nem aprovação",
      hours:"minutos de trabalho efetivo, excluindo pausa de refeição",
      staffing:"pessoas distintas com turno em cada dia, não presença simultânea",
      functions:"posto único e qualificação por turno são HARD; a presença simultânea de 50% por função é apenas objetivo SOFT de otimização, avaliado na análise funcional; não invalida horários",
      capacity:"valores de horas necessárias e défices referem-se EXCLUSIVAMENTE à META SOFT de 50% e NÃO representam falta obrigatória de pessoal nem invalidam a proposta; o alvo pode aumentar com mais pessoas habilitadas",
      rest:"somente descanso explicitamente planeado, nunca ausência de turno",
      context:"datas sem histórico confirmado permanecem desconhecidas",
      cycleLongDays:"limite inferior MATEMÁTICO de jornadas >9h conservando as datas já escaladas e a capacidade diária; não prova que os descansos possam ser redistribuídos nem garante melhoria possível sem alterar os dias de trabalho",
      cycleRestExchange:"PR96 fase 1: hipóteses estruturais são apenas condições NECESSÁRIAS; não são horários gerados nem certificados.",
      cycleRestExchangeEvaluation:"PR96 fase 2: os candidatos são reconstruídos e avaliados contra as HARD constraints atuais, 160h por trabalhador e métricas SOFT. Uma melhoria tecnicamente certificada continua a ser proposta experimental NÃO aplicada, e NÃO é garantia de conformidade laboral.",
    },
    privacy:{
      includesEmployeeNamesAndSchedules:true,
      containsCredentials:false,
      note:"O ficheiro contém dados pessoais da equipa. Partilha-o apenas com quem autorizares.",
    },
  };
}

export function diagnosticFileName(year:number,month:number):string {
  return "schedule-engine-diagnostico-"+
    String(year).padStart(4,"0")+"-"+
    String(month).padStart(2,"0")+".json";
}
