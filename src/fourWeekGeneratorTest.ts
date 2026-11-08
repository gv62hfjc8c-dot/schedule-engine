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
import { accountingCycleForDate } from "./utils/accountingCycle28";

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
const cycle=accountingCycleForDate("2026-11-29","2026-11-02");
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
console.log("PR47-18: 28-day certified generation, four weekly obligations, deterministic repeat, 29-day rejection passed.");
