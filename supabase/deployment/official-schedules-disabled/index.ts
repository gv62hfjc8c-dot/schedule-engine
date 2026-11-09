/**
 * PR #47 / Checkpoint D — DEPLOYED 2026-11-08 as official-schedules v6.
 *
 * Intentionally inert replacement for the legacy "official-schedules"
 * Supabase Edge Function. It returns HTTP 410 and does not touch the database.
 * Full authenticated HTTP and external-consumer checks remain pending.
 *
 * When deploying, KEEP verify_jwt=true at the Supabase gateway. This code
 * does not read users, connect to the database, or change approved ledgers.
 * For immediate rollback, redeploy all 13 files from the archived deployed
 * v5 source in supabase/rollback/official-schedules-v5/ and verify JWT=true.
 *
 * Deployment was performed separately from frontend code; track independently.
 */
Deno.serve((_request: Request) =>
  new Response(JSON.stringify({
    error: "legacy_official_scheduling_disabled",
    message: "O serviço antigo de aprovação não integra o Schedule Engine atual.",
  }),{
    status: 410,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
);
