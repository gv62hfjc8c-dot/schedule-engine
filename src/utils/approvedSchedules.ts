import type {
  DatedWorkShift,
  OperatingCalendarConfiguration,
  Person,
  PersonAvailability,
  PresenceConfiguration,
  WorkConstraintConfiguration,
} from "../types";
import type { ConfirmedExternalWorkContext } from "./constrainedPeriodGenerator";
import {
  validateWorkConstraints,
  type WorkValidationDateRange,
  type WorkConstraintViolation,
} from "./workConstraints";
import { isSchedulableForInterval } from "./availability";
import { getOperatingIntervalsForDate, getWeekday } from "./operatingCalendar";
import { resolvePresenceForDate } from "./presence";
import { checkPresenceForWorkShifts } from "./workCoverage";
import { MAX_PERIOD_DAYS } from "./periodGenerator";

/**
 * P6.4: immutable approval ledger. One APPROVED record owns every civil date
 * in its period, including closed dates and days with zero assignments.
 * Cancelled/superseded records are historical, never active commitments.
 * Ledger completeness must be ATTESTED by a trusted repository/adapter.
 *
 * This module is in-memory and pure: no clock, storage, UI or Supabase.
 * Persistence will need an atomic compare-and-swap by ledger version.
 */
export type ApprovedScheduleStatus = "approved" | "cancelled" | "superseded";

export interface ApprovedScheduleRecord extends WorkValidationDateRange {
  id: string;
  status: ApprovedScheduleStatus;
  /** IANA zone in which the civil dates and shift clock times are defined. */
  timeZone: string;
  shifts: DatedWorkShift[];
  approvedAt: string;
  changedAt: string | null;
  replacementId: string | null;
  replacesId: string | null;
}

export interface ApprovedScheduleLedger {
  /** Incremented exactly once per successful approval/cancel/replacement. */
  version: number;
  timeZone: string;
  /** Complete knowledge of APPROVED commitments within these civil dates. */
  coverage: WorkValidationDateRange;
  /** Explicit attestation, not inferred from the length of records. */
  complete: boolean;
  records: ApprovedScheduleRecord[];
}

export interface ScheduleDraft extends WorkValidationDateRange {
  id: string;
  timeZone: string;
  shifts: DatedWorkShift[];
}

export interface ApprovalEnvironment {
  people: Person[];
  availabilities: PersonAvailability[];
  operatingCalendar: OperatingCalendarConfiguration;
  presence: PresenceConfiguration;
  workConstraints: WorkConstraintConfiguration;
}

/** Core mutations never throw for expected domain conflicts. */
export type ApprovalFailureCode =
  | "invalid_input"
  | "invalid_ledger"
  | "stale_version"
  | "incomplete_context"
  | "duplicate_id"
  | "period_occupied"
  | "schedule_not_approved"
  | "period_mismatch"
  | "operational_constraint"
  | "work_constraint";

export interface ApprovalFailure {
  code: ApprovalFailureCode;
  issues: string[];
  workViolations: WorkConstraintViolation[];
}

export type ApprovalMutationResult =
  | { ok: true; ledger: ApprovedScheduleLedger; record: ApprovedScheduleRecord; }
  | { ok: false; failure: ApprovalFailure; };

export interface ApprovalMutationBase {
  ledger: ApprovedScheduleLedger;
  expectedVersion: number;
  /** Explicit event instant; the core never invokes Date.now(). */
  at: string;
}

export interface ApproveScheduleInput extends ApprovalMutationBase {
  draft: ScheduleDraft;
  environment: ApprovalEnvironment;
}

export interface ReplaceScheduleInput extends ApproveScheduleInput {
  replaceId: string;
}

export interface CancelScheduleInput extends ApprovalMutationBase {
  scheduleId: string;
}

export type ApprovedContextStatus =
  | "ready" | "incomplete_context" | "target_occupied" | "invalid_input";

