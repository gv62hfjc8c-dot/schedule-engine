import type {
  Person, PersonAvailability, PresenceConfiguration, WeeklyOperatingHours,
  TimeInterval, DatedWorkShift,
} from "./types";
import { createEmptyWeeklyAvailability } from "./utils/availability";
import { createEmptyWeeklyPresenceRequirements } from "./utils/presence";
import { WEEKDAYS } from "./utils/operatingCalendar";
import { INITIAL_WORK_CONSTRAINTS,validateWorkConstraints } from "./utils/workConstraints";
import { validatePersonWeeklyContractCaps } from "./utils/personSchedulingPolicies";
import { generateConstrainedPeriodSchedule,type GenerateConstrainedPeriodInput } from "./utils/constrainedPeriodGenerator";
import { certifyFinalGeneratedSchedule } from "./utils/finalScheduleCertification";

function assert(value:unknown,message:string):asserts value {
  if(!value)throw Error("PR47-F property matrix: "+message);
}
const dates=["2026-11-02","2026-11-03","2026-11-04"];
const patterns:TimeInterval[][]=[
  [{start:"09:00",end:"15:00"}],
  [{start:"09:00",end:"12:00"}],
  [{start:"12:00",end:"15:00"}],
  [],
];
function scenario(seed:number):GenerateConstrainedPeriodInput {
  const people:Person[]=["a","b"].map((id,p)=>({
    id,name:"Pessoa "+id,active:true,
    weeklyContractMinutes: [480,720,1200][(seed+p)%3],
    weeklyTargetMinutes:240,
    requiredWorkDates:seed%3===0&&p===0?["2026-11-03"]:[],
  }));
  const availabilities:PersonAvailability[]=people.map((person,p)=>({
    personId:person.id,weeklyAvailability:createEmptyWeeklyAvailability(),
    exceptions:dates.map((date,i)=>({
      date,intervals:patterns[(seed+p+i*2)%4],
    })),
  }));
  const weeklyOperatingHours=Object.fromEntries(
    WEEKDAYS.map(day=>[day,[]])) as unknown as WeeklyOperatingHours;
  const presence:PresenceConfiguration={
    weeklyPresenceRequirements:createEmptyWeeklyPresenceRequirements(),
    presenceExceptions:dates.map((date,i)=>({
      date,requirements:{
        minimumAtOpening:seed%4===0?0:1,
        minimumDuringOperation:seed%5===0?0:1,
        minimumAtClosing:seed%4===0?0:1,
      },
    })),
  };
  return {
    startDate:dates[0],endDate:dates[dates.length-1],
    timeZone:"Atlantic/Azores",
    people,availabilities,
    operatingCalendar:{
      weeklyOperatingHours,
      exceptions:dates.map(date=>({date,intervals:patterns[0]})),
    },
    workRules:{
      standardShiftDurationMinutes:240,
      ...(seed%4===0?{fullShortDayMaximumMinutes:360}:{}),
      ...(seed%3===0?{requireShiftsOnAvailableDays:true}:{}),
    },
    presence,
    workConstraints:structuredClone(INITIAL_WORK_CONSTRAINTS),
    externalContext:{startDate:"2026-11-01",endDate:"2026-11-09",
      completeOutsideTarget:true,shifts:[]},
    maxSearchNodes:1200,
  };
}
let generated=0,rejected=0,searchLimited=0;
for(let seed=0;seed<12;seed++){
  const input=scenario(seed);
  const outcome=generateConstrainedPeriodSchedule(input);
  assert(outcome.status!=="invalid_input" && outcome.status!=="incomplete_context",
    "All generated fixture inputs should be valid and context complete (seed "+seed+").");
  assert(outcome.exploredNodes<=input.maxSearchNodes!,
    "Search budget must be global and respected (seed "+seed+").");
  if(outcome.status==="generated"){
    generated++;
    const cert=certifyFinalGeneratedSchedule(input,outcome.assignments);
    assert(cert.valid,
      "Published result must pass independent final certification (seed "+seed+"): "+cert.issues.join(" "));
    const caps=validatePersonWeeklyContractCaps(input.people,outcome.assignments,
      input.workConstraints.maximumWeeklyEffectiveMinutes,input.timeZone,input.startDate,input.endDate);
    assert(caps.valid,"Published result exceeds an individual contract (seed "+seed+").");
    const work=validateWorkConstraints({
      rules:input.workConstraints,timeZone:input.timeZone,
      targetPeriod:{startDate:input.startDate,endDate:input.endDate},
      knownSchedule:{
        startDate:input.externalContext.startDate,endDate:input.externalContext.endDate,
        complete:true,shifts:[...outcome.assignments],
      },
    });
    assert(work.status==="valid",
      "Published result must meet work rules with complete context (seed "+seed+").");
    const identities=new Set<string>();
    for(const shift of outcome.assignments){
      const key=shift.date+"|"+shift.personId;
      assert(!identities.has(key) && shift.date>=input.startDate && shift.date<=input.endDate,
        "Published result includes a duplicate or out-of-period shift (seed "+seed+").");
      identities.add(key);
    }
  }else{
    rejected++;
    assert(outcome.assignments.length===0,
      "An incomplete solution must never publish partial assignments (seed "+seed+").");
    if(outcome.status==="search_limit")searchLimited++;
  }
  const repeated=generateConstrainedPeriodSchedule(input);
  assert(repeated.status===outcome.status &&
    JSON.stringify(repeated.assignments)===JSON.stringify(outcome.assignments),
    "Generator must remain deterministic on identical inputs (seed "+seed+").");
}
assert(generated+rejected===12,"Every seeded scenario must be classified.");
console.log("PR47-F deterministic matrix:",JSON.stringify({
  scenarios:12,generated,rejected,searchLimited,
}));
