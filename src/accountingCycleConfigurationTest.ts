import type {WeeklyOperatingHours} from "./types";
import {createEmptyWeeklyPresenceRequirements} from "./utils/presence";
import {isPersistedAppState} from "./persistence/localStorageStateRepository";
import {APP_STATE_VERSION} from "./persistence/stateRepository";
import {
  ACCOUNTING_CYCLE_CHOICES,
  workAccountingCycleForDate,selectedCycleLength,
  isOperationConfirmed,operationFingerprint,
  type OnboardingConfiguration,
} from "./utils/accountingCycleConfiguration";

function assert(check:unknown,message:string):asserts check {
  if(!check)throw Error("PR63: "+message);
}
const weekly:WeeklyOperatingHours={
  monday:[{start:"09:00",end:"19:00"}],
  tuesday:[{start:"09:00",end:"18:00"}],
  wednesday:[{start:"09:00",end:"18:00"}],
  thursday:[{start:"09:00",end:"18:00"}],
  friday:[{start:"09:00",end:"18:00"}],
  saturday:[{start:"09:00",end:"13:00"}],
  sunday:[],
};
const empty={
  version:APP_STATE_VERSION,
  operationTimeZone:"Atlantic/Azores",
  weeklyOperatingHours:weekly,
  exceptions:[],people:[],availabilities:[],
  workRules:{standardShiftDurationMinutes:null},
  weeklyPresenceRequirements:createEmptyWeeklyPresenceRequirements(),
  presenceExceptions:[],
};
assert(isPersistedAppState(empty),"legacy v4 must remain valid without onboarding or cycle.");
assert(selectedCycleLength(undefined,undefined)===null,"no cycle must remain absent.");
assert(selectedCycleLength("2026-11-02",undefined)===28,
  "legacy anchored v4 records still imply 28-day cycles.");
assert(JSON.stringify(ACCOUNTING_CYCLE_CHOICES)==="[7,14,28]",
  "only tested fixed 1/2/4-week cycles are currently offered.");
for(const days of ACCOUNTING_CYCLE_CHOICES){
  const last=workAccountingCycleForDate("2026-11-"+String(1+days).padStart(2,"0"),
    "2026-11-02",days);
  // The day after each fixed cycle must start a new period.
  const next=workAccountingCycleForDate("2026-11-30","2026-11-02",days);
  assert(next.totalWeeks===days/7 && next.weeks.length===days/7,
    "week breakdown must equal selected length.");
  assert(next.days===days,"resolved cycle must preserve selection.");
  assert(last.totalWeeks===days/7,"length must be reflected across any selected date.");
}
const weeklyCycle=workAccountingCycleForDate("2026-11-08","2026-11-02",7);
assert(weeklyCycle.startDate==="2026-11-02" &&
  weeklyCycle.endDate==="2026-11-08" && weeklyCycle.week===1,
  "seven-day cycle includes its last day.");
const fortnight=workAccountingCycleForDate("2026-11-16","2026-11-02",14);
assert(fortnight.startDate==="2026-11-16" &&
  fortnight.endDate==="2026-11-29" && fortnight.week===1,
  "fourteenth day boundary begins a fresh fortnight.");
const fixed28=workAccountingCycleForDate("2026-11-29","2026-11-02",28);
assert(fixed28.startDate==="2026-11-02" && fixed28.endDate==="2026-11-29" &&
  fixed28.week===4,"existing 28-day cycle semantics unchanged.");
const prior=workAccountingCycleForDate("2026-11-01","2026-11-02",7);
assert(prior.startDate==="2026-10-26" && prior.endDate==="2026-11-01",
  "negative cycle indices remain deterministic.");
const leap=workAccountingCycleForDate("2028-02-29","2028-02-01",28);
assert(leap.startDate==="2028-02-29" && leap.endDate==="2028-03-27",
  "leap-day arithmetic does not drift.");
const signature=operationFingerprint(weekly,"Atlantic/Azores");
const onboarding:OnboardingConfiguration={
  cycleDecisionConfirmed:true,
  operationConfirmedFingerprint:signature,
};
assert(isOperationConfirmed(onboarding,weekly,"Atlantic/Azores"),
  "explicit no-cycle decision can be confirmed.");
assert(!isOperationConfirmed(undefined,weekly,"Atlantic/Azores"),
  "default opening hours must never imply confirmation.");
assert(!isOperationConfirmed({...onboarding,cycleDecisionConfirmed:false},
  weekly,"Atlantic/Azores"),"cycle choice itself must be explicit.");
assert(!isOperationConfirmed(onboarding,weekly,"Europe/Lisbon"),
  "changing the time zone invalidates the confirmation.");
assert(!isOperationConfirmed(onboarding,{...weekly,monday:[{start:"10:00",end:"19:00"}]},
  "Atlantic/Azores"),"changing opening hours invalidates confirmation.");
assert(!isOperationConfirmed(onboarding,weekly,"Atlantic/Azores","2026-11-02",28),
  "enabling a cycle invalidates the previous no-cycle confirmation.");
assert(isPersistedAppState({...empty,onboarding}),
  "confirmed absence of cycle must be valid and persistable.");
assert(isPersistedAppState({...empty,cycleAnchorDate:"2026-11-02",
  accountingCycleDays:14,onboarding:{cycleDecisionConfirmed:true}}),
  "14-day cycle must be accepted in existing v4 payload.");
assert(!isPersistedAppState({...empty,accountingCycleDays:14}),
  "cycle duration without anchor must be rejected.");
assert(!isPersistedAppState({...empty,cycleAnchorDate:"2026-11-02",
  accountingCycleDays:21}),"unsupported cycle duration must be rejected.");
assert(!isPersistedAppState({...empty,onboarding:{cycleDecisionConfirmed:"yes"}}),
  "malformed confirmation cannot reach persistence.");
console.log("PR63: no-cycle decision, fixed 7/14/28-day cycles, legacy 28-day, validations and honest onboarding confirmation PASS.");
