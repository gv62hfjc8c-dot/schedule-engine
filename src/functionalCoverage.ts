import {
  clockMinutes,effectiveWorkIntervals,validateWorkAssignment,
  type WorkAssignment,
} from "./workAssignments";

/** Generic functional allocation: checkout and sales are role IDs, not
 * separate rosters. Qualification is NOT an assignment to a role.
 *
 * A person receives one role for the whole shift. This first version does
 * not permit switching functions during one shift, even for a polyvalent.
 * The validator below independently checks qualification, exclusivity
 * and minute-accurate coverage, including meal breaks.
 */
export interface FunctionalMember {
  id:string;
  active:boolean;
  qualifiedRoles?:readonly string[];
}
export interface FunctionalCoverageInput {
  date:string;
  members:readonly FunctionalMember[];
  assignments:readonly WorkAssignment[];
  opening:readonly {start:string;end:string}[];
  roles:readonly string[];
  /** SOFT simultaneous presence goal based on qualified active members.
   * Polyvalents count in each qualification pool, once in actual coverage.
   * Hard operational minimums, if introduced, are a separate policy.
   */
  minimumPercent:number;
}
export interface FunctionalRoleAssignment {
  memberId:string;
  role:string;
}
export type FunctionalIssueCode=
  |"INVALID_INPUT"|"UNASSIGNED_MEMBER"
  |"UNQUALIFIED_MEMBER"|"DUPLICATE_ROLE_ASSIGNMENT"
  |"NO_QUALIFIED_MEMBERS"|"ROLE_COVERAGE_GAP";
export interface FunctionalIssue {
  code:FunctionalIssueCode;
  memberId?:string;
  role?:string;
  start?:string;
  end?:string;
  missing?:number;
}
export interface FunctionalCoverageSlot {
  start:string;
  end:string;
  counts:Record<string,number>;
}
export interface FunctionalCoverageReport {
  /** "uncovered" means under the SOFT percentage target, not invalid. */
  status:"covered"|"uncovered"|"invalid_input";
  targets:Record<string,number>;
  qualified:Record<string,number>;
  slots:FunctionalCoverageSlot[];
  issues:FunctionalIssue[];
}
export interface FunctionalAllocationResult {
  allocations:FunctionalRoleAssignment[];
  certification:FunctionalCoverageReport;
}

type Interval={start:number;end:number};
type Validated={
  roles:string[];
  opening:Interval[];
  members:Map<string,FunctionalMember>;
  work:Map<string,Interval[]>;
  qualified:Record<string,number>;
  targets:Record<string,number>;
  cuts:number[];
};

