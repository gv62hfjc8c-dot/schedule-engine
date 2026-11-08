/**
 * End-to-end endpoint contract in a disposable in-memory Supabase simulation.
 * Bundles the real Edge entrypoint, injects Deno.serve and intercepts HTTP.
 * This is not proof of a real signed JWT or live Supabase RLS.
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const temp=mkdtempSync(join(tmpdir(),"schedule-engine-http-"));
let handler=null;
const originalFetch=globalThis.fetch;
const originalDeno=globalThis.Deno;
const owner="11111111-1111-4111-8111-111111111111";
const ownerB="22222222-2222-4222-8222-222222222222";
const idA="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const idB="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const weekdays=["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];
const weekly=Object.fromEntries(weekdays.map(day=>
  [day,day==="monday"?[{start:"09:00",end:"13:00"}]:[]]));
const presence=Object.fromEntries(weekdays.map(day=>
  [day,day==="monday"?{
    minimumAtOpening:0,minimumDuringOperation:0,minimumAtClosing:0,
  }:null]));
const makeProposal=(recordOwner,id,personId)=>({
  id,owner_id:recordOwner,start_date:"2026-11-02",
  end_date:"2026-11-02",time_zone:"Atlantic/Azores",
  payload:{
    schemaVersion:1,validationScope:"user_attested_no_external_shifts",
    startDate:"2026-11-02",endDate:"2026-11-02",
    timeZone:"Atlantic/Azores",
    people:[{id:personId,name:"Synthetic",active:true}],
    shifts:[{date:"2026-11-02",personId,
      interval:{start:"09:00",end:"13:00"},mealBreak:null}],
    configuration:{
      availabilities:[{personId,
        weeklyAvailability:weekly,exceptions:[]}],
      operatingCalendar:{weeklyOperatingHours:weekly,exceptions:[]},
      workRules:{standardShiftDurationMinutes:240},
      presence:{weeklyPresenceRequirements:presence,presenceExceptions:[]},
      workConstraints:{
        mealBreak:{
          requiredAboveEffectiveMinutes:360,durationMinutes:60,
          earliestStartAfterWorkMinutes:180,latestStartAfterWorkMinutes:300,
        },
        minimumRestBetweenShiftsMinutes:660,
        maximumDailyEffectiveMinutes:480,
        maximumWeeklyEffectiveMinutes:2400,
      },
    },
  },
});
const proposals=[makeProposal(owner,idA,"a"),makeProposal(ownerB,idB,"b")];
const calls=[];
const json=(x,status=200)=>new Response(JSON.stringify(x),{
  status,headers:{"Content-Type":"application/json"},
});
try {
  globalThis.Deno={
    env:{get:(name)=>({
      SUPABASE_URL:"https://project-test.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY:"local-test-only-secret",
      SCHEDULE_ENGINE_HISTORY_ANCHOR_DATE:"2026-01-01",
    })[name]},
    serve:(callback)=>{handler=callback;},
  };
  globalThis.fetch=async(url,init={})=>{
    const parsed=new URL(url);
    const path=parsed.pathname;
    calls.push({path,method:init.method??"GET",auth:init.headers?.Authorization??null});
    if(path==="/auth/v1/user") {
      if(init.headers?.Authorization==="Bearer user-a")
        return json({id:owner,is_anonymous:false});
      if(init.headers?.Authorization==="Bearer user-b")
        return json({id:ownerB,is_anonymous:false});
      if(init.headers?.Authorization==="Bearer anonymous")
        return json({id:owner,is_anonymous:true});
      return json({message:"unauthorized"},401);
    }
    if(path==="/rest/v1/schedule_engine_generated_schedules"){
      const ownerFilter=parsed.searchParams.get("owner_id");
      const idFilter=parsed.searchParams.get("id");
      const selectedOwner=ownerFilter?.replace("eq.","");
      const selectedId=idFilter?.replace("eq.","");
      return json(proposals.filter(p=>
        p.owner_id===selectedOwner&&p.id===selectedId));
    }
    if(path==="/rest/v1/schedule_engine_approved_ledgers")return json([]);
    if(path.startsWith("/rest/v1/rpc/"))
      throw Error("No SQL mutations are allowed with an unknown 2026 history");
    throw Error("Unexpected external request: "+path);
  };
  const output=join(temp,"edge.mjs");
  await build({entryPoints:[resolve("supabase/functions/official-schedules-v2/index.ts")],
    outfile:output,bundle:true,format:"esm",platform:"neutral",target:"es2022",
    logLevel:"error",minify:false});
  await import(pathToFileURL(output).href);
  assert.equal(typeof handler,"function","Edge Deno.serve handler not registered");
  const call=(path,init={})=>handler(new Request(
    "https://project-test.supabase.co/functions/v1/official-schedules-v2"+path,init,
  ));
  let r=await call("",{method:"OPTIONS",headers:{
    Origin:"http://localhost:5173",
    "Access-Control-Request-Method":"POST",
    "Access-Control-Request-Headers":"authorization,apikey,content-type",
  }});
  assert.equal(r.status,204,"Preflight must succeed before browser authentication.");
  assert.equal(r.headers.get("Access-Control-Allow-Origin"),"*",
    "Browser must receive CORS response without cookies.");
  assert.match(r.headers.get("Access-Control-Allow-Headers")??"",
    /authorization/i,"Authenticated browser must be allowed to send Bearer headers.");
  assert.equal(calls.length,0,"Preflight must not contact trusted backend.");
  r=await call("",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({kind:"approve",candidateId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",expectedVersion:0})});
  assert.equal(r.status,401,"POST without JWT must reject.");
  r=await call("",{method:"POST",headers:{Authorization:"Bearer anonymous",
    "Content-Type":"application/json"},body:"{}"});
  assert.equal(r.status,401,"Anonymous Supabase Auth JWT must be rejected.");
  r=await call("",{method:"PUT",headers:{Authorization:"Bearer user-a"}});
  assert.equal(r.status,405,"Only supported HTTP methods may access official endpoint.");
  r=await call("?candidate_id=not-a-uuid",{
    method:"GET",headers:{Authorization:"Bearer user-a"}});
  assert.equal(r.status,400,"Invalid candidate must be rejected before any data query.");
  // The real Edge handler uses Auth identity, not a browser-supplied owner.
  // The mocked DB responds with rows scoped to the owner filter and refuses
  // access to proposals of the other authenticated user.
  for(const [token,ownId,foreignId] of [
    ["user-a",idA,idB],["user-b",idB,idA],
  ]){
    r=await call("?candidate_id="+ownId,{
      method:"GET",headers:{Authorization:"Bearer "+token},
    });
    const self=await r.json();
    assert.equal(r.status,200,"Own saved proposal is readable.");
    assert.equal(self.ready,false,
      "Missing verified ledger must block approval even for own proposal.");
    assert.equal(self.version,null,"No official ledger is created by a read.");
    r=await call("?candidate_id="+foreignId,{
      method:"GET",headers:{Authorization:"Bearer "+token},
    });
    assert.equal(r.status,404,"Cross-account proposal lookup must be opaque.");
  }
  assert.equal(calls.filter(c=>c.path==="/rest/v1/schedule_engine_generated_schedules").length,4,
    "Both authenticated owners must be separately scoped at the backend.");
  r=await call("",{method:"POST",headers:{Authorization:"Bearer user-a",
    "Content-Type":"application/json"},body:JSON.stringify({
      kind:"approve",candidateId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      expectedVersion:0,
    })});
  assert.equal(r.status,409,"No official ledger must remain unknown.");
  const response=await r.json();
  assert.equal(response.code,"history_incomplete",
    "No imported history cannot be auto-attested as complete.");
  assert.equal(calls.some(c=>c.path.includes("/rpc/")),false,
    "Unknown history must not produce SQL writes.");
  assert.equal(calls.some(c=>c.auth==="Bearer local-test-only-secret"&&
    c.path==="/auth/v1/user"),false,
    "Authentication must validate the user's Bearer JWT, not service-role key.");
  console.log("PR47-17/23: bundled Edge tests 401, 2 isolated authenticated owners, 404 on cross-owner IDs and blocked missing history (zero writes).");
} finally {
  globalThis.fetch=originalFetch;
  if(originalDeno===undefined)delete globalThis.Deno;
  else globalThis.Deno=originalDeno;
  rmSync(temp,{recursive:true,force:true});
}
