import {WEEKDAYS,type Weekday} from "./operatingHours";
import {
  DAILY_STAFFING_REFERENCE_PERCENT,desiredDailyHeadcount,
  compareDailyStaffing,scoreDailyStaffing,
} from "./dailyStaffingBalance";
import {
  addCivilDays,civilDayOfWeek,parseCivilDate,
} from "./schedulePeriods";

/**
 * Rest/rotation foundation: planning WHOLE DAYS, not work shifts.
 * The daily minimum is a headcount constraint for day-level feasibility;
 * it NEVER certifies minute-by-minute opening coverage.
 *
 * No legal rest rule is inferred here. Every organisation must configure
 * the applicable policy explicitly. Do not equate "no shift" with official
 * leave: the returned dates are explicitly planned non-working dates.
 */
export interface RotationMember {
  id:string;
  /** Normal week's exact number of non-working calendar days (0..6). */
  weeklyDaysOff:number;
  /** Mandatory non-working weekdays, independent of weekend allocation. */
  fixedDaysOff:readonly Weekday[];
  /**
   * Minimum Monday-Friday non-working days if BOTH Saturday and Sunday
   * are awarded as a full weekend off. E.g. 1 => weekend + midweek day.
   * The ordinary weeklyDaysOff count may be exceeded in this situation.
   */
  minimumWeekdayDaysOffOnFullWeekend:number;
  /** False = respect fixed/ordinary days off, but do not award weekends. */
  eligibleFullWeekend?:boolean;
}

export type WeekdayNumbers=Record<Weekday,number>;

export interface RotationHistoryEntry {
  memberId:string;
  /** Monday anchoring the historical Saturday + Sunday off. */
  weekStart:string;
}

export interface WeekendRotationInput {
  /** Monday at the start of the planning horizon; never a month reset. */
  startWeek:string;
  weeks:number;
  members:readonly RotationMember[];
  /** Minimum people present on each civil day, NOT hourly coverage. */
  minimumPresentByWeekday:WeekdayNumbers;
  /** Explicit closures. A zero minimum alone does not mean closed. */
  closedWeekdays?:readonly Weekday[];
  /** Optional V2 effective work capacity per weekday (not a target). */
  maximumEffectiveMinutesByWeekday?:WeekdayNumbers;
  /**
   * SOFT optimization budget. Unlike minimum staffing, this does NOT
   * certify hours or set a contractual daily maximum. With all three
   * fields present, weekend grants are spread to avoid 28-day windows
   * that would require excessive daily work to meet the hours reference.
   */
  workloadPreference?:{
    cycleReferenceMinutes:number;
    preferredUpperDailyMinutes:number;
    cycleWeeks:number;
  };
  /** Explicit verified past full weekends only; missing history is UNKNOWN. */
  previousFullWeekends?:readonly RotationHistoryEntry[];
}

export interface PlannedMemberWeek {
  memberId:string;
  /** Explicit days without work, never automatically labelled paid leave. */
  daysWithoutWork:string[];
  fullWeekendOff:boolean;
  /** Upper bound for this exact set of workdays, not booked hours. */
  effectiveMinutesUpperBound:number|null;
}

export interface PlannedRotationWeek {
  weekStart:string;
  saturday:string;
  sunday:string;
  fullWeekendOffMemberIds:string[];
  members:PlannedMemberWeek[];
  /** All seven days, including fixed rest and organisation closures. */
  presentByWeekday:WeekdayNumbers;
}

export type RotationIssueCode=
  | "INVALID_CONFIGURATION" | "IMPOSSIBLE_DAY_MINIMUM"
  | "REST_PATTERN_INFEASIBLE" | "SEARCH_NOT_PROVEN";
export interface RotationIssue {
  code:RotationIssueCode;
  message:string;
  weekStart?:string;
  weekday?:Weekday;
}
export interface WeekendRotationResult {
  /** "planned" does not claim global optimality or shift/hour feasibility. */
  status:"planned"|"infeasible"|"not_proven";
  weeks:PlannedRotationWeek[];
  issues:RotationIssue[];
  historyProvided:boolean;
  weekendCounts:{memberId:string;prior:number;planned:number}[];
}

