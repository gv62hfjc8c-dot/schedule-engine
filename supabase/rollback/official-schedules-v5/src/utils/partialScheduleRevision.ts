import type { PersonAvailability, DatedWorkShift } from "../types.ts";
import {
  replaceApprovedSchedule, validateApprovedScheduleLedger,
  type ApprovedScheduleLedger, type ApprovedScheduleRecord,
  type ApprovalEnvironment, type ApprovalMutationResult,
  type AbsenceReason, type ScheduleAbsence,
} from "./approvedSchedules.ts";

export interface PartialAbsenceRevisionRequest {
  sourceId: string;
  /** Trusted server-generated ID, never accepted from the browser. */
  revisionId: string;
  expectedVersion: number;
  at: string;
  personId: string;
  startDate: string;
  endDate: string;
  reason: AbsenceReason;
  /** Optional administrative note, not a medical description. */
  note?: string;
  /**
   * Dates with replacement people. An omitted date means the original shift
   * is removed, potentially leaving coverage unsatisfied (fail closed).
   * The original clock interval and break are preserved in a reassignment.
   */
  replacements: { date: string; personId: string }[];
}

function fail(issues: string[]): ApprovalMutationResult {
  return {ok:false,failure:{code:"invalid_input",issues,workViolations:[]}};
}
function civil(s:string):number|null {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return null;
  const v=Date.parse(s+"T00:00:00Z");
  return Number.isFinite(v)&&new Date(v).toISOString().slice(0,10)===s ? v : null;
}
function days(from:string,to:string):string[] {
  const start=civil(from), end=civil(to);
  if(start===null||end===null||start>end||(end-start)/86400000>13)return [];
  const result:string[]=[];
  for(let t=start;t<=end;t+=86400000)
    result.push(new Date(t).toISOString().slice(0,10));
  return result;
}
function localDate(instant:string,timeZone:string):string {
  const parts=new Intl.DateTimeFormat("en-GB",{
    timeZone,year:"numeric",month:"2-digit",day:"2-digit",
  }).formatToParts(new Date(instant));
  const get=(key:string)=>parts.find(p=>p.type===key)?.value??"";
  return get("year")+"-"+get("month")+"-"+get("day");
}
function overlayAbsences(
  env:ApprovalEnvironment,
  absences:ScheduleAbsence[]
):ApprovalEnvironment {
  const unavailable=new Map<string,Set<string>>();
  for(const a of absences){
    const dates=unavailable.get(a.personId)??new Set<string>();
    for(const d of days(a.startDate,a.endDate))dates.add(d);
    unavailable.set(a.personId,dates);
  }
  return {...env,availabilities:env.availabilities.map(a=>{
    const unavailableDates=unavailable.get(a.personId);
    if(!unavailableDates)return a;
    const exceptions:PersonAvailability["exceptions"]=[
      ...a.exceptions.filter(e=>!unavailableDates.has(e.date)),
      ...[...unavailableDates].map(date=>({date,intervals:[]})),
    ];
    return {...a,exceptions};
  })};
}

/**
 * Build a COMPLETE replacement snapshot from a surgical absence event.
 * Unaffected shifts and dates are copied without changes. The SAME core
 * used for initial approval checks full coverage, availability and work
 * limits before any revision is considered valid.
 */
