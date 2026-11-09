import { createSupabaseGeneratedScheduleRepository } from "./persistence/supabaseGeneratedScheduleRepository";
import { isGeneratedSchedulePayload, type GeneratedSchedulePayload } from "./persistence/generatedScheduleRepository";
import { INITIAL_WORK_CONSTRAINTS } from "./utils/workConstraints";
import { proposalsForDay, selectedProposalForDay, previewFromStored } from "./utils/savedScheduleView";
import { dailyTeamRows, daySummary } from "./utils/monthlyScheduleView";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error("PR46: " + message);
}

const owner = "11111111-1111-4111-8111-111111111111";
const payload: GeneratedSchedulePayload = {
  schemaVersion: 1, validationScope: "user_attested_no_external_shifts",
  startDate: "2026-11-02", endDate: "2026-11-08", timeZone: "Atlantic/Azores",
  people: [{id:"a",name:"Nome original",active:true},{id:"b",name:"Pessoa B",active:true}],
  shifts: [{date:"2026-11-02",personId:"a",
    interval:{start:"09:00",end:"18:00"},
    mealBreak:{start:"12:00",end:"13:00"}}],
  configuration: {
    availabilities: [
      {personId:"a",weeklyAvailability:{
        monday:[{start:"09:00",end:"18:00"}],tuesday:[],wednesday:[],
        thursday:[],friday:[],saturday:[],sunday:[]
      },exceptions:[]},
    ],
    operatingCalendar: {
      weeklyOperatingHours: {
        monday:[{start:"09:00",end:"18:00"}],tuesday:[],wednesday:[],
        thursday:[],friday:[],saturday:[],sunday:[],
      },exceptions:[],
    },
    workRules: {standardShiftDurationMinutes:480},
    presence: {
      weeklyPresenceRequirements: {
        monday:{minimumAtOpening:0,minimumDuringOperation:0,minimumAtClosing:0},
        tuesday:null,wednesday:null,thursday:null,
        friday:null,saturday:null,sunday:null,
      },presenceExceptions:[],
    },
    workConstraints: structuredClone(INITIAL_WORK_CONSTRAINTS),
  },
};
assert(isGeneratedSchedulePayload(payload),"valid generated snapshot");
assert(!isGeneratedSchedulePayload({...payload,validationScope:"approved"}),
  "browser cannot label proposal as approved");
assert(!isGeneratedSchedulePayload({...payload,shifts:[{...payload.shifts[0],personId:"unknown"}]}),
  "reject shift referencing nonexistent person");
assert(!isGeneratedSchedulePayload({...payload,shifts:[payload.shifts[0],payload.shifts[0]]}),
  "reject duplicate shifts");

const records: Record<string,unknown>[]=[];
const requests: Array<{method:string,path:string}>=[];
let created=0;
const client = {
  user:{id:owner,email:"test@example.invalid"},
  async request(path:string, init:RequestInit={}):Promise<Response> {
    const method=(init.method??"GET").toUpperCase();
    requests.push({method,path});
    if(method==="POST"){
      const data=JSON.parse(String(init.body)) as Record<string,unknown>;
      assert(data.owner_id===owner,"owner must be authenticated");
      assert(!("status" in data)&&!("created_at" in data),
        "browser cannot choose approval status or created_at");
      const row={
        id:data.id,start_date:data.start_date,end_date:data.end_date,
        time_zone:data.time_zone,payload:data.payload,
        created_at:new Date(Date.UTC(2026,10,3,9,created++)).toISOString(),
      };
      if (records.some(previous=>previous.id===data.id))
        return Response.json({message:"duplicate key value violates unique constraint"},{status:409});
      records.unshift(row);
      return Response.json([row],{status:201});
    }
    assert(method==="GET","only reading and appending allowed");
    const url=new URL(path,"https://example.invalid");
    if (url.searchParams.has("id")) {
      const id=url.searchParams.get("id")!.replace("eq.","");
      return Response.json(records.filter(record=>record.id===id));
    }
    if (!url.searchParams.has("end_date")) return Response.json(records.slice(0,1));
    const start=url.searchParams.get("end_date")!.replace("gte.","");
    const end=url.searchParams.get("start_date")!.replace("lte.","");
    const eligible=records.filter(row =>
      String(row.start_date)<=end&&String(row.end_date)>=start);
    const offset=Number(url.searchParams.get("offset")??0);
    const limit=Number(url.searchParams.get("limit")??100);
    return Response.json(eligible.slice(offset,offset+limit));
  },
};
const repo=createSupabaseGeneratedScheduleRepository(client);
const first=await repo.save(payload);
assert(first.payload.people[0].name==="Nome original"&&
  first.payload.shifts[0].mealBreak?.start==="12:00","save exact snapshot");
