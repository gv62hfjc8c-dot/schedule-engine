import type {
  AvailabilityException,OperatingHoursException,Person,PersonAvailability,
  TimeInterval,Weekday,WeeklyOperatingHours,WorkRulesConfiguration,
} from "../types";
import {WEEKDAYS,getOperatingIntervalsForDate} from "./operatingCalendar";
import {intersectIntervals} from "./availability";
import {validateEditedIntervals} from "./intervalEditing";
import {validSchedulingDate} from "./personSchedulingPolicies";
import type {OnboardingConfiguration} from "./accountingCycleConfiguration";

export type AvailabilityDayStatus="closed"|"unconfigured"|"unavailable"|"available"|"invalid";

export function availabilityDayStatus(
  availability:PersonAvailability,day:Weekday,operation:TimeInterval[],
):AvailabilityDayStatus {
  if(operation.length===0)return "closed";
  const intervals=availability.weeklyAvailability[day];
  const explicit=availability.unavailableWeekdays?.includes(day)??false;
  if(explicit&&intervals.length>0)return "invalid";
  if(explicit)return "unavailable";
  if(intervals.length===0)return "unconfigured";
  if(!validateEditedIntervals(intervals,operation).valid)return "invalid";
  return intersectIntervals(intervals,operation).length>0?"available":"invalid";
}

/** Empty legacy arrays remain unknown, never positive availability.
 * The scheduler still sees [] and cannot schedule the person in either case. */
export function withAvailabilityDecision(
  original:PersonAvailability,day:Weekday,
  status:"unconfigured"|"unavailable"|"available",
  intervals:TimeInterval[]=[],
):PersonAvailability {
  const unavailable=new Set(original.unavailableWeekdays??[]);
  if(status==="unavailable")unavailable.add(day);
  else unavailable.delete(day);
  return {
    ...original,
    weeklyAvailability:{
      ...original.weeklyAvailability,
      [day]:status==="available"?intervals.map(i=>({...i})):[],
    },
    ...(unavailable.size?{unavailableWeekdays:WEEKDAYS.filter(d=>unavailable.has(d))}:{unavailableWeekdays:undefined}),
  };
}

export function validateAvailabilityException(
  next:AvailabilityException,existing:AvailabilityException[],
  currentIndex:number|null,
  operating:WeeklyOperatingHours,operatingExceptions:OperatingHoursException[],
):{valid:true;value:AvailabilityException}|{valid:false;issue:string}{
  if(!validSchedulingDate(next.date))
    return {valid:false,issue:"Seleciona uma data civil válida."};
  if(existing.some((e,i)=>i!==currentIndex&&e.date===next.date))
    return {valid:false,issue:"Já existe uma exceção nesta data."};
  let allowed:TimeInterval[];
  try{allowed=getOperatingIntervalsForDate(next.date,operating,operatingExceptions);}
  catch{return {valid:false,issue:"Não foi possível resolver o funcionamento nesta data."};}
  if(allowed.length===0&&next.intervals.length>0)
    return {valid:false,issue:"A operação está fechada nesta data; não pode haver disponibilidade escalável."};
  const checked=validateEditedIntervals(next.intervals,allowed);
  if(!checked.valid)return checked;
  return {valid:true,value:{date:next.date,intervals:checked.intervals}};
}

export function validateAvailabilityConfiguration(
  people:Person[],availabilities:PersonAvailability[],
  weeklyHours:WeeklyOperatingHours,
  operatingExceptions:OperatingHoursException[],
  workRules:WorkRulesConfiguration,
):{valid:boolean;issues:string[]} {
  const issues:string[]=[];
  const active=people.filter(p=>p.active);
  if(active.length===0)issues.push("É necessário ter pelo menos um colaborador ativo.");
  const duration=workRules.standardShiftDurationMinutes;
  if(duration===null||!Number.isInteger(duration)||duration<15||
     duration>1440||duration%15!==0)
    issues.push("Define a duração padrão do turno nas Regras, em passos de 15 minutos.");
  if(new Set(availabilities.map(a=>a.personId)).size!==availabilities.length)
    issues.push("Existem registos de disponibilidade duplicados.");
  let someAvailability=false;
  for(const p of active){
    const a=availabilities.find(row=>row.personId===p.id);
    if(!a){issues.push(p.name+": disponibilidade não configurada.");continue;}
    if(a.unavailableWeekdays &&
       (new Set(a.unavailableWeekdays).size!==a.unavailableWeekdays.length||
        a.unavailableWeekdays.some(day=>!WEEKDAYS.includes(day))))
      issues.push(p.name+": dias indisponíveis explícitos inválidos.");
    for(const day of WEEKDAYS){
      const state=availabilityDayStatus(a,day,weeklyHours[day]);
      if(state==="unconfigured")issues.push(p.name+": "+day+" por configurar.");
      if(state==="invalid")issues.push(p.name+": "+day+" contém períodos inválidos.");
      if(state==="available")someAvailability=true;
    }
    if(new Set(a.exceptions.map(e=>e.date)).size!==a.exceptions.length)
      issues.push(p.name+": datas de exceção repetidas.");
    for(let i=0;i<a.exceptions.length;i++){
      const result=validateAvailabilityException(a.exceptions[i],a.exceptions,
        i,weeklyHours,operatingExceptions);
      if(!result.valid)issues.push(p.name+": "+result.issue);
    }
  }
  if(!someAvailability)
    issues.push("Define pelo menos um período escalável para a equipa ativa.");
  return {valid:issues.length===0,issues};
}

export function availabilityAndRulesFingerprint(
  availabilities:PersonAvailability[],workRules:WorkRulesConfiguration,
):string {
  const ordered=availabilities.map(a=>[
    a.personId,
    ...WEEKDAYS.map(day=>[day,a.weeklyAvailability[day]
      .map(i=>[i.start,i.end]).sort((x,y)=>x[0].localeCompare(y[0]))]),
    [...(a.unavailableWeekdays??[])].sort(),
    a.exceptions.map(e=>[e.date,e.intervals
      .map(i=>[i.start,i.end]).sort((x,y)=>x[0].localeCompare(y[0]))])
      .sort((x,y)=>String(x[0]).localeCompare(String(y[0]))),
  ]).sort((x,y)=>String(x[0]).localeCompare(String(y[0])));
  return JSON.stringify([ordered,workRules]);
}

export function isAvailabilityAndRulesConfirmed(
  onboarding:OnboardingConfiguration|undefined,teamConfirmed:boolean,
  people:Person[],availabilities:PersonAvailability[],
  weeklyHours:WeeklyOperatingHours,
  operatingExceptions:OperatingHoursException[],
  workRules:WorkRulesConfiguration,
):boolean {
  return teamConfirmed &&
    validateAvailabilityConfiguration(people,availabilities,weeklyHours,
      operatingExceptions,workRules).valid &&
    onboarding?.availabilityRulesConfirmedFingerprint ===
      availabilityAndRulesFingerprint(availabilities,workRules);
}
