/**
 * PR47-17 / trusted scheduling command API — deployed as v1, JWT required.
 * No browser-supplied owner, ledger, environment, history or event clock.
 * Do NOT deploy with verify_jwt=false; service_role stays server-side.
 *
 * IMPORTANT: legacy bootstrap that claimed 2020–2100 complete is disabled.
 * This endpoint never creates an official ledger from missing history.
 */
import {
  executeVerifiedOfficialScheduleRequest,
  type VerifiedOfficialSchedulePorts,
} from "../../../src/application/verifiedOfficialScheduleService.ts";
import {
  validateApprovedScheduleLedger,approveSchedule,
  type ApprovedScheduleLedger,
  type ApprovalEnvironment,
  type ScheduleDraft,
} from "../../../src/utils/approvedSchedules.ts";
import {
  isGeneratedSchedulePayload,certifyGeneratedSchedulePayload,
} from "../../../src/persistence/generatedScheduleRepository.ts";
import { INITIAL_WORK_CONSTRAINTS } from "../../../src/utils/workConstraints.ts";
import type {
  HistoricalContextRequest,HistoricalWorkArchive,
  VerifiedHistoricalCoverage,
} from "../../../src/utils/historicalWorkContext.ts";
import type { WorkValidationDateRange } from "../../../src/utils/workConstraints.ts";
import type { DatedWorkShift } from "../../../src/types.ts";
import { prepareHistoricalWorkContext } from "../../../src/utils/historicalWorkContext.ts";

type RecordJson=Record<string,unknown>;
const isObject=(x:unknown):x is RecordJson=>
  x!==null&&typeof x==="object"&&!Array.isArray(x);
const endpoint=Deno.env.get("SUPABASE_URL")??"";
const serviceRole=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
// Historical scope comes from the server-verified immutable ledger, never from
// client JSON or a missing optional environment variable.
// Authorization is supplied exclusively via Bearer headers, never cookies.
// A wildcard origin permits Vite localhost without exposing user credentials.
const corsHeaders={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info, x-supabase-api-version",
  "Access-Control-Allow-Methods":"GET, POST, OPTIONS",
  "Access-Control-Max-Age":"600",
};
const json=(value:unknown,status=200)=>
  new Response(JSON.stringify(value),{status,headers:{
    ...corsHeaders,
    "Content-Type":"application/json; charset=utf-8",
    "Cache-Control":"no-store",
    "X-Content-Type-Options":"nosniff",
  }});
const projectEndpoint=(path:string)=>endpoint.replace(/\/$/,"")+path;