const IDS=WEEKDAYS.map(w=>w.id);
const DAY_INDEX=new Map<Weekday,number>(IDS.map((d,i)=>[d,i]));
const WEEKEND_MASK=(1<<5)|(1<<6);
const WEEKDAYS_MASK=(1<<5)-1;
const MAX_SEARCH_NODES=50_000;
const isDay=(v:unknown):v is Weekday=>
  typeof v==="string" && DAY_INDEX.has(v as Weekday);
const bits=(mask:number):number=>{
  let count=0;
  for(let i=0;i<7;i++)if(mask&(1<<i))count++;
  return count;
};
const has=(mask:number,index:number)=>(mask&(1<<index))!==0;
const mandatoryMask=(
  member:RotationMember,closures:ReadonlySet<Weekday>,
):number=>IDS.reduce((mask,weekday,index)=>
    mask+(member.fixedDaysOff.includes(weekday)||closures.has(weekday)
      ?(1<<index):0),0);

/** Exact number of non-working dates required by the configured policy. */
export function requiredRestDayCount(
  member:RotationMember,fullWeekendOff:boolean,
  closedWeekdays:readonly Weekday[]=[],
):number {
  let mask=mandatoryMask(member,new Set(closedWeekdays));
  if(fullWeekendOff)mask|=WEEKEND_MASK;
  if(!fullWeekendOff)return member.weeklyDaysOff;
  // A company that is permanently closed on both weekend days already
  // gives that rest structurally. It is not a specially awarded weekend
  // and must not trigger an artificial third day off midweek.
  if(closedWeekdays.includes("saturday")&&
    closedWeekdays.includes("sunday"))return member.weeklyDaysOff;
  const alreadyMidweek=bits(mask&WEEKDAYS_MASK);
  const extraMidweek=Math.max(
    0,member.minimumWeekdayDaysOffOnFullWeekend-alreadyMidweek);
  return Math.max(member.weeklyDaysOff,bits(mask)+extraMidweek);
}

function validate(input:WeekendRotationInput):RotationIssue[] {
  const issues:RotationIssue[]=[];
  const invalid=(message:string)=>issues.push({code:"INVALID_CONFIGURATION",message});
  try{
    parseCivilDate(input.startWeek);
    if(civilDayOfWeek(input.startWeek)!==0)invalid("O início deve ser segunda-feira.");
  }catch{invalid("A data inicial não é válida.");}
  if(!Number.isInteger(input.weeks)||input.weeks<1||input.weeks>52)
    invalid("O horizonte deve conter entre 1 e 52 semanas.");
  if(!Array.isArray(input.members)||input.members.length===0||
     input.members.length>500)
    invalid("A equipa deve ter entre 1 e 500 colaboradores.");
  if(issues.length)return issues;

  const existing=new Set<string>();
  const closures=input.closedWeekdays??[];
  if(!Array.isArray(closures)||closures.some(d=>!isDay(d))||
    new Set(closures).size!==closures.length)
    invalid("Existem dias de encerramento inválidos ou repetidos.");
  for(const member of input.members){
    if(!member||typeof member.id!=="string"||!member.id.trim()||
       existing.has(member.id)){
      invalid("Os identificadores dos colaboradores devem ser únicos.");
      continue;
    }
    existing.add(member.id);
    if(member.eligibleFullWeekend!==undefined &&
      typeof member.eligibleFullWeekend!=="boolean")
      invalid("A elegibilidade para rotação deve ser um valor booleano.");
    if(!Number.isInteger(member.weeklyDaysOff)||
      member.weeklyDaysOff<0||member.weeklyDaysOff>6||
      !Number.isInteger(member.minimumWeekdayDaysOffOnFullWeekend)||
      member.minimumWeekdayDaysOffOnFullWeekend<0||
      member.minimumWeekdayDaysOffOnFullWeekend>5||
      !Array.isArray(member.fixedDaysOff)||
      member.fixedDaysOff.some(day=>!isDay(day))||
      new Set(member.fixedDaysOff).size!==member.fixedDaysOff.length){
      invalid("As regras individuais de descanso são inválidas.");
      continue;
    }
    const forced=mandatoryMask(member,new Set(closures));
    if(bits(forced)>member.weeklyDaysOff)
      invalid("O descanso fixo ou o encerramento excede as folgas da semana habitual.");
    if(requiredRestDayCount(member,true,closures)>7)
      invalid("As regras do fim de semana exigem mais de sete dias de descanso.");
  }
  if(!input.minimumPresentByWeekday||
    typeof input.minimumPresentByWeekday!=="object"){
    invalid("Configura a cobertura mínima para os sete dias.");
  }else for(const day of IDS){
    const n=input.minimumPresentByWeekday[day];
    if(!Number.isInteger(n)||n<0||n>input.members.length ||
       (closures.includes(day)&&n!==0))
      invalid("A cobertura mínima de "+day+" é inválida.");
  }
  if(input.maximumEffectiveMinutesByWeekday!==undefined){
    for(const day of IDS){
      const minutes=input.maximumEffectiveMinutesByWeekday[day];
      if(!Number.isSafeInteger(minutes)||minutes<0||minutes>1440||
         (closures.includes(day)&&minutes!==0))
        invalid("A capacidade de trabalho de "+day+" é inválida.");
    }
  }
  if(input.workloadPreference!==undefined){
    const pref=input.workloadPreference;
    if(!pref || !Number.isSafeInteger(pref.cycleReferenceMinutes) ||
      pref.cycleReferenceMinutes<0 ||
      !Number.isSafeInteger(pref.preferredUpperDailyMinutes) ||
      pref.preferredUpperDailyMinutes<1 ||
      !Number.isInteger(pref.cycleWeeks) || pref.cycleWeeks<1 ||
      pref.cycleWeeks>52 || !input.maximumEffectiveMinutesByWeekday)
      invalid("A política de equilíbrio do descanso e das horas é inválida.");
  }
  if(input.previousFullWeekends!==undefined){
    if(!Array.isArray(input.previousFullWeekends)){
      invalid("O histórico de fins de semana é inválido.");
    }else{
      const seen=new Set<string>();
      for(const entry of input.previousFullWeekends){
        try{
          if(!existing.has(entry.memberId)||
            civilDayOfWeek(entry.weekStart)!==0||
            entry.weekStart>=input.startWeek ||
            seen.has(entry.memberId+"|"+entry.weekStart))
            throw new Error("invalid history");
          seen.add(entry.memberId+"|"+entry.weekStart);
        }catch{invalid("O histórico contém fins de semana inválidos.");}
      }
    }
  }
  return issues;
}

