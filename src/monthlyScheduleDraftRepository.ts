import {
  addCivilDays,enumerateCivilDays,inRange,resolvePlanningPeriod,type PlanningPeriod,
} from "./schedulePeriods";
import {
  assignmentMinutes,clockMinutes,
  assignmentsOverlap,validateWorkAssignment,type WorkAssignment,
} from "./workAssignments";
import type {ExternalScheduleContext} from "./certifySchedule";
import {validateMealBreak,type MealBreak} from "./mealBreaks";
import {
  validatePlannedRest,type PlannedRestWeekMember,
} from "./plannedRest";

/**
 * Local, unapproved proposals. One complete civil month per key.
 * A proposal never updates, deletes, or overwrites a different month's key.
 * This is not an authoritative account or a cloud history.
 */
export const MONTH_DRAFT_PREFIX="schedule-engine:v2:schedule-month:v1:";
const VERSION=1;
const MAX_ASSIGNMENTS=20_000;
type ReadStorage=Pick<Storage,"getItem">;
type WriteStorage=Pick<Storage,"getItem"|"setItem">;

export type MonthlyDraftLoad=
  | {status:"loaded";assignments:WorkAssignment[];
    mealBreaks:MealBreak[];mealBreakPolicy?:"v1"|"v2";hoursPolicy?:"rolling28";
    rotationRest?:PlannedRestWeekMember[];revision:string}
  | {status:"empty";assignments:null;revision:null}
  | {status:"invalid"|"unavailable";assignments:null;revision:null};
export type MonthlyDraftSave=
  | {ok:true;revision:string;assignments:WorkAssignment[];
    mealBreaks:MealBreak[];mealBreakPolicy?:"v1"|"v2";hoursPolicy?:"rolling28";
    rotationRest?:PlannedRestWeekMember[]}
  | {ok:false;code:"invalid"|"unavailable"|"conflict";message:string};
export type ExternalContextLoad=
  | {ok:true;context:ExternalScheduleContext}
  | {ok:false;status:"invalid"|"unavailable";message:string};

function monthPeriod(year:number,month:number):PlanningPeriod {
  return resolvePlanningPeriod({mode:"monthly",year,month});
}
function monthString(year:number,month:number):string {
  return String(year).padStart(4,"0")+"-"+String(month).padStart(2,"0");
}
export function monthlyDraftKey(year:number,month:number):string {
  monthPeriod(year,month);
  return MONTH_DRAFT_PREFIX+monthString(year,month);
}

function validatedAssignments(input:unknown,year:number,month:number):WorkAssignment[]|null {
  if(!Array.isArray(input) || input.length>MAX_ASSIGNMENTS)return null;
  const period=monthPeriod(year,month);
  const result:WorkAssignment[]=[];
  const dayGroups=new Map<string,WorkAssignment[]>();
  for(const raw of input){
    const entry=validateWorkAssignment(raw);
    if(!entry || !inRange(entry.date,period))return null;
    const id=entry.memberId.toLowerCase();
    const normalized={...entry,memberId:id};
    const key=id+"|"+entry.date;
    const existing=dayGroups.get(key)??[];
    if(existing.some(previous=>assignmentsOverlap(previous,normalized)))return null;
    existing.push(normalized);
    dayGroups.set(key,existing);
    result.push(normalized);
  }
  return result;
}

function validSingleShiftMeals(assignments:readonly WorkAssignment[]):boolean {
  const days=new Set<string>();
  for(const shift of assignments){
    const key=shift.memberId+"|"+shift.date;
    if(days.has(key))return false;
    days.add(key);
    const effective=assignmentMinutes(shift);
    // A 5h Sunday can be a full, break-free SHORT COMPANY OPENING.
    // Storage only validates shape. The independent certifier has access
    // to opening hours and decides whether the pause is required.
    if(effective<=240&&shift.mealBreak)return false;
    if(shift.mealBreak){
      if(clockMinutes(shift.mealBreak.end)-
        clockMinutes(shift.mealBreak.start)!==60)return false;
      if(clockMinutes(shift.mealBreak.start)-
        clockMinutes(shift.start)<180)return false;
    }
  }
  return true;
}

