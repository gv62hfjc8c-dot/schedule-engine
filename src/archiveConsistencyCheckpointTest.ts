import type { GeneratedSchedulePayload } from "./persistence/generatedScheduleRepository";
import { createSupabaseGeneratedScheduleRepository } from "./persistence/supabaseGeneratedScheduleRepository";
import { INITIAL_WORK_CONSTRAINTS } from "./utils/workConstraints";
import {
  proposalsForDay, selectedProposalForDay, calendarProposalForDay,
  calendarArchiveOverview, unreadableArchiveAffectsDate,
} from "./utils/savedScheduleView";
import { monthCalendarDates } from "./utils/monthlyScheduleView";

function ensure(condition:unknown,message:string):asserts condition {
  if(!condition) throw Error("PR47-C: "+message);
}
const owner="11111111-1111-4111-8111-111111111111";
const original:GeneratedSchedulePayload={
  schemaVersion:1,validationScope:"user_attested_no_external_shifts",
  startDate:"2026-11-02",endDate:"2026-11-08",timeZone:"Atlantic/Azores",
  people:[{id:"a",name:"Nome antigo",active:true}],
  shifts:[{date:"2026-11-02",personId:"a",interval:{start:"09:00",end:"18:00"},
    mealBreak:{start:"13:00",end:"14:00"}}],
  configuration:{
    availabilities:[],
    operatingCalendar:{
      weeklyOperatingHours:{
        monday:[{start:"09:00",end:"18:00"}],tuesday:[],wednesday:[],
        thursday:[],friday:[],saturday:[],sunday:[],
      },exceptions:[],
    },
    workRules:{standardShiftDurationMinutes:480},
    presence:{
      weeklyPresenceRequirements:{
        monday:null,tuesday:null,wednesday:null,thursday:null,
        friday:null,saturday:null,sunday:null,
      },presenceExceptions:[],
    },
    workConstraints:structuredClone(INITIAL_WORK_CONSTRAINTS),
  },
};
const alternative:GeneratedSchedulePayload={
  ...original,startDate:"2026-11-05",endDate:"2026-11-11",
  shifts:[{date:"2026-11-05",personId:"a",interval:{start:"10:00",end:"18:00"},
    mealBreak:{start:"13:00",end:"14:00"}}],
};
interface RawRow {
  id:string;
  created_at:string;
  start_date:string;
  end_date:string;
  time_zone:string;
  payload:GeneratedSchedulePayload;
}
const rows:RawRow[]=[];
const operations:Array<{method:string;path:string}>=[];
let timeIndex=0;
let insertedOnNextPage=false;
let injectConcurrentInsert=false;
let loseReplyAfterCommit=false;
function makeRow(payload:GeneratedSchedulePayload,id:string,createdAt?:string):RawRow{
  return {
    id,created_at:createdAt ?? new Date(Date.UTC(2026,10,5,9,timeIndex++)*1).toISOString(),
    start_date:payload.startDate,end_date:payload.endDate,
    time_zone:payload.timeZone,payload:structuredClone(payload),
  };
}
const fractionalMicros=(stamp:string)=>{
  const digits=(stamp.match(/\.(\d{1,6})(?:Z|[+-]\d{2}:\d{2})$/)?.[1]??"").padEnd(6,"0");
  return Number(digits.slice(3,6));
};
const byLatest=(a:RawRow,b:RawRow)=>
  Date.parse(b.created_at)-Date.parse(a.created_at) ||
  fractionalMicros(b.created_at)-fractionalMicros(a.created_at) ||
  b.id.localeCompare(a.id);