export interface ApprovedExternalContextResult {
  status: ApprovedContextStatus;
  requiredContext: WorkValidationDateRange | null;
  externalContext: ConfirmedExternalWorkContext | null;
  occupiedBy: string[];
  issues: string[];
}

/** No implicit "empty ledger means all employees have no work". */
export function createApprovedScheduleLedger(
  coverage: WorkValidationDateRange,
  timeZone: string,
  complete: boolean
): ApprovedScheduleLedger {
  return {
    version: 0, coverage: { ...coverage }, timeZone, complete, records: [],
  };
}

const DAY = 86_400_000;

function civil(value: string): number | null {
  if (typeof value !== "string" ||
      !/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) return null;
  const parsed = new Date(value + "T00:00:00Z");
  return Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
      ? null : parsed.getTime();
}

function dateRangeOK(range: WorkValidationDateRange): boolean {
  const start = civil(range?.startDate);
  const end = civil(range?.endDate);
  return start !== null && end !== null && start <= end;
}

function datesIn(range: WorkValidationDateRange): string[] {
  const start = civil(range.startDate);
  const end = civil(range.endDate);
  if (start === null || end === null) return [];
  const dates: string[] = [];
  for (let day = start; day <= end; day += DAY) {
    dates.push(new Date(day).toISOString().slice(0, 10));
  }
  return dates;
}

function rangesOverlap(
  first: WorkValidationDateRange,
  second: WorkValidationDateRange
): boolean {
  return first.startDate <= second.endDate &&
    second.startDate <= first.endDate;
}

function inside(date: string, range: WorkValidationDateRange): boolean {
  return date >= range.startDate && date <= range.endDate;
}

function cloneShift(shift: DatedWorkShift): DatedWorkShift {
  return {
    date: shift.date,
    personId: shift.personId,
    interval: { ...shift.interval },
    mealBreak: shift.mealBreak === null ? null : { ...shift.mealBreak },
  };
}

function cloneRecord(record: ApprovedScheduleRecord): ApprovedScheduleRecord {
  return {
    ...record,
    shifts: record.shifts.map(cloneShift),
  };
}

function copyLedger(
  ledger: ApprovedScheduleLedger,
  records: ApprovedScheduleRecord[]
): ApprovedScheduleLedger {
  return {
    version: ledger.version + 1,
    timeZone: ledger.timeZone,
    coverage: { ...ledger.coverage },
    complete: ledger.complete,
    records: records.map(cloneRecord),
  };
}

function failure(
  code: ApprovalFailureCode,
  issues: string[],
  workViolations: WorkConstraintViolation[] = []
): ApprovalMutationResult {
  return { ok: false, failure: { code, issues, workViolations } };
}