function time(min:number):string {
  return String(Math.floor(min/60)).padStart(2,"0")+":"+
    String(min%60).padStart(2,"0");
}
function read(input:FunctionalCoverageInput):Validated|null {
  if(!input || !Number.isFinite(input.minimumPercent) ||
    input.minimumPercent<0 || input.minimumPercent>100 ||
    !Array.isArray(input.roles) || !input.roles.length ||
    input.roles.some(role=>typeof role!=="string" ||
      !/^[a-z][a-z0-9_-]*$/.test(role)) ||
    new Set(input.roles).size!==input.roles.length ||
    !Array.isArray(input.members) ||
    !Array.isArray(input.assignments) ||
    !Array.isArray(input.opening))return null;
  const date=new Date(input.date+"T12:00:00Z");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(input.date) ||
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0,10)!==input.date)return null;
  const roles=[...input.roles];
  const members=new Map<string,FunctionalMember>();
  for(const person of input.members){
    if(!person || typeof person.id!=="string" || !person.id ||
      typeof person.active!=="boolean" ||
      members.has(person.id) ||
      (person.qualifiedRoles!==undefined &&
        (!Array.isArray(person.qualifiedRoles) ||
          person.qualifiedRoles.some((role:unknown)=>
            typeof role!=="string" || !/^[a-z][a-z0-9_-]*$/.test(role)) ||
          new Set(person.qualifiedRoles).size!==person.qualifiedRoles.length)))
      return null;
    members.set(person.id,person);
  }
  const opening:Interval[]=[];
  for(const window of input.opening){
    try {
      const start=clockMinutes(window.start),end=clockMinutes(window.end);
      if(start>=end)return null;
      opening.push({start,end});
    }catch{return null;}
  }
  opening.sort((a,b)=>a.start-b.start);
  if(opening.some((w,i)=>i>0 && opening[i-1].end>w.start))
    return null;
  const work=new Map<string,Interval[]>();
  for(const raw of input.assignments){
    const shift=validateWorkAssignment(raw);
    if(!shift || shift.date!==input.date)return null;
    const person=members.get(shift.memberId);
    if(!person || !person.active || work.has(shift.memberId))return null;
    work.set(shift.memberId,effectiveWorkIntervals(shift));
  }
  // Object.fromEntries creates own data properties even for edge-case
  // identifiers; never treat user-supplied role IDs as prototype keys.
  const qualified=Object.fromEntries(roles.map(role=>[role,0])) as Record<string,number>;
  const targets=Object.fromEntries(roles.map(role=>[role,0])) as Record<string,number>;
  for(const role of roles){
    qualified[role]=[...members.values()].filter(m=>m.active &&
      m.qualifiedRoles?.includes(role)).length;
    targets[role]=Math.ceil(qualified[role]*input.minimumPercent/100);
  }
  const cuts=[...new Set([
    ...opening.flatMap(w=>[w.start,w.end]),
    ...[...work.values()].flatMap(intervals=>
      intervals.flatMap(w=>[w.start,w.end])),
  ])].sort((a,b)=>a-b);
  return {roles,opening,members,work,qualified,targets,cuts};
}

function coverageSlots(
  model:Validated,allocations:ReadonlyMap<string,string>,
):FunctionalCoverageSlot[]{
  const slots:FunctionalCoverageSlot[]=[];
  for(let i=0;i<model.cuts.length-1;i++){
    const start=model.cuts[i],end=model.cuts[i+1];
    if(!model.opening.some(w=>w.start<=start&&w.end>=end))continue;
    const counts=Object.fromEntries(
      model.roles.map(role=>[role,0]),
    ) as Record<string,number>;
    for(const [id,role] of allocations){
      const intervals=model.work.get(id);
      if(counts[role]===undefined || !intervals)continue;
      if(intervals.some(w=>w.start<=start&&w.end>=end))
        counts[role]++;
    }
    slots.push({start:time(start),end:time(end),counts});
  }
  return slots;
}

/** Independent role-and-target evaluator. Never trusts the planner.
 * INVALID_INPUT issues violate HARD role integrity.
 * ROLE_COVERAGE_GAP is a SOFT objective shortfall only.
 */
export function certifyFunctionalCoverage(
  input:FunctionalCoverageInput,
  assignments:readonly FunctionalRoleAssignment[],
):FunctionalCoverageReport {
  const model=read(input);
  if(!model || !Array.isArray(assignments))
    return {status:"invalid_input",qualified:{},targets:{},slots:[],
      issues:[{code:"INVALID_INPUT"}]};
  const issues:FunctionalIssue[]=[];
  const allocation=new Map<string,string>();
  for(const entry of assignments){
    if(!entry || typeof entry.memberId!=="string" ||
      typeof entry.role!=="string" ||
      !model.work.has(entry.memberId) || 
      !model.roles.includes(entry.role)){
      issues.push({code:"INVALID_INPUT"});
      continue;
    }
    if(allocation.has(entry.memberId)){
      issues.push({code:"DUPLICATE_ROLE_ASSIGNMENT",memberId:entry.memberId});
      continue;
    }
    const person=model.members.get(entry.memberId)!;
    if(!person.qualifiedRoles?.includes(entry.role)){
      issues.push({code:"UNQUALIFIED_MEMBER",
        memberId:entry.memberId,role:entry.role});
      continue;
    }
    allocation.set(entry.memberId,entry.role);
  }
  for(const id of model.work.keys())
    if(!allocation.has(id) &&
      !issues.some(issue=>issue.code==="UNQUALIFIED_MEMBER"&&issue.memberId===id))
      issues.push({code:"UNASSIGNED_MEMBER",memberId:id});
  for(const role of model.roles)
    if(model.qualified[role]===0)
      issues.push({code:"NO_QUALIFIED_MEMBERS",role});
  const slots=coverageSlots(model,allocation);
  for(const slot of slots){
    for(const role of model.roles){
      if(slot.counts[role]<model.targets[role])
        issues.push({code:"ROLE_COVERAGE_GAP",role,
          start:slot.start,end:slot.end,
          missing:model.targets[role]-slot.counts[role]});
    }
  }
  const malformed=issues.some(issue=>issue.code!=="ROLE_COVERAGE_GAP"&&
    issue.code!=="NO_QUALIFIED_MEMBERS");
  return {
    status:malformed?"invalid_input":issues.length?"uncovered":"covered",
    targets:model.targets,qualified:model.qualified,slots,issues,
  };
}

