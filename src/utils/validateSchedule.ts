import type {
  Pessoa,
  Schedule,
  ValidationResult,
} from "../types";
import { SHIFTS } from "./shifts";

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);

  return hours * 60 + minutes;
}

export function validateSchedule(
  pessoas: Pessoa[],
  schedule: Schedule,
  weekStart: string
): ValidationResult {
  const errors: string[] = [];

  for (const pessoa of pessoas) {
    let expectedShift: string | null = null;
    let weeklyEffectiveMinutes = 0;

    for (let dayOffset = 0; dayOffset < 5; dayOffset++) {
      const date = new Date(`${weekStart}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + dayOffset);

      const dateKey = date.toISOString().slice(0, 10);
      const scheduleKey = `${pessoa.id}::${dateKey}`;
      const cell = schedule[scheduleKey];

      if (!cell) {
        errors.push(`${scheduleKey}: célula em falta`);
        continue;
      }

      const shiftDefinition = SHIFTS.find(
        (shift) => shift.id === cell.shift
      );

      if (!shiftDefinition) {
        errors.push(`${scheduleKey}: turno ${cell.shift} inexistente`);
        continue;
      }

      if (
        pessoa.eligibleShiftIds !== undefined &&
        !pessoa.eligibleShiftIds.includes(cell.shift)
      ) {
        errors.push(
          `${scheduleKey}: turno ${cell.shift} não elegível para ${pessoa.id}`
        );
      }

      const totalMinutes =
        timeToMinutes(shiftDefinition.exit) -
        timeToMinutes(shiftDefinition.entry);

      const lunchMinutes =
        timeToMinutes(shiftDefinition.lunchEnd) -
        timeToMinutes(shiftDefinition.lunchStart);

      const effectiveMinutes = totalMinutes - lunchMinutes;

      weeklyEffectiveMinutes += effectiveMinutes;

      if (effectiveMinutes !== 480) {
        errors.push(
          `${scheduleKey}: turno ${cell.shift} tem ${effectiveMinutes} minutos efetivos, esperado 480`
        );
      }

      if (expectedShift === null) {
        expectedShift = cell.shift;
        continue;
      }

      if (cell.shift !== expectedShift) {
        errors.push(
          `${scheduleKey}: esperado turno ${expectedShift}, recebido ${cell.shift}`
        );
      }
    }

    if (weeklyEffectiveMinutes !== 2400) {
      errors.push(
        `${pessoa.id}: total semanal de ${weeklyEffectiveMinutes} minutos, esperado 2400`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}