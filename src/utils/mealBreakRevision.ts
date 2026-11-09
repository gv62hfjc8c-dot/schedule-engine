import type {DatedWorkShift} from "../types";
import {certifyFinalGeneratedSchedule} from "./finalScheduleCertification";
import type {GenerateConstrainedPeriodInput} from "./constrainedPeriodGenerator";

export type MealRevisionResult =
  | {status:"valid";shifts:DatedWorkShift[]}
  | {status:"invalid";issues:string[]};

const clock=(value:string):number|null=>{
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))return null;
  return Number(value.slice(0,2))*60+Number(value.slice(3,5));
};
const format=(n:number):string=>
  String(Math.floor(n/60)).padStart(2,"0")+":"+
  String(n%60).padStart(2,"0");

/**
 * A meal edit is a NEW proposal candidate, never a mutation to an archived
 * or official schedule. Certify work, coverage, availability, qualifications
 * and contract limits again before any persistence.
 */
export function reviseMealStart(
  input:GenerateConstrainedPeriodInput,
  original:DatedWorkShift[],
  date:string,
  personId:string,
  newStart:string,
):MealRevisionResult {
  if(!Array.isArray(original))return {status:"invalid",issues:["Proposta inexistente."]};
  const matches=original.filter(s=>s.date===date&&s.personId===personId);
  if(matches.length!==1 || !matches[0].mealBreak)
    return {status:"invalid",issues:["Este colaborador não tem uma refeição editável nesse dia."]};
  const start=clock(newStart);
  const oldStart=clock(matches[0].mealBreak!.start);
  const oldEnd=clock(matches[0].mealBreak!.end);
  const shiftStart=clock(matches[0].interval.start);
  const shiftEnd=clock(matches[0].interval.end);
  if(start===null||oldStart===null||oldEnd===null||
     shiftStart===null||shiftEnd===null||oldEnd<=oldStart||
     start<=shiftStart||start+(oldEnd-oldStart)>=shiftEnd){
    return {status:"invalid",issues:["A refeição deve ficar integralmente dentro do turno e manter a duração."]};
  }
  const revised=original.map(s=>s.date===date&&s.personId===personId
    ? {...s,interval:{...s.interval},
       mealBreak:{start:format(start),end:format(start+oldEnd-oldStart)}}
    : {...s,interval:{...s.interval},
       mealBreak:s.mealBreak?{...s.mealBreak}:null});
  const certified=certifyFinalGeneratedSchedule(input,revised);
  if(!certified.valid)return {status:"invalid",issues:certified.issues};
  return {status:"valid",shifts:revised};
}
