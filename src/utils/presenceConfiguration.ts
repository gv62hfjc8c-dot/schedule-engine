import type {
  OperatingHoursException,PresenceException,PresenceRequirement,
  Weekday,WeeklyOperatingHours,WeeklyPresenceRequirements,
} from "../types";
import {WEEKDAYS} from "./operatingCalendar";
import {isPresenceRequirementValid} from "./presence";
import {isValidCivilDate} from "./operationConfigurationDraft";
import type {OnboardingConfiguration} from "./accountingCycleConfiguration";

/** Canonical data snapshot; never substitute "all zero" for a missing rule. */
export function coverageFingerprint(
  weeklyHours:WeeklyOperatingHours,
  operatingExceptions:OperatingHoursException[],
  weekly:WeeklyPresenceRequirements,
  exceptions:PresenceException[],
):string {
  const requirement=(item:PresenceRequirement|null)=>item===null?null:[
    item.minimumDuringOperation,item.minimumAtOpening,item.minimumAtClosing,
    Object.entries(item.qualifiedCoverage??{}).sort(([a],[b])=>a.localeCompare(b)),
  ];
  const intervals=(items:{start:string;end:string}[])=>
    items.map(x=>[x.start,x.end]).sort((a,b)=>a[0].localeCompare(b[0]));
  return JSON.stringify([
    ...WEEKDAYS.map(day=>[day,intervals(weeklyHours[day]),requirement(weekly[day])]),
    ...operatingExceptions.map(x=>[x.date,intervals(x.intervals)])
      .sort((a,b)=>String(a[0]).localeCompare(String(b[0]))),
    "presence-exceptions",
    ...exceptions.map(x=>[x.date,requirement(x.requirements)])
      .sort((a,b)=>String(a[0]).localeCompare(String(b[0]))),
  ]);
}

export function validCoverageConfiguration(
  weeklyHours:WeeklyOperatingHours,
  weekly:WeeklyPresenceRequirements,
  exceptions:PresenceException[],
):boolean {
  if(!WEEKDAYS.every(day=>weekly[day]===null ||
     isPresenceRequirementValid(weekly[day]!)))return false;
  const unique=new Set<string>();
  for(const entry of exceptions){
    if(!isValidCivilDate(entry.date)||unique.has(entry.date))return false;
    unique.add(entry.date);
    if(entry.requirements!==null &&
       !isPresenceRequirementValid(entry.requirements))return false;
  }
  // A company with no open weekdays can still have exceptional opening
  // dates, but confirmation remains scoped to the configuration itself.
  void weeklyHours;
  return true;
}

export function isCoverageConfirmed(
  onboarding:OnboardingConfiguration|undefined,
  operationConfirmed:boolean,
  weeklyHours:WeeklyOperatingHours,
  operatingExceptions:OperatingHoursException[],
  weekly:WeeklyPresenceRequirements,
  exceptions:PresenceException[],
):boolean{
  return operationConfirmed &&
    onboarding?.coverageConfirmedFingerprint ===
      coverageFingerprint(weeklyHours,operatingExceptions,weekly,exceptions) &&
    validCoverageConfiguration(weeklyHours,weekly,exceptions);
}

export type PresenceEditTarget=Weekday|"exception";
export type PresenceDraftValidation=
  |{valid:true;requirement:PresenceRequirement}
  |{valid:false;issue:string};

export function validatePresenceDraft(draft:PresenceRequirement):PresenceDraftValidation{
  if(!isPresenceRequirementValid(draft))
    return {valid:false,issue:"Os mínimos devem ser números inteiros não negativos."};
  return {valid:true,requirement:{
    minimumAtOpening:draft.minimumAtOpening,
    minimumDuringOperation:draft.minimumDuringOperation,
    minimumAtClosing:draft.minimumAtClosing,
    ...(draft.qualifiedCoverage?{qualifiedCoverage:{...draft.qualifiedCoverage}}:{}),
  }};
}

export function validatePresenceExceptionDraft(
  draft:PresenceException,existing:PresenceException[],editingIndex:number|null,
):{valid:true;value:PresenceException}|{valid:false;issue:string}{
  if(!isValidCivilDate(draft.date))
    return {valid:false,issue:"Indica uma data de exceção válida."};
  if(existing.some((item,index)=>index!==editingIndex && item.date===draft.date))
    return {valid:false,issue:"Já existe uma exceção de presença nesta data."};
  if(draft.requirements!==null){
    const r=validatePresenceDraft(draft.requirements);
    if(!r.valid)return r;
    return {valid:true,value:{date:draft.date,requirements:r.requirement}};
  }
  return {valid:true,value:{date:draft.date,requirements:null}};
}