/** A deterministic SOFT quality score for an incomplete allocation.
 * Deviation from the aspirational 50% goal precedes role balancing.
 * A target shortfall never implies a hard scheduling violation.
 */
function score(
  model:Validated,assigned:ReadonlyMap<string,string>,
):[number,number]{
  const slots=coverageSlots(model,assigned);
  let deficit=0,balance=0;
  for(const slot of slots){
    const duration=clockMinutes(slot.end)-clockMinutes(slot.start);
    const counts=model.roles.map(role=>slot.counts[role]);
    for(let i=0;i<counts.length;i++){
      const role=model.roles[i];
      deficit+=Math.max(0,model.targets[role]-counts[i])*duration;
      for(let j=0;j<i;j++)
        balance+=Math.abs(counts[i]-counts[j])*duration;
    }
  }
  return [deficit,balance];
}
function better(a:readonly number[],b:readonly number[]):boolean {
  for(let i=0;i<a.length;i++){
    if(a[i]<b[i])return true;
    if(a[i]>b[i])return false;
  }
  return false;
}

/** Allocates one role per scheduled person for the WHOLE DAY.
 * Specialists are fixed first. Polyvalents are assigned by deficits and
 * operational balance, followed by deterministic single-role improvements.
 * Heuristic only: when a solution cannot be certified, return explicit gaps.
 */
export function allocateFunctionalCoverage(
  input:FunctionalCoverageInput,
):FunctionalAllocationResult {
  const model=read(input);
  if(!model)return {allocations:[],
    certification:certifyFunctionalCoverage(input,[])};
  const decisions=new Map<string,string>();
  const flexible:{id:string;roles:string[]}[]=[];
  for(const id of [...model.work.keys()].sort()){
    const person=model.members.get(id)!;
    const eligible=model.roles.filter(role=>
      person.qualifiedRoles?.includes(role));
    if(eligible.length===1)decisions.set(id,eligible[0]);
    else if(eligible.length>1)flexible.push({id,roles:eligible});
  }
  const choose=(id:string,options:readonly string[])=>{
    let bestRole=options[0];
    let best:[number,number]|null=null;
    for(const role of options){
      decisions.set(id,role);
      const test=score(model,decisions);
      if(best===null || better(test,best)){
        best=test;bestRole=role;
      }
    }
    decisions.set(id,bestRole);
  };
  for(const person of flexible)choose(person.id,person.roles);
  // A bounded local pass improves partial shift overlaps without factorial
  // search across all polyvalents. Recheck hard coverage independently.
  for(let pass=0;pass<4;pass++){
    let changed=false;
    for(const person of flexible){
      const old=decisions.get(person.id)!;
      const before=score(model,decisions);
      choose(person.id,person.roles);
      if(!better(score(model,decisions),before)){
        decisions.set(person.id,old);
      }else changed=true;
    }
    if(!changed)break;
  }
  const allocations=[...decisions]
    .map(([memberId,role])=>({memberId,role}))
    .sort((a,b)=>a.memberId.localeCompare(b.memberId,"en"));
  return {
    allocations,
    certification:certifyFunctionalCoverage(input,allocations),
  };
}
