import type { SupabaseAuthClient } from "./supabaseAuth";
import type { WorkValidationDateRange } from "../utils/workConstraints";

/**
 * Read-only UI guard. Deliberately does not import the dormant approval
 * command/ledger modules: public UI must never acquire mutation capability.
 *
 * An absent ledger means UNKNOWN official history, not a complete empty
 * history. Generated results remain unapproved proposals in that case.
 * Any failed or malformed read blocks generation rather than silently
 * assuming that there are no protected dates.
 */
export async function readProtectedApprovedPeriods(
  client: Pick<SupabaseAuthClient, "request" | "user">,
  ownerId: string,
): Promise<{ periods: WorkValidationDateRange[]; contextKnown: boolean }> {
  if (!ownerId || client.user?.id !== ownerId) {
    throw new Error("A identidade da conta não foi confirmada.");
  }
  const response = await client.request(
    "/rest/v1/schedule_engine_approved_ledgers?select=ledger_version,payload"+
    "&owner_id=eq."+encodeURIComponent(ownerId)+"&limit=1"
  );
  if (!response.ok) {
    throw new Error("Não foi possível consultar os horários oficiais ("+
      response.status+"). A geração foi bloqueada.");
  }
  const data: unknown = await response.json();
  if (!Array.isArray(data) || data.length>1) {
    throw new Error("A consulta de horários oficiais devolveu dados ambíguos.");
  }
  if (client.user?.id !== ownerId) {
    throw new Error("A sessão mudou durante a consulta ao histórico oficial.");
  }
  if (data.length===0) {
    return {periods:[],contextKnown:false};
  }
  const row=data[0] as Record<string,unknown>|null;
  const payload=row?.payload as Record<string,unknown>|null;
  if (!row || !Number.isSafeInteger(row.ledger_version) || !payload ||
      payload.version!==row.ledger_version ||
      !Array.isArray(payload.records) ||
      typeof payload.complete!=="boolean") {
    throw new Error("O histórico oficial está inconsistente. A geração foi bloqueada.");
  }
  const civil=(value:unknown):value is string=>
    typeof value==="string" && /^\\d{4}-\\d{2}-\\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value+"T00:00:00Z")) &&
    new Date(value+"T00:00:00Z").toISOString().slice(0,10)===value;
  const periods:WorkValidationDateRange[]=[];
  for (const entry of payload.records as unknown[]) {
    if (!entry || typeof entry!=="object") {
      throw new Error("O histórico oficial contém um registo inválido.");
    }
    const record=entry as Record<string,unknown>;
    if (!["approved","cancelled","superseded"].includes(String(record.status)) ||
        !civil(record.startDate) || !civil(record.endDate) ||
        record.startDate>record.endDate) {
      throw new Error("O histórico oficial contém datas ou estados inválidos.");
    }
    if (record.status==="approved") {
      periods.push({startDate:record.startDate,endDate:record.endDate});
    }
  }
  return {periods,contextKnown:payload.complete===true};
}
