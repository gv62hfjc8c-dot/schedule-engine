/**
 * PR96 phase 2 — bounded, opt-in, read-only end-to-end experiments.
 *
 * A theoretical exchange is NOT evidence of an achievable schedule.
 * Only a complete 28-day candidate with exact 160h for every worker,
 * independent V2 certification, and non-worsening agreed SOFT measures
 * may be reported as a technically certified improvement.
 *
 * This experiment does not write or approve a schedule, does not alter
 * the normal generator, and does not claim Portuguese-law compliance.
 */
import {certifySchedule,type CertificationReport} from "./certifySchedule";
import {validateTeamRoster,type TeamRoster} from "./team";
import {validateWeeklyOpeningHours,type WeeklyOpeningHours} from "./operatingHours";
import {addCivilDays,civilDayOfWeek,enumerateCivilDays,resolvePlanningPeriod} from "./schedulePeriods";
import {assignmentMinutes,clockMinutes,type WorkAssignment} from "./workAssignments";
import {effectiveMealDayCapacity,mealDayOptions} from "./mealBreaks";
import {shortOpeningDays} from "./shortOpenings";
import {measureSimultaneousCoverage} from "./simultaneousCoverage";
import {evaluateDailyStaffing,scoreDailyStaffing,compareDailyStaffing} from "./dailyStaffingBalance";
import {analyzeFunctionalCapacity} from "./functionalCapacityAnalysis";
import {
  analyzeRestDayExchangeOpportunities,
  type RestDayExchangeOpportunity,
} from "./rotationDayExchangeResearch";
import type {WeekendRotationResult} from "./weekendRotation";

const TARGET_MINUTES=9600;
const NINE_HOURS=540;
const EIGHT_HOURS=480;
const STEP=15;
const MAX_OPPORTUNITIES=4;

export interface ExchangeTrial {
  opportunity:RestDayExchangeOpportunity;
  status:"certified_improvement"|"rejected";
  /** Only concrete, independently checked results may be called certified. */
  candidateLongDays:number|null;
  candidateSoloMinutes:number|null;
  candidateRoleGapMinutes:number|null;
  reason:string;
}

export interface ExchangeCandidateEvaluation {
  cycleStart:string;
  cycleEndExclusive:string;
  baselineCertificationStatus:CertificationReport["status"];
  baselineLongDays:number;
  baselineSoloMinutes:number;
  baselineRoleGapMinutes:number|null;
  evaluatedOpportunities:number;
  trials:ExchangeTrial[];
  /** Best technically certified candidate, never automatically applied. */
  best:{
    opportunity:RestDayExchangeOpportunity;
    candidateAssignments:WorkAssignment[];
    certification:CertificationReport;
    longDays:number;
    soloMinutes:number;
    roleGapMinutes:number|null;
  }|null;
  /** This is not a legal-hours or payroll compliance certificate. */
  certainty:"current_engine_constraints_only";
}

