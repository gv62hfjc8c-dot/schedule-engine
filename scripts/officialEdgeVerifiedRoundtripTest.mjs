/**
 * PR47-H06/H07: real Edge entrypoint + real command/domain + in-memory SQL
 * gateway, testing a complete independently verified synthetic history.
 * No production users, passwords, tokens, data, or ledgers are touched.
 */
import assert from "node:assert/strict";
import {build} from "esbuild";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
const temp=mkdtempSync(join(tmpdir(),"pr47-verified-edge-"));
const priorFetch=globalThis.fetch,priorDeno=globalThis.Deno;
const A="11111111-1111-4111-8111-111111111111";
const B="22222222-2222-4222-8222-222222222222";
const proposalId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const date="2099-11-02",start="2099-10-01",end="2099-12-31";
const span={start:"09:00",end:"13:00"},timeZone="Atlantic/Azores";
const days=["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];
const weekly=Object.fromEntries(days.map(day=>[day,day==="monday"?[span]:[]]));
const requirements=Object.fromEntries(days.map(day=>
  [day,day==="monday"?{
    minimumAtOpening:1,minimumDuringOperation:1,minimumAtClosing:1,
  }:null]));
const people=[{id:"a",name:"A",active:true},{id:"b",name:"B",active:true}];
const availabilities=people.map(p=>({
  personId:p.id,weeklyAvailability:weekly,exceptions:[],
}));
const rules={standardShiftDurationMinutes:240};
const workConstraints={
  mealBreak:{
    requiredAboveEffectiveMinutes:360,durationMinutes:60,
    earliestStartAfterWorkMinutes:180,latestStartAfterWorkMinutes:300,
  },
  minimumRestBetweenShiftsMinutes:660,
  maximumDailyEffectiveMinutes:480,
  maximumWeeklyEffectiveMinutes:2400,
};
const state={
  version:4,operationTimeZone:timeZone,
  people,availabilities,
  weeklyOperatingHours:weekly,exceptions:[],
  weeklyPresenceRequirements:requirements,presenceExceptions:[],
  workRules:rules,
};
const proposal={
  id:proposalId,owner_id:A,start_date:date,end_date:date,time_zone:timeZone,
  payload:{
    schemaVersion:1,validationScope:"user_attested_no_external_shifts",
    startDate:date,endDate:date,timeZone,
    people,shifts:[{date,personId:"a",interval:span,mealBreak:null}],
    configuration:{
      availabilities,
      operatingCalendar:{weeklyOperatingHours:weekly,exceptions:[]},
      presence:{
        weeklyPresenceRequirements:requirements,presenceExceptions:[],
      },
      workRules:rules,workConstraints,
    },
  },
};
const sources=people.map(p=>({
  source_id:"source-"+p.id,time_zone:timeZone,
  first_date:start,last_date:end,
}));
const verifications=people.map(p=>({
  source_id:"source-"+p.id,person_id:p.id,
  first_date:start,last_date:end,verifier_version:1,
}));
const facts=[];
for(let t=Date.parse(start+"T00:00:00Z");
  t<=Date.parse(end+"T00:00:00Z");t+=86400000){
  const day=new Date(t).toISOString().slice(0,10);
  for(const p of people)facts.push({
    source_id:"source-"+p.id,person_id:p.id,work_date:day,shifts:[],
  });
}
let ledger={
  version:0,timeZone,coverage:{startDate:start,endDate:end},
  complete:true,records:[],
};
let officialWrites=0,authCalls=0,commitCalls=0,handler=null;
const json=(value,status=200)=>new Response(JSON.stringify(value),{
  status,headers:{"Content-Type":"application/json"},
});
const copy=x=>structuredClone(x);
try {
  globalThis.Deno={
    env:{get:(name)=>({
      SUPABASE_URL:"https://synthetic.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY:"synthetic-service-only",
    })[name]},
    serve:callback=>{handler=callback;},
  };
  globalThis.fetch=async(url,init={})=>{
    const parsed=new URL(url),path=parsed.pathname,params=parsed.searchParams;
    if(path==="/auth/v1/user"){
      authCalls++;
      if(init.headers?.Authorization==="Bearer test-a")
        return json({id:A,is_anonymous:false});
      if(init.headers?.Authorization==="Bearer test-b")
        return json({id:B,is_anonymous:false});
      return json({message:"unauthorized"},401);
    }
    assert.equal(init.headers?.Authorization,"Bearer synthetic-service-only",
      "Server must use its own service identity only for database calls.");
    const selectedOwner=params.get("owner_id")?.replace("eq.","");
    const onlyA=selectedOwner===A, onlyB=selectedOwner===B;
    assert(onlyA||onlyB,"Database reads/writes must specify a verified owner.");
    if(path==="/rest/v1/schedule_engine_generated_schedules"){
      return json(onlyA&&params.get("id")==="eq."+proposalId?[proposal]:[]);
    }
    if(path==="/rest/v1/schedule_engine_approved_ledgers"){
      return json(onlyA?[{ledger_version:ledger.version,payload:copy(ledger)}]:[]);
    }
    if(path==="/rest/v1/schedule_engine_states"){
      return json(onlyA?[{revision:1,payload:copy(state)}]:[]);
    }
    const page=(rows)=>{
      const offset=Number(params.get("offset")??"0"),
        limit=Number(params.get("limit")??"500");
      return json(onlyA?rows.slice(offset,offset+limit):[]);
    };
    if(path==="/rest/v1/schedule_engine_history_sources")
      return page(sources);
    if(path==="/rest/v1/schedule_engine_history_verifications")
      return page(verifications);
    if(path==="/rest/v1/schedule_engine_history_day_facts")
      return page(facts);
    if(path==="/rest/v1/rpc/commit_schedule_engine_approved_ledger_v2"){
      commitCalls++;
      const body=JSON.parse(String(init.body));
      assert.equal(body.p_owner_id,A);
      assert.equal(body.p_expected_state_revision,
        body.p_operation==="cancel"?null:1);
      if(body.p_expected_version!==ledger.version)return json(false);
      assert.equal(body.p_next_payload.version,ledger.version+1);
      ledger=copy(body.p_next_payload);
      officialWrites++;
      return json(true);
    }
    throw Error("Unexpected trusted endpoint: "+path);
  };
  const output=join(temp,"roundtrip.mjs");
  await build({
    entryPoints:[resolve("supabase/functions/official-schedules-v2/index.ts")],
    outfile:output,bundle:true,platform:"neutral",format:"esm",
    target:"es2022",minify:false,logLevel:"error",
  });
  await import(pathToFileURL(output).href);
  assert.equal(typeof handler,"function");
  async function hit(token,method,path="",body){
    const headers={Authorization:"Bearer "+token};
    if(body!==undefined)headers["Content-Type"]="application/json";
    const result=await handler(new Request(
      "https://synthetic.supabase.co/functions/v1/official-schedules-v2"+path,{
        method,headers,...(body===undefined?{}:{body:JSON.stringify(body)}),
      }));
    return {status:result.status,body:await result.json()};
  }
  let x=await hit("test-a","GET","?candidate_id="+proposalId);
  assert.equal(x.status,200,"Verified history must expose readiness.");
  assert.equal(x.body.ready,true,
    "Server must independently certify a compatible synthetic proposal.");

  // The second identity cannot inspect or approve first owner's proposal.
  x=await hit("test-b","GET","?candidate_id="+proposalId);
  assert.equal(x.status,404,"Foreign owner must receive an opaque 404.");
  const writesBefore=officialWrites;
  x=await hit("test-b","POST","",{
    kind:"approve",candidateId:proposalId,expectedVersion:0,
  });
  assert.equal(x.status,409,"Foreign account must have no verified ledger.");
  assert.equal(officialWrites,writesBefore,
    "Foreign account must not create any official record.");

  x=await hit("test-a","POST","",{
    kind:"approve",candidateId:proposalId,expectedVersion:0,
  });
  assert.equal(x.status,200,JSON.stringify(x.body));
  assert.equal(x.body.ok,true);
  assert.equal(ledger.version,1);
  assert.equal(ledger.records.length,1);
  assert.equal(ledger.records[0].status,"approved");

  x=await hit("test-a","GET","?candidate_id="+proposalId);
  assert.equal(x.status,200);
  assert.equal(x.body.alreadyApproved,true);
  assert.equal(x.body.ready,false);

  x=await hit("test-a","POST","",{
    kind:"approve",candidateId:proposalId,expectedVersion:0,
  });
  assert.equal(x.status,409,"Duplicate approval must fail on ledger CAS.");
  assert.equal(officialWrites,1);

  x=await hit("test-a","POST","",{
    kind:"revise",sourceId:proposalId,expectedVersion:1,
    personId:"a",startDate:date,endDate:date,reason:"vacation",
    replacements:[{date,personId:"b"}],
  });
  assert.equal(x.status,200,
    "A future absence with valid replacement must be accepted: "+
    JSON.stringify(x.body));
  assert.equal(ledger.version,2);
  assert.equal(ledger.records.length,2);
  assert.equal(ledger.records[0].status,"superseded");
  assert.equal(ledger.records[1].status,"approved");
  assert.equal(ledger.records[1].shifts[0].personId,"b");
  assert.equal(ledger.records[1].revision?.sourceId,proposalId);

  const activeId=ledger.records[1].id;
  x=await hit("test-a","POST","",{
    kind:"cancel",scheduleId:activeId,expectedVersion:2,
  });
  assert.equal(x.status,200,
    "Cancellation of a future official shift must work: "+
    JSON.stringify(x.body));
  assert.equal(ledger.version,3);
  assert.equal(ledger.records[1].status,"cancelled");
  assert.equal(officialWrites,3);
  assert.equal(commitCalls,3,"No stale or cross-tenant write may reach RPC.");
  assert.equal(authCalls,8,"Every request must authenticate the caller exactly once.");
  console.log("PR47 H02/H03/H06/H07: verified-history approval, cross-owner 404, immutable revision, cancellation, stale CAS and no duplicate commits passed in bundled Edge.");
}finally{
  globalThis.fetch=priorFetch;
  if(priorDeno===undefined)delete globalThis.Deno;
  else globalThis.Deno=priorDeno;
  rmSync(temp,{recursive:true,force:true});
}
