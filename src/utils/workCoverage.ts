import type {
  DatedWorkShift,
  PresenceRequirement,
  Person,
  TimeInterval,
} from "../types";
import { getWeekday } from "./operatingCalendar";
import {
  checkPresenceForWorkingIntervals,
  type PersonWorkingIntervals,
  type PresenceCheckResult,
} from "./presence";
import { getEffectiveWorkIntervals } from "./workConstraints";
import { isShiftWithinOperation } from "./workRules";

/**
 * P6.3 coverage adapter: the attendance span is NOT a coverage interval
 * while the person is taking a meal. Structural shifts are converted
 * into separate actual working segments, retaining one person identity.
 *
 * Reuses the exact P5 opening/central/closing coverage logic. This
 * is COVERAGE ONLY: a true result does not certify that the meal has
 * the mandatory duration/placement, or verify rest, daily/weekly hours,
 * availability, contracts, or the completeness of external assignments.
 *
 * Call validateWorkConstraints independently before approving a period.
 * Legacy generators remain unchanged and are NOT P6.3 certified yet.
 */
export function checkPresenceForWorkShifts(
  date: string,
  operatingIntervals: TimeInterval[],
  requirements: PresenceRequirement,
  shifts: DatedWorkShift[],
  people?: Person[],
): PresenceCheckResult {
  try {
    getWeekday(date);
  } catch {
    return {
      valid: false,
      issues: ["Data civil inválida para validar cobertura."],
      shortages: [],
    };
  }

  const issues: string[] = [];
  const seen = new Set<string>();
  const working: PersonWorkingIntervals[] = [];

  for (const shift of shifts) {
    if (shift.date !== date) {
      issues.push(
        `O turno de ${shift.personId} pertence a ${shift.date}, não a ${date}.`
      );
    }
    if (!shift.personId.trim()) {
      issues.push("Um turno não tem identificador de pessoa.");
    } else if (seen.has(shift.personId)) {
      issues.push(`A pessoa ${shift.personId} tem mais de um turno no dia.`);
    }
    seen.add(shift.personId);

    const intervals = getEffectiveWorkIntervals(shift);
    if (!intervals) {
      issues.push(`O turno ou a refeição de ${shift.personId} é inválido.`);
      continue;
    }
    if (!isShiftWithinOperation(shift.interval, operatingIntervals)) {
      issues.push(
        `O turno de ${shift.personId} ultrapassa um período operacional contínuo.`
      );
      continue;
    }
    working.push({ personId: shift.personId, intervals });
  }

  if (issues.length > 0) {
    return { valid: false, issues, shortages: [] };
  }
  const base=checkPresenceForWorkingIntervals(
    operatingIntervals,
    requirements,
    working
  );
  if(!base.valid)return base;

  // Qualification coverage is a separate, opt-in HARD constraint.
  // Count only effective work (excluding meals) at EVERY clock segment.
  const expected=Object.entries(requirements.qualifiedCoverage??{})
    .filter(([,minimum])=>minimum>0);
  if(!expected.length)return base;
  if(!people)return {
    valid:false,shortages:base.shortages,
    issues:["A validação de qualificações exige a lista de colaboradores."],
  };
  const byId=new Map(people.map(p=>[p.id,p]));
  const clock=(value:string):number=>
    Number(value.slice(0,2))*60+Number(value.slice(3,5));
  const format=(value:number):string=>
    String(Math.floor(value/60)).padStart(2,"0")+":"+
    String(value%60).padStart(2,"0");
  for(const open of operatingIntervals){
    const first=clock(open.start),last=clock(open.end);
    const edges=new Set<number>([first,last]);
    for(const person of working)for(const shift of person.intervals){
      const a=clock(shift.start),b=clock(shift.end);
      if(a>first&&a<last)edges.add(a);
      if(b>first&&b<last)edges.add(b);
    }
    const sorted=[...edges].sort((a,b)=>a-b);
    for(let index=0;index<sorted.length-1;index++){
      const start=sorted[index],end=sorted[index+1];
      if(start>=end)continue;
      const workingPeople=working.filter(person=>
        person.intervals.some(interval=>
          clock(interval.start)<=start&&clock(interval.end)>=end));
      for(const [qualification,minimum] of expected){
        const actual=workingPeople.filter(person=>{
          const p=byId.get(person.personId);
          return p?.active===true &&
            p.qualificationTags?.includes(qualification)===true;
        }).length;
        if(actual<minimum)issues.push(
          date+": qualificação '"+qualification+"' insuficiente entre "+
          format(start)+"–"+format(end)+": "+actual+"/"+minimum+".");
      }
    }
  }
  return issues.length
    ? {valid:false,issues,shortages:base.shortages} : base;
}