function validZone(zone: string): boolean {
  try {
    if (!zone?.trim()) return false;
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

function validInstant(value: string): boolean {
  return typeof value === "string" &&
    /^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?(?:Z|[+-]\\d{2}:\\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value));
}

/**
 * Structural integrity checks: do not trust caller-supplied repositories.
 * A complete ledger may have zero records; only its explicit completion
 * assertion can authorize interpreting that as absence of approved work.
 */
function ledgerIssues(ledger: ApprovedScheduleLedger): string[] {
  const issues: string[] = [];
  if (!ledger || !Number.isSafeInteger(ledger.version) ||
      ledger.version < 0 || !dateRangeOK(ledger.coverage) ||
      !validZone(ledger.timeZone) ||
      typeof ledger.complete !== "boolean" ||
      !Array.isArray(ledger.records)) {
    return ["Ledger de horários aprovados inválido."];
  }
  const ids = new Set<string>();
  const active: ApprovedScheduleRecord[] = [];
  for (const record of ledger.records) {
    if (!record || !record.id?.trim() || ids.has(record.id)) {
      issues.push("Identificador de horário duplicado ou inválido.");
      continue;
    }
    ids.add(record.id);
    if (!dateRangeOK(record) ||
        record.startDate < ledger.coverage.startDate ||
        record.endDate > ledger.coverage.endDate ||
        record.timeZone !== ledger.timeZone ||
        !validInstant(record.approvedAt) ||
        (record.changedAt !== null && !validInstant(record.changedAt)) ||
        !Array.isArray(record.shifts) ||
        !["approved", "cancelled", "superseded"].includes(record.status) ||
        (record.status === "approved" &&
          (record.changedAt !== null || record.replacementId !== null)) ||
        (record.status === "cancelled" &&
          (record.changedAt === null || record.replacementId !== null)) ||
        (record.status === "superseded" &&
          (record.changedAt === null || !record.replacementId?.trim())) ||
        (record.changedAt !== null &&
          Date.parse(record.changedAt) < Date.parse(record.approvedAt))) {
      issues.push("Metadados inconsistentes no horário " + record.id + ".");
      continue;
    }
    if (record.shifts.some(shift =>
      !shift?.personId?.trim() || !inside(shift.date, record) ||
      !shift.interval || !("mealBreak" in shift)
    )) {
      issues.push("Um turno não pertence ao período do horário " + record.id + ".");
    }
    if (record.status === "approved") active.push(record);
  }
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      if (rangesOverlap(active[i], active[j])) {
        issues.push(
          "Dois horários aprovados ocupam as mesmas datas: " +
          active[i].id + " e " + active[j].id + "."
        );
      }
    }
  }
  return issues;
}

/** Active shifts only, with copies to stop accidental mutation by callers. */
export function listApprovedShifts(ledger: ApprovedScheduleLedger): DatedWorkShift[] {
  return ledger.records
    .filter(record => record.status === "approved")
    .flatMap(record => record.shifts.map(cloneShift))
    .sort((a, b) =>
      a.date.localeCompare(b.date) ||
      a.personId.localeCompare(b.personId, "en") ||
      a.interval.start.localeCompare(b.interval.start)
    );
}

/**
 * Consult approved commitments to feed the P6.3 period generator. Every
 * day of the required exterior range must be within a COMPLETE ledger,
 * or the result is incomplete_context. Active schedules overlapping the
 * target period are rejected (the generator does not support fixed shifts).
 */
export function queryApprovedExternalContext(input: {
  ledger: ApprovedScheduleLedger;
  targetPeriod: WorkValidationDateRange;
  workConstraints: WorkConstraintConfiguration;
  timeZone: string;
}): ApprovedExternalContextResult {
  const issues = ledgerIssues(input.ledger);
  if (issues.length || !dateRangeOK(input.targetPeriod) ||
      input.timeZone !== input.ledger?.timeZone) {
    return {
      status: "invalid_input", requiredContext: null,
      externalContext: null, occupiedBy: [],
      issues: [...issues, ...(!dateRangeOK(input.targetPeriod)
        ? ["Período de consulta inválido."] : []),
        ...(input.timeZone !== input.ledger?.timeZone
          ? ["O fuso da consulta não coincide com o do ledger."] : [])],
    };
  }

  const probe = validateWorkConstraints({
    timeZone: input.timeZone,
    rules: input.workConstraints,
    targetPeriod: input.targetPeriod,
    knownSchedule: {
      startDate: input.targetPeriod.startDate,
      endDate: input.targetPeriod.endDate,
      complete: false,
      shifts: [],
    },
  });
  if (probe.status === "invalid_input" || !probe.requiredContext) {
    return {
      status: "invalid_input", requiredContext: null,
      externalContext: null, occupiedBy: [],
      issues: probe.issues,
    };
  }
  const required = probe.requiredContext;
  if (!input.ledger.complete ||
      input.ledger.coverage.startDate > required.startDate ||
      input.ledger.coverage.endDate < required.endDate) {
    return {
      status: "incomplete_context",
      requiredContext: { ...required },
      externalContext: null, occupiedBy: [],
      issues: [
        "O repositório não confirma todos os turnos aprovados entre " +
        required.startDate + " e " + required.endDate + ".",
      ],
    };
  }
  const occupiedBy = input.ledger.records.filter(record =>
    record.status === "approved" && rangesOverlap(record, input.targetPeriod)
  ).map(record => record.id).sort();
  if (occupiedBy.length) {
    return {
      status: "target_occupied",
      requiredContext: { ...required },
      externalContext: null, occupiedBy,
      issues: ["O período contém dias já pertencentes a horários aprovados."],
    };
  }
  const externalShifts = listApprovedShifts(input.ledger)
    .filter(shift => inside(shift.date, required));
  return {
    status: "ready",
    requiredContext: { ...required },
    externalContext: {
      ...required,
      completeOutsideTarget: true,
      shifts: externalShifts,
    },
    occupiedBy: [], issues: [],
  };
}

