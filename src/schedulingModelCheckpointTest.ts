import type { DatedWorkShift, Person, WeeklyOperatingHours } from "./types";
import { WEEKDAYS } from "./utils/operatingCalendar";
import { createEmptyWeeklyAvailability } from "./utils/availability";
import { createEmptyWeeklyPresenceRequirements } from "./utils/presence";
import { INITIAL_WORK_CONSTRAINTS, getEffectiveWorkMinutesInTimeZone } from "./utils/workConstraints";
import {
  personWeeklyHardMax, personWeeklyTarget, validatePeopleSchedulingPolicies,
  validatePersonWeeklyContractCaps, isExplicitRequiredWorkday,
} from "./utils/personSchedulingPolicies";
import { accountingCycleForDate, cyclesIntersectingRange } from "./utils/accountingCycle28";
import { DEFAULT_OPERATION_TIME_ZONE, isIanaOperationTimeZone, resolveOperationTimeZone } from "./utils/operationTimeZone";
import { APP_STATE_VERSION } from "./persistence/stateRepository";
import { isPersistedAppState } from "./persistence/localStorageStateRepository";
import { certifyFinalGeneratedSchedule } from "./utils/finalScheduleCertification";
import { generateConstrainedPeriodSchedule, type GenerateConstrainedPeriodInput } from "./utils/constrainedPeriodGenerator";

function assert(value:unknown,message:string):asserts value {
  if(!value)throw Error("PR47-B: "+message);
}
const full:Person={id:"a",name:"Pessoa A",active:true};
const partial:Person={
  id:"b",name:"Pessoa B",active:true,
  weeklyContractMinutes:1200,weeklyTargetMinutes:900,
  requiredWorkDates:["2026-11-02"],
};
assert(personWeeklyHardMax(full,2400)===2400 &&
  personWeeklyTarget(full,2400)===2400,"Legacy 40h default unchanged.");
assert(personWeeklyHardMax(partial,2400)===1200 &&
  personWeeklyTarget(partial,2400)===900,
  "20h weekly contract is hard; 15h target is soft.");
assert(validatePeopleSchedulingPolicies([full,partial]).length===0,
  "Valid per-person rules.");
assert(validatePeopleSchedulingPolicies([{...partial,weeklyTargetMinutes:1500}]).length>0,
  "Target cannot exceed explicit contract.");
assert(validatePeopleSchedulingPolicies([{...partial,requiredWorkDates:["2026-11-02","2026-11-02"]}]).length>0,
  "Duplicated mandatory dates prohibited.");
assert(isExplicitRequiredWorkday(partial,"2026-11-02") &&
  !isExplicitRequiredWorkday(full,"2026-11-02"),"Availability does not imply a mandatory date.");

const shift=(date:string,personId:string,start:string,end:string,
  mealBreak:DatedWorkShift["mealBreak"]=null):DatedWorkShift=>
  ({date,personId,interval:{start,end},mealBreak});
const shifts=[
  shift("2026-11-02","b","09:00","15:00"),
  shift("2026-11-03","b","09:00","15:00"),
  shift("2026-11-04","b","09:00","15:00"),
  shift("2026-11-05","b","09:00","13:00"),
];
assert(!validatePersonWeeklyContractCaps([partial],shifts,2400,"Atlantic/Azores",
  "2026-11-02","2026-11-08").valid,
  "22h weekly work must violate the individual 20h ceiling, even if below global 40h.");
assert(validatePersonWeeklyContractCaps([partial],shifts.slice(0,3),2400,"Atlantic/Azores",
  "2026-11-02","2026-11-08").valid,
  "18h work may exceed a 15h SOFT target without violating the 20h HARD ceiling.");
assert(!validatePersonWeeklyContractCaps([partial],shifts,2400,"Atlantic/Azores",
  "2026-11-03","2026-11-04").valid,"A partial target period still checks the full affected week.");

const spring=shift("2026-03-29","a","00:30","03:30");
assert(getEffectiveWorkMinutesInTimeZone(spring,"Europe/Lisbon")===120,
  "DST forward: 3 wall-clock hours are only 2 elapsed work hours.");
assert(getEffectiveWorkMinutesInTimeZone(shift("2026-10-25","a","01:30","03:30"),
  "Europe/Lisbon")===null,
  "DST backward: ambiguous local hour cannot be certified without explicit disambiguation.");

const cycle=accountingCycleForDate("2026-11-29","2026-11-02");
assert(cycle.startDate==="2026-11-02"&&cycle.endDate==="2026-11-29"&&
  cycle.week===4&&cycle.weeks.length===4,"Fixed 28-day period, four accounting weeks.");
const next=accountingCycleForDate("2026-11-30","2026-11-02");
assert(next.startDate==="2026-11-30"&&next.endDate==="2026-12-27"&&next.week===1,
  "Next cycle starts on day 29, across civil month boundary.");
const prior=accountingCycleForDate("2026-11-01","2026-11-02");
assert(prior.startDate==="2026-10-05"&&prior.endDate==="2026-11-01",
  "Negative cycle index works before the anchor.");
