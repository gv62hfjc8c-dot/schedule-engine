import type {
  DatedWorkShift,
  PresenceRequirement,
  TimeInterval,
} from "../types";
import { getWeekday } from "./operatingCalendar";
import {
  checkPresenceForWorkingIntervals,
  type PersonWorkingIntervals,
  type PresenceCheckResult,
} from "./presence";
import { getEffectiveWorkIntervals } from "./workConstraints";
import { isShiftWithinOperation } from "./workRules";

/**
 * P6.3 coverage adapter: the attendance span is NOT a coverage interval
 * while the person is taking a meal. Structural shifts are converted
 * into separate actual working segments, retaining one person identity.
 *
 * Reuses the exact P5 opening/central/closing coverage logic. This
 * is COVERAGE ONLY: a true result does not certify that the meal has
 * the mandatory duration/placement, or verify rest, daily/weekly hours,
 * availability, contracts, or the completeness of external assignments.
 *
 * Call validateWorkConstraints independently before approving a period.
 * Legacy generators remain unchanged and are NOT P6.3 certified yet.
 */
export function checkPresenceForWorkShifts(
  date: string,
  operatingIntervals: TimeInterval[],
  requirements: PresenceRequirement,
  shifts: DatedWorkShift[]
): PresenceCheckResult {
  try {
    getWeekday(date);
  } catch {
    return {
      valid: false,
      issues: ["Data civil inválida para validar cobertura."],
      shortages: [],
    };
  }

  const issues: string[] = [];
  const seen = new Set<string>();
  const working: PersonWorkingIntervals[] = [];

  for (const shift of shifts) {
    if (shift.date !== date) {
      issues.push(
        `O turno de ${shift.personId} pertence a ${shift.date}, não a ${date}.`
      );
    }
    if (!shift.personId.trim()) {
      issues.push("Um turno não tem identificador de pessoa.");
    } else if (seen.has(shift.personId)) {
      issues.push(`A pessoa ${shift.personId} tem mais de um turno no dia.`);
    }
    seen.add(shift.personId);

    const intervals = getEffectiveWorkIntervals(shift);
    if (!intervals) {
      issues.push(`O turno ou a refeição de ${shift.personId} é inválido.`);
      continue;
    }
    if (!isShiftWithinOperation(shift.interval, operatingIntervals)) {
      issues.push(
        `O turno de ${shift.personId} ultrapassa um período operacional contínuo.`
      );
      continue;
    }
    working.push({ personId: shift.personId, intervals });
  }

  if (issues.length > 0) {
    return { valid: false, issues, shortages: [] };
  }
  return checkPresenceForWorkingIntervals(
    operatingIntervals,
    requirements,
    working
  );
}