/** Check input and version BEFORE evaluating any proposal. */
function mutationPreflight(input: ApprovalMutationBase): ApprovalFailure | null {
  const issues = ledgerIssues(input.ledger);
  if (issues.length) return {
    code: "invalid_ledger", issues, workViolations: [],
  };
  if (!Number.isSafeInteger(input.expectedVersion) ||
      input.expectedVersion !== input.ledger.version) {
    return {
      code: "stale_version",
      issues: ["O ledger foi alterado; atualizar a versão antes de aprovar."],
      workViolations: [],
    };
  }
  if (!validInstant(input.at)) return {
    code: "invalid_input",
    issues: ["A operação exige um instante ISO 8601 explícito e válido."],
    workViolations: [],
  };
  if (!input.ledger.complete) return {
    code: "incomplete_context",
    issues: ["O ledger ainda não confirma a totalidade dos turnos conhecidos."],
    workViolations: [],
  };
  return null;
}

function validateDraft(
  ledger: ApprovedScheduleLedger,
  draft: ScheduleDraft,
  environment: ApprovalEnvironment,
  excludedApprovedId: string | null
): ApprovalFailure | null {
  if (!draft || !draft.id?.trim() || !dateRangeOK(draft) ||
      draft.timeZone !== ledger.timeZone ||
      !Array.isArray(draft.shifts)) {
    return {
      code: "invalid_input", issues: ["Identificador, datas, fuso ou turnos inválidos."],
      workViolations: [],
    };
  }
  if ((civil(draft.endDate)! - civil(draft.startDate)!) / DAY + 1 >
      MAX_PERIOD_DAYS) {
    return {
      code: "invalid_input",
      issues: ["A aprovação V0 suporta até " + MAX_PERIOD_DAYS + " dias."],
      workViolations: [],
    };
  }
  if (ledger.records.some(record => record.id === draft.id)) {
    return {
      code: "duplicate_id",
      issues: ["Um identificador de horário nunca pode ser reutilizado."],
      workViolations: [],
    };
  }

  const occupying = ledger.records.find(record =>
    record.status === "approved" && record.id !== excludedApprovedId &&
    rangesOverlap(record, draft)
  );
  if (occupying) return {
    code: "period_occupied",
    issues: ["O horário " + occupying.id + " já ocupa parte deste período."],
    workViolations: [],
  };

  const probe = validateWorkConstraints({
    timeZone: draft.timeZone,
    rules: environment?.workConstraints,
    targetPeriod: draft,
    knownSchedule: {
      startDate: draft.startDate,
      endDate: draft.endDate,
      complete: false,
      shifts: [],
    },
  });
  if (probe.status === "invalid_input" || !probe.requiredContext) {
    return {
      code: "invalid_input", issues: probe.issues,
      workViolations: [],
    };
  }
  const required = probe.requiredContext;
  if (ledger.coverage.startDate > required.startDate ||
      ledger.coverage.endDate < required.endDate) return {
    code: "incomplete_context",
    issues: [
      "Não há informação confirmada para " + required.startDate +
      " até " + required.endDate + ".",
    ],
    workViolations: [],
  };

  if (draft.shifts.some(shift =>
    !shift?.personId?.trim() || !inside(shift.date, draft)
  )) return {
    code: "invalid_input",
    issues: ["Um turno da proposta está fora do período ou não tem pessoa."],
    workViolations: [],
  };

  // Exact daily operating/availability/capacity constraints are rechecked.
  // The core does not trust a user-supplied "generated" boolean.
  if (!environment || !Array.isArray(environment.people) ||
      !Array.isArray(environment.availabilities) ||
      !environment.operatingCalendar || !environment.presence) return {
    code: "invalid_input",
    issues: ["Configuração operacional para aprovação incompleta."],
    workViolations: [],
  };

  const people = new Map(environment.people.map(p => [p.id, p]));
  const availability = new Map(
    environment.availabilities.map(entry => [entry.personId, entry])
  );
  if (people.size !== environment.people.length ||
      availability.size !== environment.availabilities.length ||
      environment.people.some(p => !p.id?.trim()) ||
      environment.availabilities.some(entry =>
        !people.has(entry.personId)
      )) return {
    code: "invalid_input",
    issues: ["Pessoas ou disponibilidades inconsistentes."],
    workViolations: [],
  };

  const problems: string[] = [];
  for (const date of datesIn(draft)) {
    const proposed = draft.shifts.filter(shift => shift.date === date);
    if (environment.operatingCalendar.exceptions.filter(
      exception => exception.date === date
    ).length > 1 || environment.presence.presenceExceptions.filter(
      exception => exception.date === date
    ).length > 1) {
      problems.push(date + ": exceções operacionais duplicadas.");
      continue;
    }
    let operating: ReturnType<typeof getOperatingIntervalsForDate>;
    let presence: ReturnType<typeof resolvePresenceForDate>;
    try {
      getWeekday(date);
      operating = getOperatingIntervalsForDate(
        date, environment.operatingCalendar.weeklyOperatingHours,
        environment.operatingCalendar.exceptions
      );
      presence = resolvePresenceForDate(
        date, environment.presence.weeklyPresenceRequirements,
        environment.presence.presenceExceptions,
        environment.operatingCalendar.weeklyOperatingHours,
        environment.operatingCalendar.exceptions
      );
    } catch {
      problems.push(date + ": calendário ou presença inválidos.");
      continue;
    }
    if (operating.length === 0) {
      if (proposed.length) {
        problems.push(date + ": o dia está fechado mas contém turnos.");
      }
      continue;
    }
    if (presence.status !== "configured") {
      problems.push(date + ": requisitos de presença não configurados.");
      continue;
    }
    for (const shift of proposed) {
      const person = people.get(shift.personId);
      const entry = availability.get(shift.personId);
      if (!person?.active || !entry) {
        problems.push(date + ": pessoa inativa ou sem disponibilidade " +
          shift.personId + ".");
        continue;
      }
      if (entry.exceptions.filter(exception =>
        exception.date === date
      ).length > 1 || !shift.interval ||
          !isSchedulableForInterval(
            date, shift.interval, entry,
            environment.operatingCalendar.weeklyOperatingHours,
            environment.operatingCalendar.exceptions
          )) {
        problems.push(date + ": turno fora da disponibilidade de " +
          shift.personId + ".");
      }
    }
    const coverage = checkPresenceForWorkShifts(
      date, operating, presence.requirements, proposed
    );
    if (!coverage.valid) problems.push(
      date + ": cobertura insuficiente ou intervalos inválidos. " +
      coverage.issues.join(" ")
    );
  }
  if (problems.length) return {
    code: "operational_constraint", issues: problems, workViolations: [],
  };

  const activeShifts = listApprovedShifts(ledger).filter(shift => {
    if (!excludedApprovedId) return true;
    const source = ledger.records.find(record =>
      record.id === excludedApprovedId
    );
    return !source || !inside(shift.date, source);
  });

  const work = validateWorkConstraints({
    timeZone: ledger.timeZone,
    rules: environment.workConstraints,
    targetPeriod: draft,
    knownSchedule: {
      ...ledger.coverage,
      complete: true,
      shifts: [...activeShifts, ...draft.shifts],
    },
  });
  if (work.status !== "valid") return {
    code: work.status === "incomplete_context"
      ? "incomplete_context" : "work_constraint",
    issues: work.issues.length ? work.issues :
      ["A proposta viola regras obrigatórias de trabalho."],
    workViolations: work.violations,
  };
  return null;
}