assert(cyclesIntersectingRange("2026-11-01","2026-11-30","2026-11-02").length===3,
  "A five-week calendar month can intersect three independent cycles.");
assert(accountingCycleForDate("2028-02-29","2028-02-01").startDate==="2028-02-29" &&
  accountingCycleForDate("2028-02-29","2028-02-01").endDate==="2028-03-27",
  "Leap day begins the next cycle without being dropped.");

assert(isIanaOperationTimeZone("Europe/Lisbon") &&
  !isIanaOperationTimeZone("No/Existing_Zone") &&
  resolveOperationTimeZone(undefined)===DEFAULT_OPERATION_TIME_ZONE,
  "Legacy fallback and IANA validation.");

const weekly:WeeklyOperatingHours=Object.fromEntries(WEEKDAYS.map(day=>[
  day,day==="monday" || day==="tuesday" ? [{start:"09:00",end:"13:00"}] : [],
])) as WeeklyOperatingHours;
const people:Person[]=[partial];
const availability={personId:"b",weeklyAvailability:{
  ...createEmptyWeeklyAvailability(),monday:[{start:"09:00",end:"13:00"}],
  tuesday:[{start:"09:00",end:"13:00"}],
},exceptions:[]};
const presence={
  weeklyPresenceRequirements:createEmptyWeeklyPresenceRequirements(),
  presenceExceptions:["2026-11-02","2026-11-03"].map(date=>({
    date,requirements:{minimumAtOpening:0,minimumDuringOperation:0,
      minimumAtClosing:0},
  })),
};
const savedV4={
  version:APP_STATE_VERSION,weeklyOperatingHours:weekly,exceptions:[],
  people,availabilities:[availability],
  workRules:{standardShiftDurationMinutes:240},
  weeklyPresenceRequirements:presence.weeklyPresenceRequirements,
  presenceExceptions:[],
};
assert(isPersistedAppState(savedV4),
  "Old v4 app state without operation zone/cycle still works.");
assert(isPersistedAppState({...savedV4,operationTimeZone:"Europe/Lisbon",
  cycleAnchorDate:"2026-11-02"}),"Optional time zone and cycle persist in v4.");
assert(!isPersistedAppState({...savedV4,operationTimeZone:"Not/A_Zone"}),
  "Invalid zone is rejected before persistence.");
assert(!isPersistedAppState({...savedV4,cycleAnchorDate:"2026-02-31"}),
  "Impossible cycle anchor is rejected.");

const input:GenerateConstrainedPeriodInput={
  startDate:"2026-11-02",endDate:"2026-11-03",
  timeZone:"Atlantic/Azores",
  people,availabilities:[availability],
  operatingCalendar:{weeklyOperatingHours:weekly,exceptions:[]},
  workRules:{standardShiftDurationMinutes:240},
  presence,workConstraints:structuredClone(INITIAL_WORK_CONSTRAINTS),
  externalContext:{startDate:"2026-11-01",endDate:"2026-11-09",
    completeOutsideTarget:true,shifts:[]},
};
const two=[shift("2026-11-02","b","09:00","13:00"),
  shift("2026-11-03","b","09:00","13:00")];
assert(certifyFinalGeneratedSchedule(input,two).valid,
  "Explicitly required Monday is satisfied, Tuesday is optional.");
assert(!certifyFinalGeneratedSchedule(input,two.slice(1)).valid,
  "Missing explicit required date fails independent certification.");
const daily=generateConstrainedPeriodSchedule({...input,maxSearchNodes:3000});
assert(daily.status==="generated"&&daily.assignments.some(s=>s.date==="2026-11-02"),
  "Period generator respects mandatory dates independent of general availability.");
// PR47-F: explicit mandatory work outside the target must not contradict
// the attested external context. Otherwise a generated target would appear
// valid even though the same person's required outside day is missing.
const outsideMandatory:GenerateConstrainedPeriodInput={
  ...input,
  people:[{...partial,requiredWorkDates:["2026-11-04"]}],
};
const missingOutside=generateConstrainedPeriodSchedule({...outsideMandatory,maxSearchNodes:3000});
assert(missingOutside.status==="invalid_input" &&
  missingOutside.issues.some(issue=>issue.includes("exterior")),
  "PR47-F: external zero-shift attestation cannot ignore an explicit mandatory outside date.");
assert(!certifyFinalGeneratedSchedule(outsideMandatory,two).valid,
  "PR47-F: independent certification must reject the same external contradiction.");
const withOutsideWork:GenerateConstrainedPeriodInput={
  ...outsideMandatory,
  externalContext:{...outsideMandatory.externalContext,
    shifts:[shift("2026-11-04","b","09:00","13:00")]},
};
assert(certifyFinalGeneratedSchedule(withOutsideWork,two).valid,
  "PR47-F: confirmed external assignment satisfies the explicit outside workday.");

const externalHard=validatePersonWeeklyContractCaps(
  [partial],[...two,...Array.from({length:5},(_,i)=>
    shift("2026-11-0"+(4+i),"b","09:00","13:00"))],2400,
  "Atlantic/Azores","2026-11-02","2026-11-03");
