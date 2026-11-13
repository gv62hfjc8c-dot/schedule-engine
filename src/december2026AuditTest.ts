import type {DatedWorkShift,Person,PersonAvailability,WeeklyOperatingHours,TimeInterval} from "./types";
import {WEEKDAYS} from "./utils/operatingCalendar";
import {createEmptyWeeklyPresenceRequirements} from "./utils/presence";
import {INITIAL_WORK_CONSTRAINTS,validateWorkConstraints} from "./utils/workConstraints";
import {certifyFinalGeneratedSchedule} from "./utils/finalScheduleCertification";
import {generateConstrainedPeriodSchedule, type GenerateConstrainedPeriodInput} from "./utils/constrainedPeriodGenerator";

function assert(value:unknown,message:string):asserts value{
  if(!value)throw new Error("AUDIT DECEMBER 2026: "+message);
}
const opening:TimeInterval={start:"09:00",end:"19:00"};
const weeklyOperatingHours=Object.fromEntries(WEEKDAYS.map(d=>[
  d,["monday","tuesday","wednesday","thursday","friday"].includes(d)?[opening]:[],
])) as WeeklyOperatingHours;
const people:Person[]=Array.from({length:8},(_,i)=>({
  id:"audit-december-"+(i+1),name:"Colaborador Dezembro "+String(i+1).padStart(2,"0"),
  active:true,weeklyContractMinutes:2400,weeklyTargetMinutes:2400,
}));
const availabilities:PersonAvailability[]=people.map(person=>({
  personId:person.id,weeklyAvailability:structuredClone(weeklyOperatingHours),exceptions:[],
}));
const weekDays=["2026-12-07","2026-12-08","2026-12-09","2026-12-10","2026-12-11"];
const makeDay=(date:string):DatedWorkShift[]=>people.map((person,i)=>({
  date,personId:person.id,
  interval:i<4?{start:"09:00",end:"18:00"}:{start:"10:00",end:"19:00"},
  mealBreak:i<4?{start:"12:00",end:"13:00"}:{start:"13:00",end:"14:00"},
}));
const benchmark=weekDays.flatMap(makeDay);
const externalMonday=makeDay("2026-12-14");
const input:GenerateConstrainedPeriodInput={
  startDate:"2026-12-07",endDate:"2026-12-13",timeZone:"Atlantic/Azores",
  people,availabilities,operatingCalendar:{weeklyOperatingHours,exceptions:[]},
  presence:{weeklyPresenceRequirements:createEmptyWeeklyPresenceRequirements(),
    presenceExceptions:[]},
  workRules:{standardShiftDurationMinutes:480,maximumDailyEffectiveMinutes:480,
    requireShiftsOnAvailableDays:true},
  workConstraints:structuredClone(INITIAL_WORK_CONSTRAINTS),
  externalContext:{startDate:"2026-12-06",endDate:"2026-12-14",
    completeOutsideTarget:true,shifts:externalMonday},
  maxSearchNodes:5000,
};
function effective(s:DatedWorkShift):number{
  const minutes=(t:string)=>Number(t.slice(0,2))*60+Number(t.slice(3));
  return minutes(s.interval.end)-minutes(s.interval.start)
    -(s.mealBreak?minutes(s.mealBreak.end)-minutes(s.mealBreak.start):0);
}
const expected=certifyFinalGeneratedSchedule(input,benchmark);
assert(expected.valid,
  "A constructive reference schedule with 8 people x 40h MUST certify: "+expected.issues.join(" "));
const baseline=validateWorkConstraints({
  timeZone:input.timeZone,rules:input.workConstraints,
  targetPeriod:{startDate:input.startDate,endDate:input.endDate},
  knownSchedule:{startDate:input.externalContext.startDate,
    endDate:input.externalContext.endDate,complete:true,
    shifts:[...benchmark,...externalMonday]},
});
assert(baseline.status==="valid","External reference validator must accept benchmark.");
for(const person of people){
  assert(benchmark.filter(s=>s.personId===person.id).reduce((n,s)=>n+effective(s),0)===2400,
    person.name+" fails the required 40h benchmark");
}
console.log("AUDIT December 2026: 8 x 40h benchmark independently certified; business is continuously covered.");
const blockedMonth=generateConstrainedPeriodSchedule({...input,startDate:"2026-12-01",endDate:"2026-12-31"});
assert(blockedMonth.status==="invalid_input" && blockedMonth.issues.some(x=>x.includes("28")),
  "Current generator must explicitly report its 28-day limitation.");
console.log("AUDIT December 2026: current 31-day month blocked by certified 28-day limit.");
const actual=generateConstrainedPeriodSchedule(input);
const weekly=people.map(person=>({
  person:person.name,minutes:actual.assignments.filter(s=>s.personId===person.id)
    .reduce((n,s)=>n+effective(s),0),
}));
console.log("AUDIT generator result:",JSON.stringify({
  status:actual.status,exploredNodes:actual.exploredNodes,
  shifts:actual.assignments.length,weekly,issues:actual.issues,
}));
assert(actual.status==="generated",
  "A provably feasible week must generate; got "+actual.status+". "+actual.issues.join(" "));
const actualCert=certifyFinalGeneratedSchedule(input,actual.assignments);
assert(actualCert.valid,
  "Generated week must independently certify: "+actualCert.issues.join(" "));
for(const person of weekly)assert(person.minutes===2400,
  person.person+" must reach exactly 2400 effective minutes, not just a SOFT target.");
console.log("AUDIT December 2026: generated 8-person 40h week PASS.");
