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
      if(init.headers?.Authorization==="Bearer anonymous")
        return json({id:owner,is_anonymous:true});
      return json({message:"unauthorized"},401);
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
  let r=await call("",{method:"POST",headers:{"Content-Type":"application/json"},
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
  console.log("PR47-17: bundled Edge HTTP rejects unauthenticated, anonymous and missing-history requests (no writes).");
} finally {
  globalThis.fetch=originalFetch;
  if(originalDeno===undefined)delete globalThis.Deno;
  else globalThis.Deno=originalDeno;
  rmSync(temp,{recursive:true,force:true});
}
