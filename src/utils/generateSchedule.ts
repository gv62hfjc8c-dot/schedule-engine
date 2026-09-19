import type { Pessoa, Schedule, ShiftId } from "../types";

const SHIFT_ORDER: ShiftId[] = ["A", "B", "C"];

export function generateSchedule(
  pessoas: Pessoa[],
  weekStart: string
): Schedule {
  const schedule: Schedule = {};

  for (let personIndex = 0; personIndex < pessoas.length; personIndex++) {
    const pessoa = pessoas[personIndex];
    const baseShiftIndex = personIndex % SHIFT_ORDER.length;

      let shift = SHIFT_ORDER[baseShiftIndex];

      if (pessoa.eligibleShiftIds !== undefined) {
        for (let offset = 0; offset < SHIFT_ORDER.length; offset++) {
          const candidateShift =
            SHIFT_ORDER[(baseShiftIndex + offset) % SHIFT_ORDER.length];

          if (pessoa.eligibleShiftIds.includes(candidateShift)) {
            shift = candidateShift;
            break;
          }
        }
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