/**
 * Compute the MAXIMUM preferred (not absolute) work capacity of a rest
 * pattern. This measures the cost of awarding extra rest in terms of
 * hours that would otherwise force shifts above the preferred daily bound.
 */
function bestPreferredWeekCapacity(
  member:RotationMember,
  awarded:boolean,
  closures:ReadonlySet<Weekday>,
  dailyCap:WeekdayNumbers,
  preferredUpperDailyMinutes:number,
  requireWorkingSunday=false,
):number {
  const required=requiredRestDayCount(member,awarded,[...closures]);
  const mandatory=mandatoryMask(member,closures)|
    (awarded?WEEKEND_MASK:0);
  let best=-1;
  for(let mask=0;mask<128;mask++){
    if((mask&mandatory)!==mandatory||bits(mask)!==required ||
      (requireWorkingSunday && has(mask,6)))continue;
    const fullyClosed=closures.has("saturday")&&closures.has("sunday");
    if(awarded && !fullyClosed &&
      bits(mask&WEEKDAYS_MASK)<
        member.minimumWeekdayDaysOffOnFullWeekend)continue;
    if(!awarded && !fullyClosed &&
      (mask&WEEKEND_MASK)===WEEKEND_MASK)continue;
    const capacity=IDS.reduce((sum,day,index)=>
      sum+(has(mask,index)?0:Math.min(dailyCap[day],
        preferredUpperDailyMinutes)),0);
    if(capacity>best)best=capacity;
  }
  return best;
}

type Patterns={
  status:"feasible";masks:ReadonlyMap<string,number>;present:number[];
}|{status:"infeasible"|"not_proven"};

