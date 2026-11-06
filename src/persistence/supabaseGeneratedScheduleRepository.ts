import type { SupabaseAuthClient } from "./supabaseAuth";
import {
  isGeneratedSchedulePayload,
  type GeneratedSchedulePayload,
  type GeneratedScheduleRepository,
  type StoredGeneratedSchedule,
} from "./generatedScheduleRepository";

type AuthenticatedClient = Pick<SupabaseAuthClient, "request" | "user">;

export class GeneratedScheduleStoreError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "GeneratedScheduleStoreError";
  }
}

async function jsonResponse(response: Response): Promise<unknown> {
  try { return await response.json() as unknown; }
  catch { throw new GeneratedScheduleStoreError(
    "A base de dados devolveu dados inválidos.", response.status); }
}

async function checked(response: Response): Promise<unknown> {
  const data = await jsonResponse(response);
  if (response.ok) return data;
  const details = data && typeof data === "object"
    ? data as Record<string, unknown> : {};
  throw new GeneratedScheduleStoreError(
    typeof details.message === "string" ? details.message :
      "Não foi possível guardar ou consultar as propostas.", response.status);
}

function readRow(value: unknown): StoredGeneratedSchedule {
  if (!value || typeof value !== "object")
    throw new GeneratedScheduleStoreError("Registo de horário incompatível.");
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" ||
    typeof row.created_at !== "string" ||
    !Number.isFinite(Date.parse(row.created_at)) ||
    typeof row.start_date !== "string" ||
    typeof row.end_date !== "string" ||
    typeof row.time_zone !== "string" ||
    !isGeneratedSchedulePayload(row.payload) ||
    row.start_date !== row.payload.startDate ||
    row.end_date !== row.payload.endDate ||
    row.time_zone !== row.payload.timeZone)
    throw new GeneratedScheduleStoreError(
      "Existe uma proposta guardada com estrutura incompatível.");
  return {
    id: row.id,
    createdAt: row.created_at,
    startDate: row.start_date,
    endDate: row.end_date,
    timeZone: row.time_zone,
    payload: row.payload,
  };
}

/**
 * Untrusted browser proposals are append-only. RLS limits visibility to the
 * signed-in user. There is deliberately NO update/delete/approve method:
 * the authoritative approval command must execute on a trusted server.
 */
export function createSupabaseGeneratedScheduleRepository(
  client: AuthenticatedClient
): GeneratedScheduleRepository {
  const owner = () => {
    const user = client.user;
    if (!user) throw new GeneratedScheduleStoreError(
      "É necessário iniciar sessão para guardar horários.");
    return user.id;
  };

  return {
    async save(payload) {
      const ownerId = owner();
      if (!isGeneratedSchedulePayload(payload))
        throw new GeneratedScheduleStoreError(
          "A proposta não está completa. Não foi guardada.");
      const response = await client.request(
        "/rest/v1/schedule_engine_generated_schedules?select=id,created_at,start_date,end_date,time_zone,payload",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Prefer": "return=representation",
          },
          body: JSON.stringify({
            id: crypto.randomUUID(),
            owner_id: ownerId,
            start_date: payload.startDate,
            end_date: payload.endDate,
            time_zone: payload.timeZone,
            payload,
          }),
        }
      );
      const rows = await checked(response);
      if (!Array.isArray(rows) || rows.length !== 1)
        throw new GeneratedScheduleStoreError(
          "O servidor não confirmou o registo do horário.");
      if (client.user?.id !== ownerId)
        throw new GeneratedScheduleStoreError(
          "A sessão mudou durante a gravação. Reconsulta o histórico.");
      return readRow(rows[0]);
    },
    async latest() {
      const ownerId = owner();
      const response = await client.request(
        "/rest/v1/schedule_engine_generated_schedules" +
        "?select=id,created_at,start_date,end_date,time_zone,payload" +
        "&order=created_at.desc,id.desc&limit=1"
      );
      const rows = await checked(response);
      if (!Array.isArray(rows) || rows.length > 1)
        throw new GeneratedScheduleStoreError("Última proposta incompatível.");
      if (client.user?.id !== ownerId)
        throw new GeneratedScheduleStoreError(
          "A sessão mudou. Atualiza os horários.");
      return rows.length === 1 ? readRow(rows[0]) : null;
    },
    async listBetween(startDate, endDate) {
      const ownerId = owner();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
          !/^\d{4}-\d{2}-\d{2}$/.test(endDate) ||
          startDate > endDate)
        throw new GeneratedScheduleStoreError("Intervalo de consulta inválido.");
      const all: StoredGeneratedSchedule[] = [];
      const pageSize = 100;
      for (let page = 0; page < 200; page++) {
        const response = await client.request(
          "/rest/v1/schedule_engine_generated_schedules" +
          "?select=id,created_at,start_date,end_date,time_zone,payload" +
          "&start_date=lte." + encodeURIComponent(endDate) +
          "&end_date=gte." + encodeURIComponent(startDate) +
          "&order=created_at.desc,id.desc" +
          "&limit=" + pageSize + "&offset=" + (page * pageSize)
        );
        const rows = await checked(response);
        if (!Array.isArray(rows) || rows.length > pageSize)
          throw new GeneratedScheduleStoreError("A consulta devolveu um histórico inválido.");
        if (client.user?.id !== ownerId)
          throw new GeneratedScheduleStoreError(
            "A sessão mudou durante a consulta. Atualiza os horários.");
        all.push(...rows.map(readRow));
        if (rows.length < pageSize) return all;
      }
      throw new GeneratedScheduleStoreError(
        "Existem demasiadas propostas neste intervalo. A consulta não foi concluída.");
    },
  };
}
