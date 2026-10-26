import type { WorkConstraintConfiguration } from "../types";
import type {
  ConfirmedExternalWorkContext,
} from "./constrainedPeriodGenerator";
import {
  validateWorkConstraints,
  type WorkValidationDateRange,
} from "./workConstraints";

/**
 * The current application stores CONFIGURATION, not approved shifts.
 * It must never interpret missing shift persistence as "no assigned work".
 *
 * This minimal UI adapter only supports a narrowly declared scenario:
 * the operator explicitly confirms that NO OTHER shifts exist outside the
 * target period over the full context needed for weekly/rest rules.
 *
 * A future provider of known external shifts should replace this adapter;
 * the scheduling engine itself already accepts real external assignments.
 */
export interface EmptyExternalContextDeclaration
  extends WorkValidationDateRange {
  timeZone: string;
  rules: WorkConstraintConfiguration;
  confirmedNoExternalShifts: boolean;
}

export interface EmptyContextPreparation {
  status: "ready" | "requires_confirmation" | "invalid_input";
  requiredContext: WorkValidationDateRange | null;
  externalContext: ConfirmedExternalWorkContext | null;
  issues: string[];
}

export function prepareExplicitEmptyContext(
  input: EmptyExternalContextDeclaration
): EmptyContextPreparation {
  const result = validateWorkConstraints({
    timeZone: input.timeZone,
    rules: input.rules,
    targetPeriod: {
      startDate: input.startDate,
      endDate: input.endDate,
    },
    // Explicitly INCOMPLETE: this probe merely determines the exact
    // required date range and checks rules, dates and the IANA zone.
    knownSchedule: {
      startDate: input.startDate,
      endDate: input.endDate,
      complete: false,
      shifts: [],
    },
  });

  if (result.status === "invalid_input" || !result.requiredContext) {
    return {
      status: "invalid_input",
      requiredContext: null,
      externalContext: null,
      issues: result.issues.length
        ? result.issues
        : ["Não foi possível determinar o contexto obrigatório."],
    };
  }

  if (!input.confirmedNoExternalShifts) {
    return {
      status: "requires_confirmation",
      requiredContext: result.requiredContext,
      externalContext: null,
      issues: [
        "O motor não conhece turnos já atribuídos fora do período. "
          + "Não é possível certificar o horário sem confirmar o contexto.",
      ],
    };
  }

  return {
    status: "ready",
    requiredContext: result.requiredContext,
    externalContext: {
      ...result.requiredContext,
      completeOutsideTarget: true,
      shifts: [],
    },
    issues: [],
  };
}