export function reviseApprovedScheduleForAbsence(input:{
  ledger:ApprovedScheduleLedger;
  environment:ApprovalEnvironment;
  request:PartialAbsenceRevisionRequest;
}):ApprovalMutationResult {
  const {ledger,environment,request}=input;
  if(!ledger||!request||!environment||!Array.isArray(request.replacements))
    return fail(["Dados de revisão incompletos."]);
  const validReasons:AbsenceReason[]=[
    "sick_leave","vacation","leave","accident","departure","other",
  ];
  const affected=days(request.startDate,request.endDate);
  if(!affected.length||!request.personId?.trim()||
    !request.sourceId?.trim()||!request.revisionId?.trim()||
    !validReasons.includes(request.reason)||
    (request.note!==undefined&&(typeof request.note!=="string"||
      request.note.length>240))||
    request.replacements.length>affected.length)
    return fail(["Período, colaborador ou motivo de revisão inválido."]);
  const source=ledger.records.find(r=>
    r.id===request.sourceId&&r.status==="approved");
  if(!source)return fail(["O horário original já não está vigente."]);
  if(request.startDate<source.startDate||request.endDate>source.endDate)
    return fail(["A alteração tem de pertencer ao horário vigente."]);
  try{
    if(request.startDate<localDate(request.at,source.timeZone))
      return fail(["Não é possível alterar retroativamente turnos já decorridos."]);
  }catch{return fail(["Data ou fuso horário de revisão inválido."]);}
  const person=environment.people.find(p=>p.id===request.personId);
  if(!person)return fail(["Colaborador da ocorrência não encontrado."]);
  const from=new Set(affected);
  const removed=source.shifts.filter(s=>
    s.personId===request.personId && from.has(s.date));
  if(removed.length===0)return fail([
    "Não existem turnos deste colaborador nas datas selecionadas.",
  ]);
  if(removed.length!==new Set(removed.map(s=>s.date)).size)
    return fail(["A escala original contém turnos duplicados."]);
  const replacedDates=new Set<string>();
  const replacementShifts:DatedWorkShift[]=[];
  for(const replacement of request.replacements){
    if(!replacement||!from.has(replacement.date)||
      replacedDates.has(replacement.date)||
      replacement.personId===request.personId ||
      !environment.people.some(p=>p.id===replacement.personId&&p.active))
      return fail(["Um substituto ou data da substituição é inválido."]);
    const original=removed.find(s=>s.date===replacement.date);
    if(!original)return fail(["Não há turno para substituir nessa data."]);
    if(source.shifts.some(s=>s.date===replacement.date&&
      s.personId===replacement.personId))
      return fail(["O substituto já tem um turno nesse dia."]);
    replacedDates.add(replacement.date);
    replacementShifts.push({...original,personId:replacement.personId,
      interval:{...original.interval},
      mealBreak:original.mealBreak?{...original.mealBreak}:null});
  }
  const earlier=source.absences??[];
  if(earlier.some(a=>a.personId===request.personId&&
    a.startDate<=request.endDate&&a.endDate>=request.startDate))
    return fail(["Já existe uma ocorrência registada para estas datas."]);
  const absences:ScheduleAbsence[]=[...earlier.map(a=>({...a})),{
    personId:request.personId,startDate:request.startDate,
    endDate:request.endDate,reason:request.reason,
  }];
  const shifts=[...source.shifts.filter(s=>
    !(s.personId===request.personId&&from.has(s.date)))
    .map(s=>({...s,interval:{...s.interval},
      mealBreak:s.mealBreak?{...s.mealBreak}:null})),
    ...replacementShifts];
  const outcome=replaceApprovedSchedule({
    ledger,expectedVersion:request.expectedVersion,at:request.at,
    environment:overlayAbsences(environment,absences),
    replaceId:source.id,
    draft:{id:request.revisionId,startDate:source.startDate,
      endDate:source.endDate,timeZone:source.timeZone,shifts},
  });
  if(!outcome.ok)return outcome;
  const changedDates=[...new Set(removed.map(s=>s.date))].sort();
  const revision={
    sourceId:source.id,personId:request.personId,reason:request.reason,
    startDate:request.startDate,endDate:request.endDate,
    ...(request.note?.trim()?{note:request.note.trim()}:{}),
    changedDates,
  };
  const rememberedPeople=new Map<string,{id:string;name:string}>();
  for(const p of [...(source.people??[]),...(outcome.record.people??[])])
    rememberedPeople.set(p.id,{...p});
  const record:ApprovedScheduleRecord={
    ...outcome.record,absences,revision,
    people:[...rememberedPeople.values()],
  };
  const next={
    ...outcome.ledger,
    records:outcome.ledger.records.map(r=>r.id===record.id?record:r),
  };
  if(validateApprovedScheduleLedger(next).length)
    return fail(["A revisão produziu histórico inconsistente."]);
  return {ok:true,record,ledger:next};
}