async function readJson(path:string,init:RequestInit={}):Promise<unknown>{
  if(!endpoint||!serviceRole)throw Error("Missing trusted environment");
  const response=await fetch(projectEndpoint(path),{
    ...init,cache:"no-store",headers:{
      apikey:serviceRole,Authorization:"Bearer "+serviceRole,
      Accept:"application/json","Content-Type":"application/json",
      ...init.headers,
    },
  });
  if(!response.ok)throw Error("Trusted Supabase read/write failed");
  const payload:unknown=await response.json();
  return payload;
}
function oneRow(value:unknown):RecordJson|null {
  if(!Array.isArray(value)||value.length>1)throw Error("Ambiguous query");
  if(value.length===0)return null;
  if(!isObject(value[0]))throw Error("Malformed query row");
  return value[0];
}
function selectedOwnerPath(table:string,ownerId:string,select:string){
  return "/rest/v1/"+table+"?select="+select+
    "&owner_id=eq."+encodeURIComponent(ownerId);
}
/** Explicit pagination: never mistake a truncated API response for a complete archive. */
async function readAll(path:string):Promise<RecordJson[]>{
  const pageSize=500,maxPages=100,records:RecordJson[]=[];
  for(let page=0;page<maxPages;page++){
    const separator=path.includes("?")?"&":"?";
    const part=await readJson(path+separator+"limit="+pageSize+
      "&offset="+(page*pageSize));
    if(!Array.isArray(part)||part.some(v=>!isObject(v)))
      throw Error("Malformed archive page");
    records.push(...part as RecordJson[]);
    if(part.length<pageSize)return records;
  }
  throw Error("Historical archive too large to verify safely");
}
async function ownerFromJwt(request:Request):Promise<string|null>{
  const authorization=request.headers.get("Authorization")??"";
  if(!/^Bearer\s+\S+$/i.test(authorization)||!endpoint||!serviceRole)
    return null;
  const response=await fetch(projectEndpoint("/auth/v1/user"),{
    headers:{apikey:serviceRole,Authorization:authorization},
    cache:"no-store",
  });
  if(!response.ok)return null;
  const user:unknown=await response.json();
  return isObject(user)&&typeof user.id==="string"&&
    user.is_anonymous!==true?user.id:null;
}
function validDate(value:unknown):value is string {
  if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const ms=Date.parse(value+"T00:00:00Z");
  return Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,10)===value;
}
function credibleEnvironment(state:unknown):state is RecordJson {
  return isObject(state)&&Array.isArray(state.people)&&
    Array.isArray(state.availabilities)&&
    isObject(state.weeklyOperatingHours)&&Array.isArray(state.exceptions)&&
    isObject(state.workRules)&&
    isObject(state.weeklyPresenceRequirements)&&
    Array.isArray(state.presenceExceptions);
}
async function loadEnvironment(ownerId:string):Promise<ApprovalEnvironment>{
  const row=oneRow(await readJson(
    selectedOwnerPath("schedule_engine_states",ownerId,"payload")+"&limit=1"
  ));
  if(!row||!credibleEnvironment(row.payload))
    throw Error("Authoritative operational configuration unavailable");
  const state=row.payload;
  const rules=state.workRules as RecordJson;
  const dailyMaximum=rules.maximumDailyEffectiveMinutes;
  if(dailyMaximum!==undefined &&
      (!Number.isSafeInteger(dailyMaximum)||(dailyMaximum as number)<=0))
    throw Error("Invalid daily constraint");
  return {
    people:state.people as ApprovalEnvironment["people"],
    availabilities:state.availabilities as ApprovalEnvironment["availabilities"],
    operatingCalendar:{
      weeklyOperatingHours:state.weeklyOperatingHours as ApprovalEnvironment["operatingCalendar"]["weeklyOperatingHours"],
      exceptions:state.exceptions as ApprovalEnvironment["operatingCalendar"]["exceptions"],
    },
    presence:{
      weeklyPresenceRequirements:state.weeklyPresenceRequirements as ApprovalEnvironment["presence"]["weeklyPresenceRequirements"],
      presenceExceptions:state.presenceExceptions as ApprovalEnvironment["presence"]["presenceExceptions"],
    },
    workConstraints:{
      ...INITIAL_WORK_CONSTRAINTS,
      maximumDailyEffectiveMinutes:typeof dailyMaximum==="number"?
        dailyMaximum:INITIAL_WORK_CONSTRAINTS.maximumDailyEffectiveMinutes,
    },
  };
}
async function loadCandidate(ownerId:string,id:string):Promise<ScheduleDraft|null>{
  if(!/^[a-f0-9-]{36}$/i.test(id))return null;
  const row=oneRow(await readJson(
    selectedOwnerPath("schedule_engine_generated_schedules",ownerId,
      "id,owner_id,start_date,end_date,time_zone,payload")+
      "&id=eq."+encodeURIComponent(id)+"&limit=1"
  ));
  if(!row||row.owner_id!==ownerId||row.id!==id||
     !isGeneratedSchedulePayload(row.payload) ||
     row.start_date!==row.payload.startDate ||
     row.end_date!==row.payload.endDate ||
     row.time_zone!==row.payload.timeZone ||
     !certifyGeneratedSchedulePayload(row.payload).valid)return null;
  return {id,startDate:row.payload.startDate,endDate:row.payload.endDate,
    timeZone:row.payload.timeZone,shifts:row.payload.shifts};
}
async function loadLedger(ownerId:string):Promise<ApprovedScheduleLedger|null>{
  const row=oneRow(await readJson(
    selectedOwnerPath("schedule_engine_approved_ledgers",ownerId,
      "ledger_version,payload")+"&limit=1"
  ));
  if(!row)return null; // UNKNOWN, not a complete empty ledger.
  if(!Number.isSafeInteger(row.ledger_version) ||
     validateApprovedScheduleLedger(row.payload).length>0 ||
     !isObject(row.payload)||row.payload.version!==row.ledger_version)
    throw Error("Corrupt trusted ledger");
  return row.payload as unknown as ApprovedScheduleLedger;
}
/**
 * Only day facts covered by a trusted, matching verification become known.
 * Every person/day must have an explicit fact (including empty shifts).
 * More than one source per person/day is ambiguous and fails closed.
 */
