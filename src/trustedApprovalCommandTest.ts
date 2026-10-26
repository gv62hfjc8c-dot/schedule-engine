import { executeApprovedScheduleCommand, type TrustedApprovalPorts } from "./application/executeApprovedScheduleCommand";
import { createApprovedScheduleLedger, type ApprovedScheduleLedger } from "./utils/approvedSchedules";

function check(condition: boolean, reason: string) {
  if (!condition) throw new Error(reason);
}
const owner = "owner-1";
const base = createApprovedScheduleLedger({ startDate: "2026-10-01", endDate: "2026-11-30" }, "Europe/Lisbon", true);
const source = {
  id: "approved-1", startDate: "2026-10-20", endDate: "2026-10-20",
  timeZone: "Europe/Lisbon", status: "approved" as const,
  shifts: [], approvedAt: "2026-10-19T12:00:00Z",
  changedAt: null, replacesId: null, replacementId: null,
};
let stored: ApprovedScheduleLedger = { ...base, version: 3, records: [source] };
let writes = 0;
let environmentReads = 0;
const ports: TrustedApprovalPorts = {
  authenticateOwner: async () => owner,
  loadLedger: async (identity) => {
    check(identity === owner, "Ledger must be loaded for authenticated owner");
    return structuredClone(stored);
  },
  loadEnvironment: async () => {
    environmentReads++;
    throw new Error("Current configuration unavailable");
  },
  now: () => "2026-10-21T12:00:00Z",
  commit: async (identity, next, expected) => {
    check(identity === owner, "Commit must be scoped to owner");
    if (expected !== stored.version) return "conflict";
    stored = structuredClone(next);
    writes++;
    return "saved";
  },
};
const cancel = { kind: "cancel" as const, scheduleId: source.id, expectedVersion: 3 };
let result = await executeApprovedScheduleCommand(cancel, { ...ports, authenticateOwner: async () => null });
check(!result.ok && result.code === "unauthorized" && writes === 0, "Unauthenticated cancellation must fail");
result = await executeApprovedScheduleCommand({ ...cancel, expectedVersion: 2 }, ports);
check(!result.ok && result.code === "stale_version" && writes === 0, "Stale version must fail");
result = await executeApprovedScheduleCommand(cancel, { ...ports, loadLedger: async () => null });
check(!result.ok && result.code === "unknown_context", "Unknown ledger must not be inferred empty");
result = await executeApprovedScheduleCommand(cancel, { ...ports, commit: async () => "conflict" });
check(!result.ok && result.code === "storage_conflict" && writes === 0, "CAS conflict must not publish success");
result = await executeApprovedScheduleCommand(cancel, ports);
check(result.ok && result.version === 4 && writes === 1 &&
  stored.records[0].status === "cancelled" && environmentReads === 0,
  "Valid cancellation must be atomic and independent of configuration");
result = await executeApprovedScheduleCommand(cancel, ports);
check(!result.ok && writes === 1, "Replay cannot cancel twice");
result = await executeApprovedScheduleCommand(
  { kind: "approve", expectedVersion: 4, draft: {
    id: "untrusted", startDate: "2026-10-22", endDate: "2026-10-22",
    timeZone: "Europe/Lisbon", shifts: [],
  } }, ports
);
check(!result.ok && result.code === "storage_error" && environmentReads === 1 &&
  writes === 1, "Missing authoritative configuration must fail closed");
console.log("Trusted Approval Command Contract V0: todos os testes passaram.");
