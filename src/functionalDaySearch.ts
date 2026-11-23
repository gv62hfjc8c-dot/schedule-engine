/**
 * Bounded, deterministic, read-only optimizer for ONE functional workday.
 *
 * Intended for experimental rest exchanges, not normal generation. Hours,
 * work dates, team qualifications and one shift per person remain immutable.
 * A successful plan never exceeds the SOFT 50% role target at any open minute
 * and never worsens the HARD company coverage or the requested solo target.
 *
 * This is intentionally a narrow finite search, not an unbounded solver.
 */
import {mealDayOptions,type NumericOpening} from "./mealBreaks";
import {assignmentMinutes,clockMinutes,effectiveWorkIntervals,
  type WorkAssignment} from "./workAssignments";
import {measureSimultaneousCoverage} from "./simultaneousCoverage";
import type {TeamMember} from "./team";

interface Alternative {
  shift:WorkAssignment;
  absent:bigint;
  motion:number;
}
interface RoleGroup {
  roles:string[];
  chosen:Alternative[];
  cost:number;
}
const MAX_PEOPLE=10;
const MAX_OPTIONS=200;
const MAX_ROLE_ASSIGNMENTS=32;
const BEAM_WIDTH=384;
const MAX_GROUP_SOLUTIONS=5;

function movement(before:WorkAssignment,after:WorkAssignment):number {
  return Math.abs(clockMinutes(before.start)-clockMinutes(after.start))+
    Math.abs(clockMinutes(before.end)-clockMinutes(after.end))+
    (before.mealBreak && after.mealBreak
      ?Math.abs(clockMinutes(before.mealBreak.start)-
        clockMinutes(after.mealBreak.start)):0)+
    (before.role===after.role?0:30);
}
function countBits(value:bigint):number {
  let bits=value,n=0;
  while(bits){n++;bits&=bits-1n;}
  return n;
}
function variants(
  original:WorkAssignment,role:string,minutes:number,
  opening:readonly NumericOpening[],clockSlots:readonly number[],
):Alternative[] {
  const found=mealDayOptions(original.memberId,original.date,opening,minutes,
    false).map(shift=>{
      const assigned={...shift,role};
      const work=effectiveWorkIntervals(assigned);
      let absent=0n;
      clockSlots.forEach((t,i)=>{
        if(!work.some(w=>w.start<=t&&t<w.end))
          absent|=1n<<BigInt(i);
      });
      return {shift:assigned,absent,motion:movement(original,assigned)};
    });
  found.sort((a,b)=>a.motion-b.motion||
    a.shift.start.localeCompare(b.shift.start)||
    (a.shift.mealBreak?.start??"").localeCompare(b.shift.mealBreak?.start??""));
  return found.slice(0,MAX_OPTIONS);
}

/** For n=target+1, someone must be away from this role at EVERY moment.
 * Solve the absence-union problem with a bounded beam search over shifts. */
function rolePlans(
  people:readonly WorkAssignment[],role:string,
  target:number,minutes:ReadonlyMap<string,number>,
  opening:readonly NumericOpening[],clockSlots:readonly number[],
):{chosen:Alternative[];cost:number}[] {
  const all=people.map(person=>variants(person,role,
    minutes.get(person.memberId)??assignmentMinutes(person),
    opening,clockSlots));
  if(all.some(options=>options.length===0))return [];
  if(people.length<=target){
    const basic=all.map(options=>options[0]);
    // Alternative near-origin positions can avoid a solo minute even
    // when the first placement is tied on functional quality.
    const plans=[basic,...all.flatMap((options,i)=>
      options.slice(1,3).map(option=>
        basic.map((old,j)=>i===j?option:old)))];
    return plans.map(chosen=>({chosen,cost:chosen.reduce(
      (sum,option)=>sum+option.motion,0)}))
      .sort((a,b)=>a.cost-b.cost).slice(0,MAX_GROUP_SOLUTIONS);
  }
  if(people.length!==target+1)return [];
  const completeMask=(1n<<BigInt(clockSlots.length))-1n;
  type State={mask:bigint;chosen:Alternative[];cost:number};
  let states:State[]=[{mask:0n,chosen:[],cost:0}];
  for(const options of all){
    const unique=new Map<bigint,State>();
    for(const state of states)for(const option of options){
      const mask=state.mask|option.absent;
      const cost=state.cost+option.motion;
      const old=unique.get(mask);
      if(!old || cost<old.cost)
        unique.set(mask,{mask,chosen:[...state.chosen,option],cost});
    }
    states=[...unique.values()].sort((a,b)=>
      countBits(b.mask)-countBits(a.mask)||a.cost-b.cost)
      .slice(0,BEAM_WIDTH);
    if(!states.length)return [];
  }
  return states.filter(state=>state.mask===completeMask)
    .sort((a,b)=>a.cost-b.cost)
    .slice(0,MAX_GROUP_SOLUTIONS)
    .map(({chosen,cost})=>({chosen,cost}));
}