async function loadHistoricalEvidence(
  ownerId:string,target:WorkValidationDateRange,
  env:ApprovalEnvironment,ledger:ApprovedScheduleLedger,
):Promise<HistoricalContextRequest>{
  const people=env.people.map(p=>p.id);
  const timeZone=ledger.timeZone;
  const historyAnchor=ledger.coverage.startDate;
  const base={
    targetPeriod:target,timeZone,workConstraints:env.workConstraints,
    historyStartDate:historyAnchor,personIds:people,
  };
  if(!validDate(historyAnchor)||!ledger.complete||people.length===0)
    return {...base,archive:null};
  const [sources,verifications,facts]=await Promise.all([
    readAll(selectedOwnerPath("schedule_engine_history_sources",ownerId,
      "source_id,time_zone,first_date,last_date")),
    readAll(selectedOwnerPath("schedule_engine_history_verifications",ownerId,
      "source_id,person_id,first_date,last_date,verifier_version")),
    readAll(selectedOwnerPath("schedule_engine_history_day_facts",ownerId,
      "source_id,person_id,work_date,shifts")+
      "&work_date=gte."+historyAnchor),
  ]);
  if(!sources.length||!verifications.length)return {...base,archive:null};
  const sourceZones=new Map<string,string>();
  for(const s of sources){
    if(typeof s.source_id!=="string"||
       typeof s.time_zone!=="string"||s.time_zone!==timeZone)
      throw Error("Historical source zone mismatch");
    sourceZones.set(s.source_id,s.time_zone);
  }
  const ranges=verifications.map(v=>{
    if(typeof v.source_id!=="string"||!sourceZones.has(v.source_id)||
       typeof v.person_id!=="string"||
       !validDate(v.first_date)||!validDate(v.last_date)||
       v.first_date>v.last_date)
      throw Error("Invalid history verification");
    return v as {source_id:string;person_id:string;first_date:string;last_date:string};
  });
  const keys=new Set<string>();
  const coverage:VerifiedHistoricalCoverage[]=[];
  const shifts:DatedWorkShift[]=[];
  for(const fact of facts){
    if(typeof fact.source_id!=="string" ||
       !sourceZones.has(fact.source_id) ||
       typeof fact.person_id!=="string" ||
       !validDate(fact.work_date) || !Array.isArray(fact.shifts))
      throw Error("Invalid historical day fact");
    // Former staff can be retained in storage; only selected current people
    // contribute to this scheduling validation scope.
    if(!people.includes(fact.person_id))continue;
    const key=fact.person_id+"|"+fact.work_date;
    if(keys.has(key))throw Error("Overlapping historical sources require reconciliation");
    keys.add(key);
    const verified=ranges.some(v=>v.person_id===fact.person_id&&
      v.source_id===fact.source_id &&
      v.first_date<=fact.work_date && v.last_date>=fact.work_date);
    if(!verified)continue;
    coverage.push({personId:fact.person_id,
      startDate:fact.work_date,endDate:fact.work_date,
      sourceId:fact.source_id,verified:true});
    for(const raw of fact.shifts){
      if(!isObject(raw)||raw.personId!==fact.person_id ||
         raw.date!==fact.work_date||!isObject(raw.interval)||
         typeof raw.interval.start!=="string"||
         typeof raw.interval.end!=="string"||
         !("mealBreak" in raw))
        throw Error("Historical shift disagrees with its source day");
      shifts.push(raw as unknown as DatedWorkShift);
    }
  }
  const archive:HistoricalWorkArchive={timeZone,coverage,shifts};
  return {...base,archive};
}

