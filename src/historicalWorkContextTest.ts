import type {
  Person, TimeInterval, WeeklyOperatingHours, PresenceRequirement,
} from "./types";
import {
  prepareHistoricalWorkContext, type HistoricalContextRequest,
} from "./utils/historicalWorkContext";
import { INITIAL_WORK_CONSTRAINTS } from "./utils/workConstraints";
import { generateConstrainedPeriodSchedule } from "./utils/constrainedPeriodGenerator";
import { createEmptyWeeklyAvailability } from "./utils/availability";
import { createEmptyWeeklyPresenceRequirements } from "./utils/presence";
import { WEEKDAYS } from "./utils/operatingCalendar";

function assert(value:unknown,message:string):asserts value {
  if(!value)throw new Error("PR47-history: "+message);
}
const day="2026-11-03",monday="2026-11-02";
const targetPeriod={startDate:day,endDate:day};
const people:Person[]=[
  {id:"a",name:"Pessoa A",active:true},
  {id:"b",name:"Pessoa B",active:true},
];
const sourceShift={
  date:monday,personId:"a",
  interval:{start:"16:00",end:"22:00"},mealBreak:null,
};
const basic:HistoricalContextRequest={
  targetPeriod,timeZone:"Atlantic/Azores",
  historyStartDate:"2026-01-01",
  workConstraints:INITIAL_WORK_CONSTRAINTS,
  personIds:people.map(p=>p.id),
  archive:{timeZone:"Atlantic/Azores",coverage:[],shifts:[]},
};
const absentArchive=prepareHistoricalWorkContext({...basic,archive:null});
assert(absentArchive.status==="incomplete_context" &&
  absentArchive.externalContext===null,
  "Archive not imported is incomplete, never an empty authoritative ledger.");
const none=prepareHistoricalWorkContext(basic);
assert(none.status==="incomplete_context"&&none.externalContext===null&&
  none.missingCoverage.length>0,
  "No history must be UNKNOWN, not declared empty.");
const onlyA={...basic,archive:{...basic.archive!,coverage:[{
  personId:"a",startDate:"2026-01-01",endDate:"2026-11-08",
  sourceId:"legacy-roster-2026",verified:true,
}]}};
const missingPerson=prepareHistoricalWorkContext(onlyA);
assert(missingPerson.status==="incomplete_context"&&
  missingPerson.missingCoverage.some(c=>c.personId==="b"),
  "Importing one person's schedule must not attest others as off.");
const unverified={...basic,archive:{...onlyA.archive,coverage:[
  ...onlyA.archive.coverage,
  {personId:"b",startDate:"2026-01-01",endDate:"2026-11-08",
    sourceId:"legacy-roster-2026",verified:false},
]}};
assert(prepareHistoricalWorkContext(unverified).status==="incomplete_context",
  "Uploaded but unverified records may not certify absence of work.");
const novemberOnly={...basic,archive:{...basic.archive!,coverage:
  people.map(p=>({personId:p.id,startDate:"2026-11-02",
    endDate:"2026-11-08",sourceId:"partial-nov",verified:true}))}};
const januaryGap=prepareHistoricalWorkContext(novemberOnly);
assert(januaryGap.status==="incomplete_context"&&
  januaryGap.missingCoverage.some(c=>c.date==="2026-01-01"),
  "The 2026 anchor is enforced even when the adjacent week is known.");
const completed:HistoricalContextRequest={
  ...basic,archive:{
    timeZone:"Atlantic/Azores",
    coverage:people.map(p=>({personId:p.id,
      startDate:"2026-01-01",endDate:"2026-11-08",
      sourceId:"verified-historical-import-1",verified:true})),
    shifts:[sourceShift],
  },
};
const ready=prepareHistoricalWorkContext(completed);
assert(ready.status==="ready"&&ready.missingCoverage.length===0&&
  ready.externalContext?.completeOutsideTarget===true&&
  ready.externalContext.shifts.length===1,
  "Verified historical data supplies the known previous shift.");
