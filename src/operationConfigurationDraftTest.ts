function assert(check:unknown,message="PR61 assertion failed"):asserts check {
  if(!check)throw Error(message);
}
function equal(a:unknown,b:unknown,message="values must match"):void {
  assert(a===b,message);
}
function deepEqual(a:unknown,b:unknown,message="objects must match"):void {
  assert(JSON.stringify(a)===JSON.stringify(b),message);
}
import type {OperatingHoursException, WeeklyOperatingHours} from "./types";
import {
  createOperationExceptionDraft,
  validateOperationExceptionDraft,
  mergeAdjacentOperatingIntervals,
  hasAdjacentOperatingIntervals,
  isValidCivilDate,
  operatingPresentation,
} from "./utils/operationConfigurationDraft";

const closed=createOperationExceptionDraft();
equal(closed.date,"");
equal(closed.mode,"closed");
deepEqual(closed.intervals,[]);
assert(!isValidCivilDate("2026-02-30"));
assert(!isValidCivilDate("2026-2-9"));
assert(isValidCivilDate("2028-02-29"));
assert(!validateOperationExceptionDraft(closed,[],null).valid,"draft without date is not persisted");
const date={...closed,date:"2026-11-12"};
assert(!validateOperationExceptionDraft(date,[],null).valid,"a reason must be explicit");
const configured={...date,reason:"Inventário"};
const saved=validateOperationExceptionDraft(configured,[],null);
assert(saved.valid && saved.value.intervals.length===0 && saved.value.reason==="Inventário");
const existing:OperatingHoursException[]=[saved.value];
assert(!validateOperationExceptionDraft(configured,existing,null).valid,
  "duplicate exception is rejected");
assert(validateOperationExceptionDraft(configured,existing,0).valid,
  "editing same date does not collide with itself");
const open={...configured,mode:"open" as const,intervals:[{start:"09:00",end:"14:00"}]};
assert(validateOperationExceptionDraft(open,[],null).valid);
assert(!validateOperationExceptionDraft({...open,intervals:[]},[],null).valid,
  "open exception requires an explicitly reviewed interval");
assert(!validateOperationExceptionDraft({...open,intervals:[
  {start:"09:00",end:"14:00"},{start:"13:45",end:"18:00"},
]},[],null).valid,"overlap is a hard constraint");
assert(!validateOperationExceptionDraft({...open,intervals:[
  {start:"23:00",end:"01:00"},
]},[],null).valid,"night crossing is not silently supported");
const source=[{start:"18:00",end:"19:00"},{start:"09:00",end:"18:00"}];
const sourceCopy=structuredClone(source);
assert(hasAdjacentOperatingIntervals(source));
const normalized=mergeAdjacentOperatingIntervals(source);
assert(normalized.valid);
deepEqual(normalized.intervals,[{start:"09:00",end:"19:00"}]);
deepEqual(source,sourceCopy,"normalization never mutates persisted input");
const interrupted=[{start:"09:00",end:"13:00"},{start:"15:00",end:"19:00"}];
assert(!hasAdjacentOperatingIntervals(interrupted));
const separate=mergeAdjacentOperatingIntervals(interrupted);
assert(separate.valid && separate.intervals.length===2);
const week:WeeklyOperatingHours={
  monday:[],tuesday:[],wednesday:[],thursday:[],
  friday:[],saturday:[],sunday:[],
};
week.monday=[{start:"09:00",end:"19:00"}];
equal(operatingPresentation(week),"continuous");
week.monday=source;
equal(operatingPresentation(week),"adjacent");
week.monday=interrupted;
equal(operatingPresentation(week),"interrupted");
console.log("PR61: operation draft validation, explicit exceptions, intervals and legacy compatibility passed.");
