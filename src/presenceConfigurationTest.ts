import type {PresenceException,PresenceRequirement,WeeklyOperatingHours} from "./types";
import {APP_STATE_VERSION} from "./persistence/stateRepository";
import {isPersistedAppState} from "./persistence/localStorageStateRepository";
import {createEmptyWeeklyPresenceRequirements,resolvePresenceForDate} from "./utils/presence";
import {
  coverageFingerprint,isCoverageConfirmed,validCoverageConfiguration,
  validatePresenceDraft,validatePresenceExceptionDraft,
} from "./utils/presenceConfiguration";
import {operationFingerprint} from "./utils/accountingCycleConfiguration";
import {certifyFinalGeneratedSchedule} from "./utils/finalScheduleCertification";
import {INITIAL_WORK_CONSTRAINTS} from "./utils/workConstraints";
import type {GenerateConstrainedPeriodInput} from "./utils/constrainedPeriodGenerator";

function assert(check:unknown,message:string):asserts check {
  if(!check)throw Error("PR64: "+message);
}
const hours:WeeklyOperatingHours={
  monday:[{start:"09:00",end:"13:00"},{start:"15:00",end:"19:00"}],
  tuesday:[],wednesday:[],thursday:[],friday:[],saturday:[],sunday:[],
};
const weekly=createEmptyWeeklyPresenceRequirements();
const first=resolvePresenceForDate("2026-11-09",weekly,[],hours,[]);
assert(first.status==="configured" && first.source==="default" &&
  first.requirements.minimumDuringOperation===1,
  "null weekly coverage must inherit minimum one at EVERY open instant.");
assert(resolvePresenceForDate("2026-11-10",weekly,[],hours,[]).status==="closed",
  "closed day has no presence requirement.");

const zero:PresenceRequirement={
  minimumAtOpening:0,minimumDuringOperation:0,minimumAtClosing:0,
};
assert(validatePresenceDraft(zero).valid,"explicit zero is a valid intentional override.");
weekly.monday=zero;
const overridden=resolvePresenceForDate("2026-11-09",weekly,[],hours,[]);
assert(overridden.status==="configured" && overridden.source==="weekly" &&
  overridden.requirements.minimumDuringOperation===0,
  "explicit all-zero must remain distinct from absence.");
const nullException:PresenceException={date:"2026-11-09",requirements:null};
const reset=resolvePresenceForDate("2026-11-09",weekly,[nullException],hours,[]);
assert(reset.status==="configured" && reset.source==="default" &&
  reset.requirements.minimumDuringOperation===1,
  "null date exception must override personalized weekly zero with default one.");
const custom:PresenceRequirement={
  minimumAtOpening:1,minimumDuringOperation:2,minimumAtClosing:1,
};
const exceptions=[{date:"2026-11-09",requirements:custom}];
assert(resolvePresenceForDate("2026-11-09",weekly,exceptions,hours,[]).status==="configured",
  "custom date exception must remain usable.");
assert(resolvePresenceForDate("2026-11-09",weekly,[...exceptions,...exceptions],hours,[]).status==="invalid",
  "duplicate exceptions must never be ignored.");
assert(!validatePresenceExceptionDraft(
  {date:"2026-02-30",requirements:null},[],null).valid,
  "invalid dates must be rejected before persistence.");
assert(!validatePresenceExceptionDraft(
  {date:"2026-11-09",requirements:null},exceptions,null).valid,
  "duplicate date drafts must fail.");
assert(validatePresenceExceptionDraft(
  {date:"2026-11-09",requirements:null},exceptions,0).valid,
  "editing its own date must not be mistaken for duplicate.");
assert(!validatePresenceDraft({...custom,minimumAtClosing:-1}).valid,
  "negative requirements must fail.");
assert(!validCoverageConfiguration(hours,weekly,[...exceptions,...exceptions]),
  "a duplicate exception prevents confirmation.");

const signature=coverageFingerprint(hours,[],weekly,[]);
const onboarding={cycleDecisionConfirmed:true,
  operationConfirmedFingerprint:operationFingerprint(hours,"Atlantic/Azores"),
  coverageConfirmedFingerprint:signature};
assert(isCoverageConfirmed(onboarding,true,hours,[],weekly,[]),
  "explicit confirmation records the exact active coverage snapshot.");
assert(!isCoverageConfirmed(onboarding,false,hours,[],weekly,[]),
  "operation change invalidates coverage confirmation.");
assert(!isCoverageConfirmed(onboarding,true,hours,[],{
  ...weekly,monday:custom},[]),
  "new personalized minima invalidate previous confirmation.");
assert(!isCoverageConfirmed(onboarding,true,{
  ...hours,monday:[{start:"09:00",end:"14:00"}]},[],weekly,[]),
  "change in opening hours invalidates coverage confirmation.");
assert(!isCoverageConfirmed(onboarding,true,hours,
  [{date:"2026-11-10",intervals:[]}],weekly,[]),
  "an operating exception invalidates previously confirmed coverage.");
assert(!isCoverageConfirmed(onboarding,true,hours,[],weekly,[nullException]),
  "a new date exception invalidates previously confirmed coverage.");

const legacy={
  version:APP_STATE_VERSION,weeklyOperatingHours:hours,exceptions:[],
  people:[],availabilities:[],workRules:{standardShiftDurationMinutes:null},
  weeklyPresenceRequirements:createEmptyWeeklyPresenceRequirements(),
  presenceExceptions:[],
};
assert(isPersistedAppState(legacy),
  "legacy persisted null rules remain valid without a destructive migration.");
assert(isPersistedAppState({...legacy,onboarding}),
  "explicit coverage confirmation can be persisted in the same v4 schema.");
assert(!isPersistedAppState({...legacy,onboarding:{
  coverageConfirmedFingerprint:5}}),
  "corrupted fingerprints must not enter persistence.");

// The independent final gate must reject a schedule with uncovered time,
// even though the user has never customized the standard minimum.
const input:GenerateConstrainedPeriodInput={
  startDate:"2026-11-09",endDate:"2026-11-09",
  timeZone:"Atlantic/Azores",people:[],
  availabilities:[],
  operatingCalendar:{weeklyOperatingHours:hours,exceptions:[]},
  workRules:{standardShiftDurationMinutes:240},
  presence:{weeklyPresenceRequirements:createEmptyWeeklyPresenceRequirements(),
    presenceExceptions:[]},
  workConstraints:structuredClone(INITIAL_WORK_CONSTRAINTS),
  externalContext:{startDate:"2026-11-08",endDate:"2026-11-15",
    completeOutsideTarget:true,shifts:[]},
};
const rejected=certifyFinalGeneratedSchedule(input,[]);
assert(!rejected.valid &&
  rejected.issues.some(issue=>/cobertura|presen|necessár|mínim/i.test(issue)),
  "certifier must reject no shifts when default coverage is one person.");
const explicitZeroInput:GenerateConstrainedPeriodInput={
  ...input,presence:{...input.presence,weeklyPresenceRequirements:{
    ...input.presence.weeklyPresenceRequirements,monday:zero,
  }},
};
assert(certifyFinalGeneratedSchedule(explicitZeroInput,[]).valid,
  "an explicitly selected zero minimum allows no staff, without inventing turns.");
console.log("PR64: default one-person hard minimum, split windows, exceptions, explicit zero, confirmation, legacy data and independent certification PASS.");
