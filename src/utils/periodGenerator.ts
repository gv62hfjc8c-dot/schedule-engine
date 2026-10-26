import type { PresenceAssignment } from "../types";
import {
  generateDaySchedule,
  type DayScheduleStatus,
  type GenerateDayScheduleInput,
} from "./dailyGenerator";
import type { PresenceShortage } from "./presence";

/**
 * A period is an inclusive set of consecutive CIVIL dates, evaluated in UTC
 * for iteration only (without imposing UTC time on local operating hours).
 * This V0 orchestrates independent daily schedules. It does not enforce
 * weekly quotas, inter-day rest, fairness or contract constraints.
 */
export const MAX_PERIOD_DAYS = 14;

export interface GeneratePeriodScheduleInput
  extends Omit<GenerateDayScheduleInput, "date"> {
  startDate: string;
  endDate: string;
}

/** A shift's civil date must always travel with the assignment. */
export interface DatedPresenceAssignment extends PresenceAssignment {
  date: string;
}

export interface PeriodDayDiagnostic {
  date: string;
  status: DayScheduleStatus;
  issues: string[];
  shortages: PresenceShortage[];
  exploredNodes: number;
  /** Only diagnostic; not a committed/approved period-wide schedule. */
  foundAssignments: number;
}

export type PeriodScheduleStatus =
  | "daily_complete"
  | "incomplete"
  | "invalid_input";

export interface GeneratePeriodScheduleResult {
  status: PeriodScheduleStatus;
  /** Declares the exact scope of validation; NOT a weekly feasibility proof. */
  validationScope: "daily_only";
  days: PeriodDayDiagnostic[];
  /**
   * Published only when ALL days are individually generated or closed.
   * If any date fails, this is empty even when other dates passed.
   */
  assignments: DatedPresenceAssignment[];
  issues: string[];
  generatedDays: number;
  closedDays: number;
  failedDays: number;
  exploredNodes: number;
}

function invalid(message: string): GeneratePeriodScheduleResult {
  return {
    status: "invalid_input",
    validationScope: "daily_only",
    days: [],
    assignments: [],
    issues: [message],
    generatedDays: 0,
    closedDays: 0,
    failedDays: 0,
    exploredNodes: 0,
  };
}

function parseCivilDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== value) {
    return null;
  }
  return parsed;
}

export function generatePeriodSchedule(
  input: GeneratePeriodScheduleInput
): GeneratePeriodScheduleResult {
  const start = parseCivilDate(input.startDate);
  const end = parseCivilDate(input.endDate);
  if (!start || !end) {
    return invalid("As datas inicial e final devem ser datas civis válidas (AAAA-MM-DD).");
  }

  const dayCount = Math.round(
    (end.getTime() - start.getTime()) / 86_400_000
  ) + 1;

  if (dayCount < 1) {
    return invalid("A data final não pode ser anterior à data inicial.");
  }
  if (dayCount > MAX_PERIOD_DAYS) {
    return invalid(
      `O período V0 suporta até ${MAX_PERIOD_DAYS} dias consecutivos.`
    );
  }

  const days: PeriodDayDiagnostic[] = [];
  const candidateAssignments: DatedPresenceAssignment[] = [];
  let generatedDays = 0;
  let closedDays = 0;
  let failedDays = 0;
  let exploredNodes = 0;

  for (let offset = 0; offset < dayCount; offset++) {
    const date = new Date(start.getTime() + offset * 86_400_000)
      .toISOString().slice(0, 10);

    const result = generateDaySchedule({ ...input, date });
    exploredNodes += result.exploredNodes;

    days.push({
      date,
      status: result.status,
      issues: result.issues,
      shortages: result.shortages,
      exploredNodes: result.exploredNodes,
      foundAssignments: result.assignments.length,
    });

    if (result.status === "generated") {
      generatedDays += 1;
      for (const assignment of result.assignments) {
        candidateAssignments.push({ date, ...assignment });
      }
    } else if (result.status === "closed") {
      closedDays += 1;
    } else {
      failedDays += 1;
    }
  }

  const complete = failedDays === 0;
  return {
    status: complete ? "daily_complete" : "incomplete",
    validationScope: "daily_only",
    days,
    // Atomic publication: diagnostics may show successes, but a partial
    // period is NEVER exposed as a ready-to-use sequence of shifts.
    assignments: complete ? candidateAssignments : [],
    issues: complete
      ? []
      : [`${failedDays} dia(s) sem horário diário validado. Não foi publicado um horário parcial.`],
    generatedDays,
    closedDays,
    failedDays,
    exploredNodes,
  };
}