assert(!externalHard.valid,"A full 28h workweek cannot bypass a 20h contract.");

// PR47-F: the fast weekly capacity proof must use individual HARD limits.
const cappedDemand=structuredClone(input);
cappedDemand.people=[{
  ...partial,weeklyContractMinutes:240,weeklyTargetMinutes:240,
  requiredWorkDates:[],
}];
cappedDemand.presence.presenceExceptions=[
  {date:"2026-11-02",requirements:{minimumAtOpening:1,
    minimumDuringOperation:1,minimumAtClosing:1}},
  {date:"2026-11-03",requirements:{minimumAtOpening:1,
    minimumDuringOperation:1,minimumAtClosing:1}},
];
const capacityResult=generateConstrainedPeriodSchedule({
  ...cappedDemand,maxSearchNodes:2000,
});
assert(capacityResult.status==="incomplete" &&
  capacityResult.exploredNodes===0 &&
  capacityResult.issues.some(issue=>issue.includes("Inviabilidade comprovada")),
  "PR47-F: 8h minimum coverage cannot be supplied by a single 4h contractual cap.");

// On spring-forward Sunday 3h of wall-clock operation is only 2h elapsed.
// It must never be declared proven impossible based on wall time alone.
const dstDate="2026-03-29";
const dstRules=structuredClone(INITIAL_WORK_CONSTRAINTS);
const dstProof:GenerateConstrainedPeriodInput={
  ...input,
  startDate:dstDate,endDate:dstDate,timeZone:"Europe/Lisbon",
  workRules:{standardShiftDurationMinutes:120},
  workConstraints:dstRules,
  people:[{id:"b",name:"Pessoa B",active:true,
    weeklyContractMinutes:120,weeklyTargetMinutes:120}],
  operatingCalendar:{
    weeklyOperatingHours:Object.fromEntries(WEEKDAYS.map(day=>[day,[]])) as unknown as WeeklyOperatingHours,
    exceptions:[{date:dstDate,intervals:[{start:"00:30",end:"03:30"}]}],
  },
  availabilities:[{
    personId:"b",weeklyAvailability:createEmptyWeeklyAvailability(),
    exceptions:[{date:dstDate,intervals:[{start:"00:30",end:"03:30"}]}],
  }],
  presence:{
    weeklyPresenceRequirements:createEmptyWeeklyPresenceRequirements(),
    presenceExceptions:[{date:dstDate,requirements:{
      minimumAtOpening:1,minimumDuringOperation:1,minimumAtClosing:1,
    }}],
  },
  externalContext:{startDate:"2026-03-23",endDate:"2026-03-30",
    completeOutsideTarget:true,shifts:[]},
};
const dstOutcome=generateConstrainedPeriodSchedule({...dstProof,maxSearchNodes:3000});
assert(!dstOutcome.issues.some(issue=>issue.includes("Inviabilidade comprovada")),
  "PR47-F: DST gap cannot yield a false proof of infeasibility from wall-clock minutes.");


// PR47-19: a full-day absence is HARD, separate from normal weekly
// availability, and conflicts with an explicit mandatory workday.
const absent:Person={...full,
  unavailableWorkDates:["2026-11-02"],
  qualificationTags:["Caixa","Armazém"]};
assert(validatePeopleSchedulingPolicies([absent]).length===0,
  "Whole-day unavailability and descriptive skills are valid optional profile fields.");
assert(validatePeopleSchedulingPolicies([{
  ...absent,requiredWorkDates:["2026-11-02"],
}]).length>0,
  "The same day cannot simultaneously be mandatory and unavailable.");
assert(validatePeopleSchedulingPolicies([{
  ...absent,unavailableWorkDates:["2026-11-02","2026-11-02"],
}]).length>0,"Duplicated unavailable dates are invalid.");
assert(isPersistedAppState({...savedV4,people:[absent]}),
  "Existing v4 state can persist optional non-work dates and qualification tags.");
assert(!isPersistedAppState({...savedV4,people:[{
  ...absent,requiredWorkDates:["2026-11-02"],
}]}),"Conflicting required and unavailable dates cannot be saved.");
const absInput:GenerateConstrainedPeriodInput={
  ...input,
  people:[{...partial,requiredWorkDates:[],
    unavailableWorkDates:["2026-11-02"]}],
  presence:{...input.presence,presenceExceptions:[
    {date:"2026-11-02",requirements:{
      minimumAtOpening:1,minimumDuringOperation:1,minimumAtClosing:1,
    }},
  ]},
};
const attempted=generateConstrainedPeriodSchedule({...absInput,maxSearchNodes:3000});
assert(attempted.status!=="generated" && attempted.assignments.length===0,
  "An unavailable person cannot be assigned to cover mandatory opening.");
const forbidden=certifyFinalGeneratedSchedule(absInput,[
  shift("2026-11-02","b","09:00","13:00"),
]);
assert(!forbidden.valid &&
  forbidden.issues.some(issue=>issue.includes("indisponibilidade")),
  "Independent certification rejects work during an explicitly absent day.");

console.log("PR47-B: contracts, targets, explicit dates, DST, 28-day cycles and legacy v4 passed.");
