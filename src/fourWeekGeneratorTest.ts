import type {
  GenerateConstrainedPeriodInput,
} from "./utils/constrainedPeriodGenerator";
import {
  generateConstrainedPeriodSchedule,MAX_CONSTRAINED_PERIOD_DAYS,
} from "./utils/constrainedPeriodGenerator";
import { certifyFinalGeneratedSchedule } from "./utils/finalScheduleCertification";
import { createEmptyWeeklyAvailability } from "./utils/availability";
import { createEmptyWeeklyPresenceRequirements } from "./utils/presence";
import { INITIAL_WORK_CONSTRAINTS } from "./utils/workConstraints";
import { workAccountingCycleForDate } from "./utils/accountingCycleConfiguration";

function assert(value:unknown,message:string):asserts value{
  if(!value)throw Error("PR47-18: "+message);
}
const requiredDates=["2026-11-02","2026-11-09","2026-11-16","2026-11-23"];
const weeklyOperatingHours={
  monday:[{start:"09:00",end:"13:00"}],
  tuesday:[],wednesday:[],thursday:[],friday:[],saturday:[],sunday:[],
};
const presence=createEmptyWeeklyPresenceRequirements();
presence.monday={minimumAtOpening:1,minimumDuringOperation:1,minimumAtClosing:1};
const input:GenerateConstrainedPeriodInput={
  startDate:"2026-11-02",endDate:"2026-11-29",
  timeZone:"Atlantic/Azores",
  people:[{
    id:"test",name:"Pessoa de ensaio",active:true,
    weeklyContractMinutes:480,weeklyTargetMinutes:240,
    requiredWorkDates:requiredDates,
  }],
  availabilities:[{
    personId:"test",
    weeklyAvailability:{
      ...createEmptyWeeklyAvailability(),
      monday:[{start:"09:00",end:"13:00"}],
    },
    exceptions:[],
  }],
  operatingCalendar:{weeklyOperatingHours,exceptions:[]},
  workRules:{standardShiftDurationMinutes:240},
  presence:{weeklyPresenceRequirements:presence,presenceExceptions:[]},
  workConstraints:structuredClone(INITIAL_WORK_CONSTRAINTS),
  externalContext:{
    startDate:"2026-10-26",endDate:"2026-12-06",
    completeOutsideTarget:true,shifts:[],
  },
  maxSearchNodes:5000,
};
assert(MAX_CONSTRAINED_PERIOD_DAYS===28,
  "Constrained scheduling must permit a complete four-week cycle.");
const result=generateConstrainedPeriodSchedule(input);
assert(result.status==="generated",
  "Four 7-day weeks must be solvable in one globally certified generation: "+
    result.status+" "+result.issues.join(" "));
assert(result.days.length===28,
  "All 28 civil days must be part of a single solution, not stitched snapshots.");
assert(result.assignments.length===4 &&
  result.assignments.every((s,i)=>s.personId==="test"&&
    s.date===requiredDates[i]&&s.interval.start==="09:00"&&
    s.interval.end==="13:00"),
  "Four explicit mandatory workdays must be allocated, exactly one per week.");
const certified=certifyFinalGeneratedSchedule(input,result.assignments);
assert(certified.valid,
  "Independent certification must cover all 28 days: "+
    certified.issues.join(" "));
const cycle=workAccountingCycleForDate("2026-11-29","2026-11-02",28);
assert(cycle.startDate===input.startDate && cycle.endDate===input.endDate,
  "Generation window must align to the chosen accounting anchor.");
const beyond=generateConstrainedPeriodSchedule({
  ...input,endDate:"2026-11-30",
});
assert(beyond.status==="invalid_input" &&
  beyond.assignments.length===0,
  "29 days remain explicitly rejected instead of silently truncated.");
const deterministic=generateConstrainedPeriodSchedule(input);
assert(deterministic.status===result.status &&
  JSON.stringify(deterministic.assignments)===JSON.stringify(result.assignments),
  "Same 28-day scenario must remain deterministic.");

function addCivilDate(iso:string,days:number):string {
  const time=Date.parse(iso+"T00:00:00Z");
  return new Date(time+days*86400000).toISOString().slice(0,10);
}
// Four complete cycles, including a leap day, year change and European DST.
// A single period must always be certified as one solution, not four
// independently generated weeks stitched into an apparently valid month.
for(const [anchor,zone] of [
  ["2026-03-23","Atlantic/Azores"],
  ["2026-12-07","Europe/Lisbon"],
  ["2027-02-01","UTC"],
  ["2028-02-28","Atlantic/Azores"],
] as const){
  const scenario=structuredClone(input);
  scenario.startDate=anchor;
  scenario.endDate=addCivilDate(anchor,27);
  scenario.timeZone=zone;
  scenario.people[0].requiredWorkDates=[0,7,14,21]
    .map(offset=>addCivilDate(anchor,offset));
  scenario.externalContext={
    startDate:addCivilDate(anchor,-7),
    endDate:addCivilDate(anchor,34),
    completeOutsideTarget:true,shifts:[],
  };
  const generated=generateConstrainedPeriodSchedule(scenario);
  assert(generated.status==="generated",
    "28-day stress cycle failed at "+anchor+" / "+zone+": "+generated.issues.join("; "));
  assert(generated.days.length===28&&generated.assignments.length===4,
    "Civil date accounting must preserve exactly 28 days at "+anchor+".");
  assert(certifyFinalGeneratedSchedule(scenario,generated.assignments).valid,
    "Independent 28-day certification failed at "+anchor+".");
}

console.log("PR47-18: 28-day certified generation, four weekly obligations, deterministic repeat, 29-day rejection plus 4 month/DST/leap-year stress cases passed.");