function validatedMealBreaks(
  raw:unknown,year:number,month:number
):MealBreak[]|null {
  if(!Array.isArray(raw)||raw.length>MAX_ASSIGNMENTS)return null;
  const period=monthPeriod(year,month);
  const breaks:MealBreak[]=[];
  for(const item of raw){
    const parsed=validateMealBreak(item);
    if(!parsed||!inRange(parsed.date,period))return null;
    breaks.push({...parsed,memberId:parsed.memberId.toLowerCase()});
  }
  return breaks;
}

export function loadMonthlyDraft(
  storage:ReadStorage,year:number,month:number
):MonthlyDraftLoad {
  const key=monthlyDraftKey(year,month);
  let raw:string|null;
  try {raw=storage.getItem(key);}
  catch {return {status:"unavailable",assignments:null,revision:null};}
  if(raw===null)return {status:"empty",assignments:null,revision:null};
  try {
    const value:unknown=JSON.parse(raw);
    if(!value || typeof value!=="object" || Array.isArray(value))
      return {status:"invalid",assignments:null,revision:null};
    const document=value as {
      version?:unknown;year?:unknown;month?:unknown;assignments?:unknown;
      mealBreakPolicy?:unknown;mealBreaks?:unknown;hoursPolicy?:unknown;
      rotationRest?:unknown;
    };
    if(document.version!==VERSION||document.year!==year||document.month!==month)
      return {status:"invalid",assignments:null,revision:null};
    if(document.hoursPolicy!==undefined &&
      (document.hoursPolicy!=="rolling28" || document.mealBreakPolicy!=="v2"))
      return {status:"invalid",assignments:null,revision:null};
    const hoursPolicy=document.hoursPolicy==="rolling28"
      ?{hoursPolicy:"rolling28" as const}:{};
    const assignments=validatedAssignments(document.assignments,year,month);
    if(assignments===null)return {status:"invalid",assignments:null,revision:null};
    const rotationRest=document.rotationRest===undefined?undefined:
      validatePlannedRest(document.rotationRest,year,month,assignments);
    if(rotationRest===null || (rotationRest!==undefined &&
      document.mealBreakPolicy!=="v2"))
      return {status:"invalid",assignments:null,revision:null};
    const restFields=rotationRest===undefined?{}:{rotationRest};
    if(document.mealBreakPolicy===undefined && document.mealBreaks===undefined)
      return {status:"loaded",assignments,mealBreaks:[],revision:raw};
    if(document.mealBreakPolicy==="v2" &&
      document.mealBreaks===undefined){
      if(!validSingleShiftMeals(assignments))
        return {status:"invalid",assignments:null,revision:null};
      return {status:"loaded",assignments,mealBreaks:[],
        mealBreakPolicy:"v2",...hoursPolicy,...restFields,revision:raw};
    }
    if(document.mealBreakPolicy!=="v1")
      return {status:"invalid",assignments:null,revision:null};
    const mealBreaks=validatedMealBreaks(document.mealBreaks,year,month);
    return mealBreaks===null
      ? {status:"invalid",assignments:null,revision:null}
      : {status:"loaded",assignments,mealBreaks,mealBreakPolicy:"v1",revision:raw};
  }catch{return {status:"invalid",assignments:null,revision:null};}
}

/**
 * Version-token check prevents silently replacing a draft that has changed
 * since the page loaded. It is not an atomic cross-tab or server transaction.
 */