function dailyOpening(hours:WeeklyOpeningHours,date:string) {
  return hours.days[civilDayOfWeek(date)].intervals.map(span=>({
    start:clockMinutes(span.start),end:clockMinutes(span.end),
  }));
}
function quality(assignments:readonly WorkAssignment[],hours:WeeklyOpeningHours,
  cycleStart:string) {
  const period=resolvePlanningPeriod({mode:"28d",start:cycleStart});
  let solo=0,uncovered=0;
  for(const date of enumerateCivilDays(period)){
    const day=measureSimultaneousCoverage(assignments.filter(s=>s.date===date),
      dailyOpening(hours,date));
    solo+=day.soloMinutes;
    uncovered+=day.uncoveredMinutes;
  }
  return {
    longDays:assignments.filter(s=>assignmentMinutes(s)>NINE_HOURS).length,
    aboveNineMinutes:assignments.reduce((sum,s)=>
      sum+Math.max(0,assignmentMinutes(s)-NINE_HOURS),0),
    aboveEightMinutes:assignments.reduce((sum,s)=>
      sum+Math.max(0,assignmentMinutes(s)-EIGHT_HOURS),0),
    solo,uncovered,
  };
}
function roleQuality(assignments:readonly WorkAssignment[],
  team:TeamRoster,hours:WeeklyOpeningHours,cycleStart:string) {
  const report=analyzeFunctionalCapacity({
    period:{mode:"28d",start:cycleStart},team,openingHours:hours,
    assignments,minimumPercent:50,
  });
  return report?.status==="complete"?report.observedRoleGapMinutes:null;
}
function staffingScore(assignments:readonly WorkAssignment[],
  team:TeamRoster,hours:WeeklyOpeningHours,cycleStart:string) {
  const period=resolvePlanningPeriod({mode:"28d",start:cycleStart});
  const activeIds=team.members.filter(m=>m.active).map(m=>m.id);
  const report=evaluateDailyStaffing(assignments,period,hours,activeIds);
  const present=report.days.map(day=>day.present);
  const desired=report.days.map(day=>day.desired);
  return scoreDailyStaffing(present,desired,present.map(()=>true));
}

/**
 * Preserve the work dates and the original worker's total minutes, except
 * for the explicit Sunday-to-weekday exchange. Reduce high durations in
 * 15-minute increments without inventing a new >9h day.
 * This is a heuristic proposal, not a constraint solver.
 */
function revisedMinutes(shifts:readonly WorkAssignment[],newDate:string,
  opening:WeeklyOpeningHours,newMinutes:number):Map<string,number>|null {
  const minutes=new Map(shifts.map(s=>[s.date,assignmentMinutes(s)] as const));
  minutes.set(newDate,newMinutes);
  if([...minutes.values()].some(v=>v<=0||v%STEP!==0))return null;
  let difference=[...minutes.values()].reduce((sum,v)=>sum+v,0)-TARGET_MINUTES;
  const existing=shifts.map(s=>s.date).sort();
  for(let moves=0;difference!==0&&moves<1000;moves++){
    const choices=existing.map(date=>{
      const current=minutes.get(date)!;
      const windows=dailyOpening(opening,date);
      const maximum=effectiveMealDayCapacity(windows);
      return {date,current,maximum};
    }).filter(day=>difference>0
      ?day.current>EIGHT_HOURS
      :day.current<Math.min(NINE_HOURS,day.maximum));
    if(!choices.length)return null;
    choices.sort((a,b)=>difference>0
      ?b.current-a.current || a.date.localeCompare(b.date)
      :a.current-b.current || a.date.localeCompare(b.date));
    const chosen=choices[0];
    const step=difference>0?-STEP:STEP;
    minutes.set(chosen.date,chosen.current+step);
    difference+=step;
  }
  return difference===0?minutes:null;
}

/** Select a new internal meal position that preserves full minute-by-minute
 * business coverage with every OTHER employee's existing shift untouched. */
function placeChangedShift(date:string,memberId:string,minutes:number,
  other:readonly WorkAssignment[],opening:WeeklyOpeningHours,
  shortDays:ReadonlySet<number>,previous:WorkAssignment|undefined,
  role:string|undefined):WorkAssignment|null {
  const windows=dailyOpening(opening,date);
  const options=mealDayOptions(memberId,date,windows,minutes,
    shortDays.has(civilDayOfWeek(date)));
  let best:{shift:WorkAssignment;solo:number;movement:number}|null=null;
  for(const option of options){
    const coverage=measureSimultaneousCoverage([...other,option],windows);
    if(coverage.uncoveredMinutes!==0)continue;
    const movement=previous
      ?Math.abs(clockMinutes(option.start)-clockMinutes(previous.start))*2+
       Math.abs(clockMinutes(option.end)-clockMinutes(previous.end))+
       (previous.mealBreak&&option.mealBreak
         ?Math.abs(clockMinutes(option.mealBreak.start)-
           clockMinutes(previous.mealBreak.start)):0)
      :clockMinutes(option.start);
    if(!best||coverage.soloMinutes<best.solo ||
       (coverage.soloMinutes===best.solo&&movement<best.movement))
      best={shift:{...option,...(role===undefined?{}:{role})},
        solo:coverage.soloMinutes,movement};
  }
  return best?.shift??null;
}