export function searchBalancedFunctionalDay(input:{
  date:string;
  shifts:readonly WorkAssignment[];
  opening:readonly NumericOpening[];
  members:readonly TeamMember[];
  roles:readonly string[];
  /** Effective minutes may change only for explicitly selected people. */
  minutesOverride?:ReadonlyMap<string,number>;
  /** Upper bound on soft lone-worker time, computed from control schedule. */
  maxSoloMinutes:number;
}):WorkAssignment[]|null {
  const {date,shifts,opening,members,roles}=input;
  if(shifts.length===0||shifts.length>MAX_PEOPLE||
    opening.length!==1||opening[0].end<=opening[0].start||
    (opening[0].end-opening[0].start)%15!==0)return null;
  if(shifts.some(s=>s.date!==date || s.role===undefined) ||
    new Set(shifts.map(s=>s.memberId)).size!==shifts.length)return null;
  const clockSlots:number[]=[];
  for(let t=opening[0].start;t<opening[0].end;t+=15)clockSlots.push(t);
  const byId=new Map(members.map(member=>[member.id,member]));
  const eligible=shifts.map(shift=>
    roles.filter(role=>byId.get(shift.memberId)?.qualifiedRoles?.includes(role)));
  if(eligible.some(options=>options.length===0))return null;
  const targets=new Map(roles.map(role=>[role,Math.ceil(
    members.filter(m=>m.active&&m.qualifiedRoles?.includes(role)).length/2
  )]));
  const decisions:string[][]=[];
  function enumerate(index:number,chosen:string[]):void {
    if(decisions.length>=MAX_ROLE_ASSIGNMENTS)return;
    if(index===shifts.length){decisions.push([...chosen]);return;}
    const ordered=[...eligible[index]].sort((a,b)=>
      (a===shifts[index].role?-1:b===shifts[index].role?1:0)||
      a.localeCompare(b));
    for(const role of ordered){chosen.push(role);enumerate(index+1,chosen);chosen.pop();}
  }
  enumerate(0,[]);
  let best:{shifts:WorkAssignment[];solo:number;motion:number}|null=null;
  const minutes=input.minutesOverride??new Map<string,number>();
  for(const allocation of decisions){
    const groups=roles.map(role=>{
      const members=shifts.filter((_,i)=>allocation[i]===role);
      return rolePlans(members,role,targets.get(role)??0,
        minutes,opening,clockSlots);
    });
    if(groups.some(g=>g.length===0))continue;
    function combinations(index:number,selected:Alternative[],cost:number):void {
      if(index===groups.length){
        const planned=selected.map(s=>s.shift)
          .sort((a,b)=>a.memberId.localeCompare(b.memberId));
        const coverage=measureSimultaneousCoverage(planned,opening);
        if(coverage.uncoveredMinutes!==0 ||
          coverage.soloMinutes>input.maxSoloMinutes)return;
        if(!best || coverage.soloMinutes<best.solo ||
          (coverage.soloMinutes===best.solo&&cost<best.motion))
          best={shifts:planned,solo:coverage.soloMinutes,motion:cost};
        return;
      }
      for(const group of groups[index])
        combinations(index+1,[...selected,...group.chosen],
          cost+group.cost);
    }
    combinations(0,[],0);
  }
  return (best as {shifts:WorkAssignment[]}|null)?.shifts??null;
}
