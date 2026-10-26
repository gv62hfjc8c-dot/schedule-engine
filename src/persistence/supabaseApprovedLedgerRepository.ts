import type { ApprovedScheduleLedger } from "../utils/approvedSchedules";
import { validateApprovedScheduleLedger } from "../utils/approvedSchedules";
import type { SupabaseAuthClient } from "./supabaseAuth";

/**
 * Separate persistence boundary: approved schedules are NOT part of the
 * configuration-only app-state v4 JSON payload.
 *
 * No automatic initialization. A missing row is UNKNOWN, never an
 * authoritative assertion that there are no approved shifts.
 *
 * On write, the caller supplies the previously read expected version.
 * PostgreSQL RPC enforces compare-and-swap for multiple tabs/clients.
 */
export interface ApprovedLedgerRepository {
  load(): Promise<ApprovedScheduleLedger | null>;
  save(
    next: ApprovedScheduleLedger,
    expectedVersion: number | null,
    options?: { attestComplete?: boolean }
  ): Promise<number>;
}

export class ApprovedLedgerStoreError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
    this.name = "ApprovedLedgerStoreError";
  }
}

async function decode(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    throw new ApprovedLedgerStoreError(
      "Resposta do repositório de escalas inválida.", response.status
    );
  }
}

async function errorFrom(response: Response): Promise<ApprovedLedgerStoreError> {
  let message = `O armazenamento de horários respondeu HTTP ${response.status}.`;
  let code: string | undefined;
  try {
    const payload = await response.json() as unknown;
    if (payload && typeof payload === "object") {
      const result = payload as Record<string, unknown>;
      if (typeof result.message === "string") message = result.message;
      if (typeof result.error === "string") message = result.error;
      if (typeof result.code === "string") code = result.code;
    }
  } catch {
    // Preserve HTTP status.
  }
  return new ApprovedLedgerStoreError(message, response.status, code);
}

function validSnapshot(value: unknown): value is ApprovedScheduleLedger {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  return (
    Number.isSafeInteger(result.version) &&
    typeof result.timeZone === "string" &&
    result.complete !== undefined &&
    Array.isArray(result.records) &&
    result.coverage !== null &&
    typeof result.coverage === "object" &&
    validateApprovedScheduleLedger(value).length === 0
  );
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function createSupabaseApprovedLedgerRepository(
  client: Pick<SupabaseAuthClient, "request" | "user">
): ApprovedLedgerRepository {
  return {
    async load() {
      const user = client.user;
      if (!user) throw new Error("É necessário iniciar sessão para consultar escalas.");
      const query = `?select=ledger_version,payload&owner_id=eq.${encodeURIComponent(user.id)}&limit=1`;
      const response = await client.request(
        "/rest/v1/schedule_engine_approved_ledgers" + query
      );
      if (!response.ok) throw await errorFrom(response);
      const rows = await decode(response);
      if (!Array.isArray(rows) || rows.length > 1) {
        throw new Error("Resposta de horários aprovados inválida ou ambígua.");
      }
      // Lack of persisted data is explicitly UNKNOWN, never complete:true.
      if (rows.length === 0) return null;
      const row = rows[0] as Record<string, unknown> | null;
      if (!row || !Number.isSafeInteger(row.ledger_version) ||
          !validSnapshot(row.payload) ||
          row.ledger_version !== row.payload.version) {
        throw new Error(
          "O ledger de horários existente está inconsistente. Operações bloqueadas."
        );
      }
      return clone(row.payload);
    },

    async save(next, expectedVersion, options = {}) {
      if (!client.user) {
        throw new Error("É necessário iniciar sessão antes de guardar escalas.");
      }
      if (!validSnapshot(next)) {
        throw new Error("Ledger malformado. A gravação foi bloqueada.");
      }
      if (expectedVersion === null) {
        if (next.version !== 0 || next.complete ||
            next.records.length !== 0) {
          throw new Error(
            "A primeira gravação deve ser um ledger vazio com contexto incompleto."
          );
        }
      } else if (!Number.isSafeInteger(expectedVersion) ||
                 expectedVersion < 0 ||
                 next.version !== expectedVersion + 1) {
        throw new Error("A versão do ledger não corresponde à mutação prevista.");
      }
      const response = await client.request(
        "/rest/v1/rpc/save_schedule_engine_approved_ledger",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            p_expected_version: expectedVersion === null ? -1 : expectedVersion,
            p_payload: next,
            p_attest_complete: options.attestComplete === true,
          }),
        }
      );
      if (!response.ok) throw await errorFrom(response);
      const value = await decode(response);
      if (value !== next.version) {
        throw new ApprovedLedgerStoreError(
          "O Supabase confirmou uma versão inesperada do ledger.",
          response.status
        );
      }
      return value;
    },
  };
}
