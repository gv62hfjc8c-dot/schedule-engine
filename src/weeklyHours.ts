/** Phase 1 contract: every active person owes exactly 40 work hours each week. */
export const REQUIRED_WEEKLY_MINUTES=2400 as const; // 40 h × 60 min

export type WeeklyHoursBalance=
  | {kind:"exact";requiredMinutes:2400;actualMinutes:number;differenceMinutes:0}
  | {kind:"missing"|"excess";requiredMinutes:2400;actualMinutes:number;differenceMinutes:number};

/** Comparisons are always per complete Monday–Sunday week, never per cycle total. */
export function compareWeeklyHours(actualMinutes:number):WeeklyHoursBalance {
  if(!Number.isSafeInteger(actualMinutes) || actualMinutes<0)
    throw new Error("Minutos trabalhados inválidos.");
  const differenceMinutes=actualMinutes-REQUIRED_WEEKLY_MINUTES;
  if(differenceMinutes===0)
    return {kind:"exact",requiredMinutes:REQUIRED_WEEKLY_MINUTES,
      actualMinutes,differenceMinutes:0};
  return {
    kind:differenceMinutes<0?"missing":"excess",
    requiredMinutes:REQUIRED_WEEKLY_MINUTES,
    actualMinutes,differenceMinutes,
  };
}