function findRestPatterns(
  input:WeekendRotationInput,
  weekends:ReadonlySet<string>,
  closures:ReadonlySet<Weekday>,
):Patterns {
  const persons=input.members.map(member=>{
    const mandatory=mandatoryMask(member,closures)|
      (weekends.has(member.id)?WEEKEND_MASK:0);
    const required=requiredRestDayCount(
      member,weekends.has(member.id),[...closures]);
    const options:number[]=[];
    for(let mask=0;mask<128;mask++){
      if((mask&mandatory)!==mandatory||bits(mask)!==required)continue;
      if(weekends.has(member.id)){
        if((mask&WEEKEND_MASK)!==WEEKEND_MASK)continue;
        const naturallyClosed=closures.has("saturday")&&
          closures.has("sunday");
        if(!naturallyClosed && bits(mask&WEEKDAYS_MASK)<
          member.minimumWeekdayDaysOffOnFullWeekend)continue;
      }else if((mask&WEEKEND_MASK)===WEEKEND_MASK &&
        !(closures.has("saturday")&&closures.has("sunday")))continue;
      options.push(mask);
    }
    // Earlier options avoid resting on days requiring more colleagues.
    options.sort((a,b)=>{
      const staffingCost=(mask:number)=>IDS.reduce((sum,day,index)=>
        sum+(has(mask,index)?input.minimumPresentByWeekday[day]:0),0);
      const preference=input.workloadPreference;
      const maxMinutes=input.maximumEffectiveMinutesByWeekday;
      if(preference && maxMinutes){
        const capacity=(mask:number)=>IDS.reduce((sum,day,index)=>
          sum+(has(mask,index)?0:Math.min(maxMinutes[day],
            preference.preferredUpperDailyMinutes)),0);
        const capDiff=capacity(b)-capacity(a);
        if(capDiff!==0)return capDiff;
      }
      return staffingCost(a)-staffingCost(b)||a-b;
    });
    return {id:member.id,options};
  }).sort((a,b)=>a.options.length-b.options.length||
    a.id.localeCompare(b.id));
  if(persons.some(p=>p.options.length===0))
    return {status:"infeasible"};
  const present=Array.from({length:7},()=>input.members.length);
  const chosen=new Map<string,number>();
  let nodes=0;
  let truncated=false;
  function solve(index:number):boolean {
    if(index===persons.length)return true;
    if(nodes++>=MAX_SEARCH_NODES){
      truncated=true;return false;
    }
    const person=persons[index];
    for(const mask of person.options){
      if(IDS.some((day,i)=>present[i]-(has(mask,i)?1:0)<
        input.minimumPresentByWeekday[day]))continue;
      for(let i=0;i<7;i++)if(has(mask,i))present[i]--;
      chosen.set(person.id,mask);
      if(solve(index+1))return true;
      chosen.delete(person.id);
      for(let i=0;i<7;i++)if(has(mask,i))present[i]++;
      if(truncated)return false;
    }
    return false;
  }
  if(solve(0)){
    // The first feasible allocation maximizes HARD constraints, not
    // necessarily staffing. Improve it with strict, deterministic local
    // swaps of a single person's off-days, preserving each person's
    // mandatory/fixed days and total rest exactly.
    if(input.workloadPreference!==undefined){
      const target=desiredDailyHeadcount(input.members.length,
        DAILY_STAFFING_REFERENCE_PERCENT);
      const targets=IDS.map(day=>closures.has(day)?0:target);
      const open=IDS.map(day=>!closures.has(day));
      const rank=()=>scoreDailyStaffing(present,targets,open);
      // A strict improvement at each step guarantees termination.
      // At most 16 rounds keep the experiment bounded and predictable.
      for(let round=0;round<16;round++){
        const initial=rank();
        let best:{id:string;mask:number;old:number;
          present:number[];score:ReturnType<typeof scoreDailyStaffing>}|null=null;
        for(const person of persons){
          const old=chosen.get(person.id)!;
          for(const mask of person.options){
            if(mask===old)continue;
            const proposed=present.map((count,index)=>
              count+(has(old,index)?1:0)-(has(mask,index)?1:0));
            if(proposed.some((count,index)=>
              count<input.minimumPresentByWeekday[IDS[index]]))continue;
            const score=scoreDailyStaffing(proposed,targets,open);
            if(compareDailyStaffing(score,initial)>=0)continue;
            if(!best||compareDailyStaffing(score,best.score)<0)
              best={id:person.id,mask,old,present:proposed,score};
          }
        }
        if(!best)break;
        chosen.set(best.id,best.mask);
        for(let index=0;index<7;index++)
          present[index]=best.present[index];
      }
    }
    return {status:"feasible",masks:chosen,present};
  }
  return {status:truncated?"not_proven":"infeasible"};
}

