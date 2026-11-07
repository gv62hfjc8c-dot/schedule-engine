/**
 * PR #47 / Checkpoint D — STAGED, NOT DEPLOYED.
 *
 * This is an intentionally inert replacement for the legacy
 * "official-schedules" Supabase Edge Function, to be used ONLY after an
 * explicit deployment decision and verification of a rollback path.
 *
 * When deploying, KEEP verify_jwt=true at the Supabase gateway. This code
 * does not read users, connect to the database, or change approved ledgers.
 * For immediate rollback, redeploy all 13 files from the archived deployed
 * v5 source in supabase/rollback/official-schedules-v5/ and verify JWT=true.
 *
 * Do not silently deploy this as part of a frontend PR.
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