function commitDraft(
  input: ApproveScheduleInput,
  replaced: ApprovedScheduleRecord | null
): ApprovalMutationResult {
  const issue = mutationPreflight(input);
  if (issue) return { ok: false, failure: issue };

  const validation = validateDraft(
    input.ledger, input.draft, input.environment, replaced?.id ?? null
  );
  if (validation) return { ok: false, failure: validation };

  const record: ApprovedScheduleRecord = {
    id: input.draft.id,
    status: "approved",
    startDate: input.draft.startDate,
    endDate: input.draft.endDate,
    timeZone: input.draft.timeZone,
    shifts: input.draft.shifts.map(cloneShift),
    approvedAt: input.at,
    changedAt: null,
    replacementId: null,
    replacesId: replaced?.id ?? null,
  };
  const newRecords = input.ledger.records.map(old => (
    replaced && old.id === replaced.id
      ? {
        ...old,
        status: "superseded" as const,
        changedAt: input.at,
        replacementId: record.id,
      }
      : old
  ));
  newRecords.push(record);
  const next = copyLedger(input.ledger, newRecords);
  return { ok: true, ledger: next, record: cloneRecord(record) };
}

export function approveSchedule(
  input: ApproveScheduleInput
): ApprovalMutationResult {
  return commitDraft(input, null);
}