function requestMatches(row:RawRow,from:string,to:string):boolean{
  return row.start_date<=to && row.end_date>=from;
}
const client={
  user:{id:owner,email:"owner@example.invalid"},
  async request(path:string,init:RequestInit={}):Promise<Response>{
    const method=(init.method??"GET").toUpperCase();
    operations.push({method,path});
    const url=new URL(path,"https://example.invalid");
    if(method==="POST"){
      const body=JSON.parse(String(init.body)) as Record<string,unknown>;
      ensure(body.owner_id===client.user.id,"A save uses the current authenticated owner.");
      ensure(!("status" in body)&&!("created_at" in body),"Client never chooses approval or server timestamp.");
      const existing=rows.find(row=>row.id===body.id);
      if(existing) return Response.json({message:"duplicate primary key"},{status:409});
      const created=makeRow(body.payload as GeneratedSchedulePayload,String(body.id));
      rows.push(created);
      if(loseReplyAfterCommit){
        loseReplyAfterCommit=false;
        throw Error("Simulated network timeout after successful insert.");
      }
      return Response.json([created],{status:201});
    }
    ensure(method==="GET","Archive repository uses only INSERT and SELECT.");
    if(url.searchParams.has("id")){
      const id=url.searchParams.get("id")!.replace("eq.","");
      return Response.json(rows.filter(row=>row.id===id));
    }
    if(!url.searchParams.has("end_date")){
      return Response.json(rows.slice().sort(byLatest).slice(0,1));
    }
    const from=url.searchParams.get("end_date")!.replace("gte.","");
    const to=url.searchParams.get("start_date")!.replace("lte.","");
    let matching=rows.filter(row=>requestMatches(row,from,to)).sort(byLatest);
    const predicate=url.searchParams.get("or");
    if(predicate){
      ensure(predicate.includes("created_at.lt.")&&predicate.includes("id.lt."),
        "Pages use a tuple keyset, not offset.");
      const parsed=predicate.match(/^\(created_at\.lt\.([^,]+),and\(created_at\.eq\.([^,]+),id\.lt\.([^)]+)\)\)$/);
      ensure(parsed!==null,"Cursor condition must be well formed.");
      const timestamp=Date.parse(parsed[1]),tieId=parsed[3];
      ensure(Number.isFinite(timestamp)&&Date.parse(parsed[2])===timestamp,
        "Cursor must keep one timestamp in both branches.");
      matching=matching.filter(row=>
        Date.parse(row.created_at)<timestamp ||
        Date.parse(row.created_at)===timestamp &&
          (fractionalMicros(row.created_at)<fractionalMicros(parsed[1]) ||
          fractionalMicros(row.created_at)===fractionalMicros(parsed[1]) &&
            row.id<tieId));
      if(injectConcurrentInsert && !insertedOnNextPage){
        insertedOnNextPage=true;
        const newId="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
        rows.push(makeRow(original,newId,new Date(Date.UTC(2026,11,1,12)).toISOString()));
        // The new record is newer than the captured cursor; it should not
        // enter this historical snapshot halfway through pagination.
      }
    }
    return Response.json(matching.slice(0,Number(url.searchParams.get("limit")??100)));
  },
};
const repository=createSupabaseGeneratedScheduleRepository(client);
const id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
loseReplyAfterCommit=true;
let lost=false;
try {await repository.save(original,id);}catch{lost=true;}
ensure(lost&&rows.length===1,
  "A request can commit successfully even when the response was lost.");
const confirmed=await repository.save(original,id);
ensure(confirmed.id===id&&rows.length===1,
  "Idempotent retry must confirm existing snapshot without duplicating it.");
let unsafeOverwriteRejected=false;
try {await repository.save(alternative,id);}catch{unsafeOverwriteRejected=true;}
ensure(unsafeOverwriteRejected&&rows.length===1,
  "The same UUID with different contents must never overwrite the original.");