const weekdayRecord=(values:readonly number[]):WeekdayNumbers=>
  Object.fromEntries(IDS.map((day,i)=>[day,values[i]])) as WeekdayNumbers;

/**
 * Deterministic rest allocation with fairness across weeks.
 *
 * Award candidates who have received FEWER complete weekends (including
 * the supplied history) first; use longest wait, then stable ID, to break
 * ties. Award as many as the deterministic feasibility search can admit,
 * but do not claim a global optimum for every combination.
 *
 * Every returned "planned" week contains explicit days without work for
 * EVERY person and passes seven daily minimum-headcount checks. Staffing
 * by hour, weekly/rolling effective hours, holidays and absence must be
 * assessed by subsequent planning and the independent certifier.
 */
export function planWeekendRotation(
  input:WeekendRotationInput,
):WeekendRotationResult {
  const invalid=validate(input);
  const counts=new Map<string,{prior:number;planned:number;last:string|null}>();
  for(const member of input.members??[])
    if(member&&typeof member.id==="string")
      counts.set(member.id,{prior:0,planned:0,last:null});
  const historyProvided=input.previousFullWeekends!==undefined;
  if(invalid.length)return {
    status:"infeasible",weeks:[],issues:invalid,historyProvided,
    weekendCounts:[],
  };
  for(const entry of input.previousFullWeekends??[]){
    const info=counts.get(entry.memberId)!;
    info.prior++;
    if(info.last===null||entry.weekStart>info.last)
      info.last=entry.weekStart;
  }

  const closures=new Set(input.closedWeekdays??[]);
  for(const day of IDS){
    const available=input.members.filter(member=>
      !member.fixedDaysOff.includes(day)&&!closures.has(day)).length;
    if(available<input.minimumPresentByWeekday[day])
      invalid.push({
        code:"IMPOSSIBLE_DAY_MINIMUM",
        weekday:day,
        message:"A cobertura mínima de "+day+
          " excede os colaboradores disponíveis após descanso fixo.",
      });
  }
  if(invalid.length)return {
    status:"infeasible",weeks:[],issues:invalid,historyProvided,
    weekendCounts:input.members.map(m=>({
      memberId:m.id,prior:counts.get(m.id)!.prior,planned:0,
    })),
  };

  const planned:PlannedRotationWeek[]=[];
  const uncertainty:RotationIssue[]=[];
  // A 28-day hours target is a soft objective, but awarding almost every
  // weekend off can make it impossible without repeatedly >9h workdays.
  // Derive each person's award budget from their own available workdays,
  // closures, fixed rest and operating capacities. NEVER use a universal
  // 'one weekend every four weeks' rule.
  const pref=input.workloadPreference;
  const dailyMax=input.maximumEffectiveMinutesByWeekday;
  const cycleLength=pref?.cycleWeeks??1;
  let cycleStart=-1;
  let quota=new Map<string,number>();
  let used=new Map<string,number>();
  let preferredForecast=new Map<string,{normal:number;awarded:number}>();
  function startCycle(index:number):void {
    cycleStart=index;
    used=new Map(input.members.map(member=>[member.id,0]));
    const length=Math.min(cycleLength,input.weeks-index);
    // A Sunday opening shorter than the normal 9h threshold has a real
    // opportunity cost. Forecast an ordinary week with Sunday worked
    // when possible; otherwise "rest Sunday" can make two weekly-rest
    // policies look equally affordable even when Sunday coverage forces
    // most members to work a five-hour shift.
    preferredForecast=new Map(input.members.map(member=>{
      if(!pref || !dailyMax)return [member.id,{normal:0,awarded:0}] as const;
      const requiresSunday=dailyMax.sunday>0 &&
        dailyMax.sunday<pref.preferredUpperDailyMinutes &&
        !member.fixedDaysOff.includes("sunday") &&
        !closures.has("sunday");
      const realistic=requiresSunday?bestPreferredWeekCapacity(
        member,false,closures,dailyMax,
        pref.preferredUpperDailyMinutes,true):-1;
      const normal=realistic>=0?realistic:bestPreferredWeekCapacity(
        member,false,closures,dailyMax,pref.preferredUpperDailyMinutes);
      const awarded=bestPreferredWeekCapacity(
        member,true,closures,dailyMax,pref.preferredUpperDailyMinutes);
      return [member.id,{normal,awarded}] as const;
    }));
    quota=new Map(input.members.map(member=>{
      if(!pref || !dailyMax || member.eligibleFullWeekend===false)
        return [member.id,length] as const;
      const normal=bestPreferredWeekCapacity(
        member,false,closures,dailyMax,pref.preferredUpperDailyMinutes);
      const awarded=bestPreferredWeekCapacity(
        member,true,closures,dailyMax,pref.preferredUpperDailyMinutes);
      if(normal<0 || awarded<0 || normal<=awarded)
        return [member.id,length] as const;
      const reference=Math.round(pref.cycleReferenceMinutes*
        length/cycleLength);
      const surplus=normal*length-reference;
      const affordable=Math.floor(Math.max(0,surplus)/(normal-awarded));
      return [member.id,Math.min(length,affordable)] as const;
    }));
  }
  for(let index=0;index<input.weeks;index++){
    if(index%cycleLength===0)startCycle(index);
    const weekStart=addCivilDays(input.startWeek,index*7);
    const forced=new Set(input.members.filter(member=>{
      const mask=mandatoryMask(member,closures);
      return (mask&WEEKEND_MASK)===WEEKEND_MASK;
    }).map(member=>member.id));
    let accepted=findRestPatterns(input,forced,closures);
    if(accepted.status!=="feasible")
      return {
        status:accepted.status==="not_proven"?"not_proven":"infeasible",
        weeks:planned,
        issues:[{
          code:accepted.status==="not_proven"
            ?"SEARCH_NOT_PROVEN":"REST_PATTERN_INFEASIBLE",
          message:accepted.status==="not_proven"
            ?"A pesquisa limitada não conseguiu demonstrar viabilidade."
            :"As folgas e a cobertura mínima são incompatíveis.",
          weekStart,
        }],
        historyProvided,
        weekendCounts:input.members.map(m=>({
          memberId:m.id,prior:counts.get(m.id)!.prior,
          planned:counts.get(m.id)!.planned,
        })),
      };

    const remainingWeeks=Math.min(cycleLength,input.weeks-cycleStart)-
      (index-cycleStart);
    const leftBudget=[...quota].reduce((sum,[id,count])=>
      sum+Math.max(0,count-(used.get(id)??0)),0);
    // Spread the possible grants across the calendar instead of giving
    // nearly everybody the same Saturday/Sunday and starving the store.
    const perWeekBudget=pref
      ?Math.ceil(leftBudget/remainingWeeks)
      :input.members.length;
    // Reserving at least the desired number of people on BOTH weekend
    // days is a soft preference. If fixed rest already leaves fewer,
    // we preserve the hard rules and report the remaining shortfall.
    const weekendTarget=desiredDailyHeadcount(input.members.length,
      DAILY_STAFFING_REFERENCE_PERCENT);
    const weekendOpen=!closures.has("saturday")||
      !closures.has("sunday");
    const optionalWeekendBudget=weekendOpen && pref
      ?Math.max(forced.size,input.members.length-weekendTarget)
      :input.members.length;
    const weeklyGrantBudget=Math.min(perWeekBudget,optionalWeekendBudget);
    // Optional full-weekend grants must not worsen the INTERNAL 60%
    // day-level staffing goal. Fixed Saturday/Sunday rest already uses
    // headcount even when its holder is not awarded a full weekend.
    // This remains SOFT: an infeasible target is not a certification error.
    const weekendShortfall=(pattern:Extract<Patterns,{status:"feasible"}>):number=>
      (closures.has("saturday")?0:
        Math.max(0,weekendTarget-pattern.present[5])**2)+
      (closures.has("sunday")?0:
        Math.max(0,weekendTarget-pattern.present[6])**2);
    const candidates=input.members.filter(member=>
      !forced.has(member.id)&&member.eligibleFullWeekend!==false &&
      (!pref || (used.get(member.id)??0)<(quota.get(member.id)??0)))
      .sort((a,b)=>{
        const left=counts.get(a.id)!,right=counts.get(b.id)!;
        const totalDiff=(left.prior+left.planned)-
          (right.prior+right.planned);
        if(totalDiff!==0)return totalDiff;
        // Within the same FULL-weekend fairness tier, prioritize those
        // whose 28-day preferred-capacity forecast remains healthier after
        // another award. This is SOFT and never overrides fixed rest,
        // feasibility, or the historical count of awarded weekends.
        // Respect explicit prior-weekend history as a first tie-breaker.
        if(pref && dailyMax && !historyProvided &&
          Math.min(cycleLength,input.weeks-cycleStart)===cycleLength){
          const forecast=(member:RotationMember)=>{
            const values=preferredForecast.get(member.id);
            if(!values || values.normal<0 || values.awarded<0)return -Infinity;
            const awarded=(used.get(member.id)??0)+1;
            return values.normal*(cycleLength-awarded)+
              values.awarded*awarded;
          };
          const difference=forecast(b)-forecast(a);
          if(Number.isFinite(difference) && difference!==0)
            return difference;
        }
        if(left.last!==right.last){
          if(left.last===null)return -1;
          if(right.last===null)return 1;
          return left.last.localeCompare(right.last);
        }
        return a.id.localeCompare(b.id);
      });
    // Spacing is SOFT: a voluntary second consecutive full weekend is
    // less fair than leaving that award unused when another eligible
    // colleague can be considered. Do not modify mandatory weekend rest,
    // and allow repetition if literally nobody else is eligible.
    //
    // The last award may come from verified pre-period history, so this
    // comparison also works across month and 28-day cycle boundaries.
    // Missing history remains UNKNOWN, never reconstructed from "no shift".
    const previousWeek=addCivilDays(weekStart,-7);
    const alternativeEligible=candidates.some(member=>
      counts.get(member.id)!.last!==previousWeek);
    for(const candidate of candidates){
      if(pref && forced.size>=weeklyGrantBudget)break;
      if(alternativeEligible &&
        counts.get(candidate.id)!.last===previousWeek)
        continue;
      const proposed=new Set([...forced,candidate.id]);
      const trial=findRestPatterns(input,proposed,closures);
      if(trial.status==="feasible"){
        // A third full weekend may take Saturday from five to four
        // workers if another member already has Saturday fixed off.
        // Prefer fewer grants instead of silently missing the soft goal.
        if(pref && weekendOpen &&
          input.members.some(member=>member.fixedDaysOff.some(day=>
            (day==="saturday"&&!closures.has(day)) ||
            (day==="sunday"&&!closures.has(day)))) &&
          accepted.status==="feasible" &&
          weekendShortfall(trial)>weekendShortfall(accepted))
          continue;
        forced.add(candidate.id);
        accepted=trial;
      }else if(trial.status==="not_proven"){
        // Keep the last proven-feasible plan, but explicitly distinguish
        // it from a fully evaluated rotation-frequency search.
        uncertainty.push({
          code:"SEARCH_NOT_PROVEN",weekStart,
          message:"Uma alternativa de fim de semana excedeu o limite da pesquisa.",
        });
      }
    }
    if(accepted.status!=="feasible")
      throw new Error("A pesquisa perdeu uma solução já encontrada.");
    const selected=accepted as Extract<Patterns,{status:"feasible"}>;
    const weekMembers=input.members.map(member=>{
      const mask=selected.masks.get(member.id)!;
      const daysWithoutWork=IDS.flatMap((_,d)=>
        has(mask,d)?[addCivilDays(weekStart,d)]:[]);
      const capacities=input.maximumEffectiveMinutesByWeekday;
      const effectiveMinutesUpperBound=capacities===undefined?null:
        IDS.reduce((sum,weekday,d)=>
          sum+(has(mask,d)?0:capacities[weekday]),0);
      return {
        memberId:member.id,daysWithoutWork,
        fullWeekendOff:forced.has(member.id),
        effectiveMinutesUpperBound,
      };
    });
    planned.push({
      weekStart,saturday:addCivilDays(weekStart,5),
      sunday:addCivilDays(weekStart,6),
      fullWeekendOffMemberIds:[...forced].sort(),
      members:weekMembers,presentByWeekday:weekdayRecord(selected.present),
    });
    for(const id of forced){
      const info=counts.get(id)!;
      info.planned++;
      info.last=weekStart;
      used.set(id,(used.get(id)??0)+1);
    }
  }
  return {
    status:uncertainty.length?"not_proven":"planned",
    weeks:planned,issues:uncertainty,historyProvided,
    weekendCounts:input.members.map(m=>({
      memberId:m.id,prior:counts.get(m.id)!.prior,
      planned:counts.get(m.id)!.planned,
    })),
  };
}
