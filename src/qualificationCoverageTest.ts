import type {
  Person,DatedWorkShift,PresenceRequirement,
} from "./types";
import {
  generateConstrainedPeriodSchedule,
  type GenerateConstrainedPeriodInput,
} from "./utils/constrainedPeriodGenerator";
import { checkPresenceForWorkShifts } from "./utils/workCoverage";
import { isPresenceRequirementValid } from "./utils/presence";
import { createEmptyWeeklyAvailability } from "./utils/availability";
import { createEmptyWeeklyPresenceRequirements } from "./utils/presence";
import { WEEKDAYS } from "./utils/operatingCalendar";
import { INITIAL_WORK_CONSTRAINTS } from "./utils/workConstraints";
import { certifyFinalGeneratedSchedule } from "./utils/finalScheduleCertification";
import { isPersistedAppState } from "./persistence/localStorageStateRepository";
function assert(value:unknown,message:string):asserts value {
  if(!value)throw Error("PR47-19: "+message);
}
const date="2026-11-02",interval={start:"09:00",end:"13:00"};
const pQualified:Person={id:"a",name:"Pessoa qualificada",active:true,qualificationTags:["Caixa"]};
const pOther:Person={id:"b",name:"Pessoa sem qualificação",active:true};
const people=[pQualified,pOther];
const q:PresenceRequirement={
  minimumAtOpening:1,minimumDuringOperation:1,minimumAtClosing:1,
  qualifiedCoverage:{Caixa:1},
};
const shift=(personId:string,mealBreak:DatedWorkShift["mealBreak"]=null):DatedWorkShift=>
  ({date,personId,interval,mealBreak});
assert(isPresenceRequirementValid(q),"Positive integral qualification demand.");
assert(!isPresenceRequirementValid({...q,qualifiedCoverage:{Caixa:-1}}),
  "Negative qualification demand is invalid.");
assert(checkPresenceForWorkShifts(date,[interval],q,[shift("a")],people).valid,
  "One certified qualified worker covers every minute.");
const other=checkPresenceForWorkShifts(date,[interval],q,[shift("b")],people);
assert(!other.valid && other.issues.some(s=>s.includes("Caixa")),
  "Unqualified worker never satisfies a skill-based requirement.");
assert(!checkPresenceForWorkShifts(date,[interval],q,[shift("a")]).valid,
  "Qualification demand fails closed when personnel catalogue is unavailable.");
const withMeal=checkPresenceForWorkShifts(date,[interval],q,[
  {date,personId:"a",interval,mealBreak:{start:"10:00",end:"11:00"}},
  shift("b"),
],people);
assert(!withMeal.valid&&withMeal.issues.some(s=>s.includes("10:00")),
  "During an unpaid break, an unqualified substitute does not cover the skill.");
const empty=Object.fromEntries(WEEKDAYS.map(k=>[k,[]]));
const hours={
  ...empty,monday:[interval],
} as GenerateConstrainedPeriodInput["operatingCalendar"]["weeklyOperatingHours"];
const weeklyPresence=createEmptyWeeklyPresenceRequirements();
weeklyPresence.monday=q;
const availability=people.map(p=>({
  personId:p.id,
  weeklyAvailability:{...createEmptyWeeklyAvailability(),monday:[interval]},
  exceptions:[],
}));
const input:GenerateConstrainedPeriodInput={
  startDate:date,endDate:date,timeZone:"Atlantic/Azores",
  people,availabilities:availability,
  operatingCalendar:{weeklyOperatingHours:hours,exceptions:[]},
  workRules:{standardShiftDurationMinutes:240},
  presence:{weeklyPresenceRequirements:weeklyPresence,presenceExceptions:[]},
  workConstraints:structuredClone(INITIAL_WORK_CONSTRAINTS),
  externalContext:{startDate:"2026-10-26",endDate:"2026-11-09",
    completeOutsideTarget:true,shifts:[]},
  maxSearchNodes:4000,
};
const forged=certifyFinalGeneratedSchedule(input,[shift("b")]);
assert(!forged.valid && forged.issues.some(s=>s.includes("Caixa")),
  "Final independent certification rejects fabricated unqualified proposal.");
const generated=generateConstrainedPeriodSchedule(input);
assert(generated.status==="generated" &&
  generated.assignments.some(s=>s.personId==="a"),
  "Search finds a real qualified person instead of accepting an unqualified schedule: "+
    generated.status+" "+generated.issues.join(" "));
assert(certifyFinalGeneratedSchedule(input,generated.assignments).valid,
  "The generated skill-aware schedule passes independent final certification.");
const saved={
  version:4,weeklyOperatingHours:hours,exceptions:[],
  people,availabilities:availability,
  workRules:input.workRules,
  weeklyPresenceRequirements:weeklyPresence,presenceExceptions:[],
};
assert(isPersistedAppState(saved),"The opt-in skill requirement is persisted in v4 state.");
assert(!isPersistedAppState({...saved,weeklyPresenceRequirements:{
  ...weeklyPresence,monday:{...q,qualifiedCoverage:{Caixa:1.5}},
}}),"Fractional skill demand cannot be persisted as hard coverage.");
console.log("PR47-19: qualified work and meal gaps, generator, independent certification and persistence passed.");