const second=await repository.save(alternative,"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
ensure(second.payload.shifts[0].interval.start==="10:00" &&
  confirmed.payload.shifts[0].interval.start==="09:00",
  "Distinct proposals remain immutable versions.");

const known=[confirmed,second];
ensure(proposalsForDay(known,"2026-11-06").length===2,
  "Overlapping days have two independent archived proposals.");
ensure(selectedProposalForDay(known,"2026-11-06",null)?.id===second.id,
  "Overview shows newest proposal per date, but does not approve it.");
ensure(calendarProposalForDay(known,"2026-11-10",confirmed.id)===null,
  "Focused calendar never imports a shift from a different proposal.");
ensure(calendarProposalForDay(known,"2026-11-10",null)?.id===second.id,
  "Overview still allows independent inspection of newer dates.");
ensure(calendarProposalForDay(known,"2026-11-06",confirmed.id)?.id===confirmed.id,
  "Focus can reopen the exact original snapshot without regenerating.");
const dates=monthCalendarDates("2026-11-01").filter(date=>date.startsWith("2026-11-"));
const overview=calendarArchiveOverview(known,dates,null);
ensure(overview.mixedSources&&overview.sourceIds.length===2&&
  overview.overlappingDays===4,
  "Mixed month is explicitly identified, including four overlapping dates.");
const focused=calendarArchiveOverview(known,dates,confirmed.id);
ensure(!focused.mixedSources && focused.sourceIds.length===1,
  "Focused month must represent a single independent proposal.");

ensure(unreadableArchiveAffectsDate([{id:"bad",startDate:"2026-11-02",
  endDate:"2026-11-08"}],"2026-11-02") &&
  !unreadableArchiveAffectsDate([{id:"bad",startDate:"2026-11-02",
    endDate:"2026-11-08"}],"2026-11-25"),
  "Only affected dates are marked indeterminate with trusted metadata.");
ensure(unreadableArchiveAffectsDate([{id:null,startDate:null,endDate:null}],
  "2026-11-25"),"Unknown corruption bounds must fail closed for all dates.");
const baseCount=rows.length;
// Generate 211 more records with stable UUIDs and strictly increasing timestamps
// before the first archive read, covering multiple API pages.
for(let i=0;i<211;i++){
  const number=String(i+1).padStart(12,"0");
  rows.push(makeRow(original,"00000000-0000-4000-8000-"+number));
}
const expectedCount=rows.length;
injectConcurrentInsert=true;
const archive=await repository.listBetweenDetailed("2026-11-01","2026-11-30");
ensure(insertedOnNextPage,
  "More than 100 records must make a second paginated request.");
ensure(archive.records.length===expectedCount &&
  archive.records.every(row=>row.id!=="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee") &&
  new Set(archive.records.map(row=>row.id)).size===expectedCount,
  "Keyset pagination must return each original proposal once, excluding concurrent newer insert.");
ensure(!operations.some(op=>op.path.includes("&offset=")),
  "Offset pagination can skip snapshots when another user action inserts a new one.");

const badId="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
rows.push({...makeRow(original,badId),payload:{
  ...original,validationScope:"approved" as GeneratedSchedulePayload["validationScope"],
}});
const partial=await repository.listBetweenDetailed("2026-11-01","2026-11-30");
ensure(partial.records.length===expectedCount+1 &&
  partial.unreadable.length===1 &&
  partial.unreadable[0].id===badId,
  "One corrupted archived row must be excluded and explicitly reported.");
let strictRejected=false;
try {await repository.listBetween("2026-11-01","2026-11-30");}
catch{strictRejected=true;}
ensure(strictRejected,"Strict archive queries must fail closed rather than silently skip corruption.");

// PostgreSQL stores microseconds. Date.parse rounds these to milliseconds;
// the cursor must still preserve their true order, not compare UUIDs first.
const higherMicroId="00000000-0000-4000-8000-000000000000";
const lowerMicroId="ffffffff-ffff-4fff-8fff-ffffffffffff";
rows.push(makeRow(original,higherMicroId,"2026-11-05T09:00:00.123500Z"));
rows.push(makeRow(original,lowerMicroId,"2026-11-05T09:00:00.123400Z"));
const microsecondArchive=await repository.listBetweenDetailed("2026-11-01","2026-11-30");
const actualOrder=microsecondArchive.records.map(row=>row.id);
ensure(actualOrder.indexOf(higherMicroId)>=0 &&
  actualOrder.indexOf(higherMicroId)<actualOrder.indexOf(lowerMicroId),
  "Cursor ordering must use PostgreSQL microseconds before UUID tie-breaking.");

const malformedStart=await repository.listBetweenDetailed("2026-02-31","2026-03-01")
  .then(()=>false,()=>true);
ensure(malformedStart,"Impossible civil date must never be silently accepted.");

const foreign={
  user:null as typeof client.user | null,
  request:async()=>{throw Error("Should not call server without owner.");},
};
let unauthorized=false;
try{await createSupabaseGeneratedScheduleRepository(foreign)
  .listBetweenDetailed("2026-11-01","2026-11-30");}catch{unauthorized=true;}
ensure(unauthorized,"Archive query must require an authenticated identity.");

const changeSessionClient={
  user:{...client.user},
  request:async()=>{
    changeSessionClient.user.id="22222222-2222-4222-8222-222222222222";
    return Response.json([]);
  },
};
let switched=false;
try {await createSupabaseGeneratedScheduleRepository(changeSessionClient)
  .listBetweenDetailed("2026-11-01","2026-11-30");}
catch{switched=true;}
ensure(switched,"Changing session during archive fetch must fail closed.");

ensure(rows.length===baseCount+211+4,
  "The tests only simulate one concurrent insert and one corrupt record.");
console.log("PR47-C: immutable versions, idempotent save, coherent proposal focus, cursor pagination and partial archive diagnostics passed.");