function construct(input:{
  openingHours:WeeklyOpeningHours;
  assignments:readonly WorkAssignment[];
  opportunity:RestDayExchangeOpportunity;
  newMinutes:number;
}):WorkAssignment[]|null {
  const {openingHours,opportunity}=input;
  const before=input.assignments;
  const removed=before.find(s=>s.memberId===opportunity.memberId&&
    s.date===opportunity.restInsteadOfWorking);
  if(!removed||before.some(s=>s.memberId===opportunity.memberId&&
    s.date===opportunity.workInsteadOfRest))return null;
  const remaining=before.filter(s=>s!==removed);
  const others=remaining.filter(s=>s.memberId===opportunity.memberId);
  const assigned=revisedMinutes(others,opportunity.workInsteadOfRest,
    openingHours,newMinutes);
  if(!assigned)return null;
  const shortDays=shortOpeningDays(openingHours);
  const changes=[...assigned].filter(([date,minutes])=>
    date===opportunity.workInsteadOfRest ||
    assignmentMinutes(others.find(s=>s.date===date)!)!==minutes);
  const changedDates=new Set(changes.map(([date])=>date));
  const result=remaining.filter(s=>!changedDates.has(s.date)||
    s.memberId!==opportunity.memberId);
  // The removed Sunday must remain fully covered by the remaining team.
  if(measureSimultaneousCoverage(
    result.filter(s=>s.date===opportunity.restInsteadOfWorking),
    dailyOpening(openingHours,opportunity.restInsteadOfWorking)
  ).uncoveredMinutes>0)return null;
  for(const [date,minutes] of changes.sort((a,b)=>a[0].localeCompare(b[0]))){
    const previous=others.find(s=>s.date===date);
    const dayOthers=result.filter(s=>s.date===date);
    const placed=placeChangedShift(date,opportunity.memberId,minutes,
      dayOthers,openingHours,shortDays,previous,
      previous?.role??removed.role);
    if(!placed)return null;
    result.push(placed);
  }
  return result.sort((a,b)=>a.date.localeCompare(b.date)||
    a.memberId.localeCompare(b.memberId));
}

/**
 * Explicitly invoked research; never called by generateSchedule.
 * At most four structurally promising opportunities and three normal-day
 * work-minute variants each are evaluated. A failed attempt is not proof
 * that a different scheduling algorithm could never find a solution.
 */
