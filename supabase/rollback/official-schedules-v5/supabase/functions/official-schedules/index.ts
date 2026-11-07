/**
 * Trusted approval endpoint. Never deploy as a static frontend asset.
 *
 * User-supplied data: action, expected ledger revision, proposal ID.
 * Server-controlled data: identity, saved proposal, current configuration,
 * ledger, clock, validation, and atomic transaction.
 *
 * Import the SAME scheduling core that runs in tests. Deployment tooling
 * must include all runtime transitive modules from ../../src.
 */
import { executeApprovedScheduleCommand, type ApprovedScheduleCommand,
  type TrustedApprovalPorts } from "../../../src/application/executeApprovedScheduleCommand.ts";
import { validateApprovedScheduleLedger,
  type ApprovedScheduleLedger, type ApprovalEnvironment } from "../../../src/utils/approvedSchedules.ts";
import { isGeneratedSchedulePayload } from "../../../src/persistence/generatedScheduleRepository.ts";
import { parseOfficialScheduleRequest } from "../../../src/application/officialScheduleRequest.ts";
import { INITIAL_WORK_CONSTRAINTS } from "../../../src/utils/workConstraints.ts";

type JsonRecord = Record<string, unknown>;
const isObject = (value: unknown): value is JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const url = Deno.env.get("SUPABASE_URL") ?? "";
const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

