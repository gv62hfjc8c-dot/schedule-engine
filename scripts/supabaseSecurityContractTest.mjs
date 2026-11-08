/**
 * PR #47 / Checkpoint D. Static, OFFLINE guardrails for future changes.
 * This deliberately does NOT claim to prove the Supabase deployment is safe;
 * the live check lives in supabase/audit/pr47_checkpoint_d_readonly.sql.
 * No network, credentials or database operations.
 */
import {readFileSync,existsSync,readdirSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const file=(path)=>readFileSync(resolve(root,path),"utf8");
const contains=(source,expression,message)=>
  assert.match(source,expression,message);
const absent=(source,expression,message)=>
  assert.doesNotMatch(source,expression,message);

const migrations=readdirSync(resolve(root,"supabase/migrations")).filter(n=>n.endsWith(".sql")).sort();
assert.deepEqual(migrations,[
  "20261102125810_generated_schedule_proposals.sql",
  "20261103100427_trusted_approved_schedule_ledger.sql",
  "20261103101604_approved_context_proposals.sql",
  "20261103104023_partial_schedule_revisions.sql",
  "20261108124759_pr47_four_week_proposals.sql",
  "20261108124844_pr47_state_rpc_private_schema.sql",
  "20261108141507_pr47_historical_archive_foundation.sql",
  "20261108142521_pr47_trusted_approval_revisions.sql",
  "20261108144725_pr47_verified_ledger_initialization.sql",
],"Active migration versions must exactly match the four installed histories, two deployed PR47 upgrades and one staged historical foundation.");
const state=file("supabase/migrations/20261102125810_generated_schedule_proposals.sql");
contains(state,/security\s+definer/i,"State RPC must document its security context.");
contains(state,/set\s+search_path\s*=\s*''/i,"Privileged RPC must use fixed empty search_path.");
contains(state,/auth\.uid\(\)/i,"State writes must be scoped to authenticated identity.");
contains(state,/is_anonymous/i,"Reject anonymous sessions for persistent writes.");
contains(state,/pg_advisory_xact_lock/i,"Concurrent updates must be serialized.");
contains(state,/p_expected_revision/i,"State updates must check a revision.");
contains(state,/revoke\s+all\s+on\s+function\s+public\.save_schedule_engine_state/i,
  "State function default PUBLIC grants must be explicitly revoked.");
contains(state,/grant\s+execute\s+on\s+function\s+public\.save_schedule_engine_state[\s\S]*?to\s+authenticated/i,
  "The current state UI depends on this authenticated RPC.");

const generated=state;
contains(generated,/enable\s+row\s+level\s+security/i,
  "Generated proposals must have RLS.");
contains(generated,/grant\s+insert\s*\(\s*id,\s*owner_id,\s*start_date,\s*end_date,\s*time_zone,\s*payload\s*\)/i,
  "Proposal INSERT must remain column-scoped and must not grant created_at.");
contains(generated,/with\s+check\s*\(\s*\(select\s+auth\.uid\(\)\)\s*=\s*owner_id\s*\)/i,
  "Proposal INSERT policy must check authenticated ownership.");
absent(generated,/grant\s+(?:update|delete|all)\s+on\s+(?:table\s+)?public\.schedule_engine_generated_schedules\s+to\s+authenticated/i,
  "Never grant the browser UPDATE or DELETE over immutable proposals.");
const legacy=file("supabase/rollback/pr47-legacy-active/20261026_schedule_engine_approved_ledgers_v0.sql");
contains(legacy,/NO client role receives EXECUTE/i,
  "Legacy ledger explicitly gates off untrusted writes.");
absent(legacy,/grant\s+execute\s+on\s+function\s+public\.save_schedule_engine_approved_ledger[\s\S]*?to\s+authenticated/i,
  "Legacy ledger must not grant browser approval mutations.");

const fourWeeks=file("supabase/migrations/20261108124759_pr47_four_week_proposals.sql");
contains(fourWeeks,/end_date\s*<\s*start_date\s*\+\s*28/i,
  "Four-week proposals require the database CHECK to accept 28 days.");
const deployedRpcMigration=file("supabase/migrations/20261108124844_pr47_state_rpc_private_schema.sql");
contains(deployedRpcMigration,/CREATE\s+SCHEMA\s+IF\s+NOT\s+EXISTS\s+schedule_engine_private/i,
  "Deployed migration must install the private schema.");
contains(deployedRpcMigration,/SECURITY\s+INVOKER/i,
  "Deployed public RPC must never stay SECURITY DEFINER.");
const verifiedInit=file("supabase/migrations/20261108144725_pr47_verified_ledger_initialization.sql");
contains(verifiedInit,/initialize_schedule_engine_verified_ledger/,
  "Trusted ledger initialization must require verified historic facts.");
contains(verifiedInit,/schedule_engine_history_day_facts/,
  "Verified initialization must inspect person-day history rather than a boolean.");
contains(verifiedInit,/REVOKE\s+ALL\s+ON\s+FUNCTION[\s\S]*?initialize_schedule_engine_verified_ledger/,
  "Verified initializer must deny browser execution.");
const revisions=file("supabase/migrations/20261108142521_pr47_trusted_approval_revisions.sql");
contains(revisions,/p_operation\s+NOT\s+IN\s*\('approve','replace','cancel','revise'\)/i,
  "Trusted official CAS must accept partial revision events.");
contains(revisions,/REVOKE\s+ALL\s+ON\s+FUNCTION[\s\S]*?commit_schedule_engine_approved_ledger/i,
  "Trusted approval RPC must revoke public clients.");
const historical=file("supabase/migrations/20261108141507_pr47_historical_archive_foundation.sql");
contains(historical,/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.schedule_engine_history_day_facts/i,
  "The history migration must capture explicit person/day facts.");
contains(historical,/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.schedule_engine_history_verifications/i,
  "Historical source uploads must be separately verified.");
contains(historical,/REVOKE\s+EXECUTE\s+ON\s+FUNCTION[\s\S]*?initialize_schedule_engine_approved_ledger/i,
  "Unsafe official-ledger initialization must be disabled.");
absent(historical,/GRANT\s+(?:INSERT|UPDATE|DELETE|ALL)[\s\S]*?ON\s+public\.schedule_engine_history_(?:sources|day_facts|verifications)\s+TO\s+authenticated/i,
  "Do not grant the browser historical data writes.");
const rpcHardening=file("supabase/deployment/pr47_state_rpc_private_schema.sql");
contains(rpcHardening,/CREATE\s+SCHEMA\s+IF\s+NOT\s+EXISTS\s+schedule_engine_private/i,
  "Privileged code must be moved outside the Data API schema.");
contains(rpcHardening,/SECURITY\s+INVOKER/i,
  "The exposed RPC wrapper must not be privileged.");
contains(rpcHardening,/auth\.uid\(\)/,
  "The privileged internal implementation must retain owner scope.");
const rollbackRpc=file("supabase/rollback/pr47_state_rpc_public_restore.sql");
contains(rollbackRpc,/SECURITY\s+DEFINER/i,
  "Exact original security context must be recoverable.");
const deployedPaths=[
  "supabase/functions/official-schedules/index.ts",
  "src/application/executeApprovedScheduleCommand.ts",
  "src/utils/approvedSchedules.ts",
  "src/utils/workConstraints.ts",
  "src/utils/availability.ts",
  "src/utils/operatingCalendar.ts",
  "src/utils/presence.ts",
  "src/utils/workCoverage.ts",
  "src/utils/workRules.ts",
  "src/utils/scheduleLimits.ts",
  "src/utils/partialScheduleRevision.ts",
  "src/persistence/generatedScheduleRepository.ts",
  "src/application/officialScheduleRequest.ts",
];
const manifest=JSON.parse(file("supabase/rollback/official-schedules-v5/manifest.json"));
assert.equal(manifest.deployed_version,5,"Wrong backed-up Edge version.");
assert.equal(manifest.deployed_verify_jwt,true,"Rollback must preserve JWT verification.");
assert.equal(manifest.deployed_ezbr_sha256,
  "8cc1967656a0c62d7c6cbbf8ddd309ab52c942e0bb501fc0f1b0c4e3124e2649",
  "Unexpected server-deployed bundle identity.");
assert.equal(manifest.source_files.length,deployedPaths.length,
  "Partial Edge backups cannot be accepted.");
for(const path of deployedPaths){
  const item=manifest.source_files.find(entry=>entry.path===path);
  assert.ok(item && /^[0-9a-f]{40}$/.test(item.git_blob_sha1),
    "Manifest missing archived blob identity: "+path);
  const absolute=resolve(root,"supabase/rollback/official-schedules-v5",path);
  assert.ok(existsSync(absolute),"Missing deployed rollback source: "+path);
  const contents=readFileSync(absolute);
  const digest=createHash("sha1").update("blob "+contents.length+"\0")
    .update(contents).digest("hex");
  assert.equal(digest,item.git_blob_sha1,"Archived Edge source changed: "+path);
  assert.equal(contents.length,item.bytes,"Archived module size changed: "+path);
}
const dormant=file("supabase/deployment/official-schedules-disabled/index.ts");
contains(dormant,/status:\s*410/i,"Legacy endpoint must reject commands if explicitly deactivated.");
contains(dormant,/Deno\.serve/i,"Disabled endpoint remains a deployable Edge Function.");
absent(dormant,/Deno\.env|getUser|service_role|supabase\.co/i,
  "Disabled service must not access any database credentials.");

const audit=file("supabase/audit/pr47_checkpoint_d_readonly.sql");
const executable=audit.split("\n").filter(line=>!line.trimStart().startsWith("--")).join("\n");
absent(executable,/^\s*(?:CREATE|ALTER|DROP|TRUNCATE|DELETE|UPDATE|INSERT|GRANT|REVOKE|CALL|DO|EXECUTE|SET|NOTIFY)\b/im,
  "Supabase deployment inventory MUST remain read-only.");
contains(audit,/pg_policies/,"Audit must inspect policies.");
contains(audit,/has_function_privilege/,"Audit must inspect RPC permissions.");
contains(audit,/supabase_migrations\.schema_migrations/,
  "Audit must compare migration history.");
const assertions=file("supabase/audit/pr47_checkpoint_d_assertions.sql");
const executableAssertions=assertions.split("\n")
  .filter(line=>!line.trimStart().startsWith("--")).join("\n");
absent(executableAssertions,
  /^\s*(?:CREATE|ALTER|DROP|TRUNCATE|DELETE|UPDATE|INSERT|GRANT|REVOKE|CALL|DO|EXECUTE|SET|NOTIFY)\b/im,
  "Live security assertions MUST remain read-only.");
assert.equal((assertions.match(/select\s+'\d{2}_[a-z_]+/g)??[]).length,10,
  "Expected ten explicit live security contract checks.");
contains(assertions,/search_path=""'/,
  "The state RPC live assertion must require an empty search_path.");

const entrypoints=[
  "src/App.tsx",
  "src/components/ScheduleHome.tsx",
  "src/components/ScheduleGeneratorPanel.tsx",
  "src/persistence/supabaseInstance.ts",
];
for(const path of entrypoints){
  const src=file(path);
  absent(src,/sb_secret_[A-Za-z0-9_-]+/,"Never commit a secret API key to a public client.");
  absent(src,/VITE_SUPABASE_SERVICE_ROLE|VITE_SUPABASE_SECRET/i,
    "Frontend must not load privileged Supabase keys.");
  absent(src,/functions\/v1\/official-schedules|commit_schedule_engine_approved_ledger/,
    "The current scheduling UI must not call the retired approval service.");
}
console.log("PR47-D: static client/RLS/secret boundaries, read-only inventory and full Edge v5 rollback bundle verified (no network).");
