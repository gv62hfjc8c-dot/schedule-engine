import type { OperatingCalendarConfiguration,PersonAvailability,
  PresenceConfiguration,WeeklyOperatingHours } from "./types";
import { WEEKDAYS } from "./utils/operatingCalendar";
import { createEmptyWeeklyAvailability } from "./utils/availability";
import { createEmptyWeeklyPresenceRequirements } from "./utils/presence";
import { INITIAL_WORK_CONSTRAINTS } from "./utils/workConstraints";
import {
  createApprovedScheduleLedger,type ApprovedScheduleLedger,
} from "./utils/approvedSchedules";
import {
  executeVerifiedOfficialScheduleRequest,type VerifiedOfficialSchedulePorts,
} from "./application/verifiedOfficialScheduleService";
import type { HistoricalWorkArchive } from "./utils/historicalWorkContext";
function assert(ok:unknown,message:string):asserts ok {
  if(!ok)throw Error("PR47 trusted acceptance: "+message);
}
const date="2026-11-02";
const ownerId="11111111-1111-4111-8111-111111111111";
const candidateId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const timeZone="Atlantic/Azores";
const hours={start:"09:00",end:"13:00"};
const people=[{id:"a",name:"A",active:true},{id:"b",name:"B",active:true}];
const weekly=WEEKDAYS.reduce((a,d)=>{a[d]=[];return a;},{} as WeeklyOperatingHours);
const operatingCalendar:OperatingCalendarConfiguration={
  weeklyOperatingHours:weekly,exceptions:[{date,intervals:[hours]}],
};
const availabilities:PersonAvailability[]=people.map(person=>({
  personId:person.id,weeklyAvailability:createEmptyWeeklyAvailability(),
  exceptions:[{date,intervals:[hours]}],
}));
const presence:PresenceConfiguration={
  weeklyPresenceRequirements:createEmptyWeeklyPresenceRequirements(),
  presenceExceptions:[{date,requirements:{
    minimumAtOpening:1,minimumDuringOperation:1,minimumAtClosing:1,
  }}],
};
const env={people,availabilities,operatingCalendar,presence,
  workConstraints:structuredClone(INITIAL_WORK_CONSTRAINTS)};
const candidate={id:candidateId,startDate:date,endDate:date,timeZone,
  shifts:[{date,personId:"a",interval:hours,mealBreak:null}]};
let ledger:ApprovedScheduleLedger=createApprovedScheduleLedger(
  {startDate:"2026-10-26",endDate:"2026-11-09"},timeZone,true,
);
let history:HistoricalWorkArchive|null=null;
let writes=0;
const ports:VerifiedOfficialSchedulePorts={
  authenticateOwner:async()=>ownerId,
  loadSavedCandidate:async(owner,id)=>owner===ownerId&&id===candidateId
    ?structuredClone(candidate):null,
  loadLedger:async owner=>owner===ownerId?structuredClone(ledger):null,
  loadEnvironment:async owner=>{assert(owner===ownerId,"Must use authenticated owner");return structuredClone(env);},
  loadHistoricalEvidence:async(owner,target,environment)=>{
    assert(owner===ownerId && environment.people.length===2,"Historical lookup must be owner-scoped");
    return {targetPeriod:target,timeZone,
      historyStartDate:"2026-01-01",
      workConstraints:environment.workConstraints,
      personIds:environment.people.map(p=>p.id),
      archive:history};
  },
  commit:async(owner,next,expected)=>{
    assert(owner===ownerId,"Commit must never use a client-selected owner.");
    if(ledger.version!==expected)return "conflict";
    ledger=structuredClone(next);writes++;return "saved";
  },
  now:()=>"2026-11-01T12:00:00Z",
  newRecordId:()=>"revision-new",
};
const request={kind:"approve",candidateId,expectedVersion:0};
let result=await executeVerifiedOfficialScheduleRequest(request,ports);
assert(!result.ok&&result.code==="history_incomplete"&&writes===0,
  "No imported archive blocks approval, even when a legacy ledger falsely says complete.");
const partial:HistoricalWorkArchive={timeZone,coverage:[
 {personId:"a",startDate:"2026-01-01",endDate:"2026-11-09",sourceId:"verified-a",verified:true},
],shifts:[]};
history=partial;
result=await executeVerifiedOfficialScheduleRequest(request,ports);
assert(!result.ok&&result.code==="history_incomplete"&&writes===0,
  "All current people must have known history; A alone is insufficient.");
history={...partial,coverage:[
 ...partial.coverage,
 {personId:"b",startDate:"2026-01-01",endDate:"2026-11-09",sourceId:"verified-b",verified:true},
]};
result=await executeVerifiedOfficialScheduleRequest({...request,ownerId:"victim"},ports);
assert(!result.ok&&result.code==="invalid_input"&&writes===0,
  "Client-supplied identity must be rejected, not ignored.");
result=await executeVerifiedOfficialScheduleRequest(request,ports);
assert(result.ok&&result.version===1&&writes===1&&ledger.records.length===1,
  "A trusted owner with verified history can commit only a valid proposal.");
result=await executeVerifiedOfficialScheduleRequest(request,ports);
assert(!result.ok&&result.code==="stale_version"&&writes===1,
  "A replay with stale expectedVersion cannot commit a duplicate approval.");
history=null; // Cancellation may remove commitments even without imported history.
result=await executeVerifiedOfficialScheduleRequest(
  {kind:"cancel",scheduleId:candidateId,expectedVersion:1},ports);
assert(result.ok&&result.version===2&&writes===2&&
  ledger.records[0].status==="cancelled",
  "A trusted cancellation preserves history and requires CAS, not new work certification.");
console.log("PR47-17: trusted approval gate rejects unknown 2026 history, owner spoofing and stale CAS; allows verified context.");
