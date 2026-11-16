/**
 * Minimal team identity. "active" means eligible for future scheduling, not
 * currently on shift, on leave, available or present.
 *
 * No contract, role, personal contact or legal identifiers at this stage.
 */
export interface TeamMember {
  id: string;
  name: string;
  active: boolean;
}
export interface TeamRoster {
  members: TeamMember[];
}

export type TeamValidation =
  | {valid:true; value:TeamRoster; issues:[]}
  | {valid:false;value:null;issues:string[]};

const UUID_V4=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_MEMBERS=500;
export const EMPTY_TEAM:TeamRoster={members:[]};

export function validateTeamName(input:unknown):string|null {
  if(typeof input!=="string")return null;
  const normalized=input.trim().replace(/\s+/gu," ").normalize("NFC");
  if(normalized.length<2 || normalized.length>120 ||
    /[\p{Cc}\p{Cf}]/u.test(normalized))return null;
  return normalized;
}

/**
 * Structural validity and onboarding readiness are different.
 * An empty roster, or one with only inactive people, can be saved as a draft
 * but can never complete the team section.
 */
export function validateTeamRoster(input:unknown):TeamValidation {
  if(!input || typeof input!=="object" || Array.isArray(input))
    return {valid:false,value:null,issues:["Os dados da equipa são inválidos."]};
  const members=(input as {members?:unknown}).members;
  if(!Array.isArray(members) || members.length>MAX_MEMBERS)
    return {valid:false,value:null,issues:["A lista de colaboradores é inválida."]};
  const seen=new Set<string>();
  const checked:TeamMember[]=[];
  for(const item of members){
    if(!item || typeof item!=="object" || Array.isArray(item))
      return {valid:false,value:null,issues:["Existe um colaborador com dados inválidos."]};
    const member=item as {id?:unknown;name?:unknown;active?:unknown};
    const name=validateTeamName(member.name);
    if(!name)return {valid:false,value:null,
      issues:["O nome deve conter entre 2 e 120 caracteres válidos."]};
    if(typeof member.id!=="string" || !UUID_V4.test(member.id))
      return {valid:false,value:null,issues:["O identificador de um colaborador é inválido."]};
    const id=member.id.toLowerCase();
    if(seen.has(id))
      return {valid:false,value:null,issues:["Existem colaboradores com identificadores repetidos."]};
    if(typeof member.active!=="boolean")
      return {valid:false,value:null,issues:["O estado de um colaborador é inválido."]};
    seen.add(id);
    checked.push({id,name,active:member.active});
  }
  return {valid:true,value:{members:checked},issues:[]};
}

/** Distinct names can be identical; only the stable ID must be unique. */
export function teamIsReady(input:unknown):boolean {
  const checked=validateTeamRoster(input);
  return checked.valid && checked.value.members.some(member=>member.active);
}

export function countActiveMembers(roster:TeamRoster):number {
  return roster.members.filter(member=>member.active).length;
}
