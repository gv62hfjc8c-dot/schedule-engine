import type { OperatingCalendarConfiguration, PersonAvailability, PresenceConfiguration, WeeklyOperatingHours } from "./types";
import { WEEKDAYS } from "./utils/operatingCalendar";
import { createEmptyWeeklyAvailability } from "./utils/availability";
import { createEmptyWeeklyPresenceRequirements } from "./utils/presence";
import { INITIAL_WORK_CONSTRAINTS } from "./utils/workConstraints";
import { createApprovedScheduleLedger, approveSchedule, validateApprovedScheduleLedger } from "./utils/approvedSchedules";
import { reviseApprovedScheduleForAbsence } from "./utils/partialScheduleRevision";
import { parseOfficialScheduleRequest } from "./application/officialScheduleRequest";

const check=(ok:unknown,msg:string):asserts ok=>{if(!ok)throw new Error("PR47-17: "+msg);};
const date="2026-11-02",span={start:"09:00",end:"13:00"};
const weekly=WEEKDAYS.reduce((s,k)=>{s[k]=[];return s;},{} as WeeklyOperatingHours);
const operatingCalendar:OperatingCalendarConfiguration={weeklyOperatingHours:weekly,
  exceptions:[{date,intervals:[span]}]};
const people=[{id:"a",name:"A",active:true},{id:"b",name:"B",active:true}];
const availabilities:PersonAvailability[]=people.map(p=>({
  personId:p.id,weeklyAvailability:createEmptyWeeklyAvailability(),
  exceptions:[{date,intervals:[span]}],
}));
const presence:PresenceConfiguration={
  weeklyPresenceRequirements:createEmptyWeeklyPresenceRequirements(),
  presenceExceptions:[{date,requirements:{
    minimumDuringOperation:1,minimumAtOpening:1,minimumAtClosing:1,
  }}],
};
const env={people,availabilities,operatingCalendar,presence,
  workConstraints:structuredClone(INITIAL_WORK_CONSTRAINTS)};
const ledger=createApprovedScheduleLedger(
  {startDate:"2026-10-26",endDate:"2026-11-09"},
  "Atlantic/Azores",true,
);
const first=approveSchedule({ledger,expectedVersion:0,
  at:"2026-11-01T10:00:00Z",environment:env,
  draft:{id:"original",startDate:date,endDate:date,
    timeZone:"Atlantic/Azores",shifts:[{
      date,personId:"a",interval:{...span},mealBreak:null,
    }]},
});
check(first.ok,"Initial tested official schedule must be valid.");
if(!first.ok)throw Error("fixture");
const source=JSON.stringify(first.ledger);
const result=reviseApprovedScheduleForAbsence({
  ledger:first.ledger,environment:env,request:{
    sourceId:"original",revisionId:"revision-1",expectedVersion:1,
    at:"2026-11-01T11:00:00Z",
    personId:"a",startDate:date,endDate:date,
    reason:"vacation",replacements:[{date,personId:"b"}],
  },
});
check(result.ok,"Future absence should safely reassign an existing approved shift.");
if(!result.ok)throw Error("revision fixture");
check(result.ledger.version===2 && result.ledger.records.length===2 &&
  result.ledger.records[0].status==="superseded" &&
  result.ledger.records[1].status==="approved" &&
  result.record.revision?.sourceId==="original" &&
  result.record.absences?.[0]?.personId==="a" &&
  result.record.shifts[0].personId==="b" &&
  validateApprovedScheduleLedger(result.ledger).length===0,
  "Revision preserves old version, attaches reason and revalidates substitution.");
check(JSON.stringify(first.ledger)===source,"Revision must not mutate original ledger.");
const noCoverage=reviseApprovedScheduleForAbsence({
  ledger:first.ledger,environment:env,request:{
    sourceId:"original",revisionId:"revision-fail",expectedVersion:1,
    at:"2026-11-01T11:00:00Z",
    personId:"a",startDate:date,endDate:date,
    reason:"other",replacements:[],
  },
});
check(!noCoverage.ok,"Revision removing required coverage must fail.");
const late=reviseApprovedScheduleForAbsence({
  ledger:first.ledger,environment:env,request:{
    sourceId:"original",revisionId:"revision-late",expectedVersion:1,
    at:"2026-11-03T11:00:00Z",
    personId:"a",startDate:date,endDate:date,
    reason:"vacation",replacements:[{date,personId:"b"}],
  },
});
check(!late.ok,"Retroactive revision must not silently rewrite past commitments.");

const good=parseOfficialScheduleRequest({kind:"revise",sourceId:"original",
  expectedVersion:1,personId:"a",startDate:date,endDate:date,
  reason:"vacation",replacements:[{date,personId:"b"}]});
check(good?.kind==="revise","Valid intent-only revision can be parsed.");
check(!parseOfficialScheduleRequest({kind:"revise",sourceId:"original",
  expectedVersion:1,personId:"a",startDate:date,endDate:date,
  reason:"vacation",replacements:[],ownerId:"victim"}),
  "Untrusted owner ID must be rejected by strict request parser.");
check(!parseOfficialScheduleRequest({kind:"approve",
  candidateId:"00000000-0000-4000-8000-000000000001",
  expectedVersion:0,ledger:{complete:true}}),
  "Untrusted ledger must never arrive in approval request.");
console.log("PR47-17: official partial revisions, nonretrospective audit, trusted intent and ownership checks passed.");
