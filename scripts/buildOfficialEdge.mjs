/**
 * Staged PR47 trusted Edge Function build rehearsal.
 * Vite uses esbuild transitively; compile the Deno endpoint as one ESM module
 * so extensionless TypeScript imports never depend on Deno import mapping.
 * This does NOT deploy an endpoint or copy privileged secrets.
 */
import {build} from "esbuild";
import {mkdtempSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {resolve,join} from "node:path";
import assert from "node:assert/strict";
const temp=mkdtempSync(join(tmpdir(),"schedule-engine-edge-"));
try {
  const output=join(temp,"official-schedules-v2.mjs");
  await build({
    entryPoints:[resolve("supabase/functions/official-schedules-v2/index.ts")],
    outfile:output,bundle:true,format:"esm",platform:"neutral",
    target:"es2022",minify:false,logLevel:"warning",
    legalComments:"none",
  });
  const source=readFileSync(output,"utf8");
  assert.match(source,/Deno\.serve/,"Staged Edge endpoint missing entrypoint.");
  assert.match(source,/auth\/v1\/user/,"Endpoint must confirm real Auth identity.");
  assert.match(source,/history_incomplete/,"History must fail closed.");
  assert.doesNotMatch(source,/initialize_schedule_engine_approved_ledger/,
    "The Edge bundle must never call the unsafe all-years initializer.");
  assert.doesNotMatch(source,/(?:from|import)\s+["']\.\.?\//,
    "Edge bundle must not contain unresolved relative imports.");
  console.log("PR47-17: trusted Deno Edge function bundled without unresolved local imports (not deployed).");
} finally {
  rmSync(temp,{recursive:true,force:true});
}