export function evaluateRestDayExchangeCandidates(input:{
  cycleStart:string;
  team:TeamRoster;
  openingHours:WeeklyOpeningHours;
  assignments:readonly WorkAssignment[];
  rotation:WeekendRotationResult|null;
}):ExchangeCandidateEvaluation|null {
  const research=analyzeRestDayExchangeOpportunities(input);
  const team=validateTeamRoster(input.team);
  const hours=validateWeeklyOpeningHours(input.openingHours);
  if(!research || !team.valid || !hours.valid)return null;
  const source=input.assignments;
  const hasRoles=source.some(s=>s.role!==undefined);
  // A partial function model cannot be silently certified as an unqualified
  // proposal: hold off on these experiments until all posts are known.
  if(hasRoles && (source.some(s=>s.role===undefined) ||
    team.value.members.filter(m=>m.active).some(m=>!m.qualifiedRoles?.length)))
    return null;
  const certificationInput={
    period:{mode:"28d" as const,start:input.cycleStart},
    team:team.value,openingHours:hours.value,
    mealBreakPolicy:"v2" as const,hoursPolicy:"rolling28" as const,
    ...(hasRoles?{functionalCoveragePolicy:"qualified50" as const}:{}),
  };
  const baseline=certifySchedule({
    ...certificationInput,candidateAssignments:source,
  });
  const baselineQ=quality(source,hours.value,input.cycleStart);
  const baselineRole=hasRoles?roleQuality(source,team.value,
    hours.value,input.cycleStart):null;
  const baselineStaff=staffingScore(source,team.value,
    hours.value,input.cycleStart);
  const trials:ExchangeTrial[]=[];
  let best:ExchangeCandidateEvaluation["best"]=null;
  for(const opportunity of research.opportunities.slice(0,MAX_OPPORTUNITIES)){
    let accepted:ExchangeCandidateEvaluation["best"]=null;
    let reason="Nenhum dos posicionamentos experimentados cumpriu todas as condições.";
    if(baseline.status!=="valid" || baselineQ.uncovered!==0){
      reason="O horário de partida não está tecnicamente certificado.";
    }else{
      const weekday=opportunity.workInsteadOfRest;
      const windows=dailyOpening(hours.value,weekday);
      const maximum=effectiveMealDayCapacity(windows);
      for(const target of [480,510,540]){
        if(target>maximum)continue;
        const candidate=construct({
          openingHours:hours.value,assignments:source,
          opportunity,newMinutes:target,
        });
        if(!candidate)continue;
        // Every employee's cycle total is checked explicitly: rolling28
        // is SOFT in the existing certifier and cannot prove 160h itself.
        const active=team.value.members.filter(m=>m.active);
        if(active.some(member=>candidate.reduce((sum,s)=>
          sum+(s.memberId===member.id?assignmentMinutes(s):0),0)
          !==TARGET_MINUTES))continue;
        const certificate=certifySchedule({
          ...certificationInput,candidateAssignments:candidate,
        });
        if(certificate.status!=="valid"){
          reason="O certificador independente rejeitou os turnos candidatos.";
          continue;
        }
        const q=quality(candidate,hours.value,input.cycleStart);
        const role=hasRoles?roleQuality(candidate,team.value,
          hours.value,input.cycleStart):null;
        const staff=staffingScore(candidate,team.value,
          hours.value,input.cycleStart);
        if(q.uncovered>0 || q.longDays>=baselineQ.longDays ||
          q.aboveNineMinutes>baselineQ.aboveNineMinutes ||
          q.solo>baselineQ.solo ||
          compareDailyStaffing(staff,baselineStaff)>0 ||
          (hasRoles && (role===null || baselineRole===null ||
            role>baselineRole))){
          reason="O candidato não melhora as jornadas longas sem piorar a cobertura ou os objetivos SOFT.";
          continue;
        }
        const proposal={
          opportunity,candidateAssignments:candidate,
          certification:certificate,longDays:q.longDays,
          soloMinutes:q.solo,roleGapMinutes:role,
        };
        if(!accepted ||
          q.longDays<accepted.longDays ||
          (q.longDays===accepted.longDays && q.solo<accepted.soloMinutes))
          accepted=proposal;
      }
    }
    trials.push({
      opportunity,
      status:accepted?"certified_improvement":"rejected",
      candidateLongDays:accepted?.longDays??null,
      candidateSoloMinutes:accepted?.soloMinutes??null,
      candidateRoleGapMinutes:accepted?.roleGapMinutes??null,
      reason:accepted?"Certificado para as constraints atuais; não é validação jurídica.":reason,
    });
    if(accepted && (!best||accepted.longDays<best.longDays ||
      (accepted.longDays===best.longDays&&
        accepted.soloMinutes<best.soloMinutes)))best=accepted;
  }
  return {
    cycleStart:research.cycleStart,
    cycleEndExclusive:addCivilDays(research.cycleStart,28),
    baselineCertificationStatus:baseline.status,
    baselineLongDays:baselineQ.longDays,
    baselineSoloMinutes:baselineQ.solo,
    baselineRoleGapMinutes:baselineRole,
    evaluatedOpportunities:trials.length,trials,best,
    certainty:"current_engine_constraints_only",
  };
}