/**
 * Atomic replacement: validate NEW schedule against all OTHER approved
 * commitments BEFORE superseding old. Dates must match exactly in V0;
 * widening/reducing a period requires an explicit future model.
 */
export function replaceApprovedSchedule(
  input: ReplaceScheduleInput
): ApprovalMutationResult {
  const issue = mutationPreflight(input);
  if (issue) return { ok: false, failure: issue };
  const source = input.ledger.records.find(record =>
    record.id === input.replaceId && record.status === "approved"
  );
  if (!source) return failure(
    "schedule_not_approved", ["O horário a substituir não está aprovado."]
  );
  if (source.startDate !== input.draft?.startDate ||
      source.endDate !== input.draft?.endDate) return failure(
    "period_mismatch",
    ["A substituição V0 exige exatamente o mesmo período civil."]
  );
  if (Date.parse(input.at) < Date.parse(source.approvedAt)) return failure(
    "invalid_input", ["A substituição não pode anteceder a aprovação."]
  );
  return commitDraft(input, source);
}

/**
 * Cancellation is NOT a new validated schedule: it removes commitments
 * and leaves the dates uncovered/unassigned until another approval.
 */
export function cancelApprovedSchedule(
  input: CancelScheduleInput
): ApprovalMutationResult {
  const issue = mutationPreflight(input);
  if (issue) return { ok: false, failure: issue };
  const source = input.ledger.records.find(record =>
    record.id === input.scheduleId && record.status === "approved"
  );
  if (!source) return failure(
    "schedule_not_approved", ["O horário já está inativo ou não existe."]
  );
  if (Date.parse(input.at) < Date.parse(source.approvedAt)) return failure(
    "invalid_input", ["O cancelamento não pode anteceder a aprovação."]
  );
  const cancelled: ApprovedScheduleRecord = {
    ...source, status: "cancelled",
    changedAt: input.at,
  };
  const records = input.ledger.records.map(record =>
    record.id === source.id ? cancelled : record
  );
  return {
    ok: true,
    ledger: copyLedger(input.ledger, records),
    record: cloneRecord(cancelled),
  };
}
