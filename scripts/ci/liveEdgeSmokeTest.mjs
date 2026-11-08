/**
 * PR47 zero-secret live gateway checks. Runs from GitHub-hosted CI.
 * No tokens, credentials, end-user data or mutations are used.
 * A public Edge URL is deployment metadata, not an engine dependency.
 */
import assert from "node:assert/strict";
const base=process.env.PR47_EDGE_TEST_URL;
if(!base)throw Error("PR47_EDGE_TEST_URL must be configured for live acceptance.");
const root=base.replace(/\/$/,"");
if(!/^https:\/\/[a-z0-9-]+\.supabase\.co\/functions\/v1$/.test(root))
  throw Error("Unexpected edge smoke-test base URL.");
for(const name of ["official-schedules","official-schedules-v2"]){
  const target=root+"/"+name;
  for(const method of ["GET","POST"]){
    const r=await fetch(target+(method==="GET"?"?candidate_id=invalid":""),{
      method,redirect:"manual",signal:AbortSignal.timeout(15000),
      headers:method==="POST"?{"Content-Type":"application/json"}:{},
      ...(method==="POST"?{body:"{}"}:{}),
    });
    const body=await r.text();
    assert.equal(r.status,401,
      name+" "+method+" must reject missing JWT before reaching any service.");
    assert.doesNotMatch(body,/service_role|SUPABASE_SERVICE_ROLE_KEY/,
      "Error responses must not leak secrets.");
  }
}
const preflight=await fetch(root+"/official-schedules-v2",{
  method:"OPTIONS",redirect:"manual",signal:AbortSignal.timeout(15000),
  headers:{
    "Origin":"http://localhost:5173",
    "Access-Control-Request-Method":"POST",
    "Access-Control-Request-Headers":"authorization,apikey,content-type",
  },
});
const cors=preflight.headers.get("access-control-allow-origin");
assert([200,204].includes(preflight.status)&&cors==="*",
  "Deployed Edge must accept browser CORS preflights, status="+
    preflight.status+" allow-origin="+cors);
console.log("PR47 LIVE: old and new Edge GET/POST reject unauthenticated requests; browser preflight succeeds. No writes.");