const noReuse=prepareHistoricalWorkContext({...completed,archive:{
  ...completed.archive!,shifts:[sourceShift,{...sourceShift}],
}});
assert(noReuse.status==="invalid_input",
  "Duplicate past shifts must not be silently counted twice.");
const occupied=prepareHistoricalWorkContext({...completed,archive:{
  ...completed.archive!,shifts:[
    sourceShift,{...sourceShift,date:day,personId:"b"},
  ],
}});
assert(occupied.status==="target_occupied"&&occupied.externalContext===null,
  "Imported work on target dates requires revision instead of new scheduling.");

if(!ready.externalContext)throw new Error("Verified historical context expected.");
const hours:TimeInterval[]=[{start:"08:00",end:"12:00"}];
const closed=WEEKDAYS.reduce((hours,day)=>{hours[day]=[];return hours;},{} as WeeklyOperatingHours);
const presence=createEmptyWeeklyPresenceRequirements();
const one:PresenceRequirement={
  minimumAtOpening:1,minimumDuringOperation:1,minimumAtClosing:1,
};
const result=generateConstrainedPeriodSchedule({
  ...targetPeriod,timeZone:"Atlantic/Azores",
  people,
  availabilities:people.map(p=>({
    personId:p.id,
    weeklyAvailability:createEmptyWeeklyAvailability(),
    exceptions:[{date:day,intervals:hours}],
  })),
  operatingCalendar:{weeklyOperatingHours:closed,
    exceptions:[{date:day,intervals:hours}]},
  presence:{weeklyPresenceRequirements:presence,
    presenceExceptions:[{date:day,requirements:one}]},
  workRules:{standardShiftDurationMinutes:240},
  workConstraints:structuredClone(INITIAL_WORK_CONSTRAINTS),
  externalContext:ready.externalContext,
  maxSearchNodes:5000,
});
assert(result.status==="generated"&&result.assignments.length===1&&
  result.assignments[0].personId==="b",
  "A 10h rest gap with imported historical work excludes A; engine selects B.");

const withLidio={
  ...basic,
  targetPeriod:{startDate:"2026-01-06",endDate:"2026-01-06"},
  historyStartDate:"2026-01-01",
  personIds:["a","b"],
  employmentPeriods:{
    a:[{startDate:"2025-12-29",endDate:null}],
    b:[{startDate:"2026-01-05",endDate:null}],
  },
  archive:{timeZone:"Atlantic/Azores",shifts:[],
    coverage:[
      {personId:"a",startDate:"2026-01-01",endDate:"2026-01-05",sourceId:"january",verified:true},
      {personId:"b",startDate:"2026-01-05",endDate:"2026-01-05",sourceId:"january",verified:true},
    ]},
} satisfies HistoricalContextRequest;
const effectiveEmployment=prepareHistoricalWorkContext(withLidio);
assert(effectiveEmployment.status==="ready",
  "Historical gaps before Lidio's entry must not block a verified employed period.");
const priorToEmployment=prepareHistoricalWorkContext({...withLidio,
  archive:{...withLidio.archive,shifts:[{
    date:"2026-01-01",personId:"b",interval:{start:"08:00",end:"12:00"},mealBreak:null,
  }]}});
assert(priorToEmployment.status==="invalid_input",
  "Historical work may not be attributed before a person's actual entry.");
const invalidEmployment=prepareHistoricalWorkContext({...withLidio,
  employmentPeriods:{...withLidio.employmentPeriods,b:[
    {startDate:"2026-01-05",endDate:"2026-01-08"},
    {startDate:"2026-01-07",endDate:null},
  ]}});
assert(invalidEmployment.status==="invalid_input",
  "Overlapping employee relationships must be rejected.");

console.log("PR47-history: unknown, unverified and incomplete 2026 history blocked; "+
  "verified import guides cross-day scheduling correctly.");
