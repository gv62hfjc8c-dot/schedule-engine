import {WEEKDAYS,type Weekday} from "./operatingHours";

/**
 * Minimal team identity. "active" means eligible for future scheduling, not
 * a shift assignment, attendance record or absence. Eligibility windows are
 * derived from the organisation's operating hours, not stored per person.
 *
 * A weekly days-off COUNT is optional until configured. No weekday is fixed;
 * a day without a shift is not automatically labeled an official day off.
 * No contract, personal contact or legal identifiers at this stage.
 * Explicit role qualifications are capabilities, never simultaneous work
 * assignments or an implicit guarantee of functional coverage.
 */
/** Current retail role presets; other business role catalogs belong in a
 * later, data-driven configuration stage, not in the core scheduler.
 */
export const OPERATIONAL_ROLES=["checkout","sales"] as const;
export type OperationalRole=typeof OPERATIONAL_ROLES[number];

export interface TeamMember {
  id: string;
  name: string;
  active: boolean;
  /** Which functions this person is qualified to cover.
   * Omitted means UNKNOWN on legacy rosters, never "both".
   * A dual-qualified person still counts as ONE person at any instant.
   */
  qualifiedRoles?: OperationalRole[];
  /** Exact number of non-working calendar days per Monday-Sunday week (0..6).
   * Omitted for legacy rosters: no days-off constraint is implied. */
  weeklyDaysOff?: number;
  /** Explicit recurring mandatory rest weekdays; absent for legacy teams. */
  fixedDaysOff?: Weekday[];
  /** Opt-in rest rotation: a full Saturday+Sunday may add weekday rest. */
  weekendRest?: {minimumWeekdayDaysOffOnFullWeekend:number};
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
    const member=item as {id?:unknown;name?:unknown;active?:unknown;
      weeklyDaysOff?:unknown;fixedDaysOff?:unknown;weekendRest?:unknown;
      qualifiedRoles?:unknown};
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
    if(member.weeklyDaysOff!==undefined && (
      typeof member.weeklyDaysOff!=="number" ||
      !Number.isInteger(member.weeklyDaysOff) ||
      member.weeklyDaysOff<0 || member.weeklyDaysOff>6
    ))
      return {valid:false,value:null,issues:[
        "As folgas semanais devem ser um número inteiro entre 0 e 6.",
      ]};
    const roles=member.qualifiedRoles;
    if(roles!==undefined && (
      !Array.isArray(roles) || roles.length<1 ||
      roles.length>OPERATIONAL_ROLES.length ||
      roles.some(role=>!OPERATIONAL_ROLES.some(allowed=>allowed===role)) ||
      new Set(roles).size!==roles.length
    ))return {valid:false,value:null,issues:[
      "As funções devem ser Caixa, Vendas ou ambas, sem repetições.",
    ]};
    const fixedDays=member.fixedDaysOff??[];
    if(!Array.isArray(fixedDays) ||
      fixedDays.some(day=>!WEEKDAYS.some(weekday=>weekday.id===day)) ||
      new Set(fixedDays).size!==fixedDays.length ||
      (fixedDays.length>0 && (member.weeklyDaysOff===undefined ||
        fixedDays.length>member.weeklyDaysOff)))
      return {valid:false,value:null,issues:[
        "As folgas fixas devem ser dias distintos e caber nas folgas habituais.",
      ]};
    let weekendRest:TeamMember["weekendRest"];
    if(member.weekendRest!==undefined){
      if(!member.weekendRest || typeof member.weekendRest!=="object" ||
        Array.isArray(member.weekendRest) ||
        member.weeklyDaysOff===undefined)
        return {valid:false,value:null,issues:[
          "Configura as folgas habituais antes de ativar a rotação de fins de semana.",
        ]};
      const minimum=(member.weekendRest as {minimumWeekdayDaysOffOnFullWeekend?:unknown})
        .minimumWeekdayDaysOffOnFullWeekend;
      if(typeof minimum!=="number" || !Number.isInteger(minimum) ||
        minimum<0 || minimum>5)
        return {valid:false,value:null,issues:[
          "O descanso mínimo durante a semana deve ser entre zero e cinco dias.",
        ]};
      weekendRest={minimumWeekdayDaysOffOnFullWeekend:minimum};
    }
    seen.add(id);
    checked.push({
      id,name,active:member.active,
      ...(roles===undefined?{}:{qualifiedRoles:OPERATIONAL_ROLES.filter(
        role=>roles.includes(role),
      )}),
      ...(member.weeklyDaysOff===undefined ? {} :
        {weeklyDaysOff:member.weeklyDaysOff}),
      ...(member.fixedDaysOff===undefined?{}:{fixedDaysOff:[...fixedDays] as Weekday[]}),
      ...(weekendRest===undefined?{}:{weekendRest}),
    });
  }
  return {valid:true,value:{members:checked},issues:[]};
}

/** Unknown roles do not imply qualification, even for legacy staff.
 * This is NOT a function-level coverage report: assignments are still
 * unlabelled until the functional allocation phase is implemented.
 */
export function isQualifiedForRole(
  member:TeamMember,role:OperationalRole,
):boolean {
  return member.qualifiedRoles?.includes(role)??false;
}

/** Distinct names can be identical; only the stable ID must be unique. */
export function teamIsReady(input:unknown):boolean {
  const checked=validateTeamRoster(input);
  return checked.valid && checked.value.members.some(member=>member.active);
}

export function countActiveMembers(roster:TeamRoster):number {
  return roster.members.filter(member=>member.active).length;
}