export function saveMonthlyDraft(
  storage:WriteStorage,year:number,month:number,
  input:unknown,expectedRevision:string|null,
  mealBreaksInput:unknown=undefined,mealBreakPolicy:"v1"|"v2"|undefined=undefined,
  hoursPolicy:"rolling28"|undefined=undefined,
  rotationRestInput:unknown=undefined,
):MonthlyDraftSave {
  const key=monthlyDraftKey(year,month);
  const assignments=validatedAssignments(input,year,month);
  if(assignments===null)
    return {ok:false,code:"invalid",message:"O horário contém turnos inválidos ou fora do mês selecionado."};
  if(rotationRestInput!==undefined && mealBreakPolicy!=="v2")
    return {ok:false,code:"invalid",message:
      "O descanso explícito só é suportado nas propostas com turnos V2."};
  const rotationRest=rotationRestInput===undefined?undefined:
    validatePlannedRest(rotationRestInput,year,month,assignments);
  if(rotationRest===null)
    return {ok:false,code:"invalid",message:
      "A proposta contém descansos planeados inconsistentes com os turnos."};
  if(hoursPolicy!==undefined &&
    (hoursPolicy!=="rolling28" || mealBreakPolicy!=="v2"))
    return {ok:false,code:"invalid",message:"A política de horas da proposta é inválida."};
  if(mealBreakPolicy==="v2" && !validSingleShiftMeals(assignments))
    return {ok:false,code:"invalid",
      message:"Cada turno normal exige uma pausa válida dentro do turno."};
  if((mealBreakPolicy===undefined && mealBreaksInput!==undefined) ||
    (mealBreakPolicy==="v1" && mealBreaksInput===undefined) ||
    (mealBreakPolicy==="v2" && mealBreaksInput!==undefined))
    return {ok:false,code:"invalid",message:"Faltam dados válidos de pausas da proposta."};
  const mealBreaks=mealBreakPolicy==="v1"
    ?validatedMealBreaks(mealBreaksInput,year,month):[];
  if(mealBreaks===null)
    return {ok:false,code:"invalid",message:"As pausas da proposta são inválidas."};
  let current:string|null;
  try{current=storage.getItem(key);}
  catch{return {ok:false,code:"unavailable",message:"Não foi possível ler o horário guardado neste dispositivo."};}
  if(current!==expectedRevision)
    return {ok:false,code:"conflict",message:"O horário deste mês foi alterado desde que abriste a página. Recarrega para evitar substituir outras alterações."};
  const revision=JSON.stringify({
    version:VERSION,year,month,assignments,
    ...(mealBreakPolicy==="v1"?{mealBreakPolicy,mealBreaks}:{}),
    ...(mealBreakPolicy==="v2"?{mealBreakPolicy}:{}),
    ...(hoursPolicy?{hoursPolicy}:{}),
    ...(rotationRest===undefined?{}:{rotationRest}),
  });
  try{
    storage.setItem(key,revision);
    return {ok:true,revision,assignments,mealBreaks,
      ...(mealBreakPolicy?{mealBreakPolicy}:{}),
      ...(hoursPolicy?{hoursPolicy}:{}),
      ...(rotationRest===undefined?{}:{rotationRest}),
    };
  }catch{return {ok:false,code:"unavailable",message:"Não foi possível guardar a proposta neste dispositivo."};}
}

/**
 * Read exactly the neighboring civil months needed by the selected month's
 * border weeks. Only an explicitly saved COMPLETE monthly proposal makes
 * external days known, including its dates with zero assigned work.
 */
export function readExternalMonthlyContext(
  storage:ReadStorage,year:number,month:number
):ExternalContextLoad {
  const period=monthPeriod(year,month);
  const outside=enumerateCivilDays(period.validation)
    .filter(date=>!inRange(date,period));
  const loaded=new Map<string,MonthlyDraftLoad>();
  const assignments:WorkAssignment[]=[];
  const completeDates:string[]=[];
  for(const date of outside){
    const [y,m]=date.split("-").map(Number);
    const key=monthString(y,m);
    let state=loaded.get(key);
    if(!state){
      state=loadMonthlyDraft(storage,y,m);
      loaded.set(key,state);
    }
    if(state.status==="invalid"||state.status==="unavailable")
      return {
        ok:false,status:state.status,
        message:"Não foi possível ler com segurança o horário de "+key+
          ". A geração foi interrompida para não ignorar os dados desse mês.",
      };
    if(state.status!=="loaded")continue;
    completeDates.push(date);
  }
  for(const [key,state] of loaded){
    if(state.status!=="loaded")continue;
    assignments.push(...state.assignments.filter(entry=>
      outside.includes(entry.date) && entry.date.startsWith(key)));
  }
  return {ok:true,context:{assignments,completeDates}};
}

