import {
  approveSchedule, cancelApprovedSchedule, replaceApprovedSchedule,
  type ApprovalEnvironment, type ApprovalFailure, type ApprovedScheduleLedger,
  type ApprovedScheduleRecord, type ScheduleDraft,
} from "../utils/approvedSchedules";

/**
 * P6.4 server-side application boundary. Not an HTTP endpoint and not
 * secure merely by being imported: the adapter must execute on a trusted
 * server, authenticate requests, load authoritative configuration and
 * persist under the SAME authenticated owner with transactional CAS.
 *
 * Never accept an environment, ledger, ownerId or timestamp from the browser.
 * The generic snapshot RPC is deliberately not executable by client roles.
 */
export type ApprovedScheduleCommand =
  | { kind: "approve"; expectedVersion: number; draft: ScheduleDraft }
  | { kind: "replace"; expectedVersion: number; replaceId: string; draft: ScheduleDraft }
  | { kind: "cancel"; expectedVersion: number; scheduleId: string };

export interface TrustedApprovalPorts {
  /** Validates an actual server-side authenticated permanent session. */
  authenticateOwner(): Promise<string | null>;
  /** Must be scoped by owner in server-controlled queries, never request body. */
  loadLedger(ownerId: string): Promise<ApprovedScheduleLedger | null>;
  /** Current configuration must come from a trusted storage read. */
  loadEnvironment(ownerId: string): Promise<ApprovalEnvironment>;
  /** Server-generated ISO instant, not a client clock. */
  now(): string;
  /**
   * Atomic, owner-scoped write: reject stale expectedVersion, write snapshot
   * + append immutable history in ONE transaction. Privileged credentials
   * must remain server-side.
   */
  commit(ownerId: string, next: ApprovedScheduleLedger, expectedVersion: number): Promise<"saved" | "conflict">;
}

export type CommandExecutionResult =
  | { ok: true; record: ApprovedScheduleRecord; version: number }
  | { ok: false; code: "unauthorized" | "unknown_context" | "storage_conflict" | "storage_error" | ApprovalFailure["code"]; issues: string[] };

export async function executeApprovedScheduleCommand(
  command: ApprovedScheduleCommand,
  ports: TrustedApprovalPorts
): Promise<CommandExecutionResult> {
  // Fail closed: any failed session/read/commit returns no approvals.
  let ownerId: string | null;
  try {
    ownerId = await ports.authenticateOwner();
  } catch {
    return { ok: false, code: "unauthorized", issues: ["Sessão não confirmada."] };
  }
  if (!ownerId?.trim()) {
    return { ok: false, code: "unauthorized", issues: ["Proprietário não autenticado."] };
  }
  if (!command || !Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 0 ||
      !["approve", "replace", "cancel"].includes(command.kind)) {
    return { ok: false, code: "invalid_input", issues: ["Comando ou versão inválidos."] };
  }

  try {
    const ledger = await ports.loadLedger(ownerId);
    if (!ledger) {
      return { ok: false, code: "unknown_context", issues: ["Ledger ainda não inicializado ou atestado."] };
    }
    if (ledger.version !== command.expectedVersion) {
      return { ok: false, code: "stale_version", issues: ["Versão desatualizada."] };
    }
    // The ledger itself enforces complete context; do not attest here.
    const at = ports.now();
    const base = { ledger, expectedVersion: command.expectedVersion, at };
    // Cancellation does not require current scheduling configuration.
    const mutation = command.kind === "cancel"
      ? cancelApprovedSchedule({ ...base, scheduleId: command.scheduleId })
      : command.kind === "approve"
        ? approveSchedule({ ...base, draft: command.draft, environment: await ports.loadEnvironment(ownerId) })
        : replaceApprovedSchedule({ ...base, replaceId: command.replaceId, draft: command.draft, environment: await ports.loadEnvironment(ownerId) });

    if (!mutation.ok) {
      return { ok: false, code: mutation.failure.code, issues: mutation.failure.issues };
    }
    const saved = await ports.commit(ownerId, mutation.ledger, command.expectedVersion);
    if (saved !== "saved") {
      return { ok: false, code: "storage_conflict", issues: ["Outro processo alterou o ledger."] };
    }
    return { ok: true, record: mutation.record, version: mutation.ledger.version };
  } catch {
    return { ok: false, code: "storage_error", issues: ["Falha ao confirmar dados ou persistência. Não assumir aprovação."] };
  }
}