const changed={...payload,shifts:[{
  ...payload.shifts[0],interval:{start:"10:00",end:"18:00"},
  mealBreak:{start:"13:00",end:"14:00"},
}]};
const newer=await repo.save(changed);
const confirmedRetry=await repo.save(payload,first.id);
assert(confirmedRetry.id===first.id && records.length===2,
  "retry after the server committed must reuse the same snapshot, not append another.");
let differentPayloadRejected=false;
try {await repo.save(changed,first.id);} catch {differentPayloadRejected=true;}
assert(differentPayloadRejected && records.length===2,
  "same proposal UUID can never silently overwrite different content.");
const latestRecord=await repo.latest();
assert(latestRecord?.id===newer.id,"recover last stored schedule before loading calendar");
const afterRestart=await createSupabaseGeneratedScheduleRepository(client)
  .listBetween("2026-11-01","2026-11-30");
assert(afterRestart.length===2,"restore saved records on a new repository instance");
assert(afterRestart[0].id===newer.id,"latest proposal listed first");
assert(afterRestart[1].id===first.id,"original proposal remains immutable");
assert(afterRestart[1].payload.shifts[0].interval.start==="09:00",
  "new generation never overwrites earlier schedule");

const latest=selectedProposalForDay(afterRestart,"2026-11-02",null);
assert(latest?.id===newer.id,"calendar shows latest snapshot");
const old=selectedProposalForDay(afterRestart,"2026-11-02",first.id);
assert(old?.id===first.id,"older snapshot can be opened explicitly");
assert(proposalsForDay(afterRestart,"2026-11-03").length===2,
  "a day with zero assigned shifts still belongs to a saved proposal");
assert(proposalsForDay(afterRestart,"2026-11-09").length===0,
  "do not fabricate a schedule outside saved period");

const archivedRows=dailyTeamRows({
  date:"2026-11-02",people:old!.payload.people,
  availabilities:old!.payload.configuration.availabilities,
  operation:old!.payload.configuration.operatingCalendar,
  preview:previewFromStored(old!),
});
assert(archivedRows[0].name==="Nome original"&&
  archivedRows[0].shift?.interval.start==="09:00",
  "restore original people and shift independently of current settings");
assert(daySummary(archivedRows).assigned===1,"restore daily staffing correctly");

const irrelevant=await repo.listBetween("2027-03-01","2027-03-31");
assert(irrelevant.length===0,"month query scoped to date interval");
assert(requests.every(r=>r.method==="GET"||r.method==="POST"),
  "repository never updates deletes or approves");
assert(requests.some(r=>r.path.includes("start_date=lte.")&&r.path.includes("end_date=gte.")),
  "query both overlapping date bounds");

const invalidClient={
  user:client.user,
  request:async()=>Response.json([{
    ...records[0],payload:{...payload,shifts:[{date:"2026-11-09"}]},
  }]),
};
let corruptionRejected=false;
try{await createSupabaseGeneratedScheduleRepository(invalidClient)
  .listBetween("2026-11-01","2026-11-30");}catch{corruptionRejected=true;}
assert(corruptionRejected,"never silently display corrupted archived schedule");
const anonymous={
  user:null,request:async()=>{throw Error("must not be requested");},
};
let anonymousRejected=false;
try{await createSupabaseGeneratedScheduleRepository(anonymous)
  .listBetween("2026-11-01","2026-11-30");}catch{anonymousRejected=true;}
assert(anonymousRejected,"requires authentication");

const manyRecords=Array.from({length:211},(_,i)=>({
  ...records[0],
  id:"00000000-0000-4000-8000-"+String(211-i).padStart(12,"0"),
}));
let pages=0;
const pagingClient={
  user:client.user,
  request:async(path:string)=>{
    const url=new URL(path,"https://example.invalid");
    pages++;
    const cursor=url.searchParams.get("or");
    const id=cursor?.match(/id\.lt\.([\da-f-]+)/)?.[1]??null;
    const filtered=id?manyRecords.filter(row=>String(row.id)<id):manyRecords;
    return Response.json(filtered.slice(0,100));
  },
};
const paged=await createSupabaseGeneratedScheduleRepository(pagingClient)
  .listBetween("2026-11-01","2026-11-30");
assert(paged.length===211&&pages===3,
  "more than 100 saved proposals never disappear due to keyset pagination");
assert(requests.every(r=>!r.path.includes("&offset=")),
  "archive reads must not use offset pagination");
console.log("PR46: persist, restore, versions, snapshots, RLS contracts and pagination passed.");