export function loadMonthlyDraftFromBrowser(year:number,month:number):MonthlyDraftLoad {
  try{return loadMonthlyDraft(window.localStorage,year,month);}
  catch{return {status:"unavailable",assignments:null,revision:null};}
}
export function saveMonthlyDraftToBrowser(
  year:number,month:number,assignments:unknown,expectedRevision:string|null,
  mealBreaks?:unknown,mealBreakPolicy?:"v1"|"v2",
  hoursPolicy?:"rolling28",rotationRest?:unknown
):MonthlyDraftSave {
  try{return saveMonthlyDraft(
    window.localStorage,year,month,assignments,expectedRevision,
    mealBreaks,mealBreakPolicy,hoursPolicy,rotationRest
  );}
  catch{return {ok:false,code:"unavailable",message:"Não foi possível guardar neste dispositivo."};}
}
export function readExternalMonthlyContextFromBrowser(
  year:number,month:number
):ExternalContextLoad {
  try{return readExternalMonthlyContext(window.localStorage,year,month);}
  catch{return {ok:false,status:"unavailable",message:"O armazenamento de horários não está disponível neste dispositivo."};}
}

/**
 * Read up to 27 civil dates preceding a month. A missing monthly draft means
 * UNKNOWN, never zero work or an automatic folga.
 * The returned values are read-only inputs for rolling balances and planning.
 */
export function readPriorRollingHistory(
  storage:ReadStorage,year:number,month:number
):ExternalContextLoad {
  const period=monthPeriod(year,month);
  const days=enumerateCivilDays({
    start:addCivilDays(period.start,-27),endExclusive:period.start,
  });
  const loaded=new Map<string,MonthlyDraftLoad>();
  const known:string[]=[];
  for(const date of days){
    const [y,m]=date.split("-").map(Number);
    const key=monthString(y,m);
    let draft=loaded.get(key);
    if(!draft){
      draft=loadMonthlyDraft(storage,y,m);
      loaded.set(key,draft);
    }
    if(draft.status==="invalid"||draft.status==="unavailable")
      return {ok:false,status:draft.status,
        message:"Não foi possível ler o histórico de "+key+
          " para o equilíbrio móvel de 28 dias."};
    if(draft.status==="loaded")known.push(date);
  }
  const knownSet=new Set(known);
  const savedDrafts=[...loaded.values()]
    .filter((draft):draft is Extract<MonthlyDraftLoad,{status:"loaded"}>=>
      draft.status==="loaded");
  const assignments=savedDrafts.flatMap(draft=>draft.assignments)
    .filter(shift=>knownSet.has(shift.date));
  // Historical fairness is based only on EXPLICIT saved rest decisions.
  // An empty day in a schedule is not automatically a legitimate folga.
  const confirmedFullWeekends=savedDrafts
    .flatMap(draft=>draft.rotationRest??[])
    .filter(record=>record.fullWeekendOff &&
      addCivilDays(record.weekStart,6)<period.start)
    .map(record=>({
      memberId:record.memberId,weekStart:record.weekStart,
    }));
  return {ok:true,context:{
    assignments,completeDates:known,
    ...(confirmedFullWeekends.length>0
      ?{plannedFullWeekends:confirmedFullWeekends}:{}),
  }};
}

export function readPriorRollingHistoryFromBrowser(
  year:number,month:number
):ExternalContextLoad {
  try{return readPriorRollingHistory(window.localStorage,year,month);}
  catch{return {ok:false,status:"unavailable",
    message:"O histórico de horários não está disponível neste dispositivo."};}
}
