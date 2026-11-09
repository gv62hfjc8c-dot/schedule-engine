/** PR47-03: verify the deployed legacy v6 source is structurally inert.
 * JWT gate (verify_jwt=true) is independently checked via Supabase metadata.
 */
import { build } from "esbuild";
import { mkdtempSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join,resolve } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const folder=mkdtempSync(join(tmpdir(),"pr47-old-edge-"));
const originalDeno=globalThis.Deno, originalFetch=globalThis.fetch;
let handler=null,calls=0;
try{
  globalThis.Deno={serve:function(fn){handler=fn;}};
  globalThis.fetch=async()=>{calls++;throw Error("Disabled Edge contacted network");};
  const outfile=join(folder,"legacy-edge.mjs");
  await build({entryPoints:[resolve("supabase/deployment/official-schedules-disabled/index.ts")],
    outfile,bundle:true,platform:"neutral",format:"esm",target:"es2022",logLevel:"error"});
  await import(pathToFileURL(outfile).href);
  assert.equal(typeof handler,"function","Expected a Deno handler.");
  for(const method of ["GET","POST"]){
    const result=await handler(new Request("https://example.invalid/functions/v1/official-schedules",{method}));
    assert.equal(result.status,410,"Legacy endpoint must reject official operations.");
    const data=await result.json();
    assert.equal(data.error,"legacy_official_scheduling_disabled");
    assert.equal(result.headers.get("Cache-Control"),"no-store");
  }
  assert.equal(calls,0,"Legacy endpoint must never read or write any remote state.");
  console.log("PR47-03: both legacy GET/POST return 410 without network access.");
}finally{
  globalThis.fetch=originalFetch;
  if(originalDeno===undefined)delete globalThis.Deno;
  else globalThis.Deno=originalDeno;
  rmSync(folder,{recursive:true,force:true});
}