Deno.serve(async(request:Request)=>{
  if(request.method==="OPTIONS")
    return new Response(null,{status:204,headers:corsHeaders});
  if(!["GET","POST"].includes(request.method))
    return json({ok:false,code:"method_not_allowed"},405);
  const ownerId=await ownerFromJwt(request).catch(()=>null);
  if(!ownerId)return json({ok:false,code:"unauthorized"},401);
  if(request.method==="GET"){
    try{
      const candidateId=new URL(request.url).searchParams.get("candidate_id")??"";
      if(!/^[a-f0-9-]{36}$/i.test(candidateId))
        return json({ok:false,code:"invalid_input",
          issues:["Identificador de proposta inválido."]},400);
      const candidate=await loadCandidate(ownerId,candidateId);
      if(!candidate)return json({ok:false,code:"missing_candidate"},404);
      const ledger=await loadLedger(ownerId);
      if(!ledger)return json({ok:true,ready:false,alreadyApproved:false,
        version:null,historyStatus:"not_initialized",
        message:"O histórico oficial ainda não foi verificado e inicializado."});
      const official=ledger.records.find(r=>r.id===candidateId);
      if(official)return json({ok:true,ready:false,
        alreadyApproved:official.status==="approved",
        officialStatus:official.status,version:ledger.version,
        historyStatus:"existing_record",
        message:"Esta proposta já possui um registo no histórico oficial."});
      const env=await loadEnvironment(ownerId);
      const evidence=await loadHistoricalEvidence(ownerId,candidate,env,ledger);
      const checked=prepareHistoricalWorkContext(evidence);
      if(!ledger.complete||checked.status!=="ready"||!checked.externalContext)
        return json({ok:true,ready:false,alreadyApproved:false,
          version:ledger.version,historyStatus:checked.status,
          message:checked.issues[0]??"É necessário completar o histórico anterior."});
      // Readiness must prove *the actual candidate*, not merely that its
      // historical window exists. The POST performs the same check again.
      const certified=approveSchedule({
        ledger,expectedVersion:ledger.version,at:new Date().toISOString(),
        draft:candidate,environment:{
          ...env,historicalShifts:checked.externalContext.shifts,
        },
      });
      return json({ok:true,ready:certified.ok,alreadyApproved:false,
        version:ledger.version,
        historyStatus:certified.ok?"certified":"not_certified",
        message:certified.ok?"Proposta validada e pronta para aprovação oficial.":
          certified.issues[0]??"A proposta não cumpre as restrições atuais."});
    }catch{return json({ok:false,code:"storage_error"},503);}
  }
  let input:unknown;
  try{input=await request.json();}
  catch{return json({ok:false,code:"invalid_input"},400);}
  // History IANA zone is request-local: NEVER use shared state for owner context.
  let trustedZone:string|null=null;
  try{trustedZone=(await loadLedger(ownerId))?.timeZone??null;}
  catch{return json({ok:false,code:"storage_error"},503);}
  if(!trustedZone)return json({ok:false,code:"history_incomplete",
    issues:["O arquivo oficial ainda não foi iniciado com cobertura histórica verificada."]},409);
  const ports:VerifiedOfficialSchedulePorts={
    authenticateOwner:async()=>ownerId,
    loadLedger,
    loadEnvironment,
    loadSavedCandidate:loadCandidate,
    loadHistoricalEvidence:async(owner,target,env)=>{
      const ledger=await loadLedger(owner);
      if(!ledger)throw Error("Verified ledger missing");
      return loadHistoricalEvidence(owner,target,env,ledger);
    },
    now:()=>new Date().toISOString(),
    newRecordId:()=>crypto.randomUUID(),
    commit:async(id,next,expected)=>{
      if(validateApprovedScheduleLedger(next).length)
        throw Error("Uncertified official snapshot");
      const result=await readJson("/rest/v1/rpc/commit_schedule_engine_approved_ledger",{
        method:"POST",body:JSON.stringify({
          p_owner_id:id,p_expected_version:expected,
          p_next_payload:next,p_operation:isObject(input)?input.kind:null,
          p_record_id:isObject(input)?(
            input.kind==="cancel"?input.scheduleId:
            input.kind==="revise"?next.records.find(r=>
              r.status==="approved"&&r.revision?.sourceId===input.sourceId)?.id:
            input.candidateId):null,
        }),
      });
      return result===true?"saved":"conflict";
    },
  };
  const outcome=await executeVerifiedOfficialScheduleRequest(input,ports);
  const status=outcome.ok?200:
    outcome.code==="unauthorized"?401:
    outcome.code==="missing_candidate"?404:
    outcome.code==="invalid_input"?400:
    ["stale_version","storage_conflict","history_incomplete","unknown_context"].includes(outcome.code)?409:
    outcome.code==="storage_error"?503:422;
  return json(outcome,status);
});
