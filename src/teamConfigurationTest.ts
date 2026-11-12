import type {Person,WeeklyOperatingHours} from "./types";
import {APP_STATE_VERSION} from "./persistence/stateRepository";
import {isPersistedAppState} from "./persistence/localStorageStateRepository";
import {createEmptyWeeklyPresenceRequirements} from "./utils/presence";
import {createPerson} from "./utils/people";
import {validatePersonDraft,validateTeamConfiguration,teamFingerprint,isTeamConfirmed}
  from "./utils/teamConfiguration";
import {employedOn} from "./utils/employmentPeriods";
import {isTeamConfirmed as confirmed} from "./utils/teamConfiguration";
function ok(condition:unknown,message:string):asserts condition {
  if(!condition)throw Error("PR65: "+message);
}
const legacy=createPerson("p1","  Ana  Silva ");
const unbounded=validatePersonDraft(legacy,"unrestricted");
ok(unbounded.valid&&unbounded.person.employmentPeriods===undefined,
  "Unrestricted eligibility must remain explicit and compatible with legacy.");
ok(!validatePersonDraft(legacy,null).valid,
  "New staff must explicitly choose temporal eligibility.");
ok(!validatePersonDraft(legacy,"periods").valid,
  "Dated eligibility requires at least one period.");
const withDates:Person={
  ...legacy,name:"Ana Silva",employmentPeriods:[{startDate:"2026-11-01",endDate:null}],
};
const dated=validatePersonDraft(withDates,"periods");
ok(dated.valid && employedOn(dated.person,"2026-11-25"),
  "Valid dated employment survives normalization and is eligible in period.");
ok(!employedOn(dated.person,"2026-10-31"),
  "Eligibility cannot leak into a prior date.");
ok(!validatePersonDraft({...withDates,employmentPeriods:[
  {startDate:"2026-11-01",endDate:"2026-11-30"},
  {startDate:"2026-11-20",endDate:null},
]},"periods").valid,"Overlapping periods must be rejected before Save.");
ok(!validatePersonDraft({...withDates,employmentPeriods:[
  {startDate:"2026-02-30",endDate:null},
]},"periods").valid,"Invalid civil dates must not be accepted.");
ok(!validatePersonDraft({...legacy,employmentPeriods:[]},"none").valid,
  "Active person cannot be intentionally ineligible for every date.");
ok(validatePersonDraft({...legacy,active:false,employmentPeriods:[]},"none").valid,
  "Archived person with no eligible periods is preserved.");
ok(!validatePersonDraft({...legacy,weeklyContractMinutes:1200,weeklyTargetMinutes:1500},
  "unrestricted").valid,"Soft target cannot exceed contractual ceiling.");
ok(!validatePersonDraft({...legacy,qualificationTags:["Receção","Receção"]},
  "unrestricted").valid,"Duplicate qualifications rejected.");
ok(!validatePersonDraft({...legacy,weeklyContractMinutes:61},
  "unrestricted").valid,"Hours must be multiples of 15 min.");

const group=[{...withDates,id:"p1"},createPerson("p2","Bruno")];
ok(validateTeamConfiguration(group).valid,
  "Legacy unrestricted person is valid but no proof of actual employment.");
ok(!validateTeamConfiguration([]).valid,"Zero active people cannot confirm onboarding.");
ok(!validateTeamConfiguration([{...withDates,employmentPeriods:[]}]).valid,
  "An active person with [] employment cannot confirm the team.");
ok(!validateTeamConfiguration([group[0],{...group[1],id:"p1"}]).valid,
  "Duplicate person IDs are invalid.");
const base=teamFingerprint(group);
const onboarding={teamConfirmedFingerprint:base};
ok(isTeamConfirmed(onboarding,true,group),"Explicit saved fingerprint confirms team.");
ok(!confirmed(onboarding,false,group),"Previous onboarding stages are hard prerequisites.");
ok(!confirmed(onboarding,true,[{...group[0],name:"Ana Costa"},group[1]]),
  "Renaming a person invalidates confirmation.");
ok(!confirmed(onboarding,true,[{...group[0],employmentPeriods:[
  {startDate:"2026-11-02",endDate:null},
]},group[1]]),"Changing employment dates invalidates confirmation.");
ok(!confirmed(onboarding,true,[{...group[0],weeklyContractMinutes:1200},group[1]]),
  "Changing contract hours invalidates confirmation.");
ok(!confirmed(onboarding,true,[{...group[0],qualificationTags:["Receção"]},group[1]]),
  "Qualification edit invalidates confirmation.");
ok(!confirmed(onboarding,true,[{...group[0],active:false},group[1]]),
  "Archiving or reactivating staff invalidates confirmation.");
ok(teamFingerprint([...group].reverse())===base,
  "UI sorting must never invalidate confirmation.");
const noHours:WeeklyOperatingHours={
  monday:[],tuesday:[],wednesday:[],thursday:[],friday:[],saturday:[],sunday:[],
};
const state={
  version:APP_STATE_VERSION,weeklyOperatingHours:noHours,exceptions:[],
  people:group,availabilities:[],
  workRules:{standardShiftDurationMinutes:null},
  weeklyPresenceRequirements:createEmptyWeeklyPresenceRequirements(),
  presenceExceptions:[],onboarding,
};
ok(isPersistedAppState(state),"Team confirmation persists in existing state v4.");
ok(!isPersistedAppState({...state,onboarding:{teamConfirmedFingerprint:23}}),
  "Invalid confirmation cannot be persisted.");
console.log("PR65: atomic draft validation, temporal eligibility, contracts, legacy data and team confirmation PASS.");
