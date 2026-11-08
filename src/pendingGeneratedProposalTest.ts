import {
  stagePendingGeneratedProposal,
  loadPendingGeneratedProposal,
  acknowledgePendingGeneratedProposal,
  type ProposalOutboxStore,
} from "./utils/pendingGeneratedProposal";
import type { GeneratedSchedulePayload } from "./persistence/generatedScheduleRepository";
import { createSupabaseGeneratedScheduleRepository } from "./persistence/supabaseGeneratedScheduleRepository";
import { INITIAL_WORK_CONSTRAINTS } from "./utils/workConstraints";
import { createEmptyWeeklyAvailability } from "./utils/availability";
import { createEmptyWeeklyPresenceRequirements } from "./utils/presence";
import { WEEKDAYS } from "./utils/operatingCalendar";

function check(yes:unknown,message:string):asserts yes{if(!yes)throw Error(message);}
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

// PR47-14: End-to-end crash/outbox rehearsal around the REAL repository.
// A POST may reach PostgreSQL before the browser loses its reply. After a
// browser restart, retrying the identical UUID must not create two rows.
for(const commitBeforeDisconnect of [true,false]){
  const persisted=new Map<string,Record<string,unknown>>();
  const data=new Map<string,string>();
  const browser:ProposalOutboxStore={
    getItem:key=>data.get(key)??null,
    setItem:(key,value)=>{data.set(key,value);},
    removeItem:key=>{data.delete(key);},
  };
  const proposalId=commitBeforeDisconnect?id:id2;
  let initialRequest=true;
  let posts=0;
  const transport={
    user:{id:owner,email:"synthetic@example.invalid"},
    request:async(path:string,init:RequestInit={}):Promise<Response>=>{
      const method=(init.method??"GET").toUpperCase();
      if(method==="POST"){
        posts++;
        const sent=JSON.parse(String(init.body)) as Record<string,unknown>;
        check(sent.id===proposalId&&sent.owner_id===owner,
          "Crash replay must remain on the same authenticated owner/UUID.");
        if(persisted.has(proposalId))
          return Response.json({message:"duplicate key"},{status:409});
        const row:Record<string,unknown>={
          id:proposalId,created_at:"2026-11-08T12:00:00.000Z",
          start_date:payload.startDate,end_date:payload.endDate,
          time_zone:payload.timeZone,payload:sent.payload,
        };
        if(initialRequest){
          initialRequest=false;
          if(commitBeforeDisconnect)persisted.set(proposalId,row);
          throw new Error("Connection lost while saving");
        }
        persisted.set(proposalId,row);
        return Response.json([row],{status:201});
      }
      check(method==="GET"&&path.includes("id=eq."+proposalId),
        "Replay after conflict must verify the original server row.");
      return Response.json(persisted.has(proposalId)?[persisted.get(proposalId)]:[]);
    },
  };
  stagePendingGeneratedProposal(browser,{ownerId:owner,id:proposalId,payload});
  let interrupted=false;
  try{await createSupabaseGeneratedScheduleRepository(transport)
    .save(payload,proposalId);}
  catch{interrupted=true;}
  check(interrupted&&loadPendingGeneratedProposal(browser,owner)?.id===proposalId,
    "A rejected or lost response must preserve a durable pending proposal.");
  // Simulate complete process loss and fresh repository/browser component.
  const recovered=loadPendingGeneratedProposal(browser,owner);
  check(recovered!==null,"The recovered process must find the original outbox.");
  const result=await createSupabaseGeneratedScheduleRepository(transport)
    .save(recovered!.payload,recovered!.id);
  check(result.id===proposalId&&persisted.size===1&&posts===2,
    "Crash replay may create exactly one proposal, never two.");
  check(acknowledgePendingGeneratedProposal(browser,owner,result.id),
    "Clear durable outbox only after exact server acknowledgment.");
  check(loadPendingGeneratedProposal(browser,owner)===null,
    "A server-confirmed retry must never reappear on browser restart.");
  check(loadPendingGeneratedProposal(browser,other)===null,
    "Another signed-in person cannot observe the pending proposal.");
}
console.log("PR47-14: owner-scoped durable proposal recovery, crash replay and collision safety passed.");
