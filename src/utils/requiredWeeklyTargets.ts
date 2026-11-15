import type {DatedWorkShift,Person} from "../types";
import type {GenerateConstrainedPeriodInput} from "./constrainedPeriodGenerator";
import {employedOn} from "./employmentPeriods";
import {getSchedulableIntervalsForDate} from "./availability";
import {getEffectiveWorkMinutesInTimeZone} from "./workConstraints";
import {isPersonUnavailableOnDate,personWeeklyTarget,validSchedulingDate} from "./personSchedulingPolicies";

const DAY=86_400_000;
const civil=(ms:number)=>new Date(ms).toISOString().slice(0,10);
function monday(date:string):number {
  const ms=Date.parse(date+"T00:00:00Z");
  return ms-((new Date(ms).getUTCDay()+6)%7)*DAY;
}
function targetWeeks(start:string,end:string):number[] {
  if(!validSchedulingDate(start)||!validSchedulingDate(end)||start>end)return [];
  const weeks:number[]=[];
  const last=monday(end);
  for(let ms=monday(start);ms<=last;ms+=7*DAY)weeks.push(ms);
  return weeks;
}
function fullyEligible(person:Person,week:number):boolean {
  // A partial employment week is not silently prorated. Its contractual
  // minimum needs a separately agreed rule; the weekly floor applies only
  // to weeks of complete employment eligibility.
  for(let offset=0;offset<7;offset++){
    if(!employedOn(person,civil(week+offset*DAY)))return false;
  }
  return true;
}
export interface WeeklyTargetDeficit {
  personId:string;
  weekStart:string;
  requiredMinutes:number;
  effectiveMinutes:number;
}
export interface RequiredWeeklyTargetResult {
  valid:boolean;
  issues:string[];
  deficits:WeeklyTargetDeficit[];
}
/** Final independent HARD floor. Never substitute a SOFT target as a minimum
 * unless the rule was explicitly enabled, and always include attested shifts
 * OUTSIDE the generated month in complete Monday–Sunday weeks. */
export function validateRequiredWeeklyTargets(
  input:Pick<GenerateConstrainedPeriodInput,
    'workRules'|'workConstraints'|'people'|'timeZone'|'startDate'|'endDate'|'externalContext'>,
  assignments:DatedWorkShift[]
):RequiredWeeklyTargetResult {
  if(!input.workRules.requireWeeklyTargetsAsMinimum)
    return {valid:true,issues:[],deficits:[]};
  const issues:string[]=[];
  const deficits:WeeklyTargetDeficit[]=[];
  const context=input.externalContext;
  const shifts=[...context.shifts,...assignments];
  for(const week of targetWeeks(input.startDate,input.endDate)){
    const weekStart=civil(week),weekEnd=civil(week+6*DAY);
    if(!context.completeOutsideTarget || context.startDate>weekStart ||
        context.endDate<weekEnd){
      issues.push("Sem contexto confirmado para a semana completa "+weekStart+".");
      continue;
    }
    for(const person of input.people.filter(p=>p.active && fullyEligible(p,week))){
      const required=personWeeklyTarget(person,input.workConstraints.maximumWeeklyEffectiveMinutes);
      if(required===0)continue;
      let actual=0;
      let invalid=false;
      for(const shift of shifts.filter(s=>s.personId===person.id &&
          s.date>=weekStart && s.date<=weekEnd)){
        const minutes=getEffectiveWorkMinutesInTimeZone(shift,input.timeZone);
        if(minutes===null){invalid=true;break;}
        actual+=minutes;
      }
      if(invalid){
        issues.push("Não foi possível validar as horas efetivas de "+person.id+
          " na semana "+weekStart+".");
        continue;
      }
      if(actual<required){
        deficits.push({personId:person.id,weekStart,
          requiredMinutes:required,effectiveMinutes:actual});
        issues.push("Horas semanais obrigatórias em falta para "+person.name+
          " na semana "+weekStart+": "+actual+" de "+required+" minutos efetivos.");
      }
    }
  }
  return {valid:issues.length===0,issues,deficits};
}

/** Optimistic proof of a HARD weekly-target shortage BEFORE search.
 * Unknown/ambiguous availability is never used to assert impossibility.
 * Meals and rest are ignored, deliberately OVER-estimating possible hours. */
export function provenRequiredWeeklyTargetShortage(
  input:GenerateConstrainedPeriodInput
):string|null {
  if(!input.workRules.requireWeeklyTargetsAsMinimum)return null;
  try{
    const targetStart=input.startDate,targetEnd=input.endDate;
    for(const week of targetWeeks(targetStart,targetEnd)){
      const weekStart=civil(week),weekEnd=civil(week+6*DAY);
      if(!input.externalContext.completeOutsideTarget ||
          input.externalContext.startDate>weekStart ||
          input.externalContext.endDate<weekEnd)return null;
      for(const person of input.people.filter(p=>p.active && fullyEligible(p,week))){
        const required=personWeeklyTarget(person,input.workConstraints.maximumWeeklyEffectiveMinutes);
        if(required===0)continue;
        let possible=0;
        let uncertain=false;
        for(let i=0;i<7;i++){
          const date=civil(week+i*DAY);
          if(date<targetStart||date>targetEnd){
            for(const shift of input.externalContext.shifts.filter(s=>
              s.personId===person.id && s.date===date)){
              const n=getEffectiveWorkMinutesInTimeZone(shift,input.timeZone);
              if(n===null){uncertain=true;break;}
              possible+=n;
            }
          }else if(!isPersonUnavailableOnDate(person,date)){
            const availability=input.availabilities.find(a=>a.personId===person.id);
            if(!availability){uncertain=true;break;}
            const intervals=getSchedulableIntervalsForDate(
              date,availability,input.operatingCalendar.weeklyOperatingHours,
              input.operatingCalendar.exceptions);
            let available=0;
            for(const interval of intervals){
              const minutes=getEffectiveWorkMinutesInTimeZone(
                {date,personId:person.id,interval,mealBreak:null},input.timeZone);
              if(minutes===null){uncertain=true;break;}
              available+=minutes;
            }
            possible+=Math.min(available,input.workConstraints.maximumDailyEffectiveMinutes);
          }
          if(uncertain)break;
        }
        if(!uncertain && possible<required){
          return "Semana de "+weekStart+": "+person.name+
            " exige "+required+" minutos efetivos, mas a capacidade máxima"+
            " disponível e o contexto exterior confirmado só permitem "+
            possible+" minutos. Inviabilidade semanal comprovada.";
        }
      }
    }
  }catch{
    // Malformed input and DST ambiguities are handled by normal validation.
  }
  return null;
}
