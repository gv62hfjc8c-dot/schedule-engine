import {
  stagePendingGeneratedProposal,
  loadPendingGeneratedProposal,
  acknowledgePendingGeneratedProposal,
  type ProposalOutboxStore,
} from "./utils/pendingGeneratedProposal";
import type { GeneratedSchedulePayload } from "./persistence/generatedScheduleRepository";
import { INITIAL_WORK_CONSTRAINTS } from "./utils/workConstraints";
import { createEmptyWeeklyAvailability } from "./utils/availability";
import { createEmptyWeeklyPresenceRequirements } from "./utils/presence";
import { WEEKDAYS } from "./utils/operatingCalendar";

const check=(yes:unknown,message:string):asserts yes=>{if(!yes)throw Error(message);};
const owner="11111111-1111-4111-8111-111111111111";
const other="22222222-2222-4222-8222-222222222222";
const id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const id2="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const empty=Object.fromEntries(WEEKDAYS.map(k=>[k,[]]));
const payload:GeneratedSchedulePayload={
 schemaVersion:1,validationScope:"user_attested_no_external_shifts",
 startDate:"2026-11-02",endDate:"2026-11-08",timeZone:"Atlantic/Azores",
 people:[{id:"a",name:"Pessoa A",active:true}],
 shifts:[{date:"2026-11-02",personId:"a",interval:{start:"09:00",end:"13:00"},mealBreak:null}],
 configuration:{
  availabilities:[{
    personId:"a",
    weeklyAvailability:{...createEmptyWeeklyAvailability(),
      monday:[{start:"09:00",end:"13:00"}]},
    exceptions:[],
  }],
  operatingCalendar:{weeklyOperatingHours:{
    ...empty,monday:[{start:"09:00",end:"13:00"}],
  } as GeneratedSchedulePayload["configuration"]["operatingCalendar"]["weeklyOperatingHours"],
  exceptions:[]},
  workRules:{standardShiftDurationMinutes:240},
  presence:{weeklyPresenceRequirements:createEmptyWeeklyPresenceRequirements(),presenceExceptions:[]},
  workConstraints:structuredClone(INITIAL_WORK_CONSTRAINTS),
 },
};
const data=new Map<string,string>();
const store:ProposalOutboxStore={
 getItem:key=>data.get(key)??null,
 setItem:(key,value)=>{data.set(key,value);},
 removeItem:key=>{data.delete(key);},
};
check(loadPendingGeneratedProposal(store,owner)===null,"Empty outbox.");
stagePendingGeneratedProposal(store,{ownerId:owner,id,payload});
const original=loadPendingGeneratedProposal(store,owner);
check(original?.id===id && original.payload.people[0].name==="Pessoa A",
  "An unconfirmed snapshot survives browser reload.");
check(loadPendingGeneratedProposal(store,other)===null,
  "A different logged-in owner cannot read another user's pending snapshot.");
const before=data.size;
stagePendingGeneratedProposal(store,{ownerId:owner,id,payload});
check(data.size===before,"Retry of exact UUID/snapshot is idempotent.");
let conflict=false;
try{stagePendingGeneratedProposal(store,{ownerId:owner,id:id2,payload});}
catch{conflict=true;}
check(conflict && loadPendingGeneratedProposal(store,owner)?.id===id,
  "A later generation must never overwrite a pending earlier proposal.");
check(!acknowledgePendingGeneratedProposal(store,owner,id2),
  "Acknowledgment for the wrong UUID cannot erase a previous proposal.");
check(acknowledgePendingGeneratedProposal(store,owner,id) &&
  loadPendingGeneratedProposal(store,owner)===null,
  "Server-confirmed UUID clears its outbox entry.");
stagePendingGeneratedProposal(store,{ownerId:owner,id:id2,payload});
const key=[...data.keys()][0];
data.set(key,"not-json");
let damaged=false;
try{loadPendingGeneratedProposal(store,owner);}catch{damaged=true;}
check(damaged&&data.get(key)==="not-json",
  "Damaged backups fail closed and are never silently discarded.");
data.set(key,JSON.stringify({ownerId:other,id:id2,payload}));
let mixed=false;
try{loadPendingGeneratedProposal(store,owner);}catch{mixed=true;}
check(mixed,"The owner inside the saved envelope must match the authenticated user.");
const full:ProposalOutboxStore={
 getItem:()=>null,setItem:()=>{throw Error("Quota exceeded");},removeItem:()=>{},
};
let failed=false;
try{stagePendingGeneratedProposal(full,{ownerId:owner,id,payload});}
catch{failed=true;}
check(failed,"A rejected durable stage must be surfaced before the first network request.");
console.log("PR47-14: owner-scoped durable proposal recovery, crash replay and collision safety passed.");
