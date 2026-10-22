import type { Pessoa, Schedule, ShiftId } from "../types";

const SHIFT_ORDER: ShiftId[] = ["A", "B", "C"];

function selectShift(
  pessoa: Pessoa,
  baseShiftIndex: number
): ShiftId | null {
  if (pessoa.eligibleShiftIds === undefined) {
    return SHIFT_ORDER[baseShiftIndex];
  }

  for (let offset = 0; offset < SHIFT_ORDER.length; offset++) {
    const candidateShift =
      SHIFT_ORDER[(baseShiftIndex + offset) % SHIFT_ORDER.length];

    if (pessoa.eligibleShiftIds.includes(candidateShift)) {
      return candidateShift;
    }
  }

  return null;
}

export function generateSchedule(
  pessoas: Pessoa[],
  weekStart: string
): Schedule {
  const schedule: Schedule = {};

  for (let personIndex = 0; personIndex < pessoas.length; personIndex++) {
    const pessoa = pessoas[personIndex];
    const baseShiftIndex = personIndex % SHIFT_ORDER.length;
    const shift = selectShift(pessoa, baseShiftIndex);

    // Hard constraints must not be knowingly violated by the generator.
    // If no eligible shift exists, leave the person unscheduled so the
    // independent validator can report the schedule as incomplete.
    if (shift === null) {
      continue;
    }

    for (let dayOffset = 0; dayOffset < 5; dayOffset++) {
      const date = new Date(`${weekStart}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + dayOffset);

      const dateKey = date.toISOString().slice(0, 10);
      const scheduleKey = `${pessoa.id}::${dateKey}`;

      schedule[scheduleKey] = {
        shift,
      };
    }
  }

  return schedule;
}