async function remote(path: string, init: RequestInit = {}): Promise<unknown> {
  if (!url || !secret) throw new Error("Trusted Supabase environment unavailable");
  const response = await fetch(url + path, {
    ...init,
    headers: {
      apikey: secret,
      Authorization: "Bearer " + secret,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Trusted database request failed");
  return await response.json();
}
function oneRow(value: unknown): JsonRecord | null {
  if (!Array.isArray(value) || value.length > 1) throw new Error("Ambiguous database result");
  if (value.length === 0) return null;
  if (!isObject(value[0])) throw new Error("Malformed database record");
  return value[0];
}
async function fetchOwner(request: Request): Promise<string | null> {
  const auth = request.headers.get("Authorization") ?? "";
  if (!/^Bearer\s+\S+$/i.test(auth) || !url || !secret) return null;
  const response = await fetch(url + "/auth/v1/user", {
    headers: { apikey: secret, Authorization: auth },
    cache: "no-store",
  });
  if (!response.ok) return null;
  const payload: unknown = await response.json();
  if (!isObject(payload) || typeof payload.id !== "string" ||
    payload.is_anonymous === true) return null;
  return payload.id;
}

async function lookupCandidate(ownerId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const data = oneRow(await remote(
    "/rest/v1/schedule_engine_generated_schedules?select=id,owner_id,start_date,end_date,time_zone,payload" +
    "&owner_id=eq." + encodeURIComponent(ownerId) +
    "&id=eq." + encodeURIComponent(id) + "&limit=1",
  ));
  if (!data || data.id !== id || data.owner_id !== ownerId ||
    !isGeneratedSchedulePayload(data.payload)) return null;
  const p = data.payload;
  if (data.start_date !== p.startDate || data.end_date !== p.endDate ||
    data.time_zone !== p.timeZone) return null;
  return { id, payload: p };
}

async function loadAuthoritativeEnvironment(ownerId: string): Promise<ApprovalEnvironment> {
  const row = oneRow(await remote(
    "/rest/v1/schedule_engine_states?select=payload" +
    "&owner_id=eq." + encodeURIComponent(ownerId) + "&limit=1"
  ));
  if (!row || !isObject(row.payload)) throw new Error("No trusted configuration");
  const state = row.payload;
  if (!Array.isArray(state.people) || !Array.isArray(state.availabilities) ||
    !isObject(state.workRules) ||
    !isObject(state.weeklyOperatingHours) || !Array.isArray(state.exceptions) ||
    !isObject(state.weeklyPresenceRequirements) ||
    !Array.isArray(state.presenceExceptions))
    throw new Error("Invalid stored operational configuration");
  const max = state.workRules.maximumDailyEffectiveMinutes;
  if (max !== undefined && (!Number.isSafeInteger(max) ||
    (max as number) <= 0)) throw new Error("Invalid effective daily work maximum");
  return {
    people: state.people as ApprovalEnvironment["people"],
    availabilities: state.availabilities as ApprovalEnvironment["availabilities"],
    operatingCalendar: {
      weeklyOperatingHours: state.weeklyOperatingHours as ApprovalEnvironment["operatingCalendar"]["weeklyOperatingHours"],
      exceptions: state.exceptions as ApprovalEnvironment["operatingCalendar"]["exceptions"],
    },
    presence: {
      weeklyPresenceRequirements: state.weeklyPresenceRequirements as ApprovalEnvironment["presence"]["weeklyPresenceRequirements"],
      presenceExceptions: state.presenceExceptions as ApprovalEnvironment["presence"]["presenceExceptions"],
    },
    workConstraints: {
      ...INITIAL_WORK_CONSTRAINTS,
      maximumDailyEffectiveMinutes: typeof max === "number" ?
        max : INITIAL_WORK_CONSTRAINTS.maximumDailyEffectiveMinutes,
    },
    workRules: state.workRules as ApprovalEnvironment["workRules"],
  };
}

async function getLedger(ownerId: string): Promise<ApprovedScheduleLedger | null> {
  const row = oneRow(await remote(
    "/rest/v1/schedule_engine_approved_ledgers?select=ledger_version,payload" +
    "&owner_id=eq." + encodeURIComponent(ownerId) + "&limit=1"
  ));
  if (!row) return null;
  if (!Number.isSafeInteger(row.ledger_version) ||
    validateApprovedScheduleLedger(row.payload).length > 0 ||
    !isObject(row.payload) || row.ledger_version !== row.payload.version)
    throw new Error("Corrupted official schedule ledger");
  return row.payload as unknown as ApprovedScheduleLedger;
}

async function bootstrapLedger(ownerId: string, zone: string) {
  const initialized = await remote(
    "/rest/v1/rpc/initialize_schedule_engine_approved_ledger",
    { method: "POST", body: JSON.stringify({
      p_owner_id: ownerId, p_time_zone: zone,
    }) }
  );
  if (validateApprovedScheduleLedger(initialized).length > 0)
    throw new Error("Invalid initial official ledger");
  return initialized as ApprovedScheduleLedger;
}


Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({error:"method_not_allowed"},405);
  const ownerId = await fetchOwner(request).catch(()=>null);
  if (!ownerId) return json({ok:false,code:"unauthorized",
    issues:["Sessão não confirmada."]},401);

  let body: unknown;
  try { body = await request.json(); }
  catch { return json({ok:false,code:"invalid_input",issues:["Pedido inválido."]},400); }
  const input=parseOfficialScheduleRequest(body);
  if (!input) return json({ok:false,code:"invalid_input",
    issues:["Comando de aprovação inválido."]},400);

  try {
    const candidate = input.kind === "approve" || input.kind === "replace"
      ? await lookupCandidate(ownerId,input.candidateId) : null;
    if ((input.kind === "approve" || input.kind === "replace") && !candidate)
      return json({ok:false,code:"invalid_input",
        issues:["Proposta não encontrada nesta conta."]},404);

    // Only persisted candidate ID is accepted; never take a draft, ledger,
    // authorizing environment, owner ID, or event timestamp from the client.
    const draft = candidate ? {
      id: candidate.id,
      startDate: candidate.payload.startDate,
      endDate: candidate.payload.endDate,
      timeZone: candidate.payload.timeZone,
      shifts: candidate.payload.shifts,
    } : null;
    // Reject an invalid or injected time zone before initializing a ledger.
    // A malformed candidate must not poison the owner's official archive.
    if (draft) {
      try {
        new Intl.DateTimeFormat("en", {timeZone:draft.timeZone});
      } catch {
        return json({ok:false,code:"invalid_input",
          issues:["O fuso horário da proposta não é válido."]},400);
      }
    }
    const revisionId = input.kind === "revise" ? crypto.randomUUID() : null;
    const command: ApprovedScheduleCommand = input.kind === "cancel"
      ? {kind:"cancel",expectedVersion:input.expectedVersion,
         scheduleId:input.scheduleId}
      : input.kind === "revise"
        ? {kind:"revise",expectedVersion:input.expectedVersion,
          sourceId:input.sourceId,personId:input.personId,
          startDate:input.startDate,endDate:input.endDate,
          reason:input.reason,note:input.note,
          replacements:input.replacements}
        : input.kind === "replace"
          ? {kind:"replace",expectedVersion:input.expectedVersion,
            replaceId:input.replaceId,draft:draft!}
          : {kind:"approve",expectedVersion:input.expectedVersion,draft:draft!};

    const ports: TrustedApprovalPorts = {
      authenticateOwner: async () => ownerId,
      loadLedger: async (id) => {
        const loaded=await getLedger(id);
        if (loaded) return loaded;
        // A database-owned empty ledger can be attested only for the
        // official application archive (not external real-world work).
        if (!draft) return null;
        return bootstrapLedger(id,draft.timeZone);
      },
      loadEnvironment: loadAuthoritativeEnvironment,
      now: () => new Date().toISOString(),
      newRecordId: () => revisionId ?? crypto.randomUUID(),
      commit: async (id,next,expected) => {
        if (validateApprovedScheduleLedger(next).length > 0)
          throw new Error("Invalid proposed ledger update");
        const ok = await remote(
          "/rest/v1/rpc/commit_schedule_engine_approved_ledger",
          {method:"POST",body:JSON.stringify({
            p_owner_id:id,p_expected_version:expected,
            p_next_payload:next,p_operation:input.kind,
            p_record_id:input.kind==="cancel" ? input.scheduleId :
              input.kind==="revise" ? revisionId : input.candidateId,
          })}
        );
        return ok === true ? "saved" : "conflict";
      },
    };
    const outcome=await executeApprovedScheduleCommand(command,ports);
    return json(outcome, outcome.ok ? 200 :
      outcome.code === "stale_version" || outcome.code === "storage_conflict" ? 409 :
      outcome.code === "invalid_input" ? 400 : 422);
  } catch {
    // Do not leak trusted database metadata or silently assert success.
    return json({ok:false,code:"storage_error",
      issues:["Não foi possível confirmar a aprovação. Consulta o estado oficial antes de tentar novamente."]},503);
  }
});
