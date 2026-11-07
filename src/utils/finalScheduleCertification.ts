import type { DatedWorkShift } from "../types";
import type { GenerateConstrainedPeriodInput } from "./constrainedPeriodGenerator";
import { getOperatingIntervalsForDate } from "./operatingCalendar";
import { isSchedulableForInterval, getSchedulableIntervalsForDate } from "./availability";
import { resolvePresenceForDate } from "./presence";
import { checkPresenceForWorkShifts } from "./workCoverage";
import { validateWorkConstraints, type WorkConstraintViolation } from "./workConstraints";
import { isExplicitRequiredWorkday, validatePersonWeeklyContractCaps } from "./personSchedulingPolicies";

export interface FinalScheduleCertification {
  valid: boolean;
  issues: string[];
  workViolations: WorkConstraintViolation[];
}

/**
 * Independent last gate AFTER all search and optimization stages.
 * Neither a proposal nor an optimizer is trusted to certify its own output.
 * This checks the complete period, including dates without assignments.
 */
export function certifyFinalGeneratedSchedule(
  input: GenerateConstrainedPeriodInput,
  assignments: DatedWorkShift[],
): FinalScheduleCertification {
  const issues: string[] = [];
  const activeIds = new Set(input.people.filter(p => p.active).map(p => p.id));
  const seen = new Set<string>();
  const byDay = new Map<string, DatedWorkShift[]>();
  for (const shift of assignments) {
    if (shift.date < input.startDate || shift.date > input.endDate) {
      issues.push("O resultado contém um turno fora do período gerado.");
      continue;
    }
    const key = shift.date + "|" + shift.personId;
    if (seen.has(key)) issues.push("Há turnos duplicados para " + key + ".");
    seen.add(key);
    if (!activeIds.has(shift.personId))
      issues.push("Foi atribuída uma pessoa inexistente ou inativa: " + shift.personId + ".");
    const availability = input.availabilities.find(a => a.personId === shift.personId);
    if (!availability || !isSchedulableForInterval(
      shift.date, shift.interval, availability,
      input.operatingCalendar.weeklyOperatingHours,
      input.operatingCalendar.exceptions,
    )) issues.push("Turno fora da disponibilidade para " + key + ".");
    byDay.set(shift.date, [...(byDay.get(shift.date) ?? []), shift]);
  }

  const start = Date.parse(input.startDate + "T00:00:00Z");
  const end = Date.parse(input.endDate + "T00:00:00Z");
  for (let day = start; day <= end; day += 86_400_000) {
    const date = new Date(day).toISOString().slice(0, 10);
    const operating = getOperatingIntervalsForDate(
      date, input.operatingCalendar.weeklyOperatingHours,
      input.operatingCalendar.exceptions,
    );
    const shifts = byDay.get(date) ?? [];
    if (!operating.length) {
      if (shifts.length) issues.push(date + ": turno num dia encerrado.");
      if (input.people.some(p=>p.active && isExplicitRequiredWorkday(p,date)))
        issues.push(date + ": dia obrigatório configurado para operação encerrada.");
      continue;
    }
    const presence = resolvePresenceForDate(
      date, input.presence.weeklyPresenceRequirements,
      input.presence.presenceExceptions,
      input.operatingCalendar.weeklyOperatingHours,
      input.operatingCalendar.exceptions,
    );
    if (presence.status !== "configured") {
      issues.push(date + ": mínimos de cobertura não configurados ou inválidos.");
      continue;
    }
    const coverage = checkPresenceForWorkShifts(date, operating, presence.requirements, shifts);
    if (!coverage.valid) issues.push(date + ": " + coverage.issues.join(" "));
    for (const person of input.people.filter(p => p.active)) {
      const availability = input.availabilities.find(a => a.personId === person.id);
      const allowed = availability ? getSchedulableIntervalsForDate(
        date, availability, input.operatingCalendar.weeklyOperatingHours,
        input.operatingCalendar.exceptions,
      ) : [];
      const required = isExplicitRequiredWorkday(person,date) ||
        (input.workRules.requireShiftsOnAvailableDays && allowed.length>0);
      if (required && !shifts.some(s => s.personId === person.id))
        issues.push(date + ": falta o turno obrigatório de " + person.id + ".");
    }
    const shortLimit = input.workRules.fullShortDayMaximumMinutes ?? 0;
    if (shortLimit > 0 && operating.length === 1) {
      const minutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
      const duration = minutes(operating[0].end) - minutes(operating[0].start);
      if (duration > 0 && duration <= shortLimit) {
        for (const shift of shifts) {
          if (shift.interval.start !== operating[0].start ||
              shift.interval.end !== operating[0].end)
            issues.push(date + ": jornada integral de dia curto incumprida.");
        }
      }
    }
  }

  const work = validateWorkConstraints({
    timeZone: input.timeZone, rules: input.workConstraints,
    targetPeriod: {startDate: input.startDate, endDate: input.endDate},
    knownSchedule: {
      startDate: input.externalContext.startDate,
      endDate: input.externalContext.endDate,
      complete: input.externalContext.completeOutsideTarget,
      shifts: [...input.externalContext.shifts, ...assignments],
    },
  });
  if (work.status !== "valid")
    issues.push(...work.issues, ...work.violations.map(v => v.message),
      "A validação final das regras de trabalho não foi concluída com sucesso.");
  const contractual=validatePersonWeeklyContractCaps(
    input.people,[...input.externalContext.shifts,...assignments],
    input.workConstraints.maximumWeeklyEffectiveMinutes,
    input.timeZone,input.startDate,input.endDate);
  if (!contractual.valid) issues.push(...contractual.issues);

  return { valid: issues.length === 0, issues, workViolations: work.violations };
}
