import type {Person,PersonAvailability,WeeklyOperatingHours,WorkRulesConfiguration} from "./types";
import {createPersonAvailability,getAvailabilityIntervalsForDate} from "./utils/availability";
import {
  availabilityDayStatus,availabilityAndRulesFingerprint,
  isAvailabilityAndRulesConfirmed,validateAvailabilityConfiguration,
  validateAvailabilityException,withAvailabilityDecision,
} from "./utils/availabilityConfiguration";
import {isPersistedAppState} from "./persistence/localStorageStateRepository";
import {APP_STATE_VERSION} from "./persistence/stateRepository";
import {createEmptyWeeklyPresenceRequirements} from "./utils/presence";
function assert(condition:unknown,message:string):asserts condition{
  if(!condition)throw Error("PR68: "+message);
}
const hours:WeeklyOperatingHours={
  monday:[{start:"09:00",end:"13:00"},{start:"15:00",end:"19:00"}],
  tuesday:[{start:"09:00",end:"18:00"}],
  wednesday:[],thursday:[],friday:[],saturday:[],sunday:[],
};
const rules:WorkRulesConfiguration={standardShiftDurationMinutes:240};
const person:Person={id:"p1",name:"Ensaio",active:true};
const legacy=createPersonAvailability(person.id);
assert(availabilityDayStatus(legacy,"monday",hours.monday)==="unconfigured",
  "Empty legacy availability is NOT an explicit unavailability choice.");
assert(availabilityDayStatus(legacy,"wednesday",hours.wednesday)==="closed",
  "Closed days are not pending regardless of empty availability.");
assert(getAvailabilityIntervalsForDate("2026-11-09",legacy).length===0,
  "Missing configuration must NOT make somebody schedulable.");
const unavailable=withAvailabilityDecision(legacy,"monday","unavailable");
assert(availabilityDayStatus(unavailable,"monday",hours.monday)==="unavailable",
  "Explicit unavailability must be distinguishable from unconfigured.");
assert(unavailable.weeklyAvailability.monday.length===0,
  "Explicit unavailability must stay a hard empty slot for generators.");
assert(availabilityDayStatus(legacy,"monday",hours.monday)==="unconfigured",
  "Draft helper must never mutate original persisted data.");
const restored=withAvailabilityDecision(unavailable,"monday","unconfigured");
assert(availabilityDayStatus(restored,"monday",hours.monday)==="unconfigured",
  "Resetting must remove the explicit unavailability marker.");
const monday=withAvailabilityDecision(legacy,"monday","available",hours.monday);
assert(availabilityDayStatus(monday,"monday",hours.monday)==="available",
  "Split operating windows must accept two matching availability intervals.");
const contradictory:PersonAvailability={
  ...monday,unavailableWeekdays:["monday"],
};
assert(availabilityDayStatus(contradictory,"monday",hours.monday)==="invalid",
  "A marked unavailable day cannot also be available.");
assert(getAvailabilityIntervalsForDate("2026-11-09",contradictory).length===0,
  "An explicit unavailable marker MUST be enforced by the resolver, even against inconsistent imported intervals.");
const outside=withAvailabilityDecision(legacy,"monday","available",[
  {start:"08:00",end:"13:00"},
]);
assert(availabilityDayStatus(outside,"monday",hours.monday)==="invalid",
  "Availability outside operation must not be confirmed.");
const normalized=withAvailabilityDecision(monday,"tuesday","unavailable");
const full=validateAvailabilityConfiguration([person],[normalized],hours,[],rules);
assert(full.valid,
  "One available day and explicit unavailability on other open days is structurally valid.");
assert(!validateAvailabilityConfiguration([person],[legacy],hours,[],rules).valid,
  "Unconfigured staff cannot be marked confirmed.");
assert(!validateAvailabilityConfiguration([person],[unavailable],hours,[],rules).valid,
  "Still-unconfigured Tuesday prevents confirmation.");
assert(!validateAvailabilityConfiguration([person],[normalized],hours,[],
  {standardShiftDurationMinutes:null}).valid,
  "Missing work rules prevent Step 4, even if availability decisions exist.");
assert(!validateAvailabilityConfiguration([person],[normalized],hours,[],
  {standardShiftDurationMinutes:17}).valid,
  "Standard shift must obey 15-minute granularity.");
assert(!validateAvailabilityConfiguration([{...person,active:false}],[normalized],hours,[],rules).valid,
  "No active staff cannot be confirmed.");
assert(validateAvailabilityException({date:"2026-11-12",intervals:[]},
  [],null,hours,[]).valid,
  "An explicit empty date exception remains an intentional unavailable override.");
assert(!validateAvailabilityException({date:"2026-02-30",intervals:[]},
  [],null,hours,[]).valid,"Impossible exception date rejected.");
assert(!validateAvailabilityException({date:"2026-11-09",intervals:hours.monday},
  [{date:"2026-11-09",intervals:[]}],null,hours,[]).valid,
  "Duplicate exception dates rejected.");
assert(validateAvailabilityException({date:"2026-11-09",intervals:hours.monday},
  [{date:"2026-11-09",intervals:[]}],0,hours,[]).valid,
  "Editing the current exception's own date is safe.");
assert(!validateAvailabilityException({date:"2026-11-11",intervals:hours.monday},
  [],null,hours,[]).valid,
  "Closed dates cannot be accidentally scheduled.");

const signature=availabilityAndRulesFingerprint([normalized],rules);
assert(isAvailabilityAndRulesConfirmed({availabilityRulesConfirmedFingerprint:signature},
  true,[person],[normalized],hours,[],rules),
  "Explicit fingerprint must confirm step 4 only with valid prior stages.");
assert(!isAvailabilityAndRulesConfirmed({availabilityRulesConfirmedFingerprint:signature},
  false,[person],[normalized],hours,[],rules),
  "Team confirmation is a prerequisite for Step 4.");
assert(!isAvailabilityAndRulesConfirmed({availabilityRulesConfirmedFingerprint:signature},
  true,[person],[monday],hours,[],rules),
  "Editing one day invalidates Step 4.");
assert(!isAvailabilityAndRulesConfirmed({availabilityRulesConfirmedFingerprint:signature},
  true,[person],[normalized],hours,[],{standardShiftDurationMinutes:480}),
  "Changing generation rules invalidates Step 4.");
assert(availabilityAndRulesFingerprint([normalized],rules)===signature,
  "Identical configuration produces identical fingerprint.");

const legacyState={
  version:APP_STATE_VERSION,weeklyOperatingHours:hours,exceptions:[],
  people:[person],availabilities:[legacy],workRules:rules,
  weeklyPresenceRequirements:createEmptyWeeklyPresenceRequirements(),
  presenceExceptions:[],
};
assert(isPersistedAppState(legacyState),
  "Historical V4 records with empty arrays remain readable and unconfigured.");
const currentState={...legacyState,availabilities:[normalized],
  onboarding:{availabilityRulesConfirmedFingerprint:signature}};
assert(isPersistedAppState(currentState),
  "New optional decision metadata and Step 4 fingerprint persist in V4 without migration.");
assert(!isPersistedAppState({...legacyState,availabilities:[{
  ...normalized,unavailableWeekdays:["monday","monday"],
}]}),"Duplicate explicit unavailable days must fail persistence validation.");
assert(!isPersistedAppState({...legacyState,
  onboarding:{availabilityRulesConfirmedFingerprint:17}}),
  "Corrupted onboarding fingerprint cannot persist.");
console.log("PR68: availability states, explicit dates, split windows, draft purity, V4 persistence and Step 4 confirmation PASS.");
