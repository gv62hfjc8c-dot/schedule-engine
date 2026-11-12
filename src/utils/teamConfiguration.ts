import type {Person} from "../types";
import {normalizePersonName} from "./people";
import {validatePeopleSchedulingPolicies} from "./personSchedulingPolicies";
import {validateEmploymentPeriods} from "./employmentPeriods";
import type {OnboardingConfiguration} from "./accountingCycleConfiguration";

export type EligibilityChoice="unrestricted"|"periods"|"none";
export type PersonDraftResult =
  | {valid:true;person:Person}
  | {valid:false;issue:string};

/** The user must make an explicit eligibility choice for new people.
 * Historical undefined employmentPeriods continue to mean unrestricted. */
export function validatePersonDraft(
  person:Person,choice:EligibilityChoice|null,
):PersonDraftResult {
  if(choice===null)return {valid:false,issue:"Escolhe como este colaborador pode ser escalado ao longo do tempo."};
  let name:string;
  try{name=normalizePersonName(person.name);}
  catch{return {valid:false,issue:"Indica o nome do colaborador."};}
  if(name.length>160)return {valid:false,issue:"O nome não pode exceder 160 caracteres."};
  const candidate:Person={...person,name};
  if(choice==="unrestricted"){
    delete candidate.employmentPeriods;
  }else if(choice==="none"){
    if(candidate.active)return {valid:false,issue:"Um colaborador ativo precisa de um período elegível ou de elegibilidade sem restrição de datas."};
    candidate.employmentPeriods=[];
  }else{
    if(!candidate.employmentPeriods?.length)
      return {valid:false,issue:"Define pelo menos um período de vínculo ou escolhe a opção sem restrição de datas."};
    const issues=validateEmploymentPeriods(candidate.employmentPeriods);
    if(issues.length)return {valid:false,issue:issues.join(" ")};
    candidate.employmentPeriods=candidate.employmentPeriods.map(p=>({...p}));
  }
  const issues=validatePeopleSchedulingPolicies([candidate]);
  if(issues.length)return {valid:false,issue:issues.join(" ")};
  return {valid:true,person:candidate};
}

export function validateTeamConfiguration(people:Person[]):{valid:boolean;issues:string[]} {
  const issues:string[]=[];
  if(!people.some(p=>p.active))
    issues.push("Adiciona ou reativa pelo menos um colaborador.");
  if(new Set(people.map(p=>p.id)).size!==people.length ||
     people.some(p=>!p.id.trim()))
    issues.push("Os identificadores de colaboradores devem ser únicos e válidos.");
  for(const p of people){
    if(!p.name.trim()||p.name.length>160)
      issues.push("Existe um colaborador com nome inválido.");
    if(p.active&&p.employmentPeriods!==undefined&&p.employmentPeriods.length===0)
      issues.push(p.name+": colaborador ativo sem qualquer período de elegibilidade.");
  }
  issues.push(...validatePeopleSchedulingPolicies(people));
  return {valid:issues.length===0,issues};
}

/** All schedule-relevant person fields are included, not availability (step 4).
 * Stable ordering avoids false invalidation when cards are sorted on screen. */
export function teamFingerprint(people:Person[]):string {
  return JSON.stringify([...people].sort((a,b)=>a.id.localeCompare(b.id)).map(p=>[
    p.id,p.name,p.active,
    p.employmentPeriods===undefined ? "unrestricted" :
      [...p.employmentPeriods].sort((a,b)=>a.startDate.localeCompare(b.startDate))
        .map(x=>[x.startDate,x.endDate]),
    p.weeklyContractMinutes??null,p.weeklyTargetMinutes??null,
    [...(p.qualificationTags??[])].sort(),
    [...(p.requiredWorkDates??[])].sort(),
    [...(p.unavailableWorkDates??[])].sort(),
  ]));
}

export function isTeamConfirmed(
  onboarding:OnboardingConfiguration|undefined,
  prerequisitesConfirmed:boolean,people:Person[],
):boolean{
  return prerequisitesConfirmed &&
    validateTeamConfiguration(people).valid &&
    onboarding?.teamConfirmedFingerprint===teamFingerprint(people);
}
