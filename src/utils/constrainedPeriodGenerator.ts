import type { DatedWorkShift, TimeInterval, WorkConstraintConfiguration } from "../types";
import {employedOn,validateEmploymentPeriods} from "./employmentPeriods";
import {
  searchMealAwareDaySchedule,
  type GenerateMealAwareDayInput,
  type MealAwareSearchBudget,
} from "./mealAwareDayGenerator";
import {
  validateWorkConstraints,
  type WorkConstraintViolation,
  type WorkValidationDateRange,
} from "./workConstraints";
import type { PresenceShortage } from "./presence";
import type { DayScheduleStatus } from "./dailyGenerator";
/** The constrained engine certifies cross-day, weekly and monthly boundaries. */
export const MAX_CONSTRAINED_PERIOD_DAYS=28;
import { getOperatingIntervalsForDate } from "./operatingCalendar";
import { getSchedulableIntervalsForDate, isSchedulableForInterval } from "./availability";
import { checkPresenceForWorkShifts } from "./workCoverage";
import { certifyFinalGeneratedSchedule } from "./finalScheduleCertification";
import {
  personWeeklyHardMax, personWeeklyTarget, validatePeopleSchedulingPolicies,
  validatePersonWeeklyContractCaps, isExplicitRequiredWorkday, missingRequiredOutsideWorkdays,
} from "./personSchedulingPolicies";
import { resolvePresenceForDate } from "./presence";
import { provenWeeklyCapacityShortage } from "./weeklyCapacityPrecheck";

/**
 * A caller must explicitly attest that all assignments AND confirmed
 * non-working dates OUTSIDE the generated period are known within this
 * date interval. The engine fills the target period itself; a list of
 * external shifts alone NEVER proves it is complete.
 */
export interface ConfirmedExternalWorkContext extends WorkValidationDateRange {
  completeOutsideTarget: boolean;
  shifts: DatedWorkShift[];
}

export interface GenerateConstrainedPeriodInput
  extends Omit<GenerateMealAwareDayInput, "date"> {
  startDate: string;
  endDate: string;
  externalContext: ConfirmedExternalWorkContext;
  /** Authoritative active approved periods: the generator must not plan over them. */
  protectedApprovedPeriods?: WorkValidationDateRange[];
  /**
   * Global search budget, not a fresh daily budget. The default is 50k
   * explored nodes for ALL dates and rejected/backtracked alternatives.
   */
  maxSearchNodes?: number;
}

export type ConstrainedPeriodStatus =
  | "generated"
  | "incomplete"
  | "incomplete_context"
  | "invalid_input"
  | "search_limit";

export interface ConstrainedPeriodDayDiagnostic {
  date: string;
  /** Null means this day could not be reached during bounded search. */
  lastDailyStatus: DayScheduleStatus | null;
  attempts: number;
  rejectedByWorkRules: number;
  foundAssignments: number;
  issues: string[];
  shortages: PresenceShortage[];
}

export interface GenerateConstrainedPeriodResult {
  status: ConstrainedPeriodStatus;
  /** Only status=generated certifies both work rules and daily coverage. */
  validationScope: "period_work_and_coverage_when_generated";
  assignments: DatedWorkShift[];
  days: ConstrainedPeriodDayDiagnostic[];
  issues: string[];
  requiredContext: WorkValidationDateRange | null;
  workViolations: WorkConstraintViolation[];
  exploredNodes: number;
  rejectedByWorkRules: number;
}

const DAY = 86_400_000;
const DEFAULT_GLOBAL_MAX_NODES = 50_000;

function civilDate(value: string): number | null {
  if (typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
    ? null : date.getTime();
}

function dayString(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

function isWithin(day: string, startDate: string, endDate: string): boolean {
  return day >= startDate && day <= endDate;
}

function resultWith(
  status: ConstrainedPeriodStatus,
  issues: string[],
  days: ConstrainedPeriodDayDiagnostic[] = [],
  requiredContext: WorkValidationDateRange | null = null,
  workViolations: WorkConstraintViolation[] = [],
  exploredNodes = 0,
  rejectedByWorkRules = 0
): GenerateConstrainedPeriodResult {
  return {
    status,
    validationScope: "period_work_and_coverage_when_generated",
    assignments: [],
    days,
    issues,
    requiredContext,
    workViolations,
    exploredNodes,
    rejectedByWorkRules,
  };
}


/**
 * Improvement phase after a certified feasible period. Extend existing
 * attendance spans on the 15-minute grid while preserving ALL hard rules.
 * Never removes coverage or assignments. This is a bounded local improvement,
 * NOT a proof of globally optimal hours.
 */
function improveWeeklyHours(
  input: GenerateConstrainedPeriodInput,
  base: DatedWorkShift[],
  external: DatedWorkShift[],
  knownStart: string,
  knownEnd: string
): DatedWorkShift[] {
  const schedule = base.map(s => ({
    ...s, interval: { ...s.interval },
    mealBreak: s.mealBreak ? { ...s.mealBreak } : null,
  }));
  const mins = (value: string) => {
    const [h, m] = value.split(":").map(Number);
    return h * 60 + m;
  };
  const time = (value: number) =>
    `${String(Math.floor(value / 60)).padStart(2,"0")}:${String(value % 60).padStart(2,"0")}`;
  const effective = (s: DatedWorkShift) =>
    mins(s.interval.end) - mins(s.interval.start) -
      (s.mealBreak ? mins(s.mealBreak.end) - mins(s.mealBreak.start) : 0);
  const weeklyLimit = input.workConstraints.maximumWeeklyEffectiveMinutes;
  const meal = input.workConstraints.mealBreak;
  const profile = (id:string) => input.people.find(p=>p.id===id)!;
  const hardMax = (id:string) => personWeeklyHardMax(profile(id),weeklyLimit);
  const targetMax = (id:string) => personWeeklyTarget(profile(id),weeklyLimit);
  const weeks = (date: string) => {
    const d = new Date(date + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - (d.getUTCDay()+6)%7);
    return d.toISOString().slice(0,10);
  };
  const dateValid = (date: string) => {
    const operation = getOperatingIntervalsForDate(date,
      input.operatingCalendar.weeklyOperatingHours,
      input.operatingCalendar.exceptions);
    const presence = resolvePresenceForDate(date,
      input.presence.weeklyPresenceRequirements,
      input.presence.presenceExceptions,
      input.operatingCalendar.weeklyOperatingHours,
      input.operatingCalendar.exceptions);
    return presence.status === "configured" &&
      checkPresenceForWorkShifts(date, operation, presence.requirements,
        schedule.filter(s => s.date === date), input.people).valid;
  };
  const valid = (date: string) =>
    dateValid(date) &&
    validateWorkConstraints({
      timeZone: input.timeZone,
      rules: input.workConstraints,
      targetPeriod: { startDate: input.startDate, endDate: input.endDate },
      knownSchedule: {
        startDate: knownStart, endDate: knownEnd, complete: true,
        shifts: [...external, ...schedule],
      },
    }).status === "valid" &&
    validatePersonWeeklyContractCaps(input.people,[...external,...schedule],
      input.workConstraints.maximumWeeklyEffectiveMinutes,input.timeZone,
      input.startDate,input.endDate).valid;

  // Aim for the weekly cap in this experiment. Bound candidate evaluation
  // to prevent unbounded work outside the backtracking budget.
  let evaluations = 0;
  for (let round = 0; round < 2; round++) {
    let changed = false;
    for (let i = schedule.length - 1; i >= 0; i--) {
      const original = schedule[i];
      const personHours = schedule.filter(s =>
        s.personId === original.personId && weeks(s.date) === weeks(original.date)
      ).reduce((n,s) => n + effective(s),0) +
        external.filter(s => s.personId === original.personId &&
          weeks(s.date) === weeks(original.date)).reduce((n,s)=>n+effective(s),0);
      const availableHours = Math.min(
        targetMax(original.personId) - personHours,
        hardMax(original.personId) - personHours,
        input.workConstraints.maximumDailyEffectiveMinutes - effective(original));
      if (availableHours < 15) continue;
      const availability = input.availabilities.find(a =>
        a.personId === original.personId);
      if (!availability) continue;
      const earliest = Math.max(0, mins(original.interval.start) - availableHours);
      const latest = Math.min(1440, mins(original.interval.end) + availableHours);
      const proposals: DatedWorkShift[] = [];
      for (let start = Math.ceil(earliest/15)*15;
        start <= mins(original.interval.start); start += 15) {
        for (let end = Math.ceil(mins(original.interval.end)/15)*15;
          end <= latest; end += 15) {
          const duration = end - start;
          if (duration <= mins(original.interval.end)-mins(original.interval.start)) continue;
          const limit = Math.min(
            targetMax(original.personId) - personHours + effective(original),
            hardMax(original.personId) - personHours + effective(original),
            input.workConstraints.maximumDailyEffectiveMinutes);
          if (duration <= meal.requiredAboveEffectiveMinutes && duration <= limit) {
            proposals.push({...original, interval:{start:time(start),end:time(end)},mealBreak:null});
          }
          const work = duration - meal.durationMinutes;
          if (work > meal.requiredAboveEffectiveMinutes && work <= limit) {
            for (let offset = meal.earliestStartAfterWorkMinutes;
              offset <= Math.min(meal.latestStartAfterWorkMinutes, work - 1);
              offset += 15) {
              proposals.push({...original,
                interval:{start:time(start),end:time(end)},
                mealBreak:{start:time(start+offset),
                  end:time(start+offset+meal.durationMinutes)}});
            }
          }
        }
      }
      proposals.sort((a,b) => effective(b)-effective(a));
      let selected: DatedWorkShift | null = null;
      for (const proposed of proposals) {
        if (++evaluations > 12000) break;
        if (!isSchedulableForInterval(original.date,proposed.interval,
          availability,input.operatingCalendar.weeklyOperatingHours,
          input.operatingCalendar.exceptions)) continue;
        schedule[i] = proposed;
        if (valid(original.date) && satisfiesFullShortDayPolicy(input,schedule)) { selected = proposed; break; }
      }
      schedule[i] = selected ?? original;
      if (selected) changed = true;
    }
    if (!changed || evaluations > 12000) break;
  }

  // P6.3 PR #26: fill missing person-days only after extending existing
  // shifts. Every extra candidate is checked against availability, daily
  // coverage and the COMPLETE work schedule, including external shifts.
  // Prefer the largest usable effective duration without claiming optimality.
  const dates: string[] = [];
  for (let day = Date.parse(input.endDate + "T00:00:00Z");
    day >= Date.parse(input.startDate + "T00:00:00Z"); day -= DAY) {
    dates.push(new Date(day).toISOString().slice(0, 10));
  }
  let extraEvaluations = 0;
  const maxExtraEvaluations = 12000;
  // Keep the experimental near-full-week scope; unlike the earlier
  // implementation, candidates can fill ANY free day, not only trailing days.
  // Try the largest weekly deficit first to avoid favoring the people already
  // nearest 40 hours. Every accepted shift passes the full independent validator.
  for (const date of dates.length >= 5 ? dates : []) {
    if (extraEvaluations >= maxExtraEvaluations) break;
    const operation = getOperatingIntervalsForDate(date,
      input.operatingCalendar.weeklyOperatingHours,
      input.operatingCalendar.exceptions);
    const candidates = input.people.filter(p => p.active).sort((a, b) => {
      const total = (id: string) => [...schedule, ...external]
        .filter(shift => shift.personId === id && weeks(shift.date) === weeks(date))
        .reduce((n, shift) => n + effective(shift), 0);
      const deficit=(p: typeof a) => Math.max(0,targetMax(p.id)-total(p.id));
      return deficit(b)-deficit(a) || total(a.id)-total(b.id) || a.id.localeCompare(b.id);
    });
    for (const person of candidates) {
      if (extraEvaluations >= maxExtraEvaluations) break;
      if (schedule.some(s => s.date === date && s.personId === person.id)) continue;
      const availability = input.availabilities.find(a => a.personId === person.id);
      if (!availability) continue;
      const personHours = [...schedule, ...external].filter(s =>
        s.personId === person.id && weeks(s.date) === weeks(date)
      ).reduce((total, shift) => total + effective(shift), 0);
      const remaining = Math.min(
        targetMax(person.id) - personHours,
        hardMax(person.id) - personHours,
        input.workConstraints.maximumDailyEffectiveMinutes);
      if (remaining < 15) continue;
      let added = false;
      for (const period of operation) {
        if (added || extraEvaluations >= maxExtraEvaluations) break;
        const open = mins(period.start);
        const close = mins(period.end);
        const maxEffective = Math.min(remaining, close - open);
        for (let work = Math.floor(maxEffective / 15) * 15;
          work >= 15 && !added && extraEvaluations < maxExtraEvaluations; work -= 15) {
          const needsMeal = work > meal.requiredAboveEffectiveMinutes;
          const span = work + (needsMeal ? meal.durationMinutes : 0);
          if (span > close - open) continue;
          for (let start = open; start + span <= close && !added &&
            extraEvaluations < maxExtraEvaluations; start += 15) {
            const mealOffsets = needsMeal
              ? Array.from({length: Math.max(0, Math.floor(
                  (Math.min(meal.latestStartAfterWorkMinutes, work - 1) -
                    meal.earliestStartAfterWorkMinutes) / 15) + 1)},
                  (_, i) => meal.earliestStartAfterWorkMinutes + 15*i)
              : [0];
            for (const offset of mealOffsets) {
              if (++extraEvaluations > maxExtraEvaluations) break;
              const candidate: DatedWorkShift = {
                date, personId: person.id,
                interval: {start: time(start), end: time(start + span)},
                mealBreak: needsMeal
                  ? {start: time(start + offset),
                    end: time(start + offset + meal.durationMinutes)}
                  : null,
              };
              if (!isSchedulableForInterval(date, candidate.interval,
                availability, input.operatingCalendar.weeklyOperatingHours,
                input.operatingCalendar.exceptions)) continue;
              schedule.push(candidate);
              if (valid(date) && satisfiesFullShortDayPolicy(input,schedule)) {added = true; break;}
              schedule.pop();
            }
          }
        }
      }
    }
  }
  return schedule;
}


/**
 * PR #27: improve weekday regularity without spending or removing weekly
 * effective minutes. Paired transfers keep each person's weekly hours fixed.
 * Every proposed pair is checked by the independent COMPLETE validator.
 * Bounded local search, not a proof of optimality.
 */
function regularizeWeekdayShifts(
  input: GenerateConstrainedPeriodInput,
  initial: DatedWorkShift[],
  external: DatedWorkShift[],
  contextStart: string,
  contextEnd: string
): DatedWorkShift[] {
  const result = initial.map(s => ({
    ...s, interval: {...s.interval},
    mealBreak: s.mealBreak ? {...s.mealBreak} : null,
  }));
  const minutes = (value: string) => {
    const [h, m] = value.split(":").map(Number);
    return h * 60 + m;
  };
  const clock = (value: number) =>
    `${String(Math.floor(value/60)).padStart(2,"0")}:${String(value%60).padStart(2,"0")}`;
  const effective = (s: DatedWorkShift) => minutes(s.interval.end) -
    minutes(s.interval.start) -
    (s.mealBreak ? minutes(s.mealBreak.end)-minutes(s.mealBreak.start) : 0);
  const monday = (date: string) => {
    const d = new Date(date+"T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - (d.getUTCDay()+6)%7);
    return d.toISOString().slice(0,10);
  };
  // Balance comparable full-operation days, including Saturdays if long
  // enough. Short operating days (e.g. Sunday 5h) are intentionally excluded.
  const weekday = (date: string) => {
    const duration = input.workRules.standardShiftDurationMinutes ?? 480;
    const meal = input.workConstraints.mealBreak;
    const requiredSpan = duration +
      (duration > meal.requiredAboveEffectiveMinutes ? meal.durationMinutes : 0);
    const operation = getOperatingIntervalsForDate(date,
      input.operatingCalendar.weeklyOperatingHours,
      input.operatingCalendar.exceptions);
    return operation.some(interval =>
      minutes(interval.end)-minutes(interval.start) >= requiredSpan);
  };
  const meal = input.workConstraints.mealBreak;
  const variants = (shift: DatedWorkShift, work: number): DatedWorkShift[] => {
    if (work < 15 || work > input.workConstraints.maximumDailyEffectiveMinutes) return [];
    const requiredMeal = work > meal.requiredAboveEffectiveMinutes;
    const span = work + (requiredMeal ? meal.durationMinutes : 0);
    const oldStart = minutes(shift.interval.start);
    const oldEnd = minutes(shift.interval.end);
    const proposedStarts = new Set([oldStart, oldEnd-span]);
    const choices: DatedWorkShift[] = [];
    for (const start of proposedStarts) {
      if (start < 0 || start+span > 1440) continue;
      const offsets = requiredMeal ? [
        ...new Set([
          shift.mealBreak ? minutes(shift.mealBreak.start)-oldStart : NaN,
          ...Array.from({length:Math.floor(
            (meal.latestStartAfterWorkMinutes-meal.earliestStartAfterWorkMinutes)/15
          )+1},(_,k)=>meal.earliestStartAfterWorkMinutes+15*k),
        ]),
      ] : [0];
      for (const offset of offsets) {
        if (requiredMeal && (!Number.isFinite(offset) ||
          offset < meal.earliestStartAfterWorkMinutes ||
          offset > meal.latestStartAfterWorkMinutes ||
          offset >= work)) continue;
        choices.push({
          ...shift,
          interval:{start:clock(start),end:clock(start+span)},
          mealBreak: requiredMeal
            ? {start:clock(start+offset),end:clock(start+offset+meal.durationMinutes)}
            : null,
        });
      }
    }
    return choices;
  };
  let probes = 0;
  for (const person of input.people.filter(p=>p.active)) {
    const availability = input.availabilities.find(a=>a.personId===person.id);
    if (!availability) continue;
    const personWeeks = new Set(result.filter(s=>
      s.personId===person.id && weekday(s.date)).map(s=>monday(s.date)));
    for (const week of personWeeks) {
      for (let round=0;round<40 && probes<4000;round++) {
        const indices = result.map((s,i)=>({s,i})).filter(x=>
          x.s.personId===person.id && monday(x.s.date)===week && weekday(x.s.date));
        if (indices.length<2) break;
        const ascending = [...indices].sort((a,b)=>
          effective(a.s)-effective(b.s) || a.s.date.localeCompare(b.s.date));
        const short=ascending[0], long=ascending[ascending.length-1];
        if (effective(long.s)-effective(short.s)<30) break;
        const desiredShort=effective(short.s)+15;
        const desiredLong=effective(long.s)-15;
        const originalShort=result[short.i], originalLong=result[long.i];
        let improved=false;
        for (const small of variants(originalShort,desiredShort)) {
          if (!isSchedulableForInterval(small.date,small.interval,availability,
            input.operatingCalendar.weeklyOperatingHours,
            input.operatingCalendar.exceptions)) continue;
          result[short.i]=small;
          for (const large of variants(originalLong,desiredLong)) {
            if (++probes>4000) break;
            if (!isSchedulableForInterval(large.date,large.interval,availability,
              input.operatingCalendar.weeklyOperatingHours,
              input.operatingCalendar.exceptions)) continue;
            result[long.i]=large;
            const coverageOk=[short.s.date,long.s.date].every(date=>{
              const operating=getOperatingIntervalsForDate(date,
                input.operatingCalendar.weeklyOperatingHours,
                input.operatingCalendar.exceptions);
              const presence=resolvePresenceForDate(date,
                input.presence.weeklyPresenceRequirements,
                input.presence.presenceExceptions,
                input.operatingCalendar.weeklyOperatingHours,
                input.operatingCalendar.exceptions);
              return presence.status==="configured" &&
                checkPresenceForWorkShifts(date,operating,presence.requirements,
                  result.filter(s=>s.date===date), input.people).valid;
            });
            if (coverageOk && validateWorkConstraints({
              timeZone:input.timeZone, rules:input.workConstraints,
              targetPeriod:{startDate:input.startDate,endDate:input.endDate},
              knownSchedule:{startDate:contextStart,endDate:contextEnd,
                complete:true,shifts:[...external,...result]},
            }).status==="valid") {
              improved=true;
              break;
            }
          }
          if (improved || probes>=4000) break;
          result[long.i]=originalLong;
        }
        if (!improved) {
          result[short.i]=originalShort;
          result[long.i]=originalLong;
          break;
        }
      }
    }
  }
  return result;
}

/**
 * Preserve dominant weekday clock patterns when a same-duration shift can
 * be moved without reducing effective hours. Only candidates satisfying
 * availability, coverage, meals and the complete known schedule are accepted.
 * No changed start time is treated as a hard rule.
 */
function alignWeekdayClockPatterns(
  input: GenerateConstrainedPeriodInput,
  original: DatedWorkShift[],
  external: DatedWorkShift[],
  contextStart: string,
  contextEnd: string
): DatedWorkShift[] {
  const schedule = original.map(s => ({
    ...s, interval: {...s.interval},
    mealBreak: s.mealBreak ? {...s.mealBreak} : null,
  }));
  const minute = (v: string) => Number(v.slice(0,2))*60 + Number(v.slice(3,5));
  const clock = (v: number) => String(Math.floor(v/60)).padStart(2,"0") +
    ":" + String(v%60).padStart(2,"0");
  const monday = (date: string) => {
    const d = new Date(date+"T00:00:00Z");
    d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);
    return d.toISOString().slice(0,10);
  };
  // Compare shift patterns on any sufficiently long operating day.
  // A short Sunday does not distort the expected starts of full workdays.
  const isWeekday = (date: string) => {
    const standard = input.workRules.standardShiftDurationMinutes ?? 480;
    const meal = input.workConstraints.mealBreak;
    const span = standard + (standard > meal.requiredAboveEffectiveMinutes
      ? meal.durationMinutes : 0);
    return getOperatingIntervalsForDate(date,
      input.operatingCalendar.weeklyOperatingHours,
      input.operatingCalendar.exceptions).some(interval =>
      minute(interval.end)-minute(interval.start)>=span);
  };
  let evaluations = 0;
  for (const person of input.people.filter(p=>p.active)) {
    const availability = input.availabilities.find(a=>a.personId===person.id);
    if (!availability) continue;
    const weeks = new Set(schedule.filter(s=>s.personId===person.id &&
      isWeekday(s.date)).map(s=>monday(s.date)));
    for (const week of weeks) {
      const indices = schedule.map((shift,i)=>({shift,i})).filter(x=>
        x.shift.personId===person.id && isWeekday(x.shift.date) &&
        monday(x.shift.date)===week);
      if (indices.length < 3) continue;
      const starts = new Map<number,number>();
      for (const item of indices) {
        const start = minute(item.shift.interval.start);
        starts.set(start,(starts.get(start)??0)+1);
      }
      const dominant = [...starts.entries()].sort((a,b)=>
        b[1]-a[1] || a[0]-b[0])[0];
      if (!dominant || dominant[1]<2) continue;
      for (const {i} of indices) {
        if (++evaluations > 3000) return schedule;
        const current = schedule[i];
        if (minute(current.interval.start)===dominant[0]) continue;
        const span = minute(current.interval.end)-minute(current.interval.start);
        // Try matching the dominant start first. If not possible, try
        // progressively closer quarter-hour starts, never increasing the
        // deviation from that person's usual clock time.
        const currentStart = minute(current.interval.start);
        const distance = Math.abs(currentStart-dominant[0]);
        const sign = currentStart>dominant[0]?1:-1;
        const alternatives = Array.from({
          length: Math.floor(distance/15)
        },(_,k)=>dominant[0]+sign*k*15);
        const meal = current.mealBreak;
        let accepted=false;
        for (const start of alternatives) {
          const end=start+span;
          if(start<0||end>1440) continue;
          const offsets = meal ? [
            minute(meal.start)-currentStart,
            ...Array.from({length: Math.floor(
              (input.workConstraints.mealBreak.latestStartAfterWorkMinutes-
                input.workConstraints.mealBreak.earliestStartAfterWorkMinutes)/15)+1},
              (_,k)=>input.workConstraints.mealBreak.earliestStartAfterWorkMinutes+k*15),
          ] : [0];
          for (const offset of [...new Set(offsets)]) {
            if (++evaluations>3000) return schedule;
            const next: DatedWorkShift = {
              ...current, interval:{start:clock(start),end:clock(end)},
              mealBreak: meal?{start:clock(start+offset),
                end:clock(start+offset+input.workConstraints.mealBreak.durationMinutes)}:null,
            };
            if (!isSchedulableForInterval(current.date,next.interval,
              availability,input.operatingCalendar.weeklyOperatingHours,
              input.operatingCalendar.exceptions)) continue;
            schedule[i]=next;
            const operating=getOperatingIntervalsForDate(current.date,
              input.operatingCalendar.weeklyOperatingHours,
              input.operatingCalendar.exceptions);
            const presence=resolvePresenceForDate(current.date,
              input.presence.weeklyPresenceRequirements,
              input.presence.presenceExceptions,
              input.operatingCalendar.weeklyOperatingHours,
              input.operatingCalendar.exceptions);
            const coverageOk=presence.status==="configured" &&
              checkPresenceForWorkShifts(current.date,operating,presence.requirements,
                schedule.filter(s=>s.date===current.date), input.people).valid;
            const workOk=coverageOk && validateWorkConstraints({
              timeZone:input.timeZone,rules:input.workConstraints,
              targetPeriod:{startDate:input.startDate,endDate:input.endDate},
              knownSchedule:{startDate:contextStart,endDate:contextEnd,
                complete:true,shifts:[...external,...schedule]},
            }).status==="valid";
            if (workOk) {accepted=true;break;}
            schedule[i]=current;
          }
          if(accepted)break;
        }
      }
    }
  }
  return schedule;
}

/**
 * Repair coupled weekday inversions. A single move may violate opening or
 * closing coverage, while simultaneously exchanging two shifts preserves it.
 * Only equal-span exchanges are considered; effective hours never change.
 */
function repairSwappedWeekdayStarts(
  input: GenerateConstrainedPeriodInput,
  original: DatedWorkShift[],
  external: DatedWorkShift[],
  contextStart: string,
  contextEnd: string
): DatedWorkShift[] {
  const result = original.map(s=>({...s,interval:{...s.interval},
    mealBreak:s.mealBreak?{...s.mealBreak}:null}));
  const mins=(v:string)=>Number(v.slice(0,2))*60+Number(v.slice(3,5));
  const time=(v:number)=>String(Math.floor(v/60)).padStart(2,"0")+":"+
    String(v%60).padStart(2,"0");
  const week=(date:string)=>{
    const d=new Date(date+"T00:00:00Z");
    d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);
    return d.toISOString().slice(0,10);
  };
  const weekday=(date:string)=>(new Date(date+"T00:00:00Z").getUTCDay()+6)%7<5;
  const dominant=new Map<string,number>();
  for(const person of input.people.filter(p=>p.active)){
    const weeks=new Set(result.filter(s=>s.personId===person.id&&weekday(s.date))
      .map(s=>week(s.date)));
    for(const w of weeks){
      const starts=new Map<number,number>();
      for(const shift of result.filter(s=>s.personId===person.id&&
        weekday(s.date)&&week(s.date)===w)){
        const start=mins(shift.interval.start);
        starts.set(start,(starts.get(start)??0)+1);
      }
      const top=[...starts.entries()].sort((a,b)=>b[1]-a[1]||a[0]-b[0])[0];
      if(top && top[1]>=2)dominant.set(person.id+"|"+w,top[0]);
    }
  }
  const mealRule=input.workConstraints.mealBreak;
  const variants=(shift:DatedWorkShift,start:number):DatedWorkShift[]=>{
    const span=mins(shift.interval.end)-mins(shift.interval.start);
    if(start<0||start+span>1440)return [];
    const base={...shift,interval:{start:time(start),end:time(start+span)}};
    if(!shift.mealBreak)return [{...base,mealBreak:null}];
    const offsets=[720-start,780-start,840-start,
      mins(shift.mealBreak.start)-mins(shift.interval.start)];
    for(let offset=mealRule.earliestStartAfterWorkMinutes;
      offset<=mealRule.latestStartAfterWorkMinutes;offset+=15)offsets.push(offset);
    return [...new Set(offsets)].filter(offset=>
      offset>=mealRule.earliestStartAfterWorkMinutes&&
      offset<=mealRule.latestStartAfterWorkMinutes&&
      offset+mealRule.durationMinutes<=span).map(offset=>({
        ...base,mealBreak:{start:time(start+offset),
          end:time(start+offset+mealRule.durationMinutes)},
      }));
  };
  let checks=0;
  for(const date of [...new Set(result.map(s=>s.date))].filter(weekday)){
    const day=result.map((s,i)=>({s,i})).filter(x=>x.s.date===date);
    let repaired=false;
    for(let a=0;a<day.length&&!repaired;a++){
      for(let b=a+1;b<day.length&&!repaired;b++){
        const left=day[a],right=day[b];
        const targetLeft=dominant.get(left.s.personId+"|"+week(date));
        const targetRight=dominant.get(right.s.personId+"|"+week(date));
        if(targetLeft===undefined||targetRight===undefined||
          targetLeft!==mins(right.s.interval.start)||
          targetRight!==mins(left.s.interval.start)||
          targetLeft===mins(left.s.interval.start))continue;
        const spanLeft=mins(left.s.interval.end)-mins(left.s.interval.start);
        const spanRight=mins(right.s.interval.end)-mins(right.s.interval.start);
        if(spanLeft!==spanRight)continue;
        const availabilityLeft=input.availabilities.find(x=>x.personId===left.s.personId);
        const availabilityRight=input.availabilities.find(x=>x.personId===right.s.personId);
        if(!availabilityLeft||!availabilityRight)continue;
        const leftOptions=variants(left.s,targetLeft);
        const rightOptions=variants(right.s,targetRight);
        for(const first of leftOptions){
          if(repaired||checks>=1500)break;
          if(!isSchedulableForInterval(date,first.interval,availabilityLeft,
            input.operatingCalendar.weeklyOperatingHours,
            input.operatingCalendar.exceptions))continue;
          for(const second of rightOptions){
            if(++checks>1500)break;
            if(!isSchedulableForInterval(date,second.interval,availabilityRight,
              input.operatingCalendar.weeklyOperatingHours,
              input.operatingCalendar.exceptions))continue;
            result[left.i]=first;result[right.i]=second;
            const operation=getOperatingIntervalsForDate(date,
              input.operatingCalendar.weeklyOperatingHours,
              input.operatingCalendar.exceptions);
            const presence=resolvePresenceForDate(date,
              input.presence.weeklyPresenceRequirements,
              input.presence.presenceExceptions,
              input.operatingCalendar.weeklyOperatingHours,
              input.operatingCalendar.exceptions);
            const coverage=presence.status==="configured"&&
              checkPresenceForWorkShifts(date,operation,presence.requirements,
                result.filter(s=>s.date===date), input.people).valid;
            const valid=coverage&&validateWorkConstraints({
              timeZone:input.timeZone,rules:input.workConstraints,
              targetPeriod:{startDate:input.startDate,endDate:input.endDate},
              knownSchedule:{startDate:contextStart,endDate:contextEnd,
                complete:true,shifts:[...external,...result]},
            }).status==="valid";
            if(valid){repaired=true;break;}
            result[left.i]=left.s;result[right.i]=right.s;
          }
        }
        if(!repaired){result[left.i]=left.s;result[right.i]=right.s;}
      }
    }
  }
  return result;
}

/**
 * Clock regularity sometimes needs two simultaneous moves: moving an outlier
 * earlier can remove late coverage, whereas a smaller compensating late
 * start by a colleague can maintain it. This bounded search only accepts an
 * overall decrease in weekly clock-time deviation and independently validates
 * all mandatory rules. It never changes effective hours or days worked.
 */
export function improveCoupledWeeklyClockPatterns(
  input: GenerateConstrainedPeriodInput,
  original: DatedWorkShift[],
  external: DatedWorkShift[],
  contextStart: string,
  contextEnd: string
): DatedWorkShift[] {
  let schedule=original.map(s=>({...s,interval:{...s.interval},
    mealBreak:s.mealBreak?{...s.mealBreak}:null}));
  const minute=(v:string)=>Number(v.slice(0,2))*60+Number(v.slice(3,5));
  const clock=(v:number)=>String(Math.floor(v/60)).padStart(2,"0")+":"+
    String(v%60).padStart(2,"0");
  const week=(date:string)=>{
    const d=new Date(date+"T00:00:00Z");
    d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);
    return d.toISOString().slice(0,10);
  };
  const comparable=(date:string)=>{
    const standard=input.workRules.standardShiftDurationMinutes??480;
    const meal=input.workConstraints.mealBreak;
    const span=standard+(standard>meal.requiredAboveEffectiveMinutes?
      meal.durationMinutes:0);
    return getOperatingIntervalsForDate(date,
      input.operatingCalendar.weeklyOperatingHours,
      input.operatingCalendar.exceptions).some(i=>
      minute(i.end)-minute(i.start)>=span);
  };
  const groups=(shifts:DatedWorkShift[])=>{
    const map=new Map<string,number[]>();
    for(const s of shifts.filter(s=>comparable(s.date))){
      const key=s.personId+"|"+week(s.date);
      map.set(key,[...(map.get(key)??[]),minute(s.interval.start)]);
    }
    return map;
  };
  const clockCost=(shifts:DatedWorkShift[]):number=>{
    let cost=0;
    for(const starts of groups(shifts).values()){
      if(starts.length<2)continue;
      const sorted=[...starts].sort((a,b)=>a-b);
      const median=sorted[Math.floor(sorted.length/2)];
      cost+=sorted.reduce((total,v)=>total+Math.abs(v-median),0);
    }
    return cost;
  };
  const dominant=(shifts:DatedWorkShift[],shift:DatedWorkShift):number|null=>{
    const starts=groups(shifts).get(shift.personId+"|"+week(shift.date));
    if(!starts||starts.length<2)return null;
    const sorted=[...starts].sort((a,b)=>a-b);
    return sorted[Math.floor(sorted.length/2)];
  };
  const mealRule=input.workConstraints.mealBreak;
  const versions=(s:DatedWorkShift,start:number):DatedWorkShift[]=>{
    const length=minute(s.interval.end)-minute(s.interval.start);
    if(start<0||start+length>1440)return [];
    const interval={start:clock(start),end:clock(start+length)};
    if(!s.mealBreak)return [{...s,interval,mealBreak:null}];
    const candidates=[720,780,840,
      minute(s.mealBreak.start),
      start+minute(s.mealBreak.start)-minute(s.interval.start)];
    const variants:DatedWorkShift[]=[];
    for(const lunch of [...new Set(candidates)]){
      const offset=lunch-start;
      if(offset<mealRule.earliestStartAfterWorkMinutes||
        offset>mealRule.latestStartAfterWorkMinutes||
        lunch+mealRule.durationMinutes>start+length)continue;
      variants.push({...s,interval,mealBreak:{
        start:clock(lunch),end:clock(lunch+mealRule.durationMinutes)}});
    }
    return variants;
  };
  const validated=(trial:DatedWorkShift[],date:string)=>{
    const op=getOperatingIntervalsForDate(date,
      input.operatingCalendar.weeklyOperatingHours,
      input.operatingCalendar.exceptions);
    const presence=resolvePresenceForDate(date,
      input.presence.weeklyPresenceRequirements,
      input.presence.presenceExceptions,
      input.operatingCalendar.weeklyOperatingHours,
      input.operatingCalendar.exceptions);
    return presence.status==="configured"&&
      checkPresenceForWorkShifts(date,op,presence.requirements,
        trial.filter(s=>s.date===date), input.people).valid &&
      validateWorkConstraints({
        timeZone:input.timeZone,rules:input.workConstraints,
        targetPeriod:{startDate:input.startDate,endDate:input.endDate},
        knownSchedule:{startDate:contextStart,endDate:contextEnd,
          complete:true,shifts:[...external,...trial]},
      }).status==="valid";
  };
  let probes=0;
  const limit=2600;
  for(let round=0;round<2&&probes<limit;round++){
    let improved=false;
    const baseline=clockCost(schedule);
    for(let i=0;i<schedule.length&&probes<limit;i++){
      const originalA=schedule[i];
      if(!comparable(originalA.date))continue;
      const preferred=dominant(schedule,originalA);
      const initial=minute(originalA.interval.start);
      if(preferred===null||preferred===initial)continue;
      const step=preferred<initial?-15:15;
      let best=baseline;
      let selected:DatedWorkShift[]|null=null;
      const date=originalA.date;
      const availabilityA=input.availabilities.find(a=>a.personId===originalA.personId);
      if(!availabilityA)continue;
      for(let start=preferred;
        step<0?start<initial:start>initial;
        start-=step){
        if(probes>=limit)break;
        for(const first of versions(originalA,start)){
          if(!isSchedulableForInterval(date,first.interval,availabilityA,
            input.operatingCalendar.weeklyOperatingHours,
            input.operatingCalendar.exceptions))continue;
          for(let j=0;j<schedule.length&&probes<limit;j++){
            const other=schedule[j];
            if(j===i||other.date!==date||other.personId===originalA.personId)
              continue;
            const availabilityB=input.availabilities.find(a=>a.personId===other.personId);
            if(!availabilityB)continue;
            const oldStart=minute(other.interval.start);
            // A smaller opposite move can compensate closing/opening
            // coverage, without merely transferring the same irregularity.
            for(let offset=15;offset<=135&&probes<limit;offset+=15){
              const nextStart=oldStart-(step<0?-offset:offset);
              for(const second of versions(other,nextStart)){
                if(!isSchedulableForInterval(date,second.interval,availabilityB,
                  input.operatingCalendar.weeklyOperatingHours,
                  input.operatingCalendar.exceptions))continue;
                const trial=[...schedule];trial[i]=first;trial[j]=second;
                const cost=clockCost(trial);
                if(cost>=best)continue;
                probes++;
                if(!validated(trial,date))continue;
                best=cost;selected=trial;
              }
            }
          }
        }
      }
      if(selected){schedule=selected;improved=true;break;}
    }
    if(!improved)break;
  }
  return schedule;
}

/**
 * Soft meal preference after all assignments are generated. Repositioning a
 * meal never changes effective hours or the shift span. Every candidate must
 * satisfy the independent work validator and daily coverage validator.
 *
 * Preferred starts: 12:00, 13:00, 14:00. These are NOT hard constraints:
 * a legal meal outside these starts remains preferable to an invalid shift.
 */
function staggerPreferredMeals(
  input: GenerateConstrainedPeriodInput,
  original: DatedWorkShift[],
  external: DatedWorkShift[],
  contextStart: string,
  contextEnd: string
): DatedWorkShift[] {
  const schedule = original.map(s => ({
    ...s, interval: {...s.interval},
    mealBreak: s.mealBreak ? {...s.mealBreak} : null,
  }));
  const minute = (v: string) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5));
  const clock = (v: number) => String(Math.floor(v / 60)).padStart(2, "0") +
    ":" + String(v % 60).padStart(2, "0");
  const mealRules = input.workConstraints.mealBreak;
  const overlap = (a: DatedWorkShift, b: DatedWorkShift): number => {
    if (!a.mealBreak || !b.mealBreak || a.date !== b.date) return 0;
    return Math.max(0, Math.min(minute(a.mealBreak.end), minute(b.mealBreak.end)) -
      Math.max(minute(a.mealBreak.start), minute(b.mealBreak.start)));
  };
  const preferred = [720, 780, 840];
  const penalty = (index: number): number => {
    const current = schedule[index];
    if (!current.mealBreak) return 0;
    const start = minute(current.mealBreak.start);
    const distance = Math.min(...preferred.map(p => Math.abs(start - p)));
    const collisions = schedule.reduce((total, other, i) =>
      total + (i === index ? 0 : overlap(current, other)), 0);
    // Outside 12:00–14:00 is less desirable than some overlap inside it.
    // Both are soft objectives: mandatory staffing/meal rules always win.
    const outside = start < preferred[0]
      ? preferred[0] - start
      : Math.max(0, start - preferred[preferred.length-1]);
    const outsidePenalty = outside > 0 ? 480 + outside * 6 : 0;
    return collisions * 2 + distance / 2 + outsidePenalty;
  };
  let checks = 0;
  for (let round = 0; round < 3 && checks < 3000; round++) {
    let changed = false;
    for (let i = 0; i < schedule.length && checks < 3000; i++) {
      const shift = schedule[i];
      if (!shift.mealBreak) continue;
      const old = shift.mealBreak;
      let best = penalty(i);
      let chosen = old;
      const start = minute(shift.interval.start);
      const end = minute(shift.interval.end);
      // Existing hard rules determine legal offsets. Keep 15m resolution.
      for (let offset = mealRules.earliestStartAfterWorkMinutes;
        offset <= mealRules.latestStartAfterWorkMinutes && checks < 3000;
        offset += 15) {
        const proposedStart = start + offset;
        const proposedEnd = proposedStart + mealRules.durationMinutes;
        if (proposedEnd > end || proposedStart < start) continue;
        schedule[i] = {...shift, mealBreak:{
          start:clock(proposedStart), end:clock(proposedEnd),
        }};
        const score = penalty(i);
        if (score >= best) continue;
        checks++;
        const date = shift.date;
        const operation = getOperatingIntervalsForDate(date,
          input.operatingCalendar.weeklyOperatingHours,
          input.operatingCalendar.exceptions);
        const presence = resolvePresenceForDate(date,
          input.presence.weeklyPresenceRequirements,
          input.presence.presenceExceptions,
          input.operatingCalendar.weeklyOperatingHours,
          input.operatingCalendar.exceptions);
        const coverageOk = presence.status === "configured" &&
          checkPresenceForWorkShifts(date, operation, presence.requirements,
            schedule.filter(s => s.date === date), input.people).valid;
        const workOk = coverageOk && validateWorkConstraints({
          timeZone:input.timeZone, rules:input.workConstraints,
          targetPeriod:{startDate:input.startDate,endDate:input.endDate},
          knownSchedule:{startDate:contextStart,endDate:contextEnd,
            complete:true,shifts:[...external,...schedule]},
        }).status === "valid";
        if (workOk) {best = score;chosen = schedule[i].mealBreak!;}
      }
      schedule[i] = {...shift,mealBreak:chosen};
      if (chosen !== old) changed = true;
    }
    if (!changed) break;
  }
  return schedule;
}

/**
 * Weekly meal consistency is a soft objective, not a fixed lunch constraint.
 * Prefer the same meal start for the same person on comparable working days,
 * while also preferring 12:00/13:00/14:00 and avoiding simultaneous meals.
 *
 * A whole person's week can be tested as one candidate, which avoids
 * getting trapped in day-by-day decisions. Single-day and coupled swaps
 * provide bounded fallback moves. EVERY accepted change is independently
 * checked against complete work constraints and actual daily coverage.
 */
export function stabilizeWeeklyMealPatterns(
  input: GenerateConstrainedPeriodInput,
  original: DatedWorkShift[],
  external: DatedWorkShift[],
  contextStart: string,
  contextEnd: string
): DatedWorkShift[] {
  let schedule = original.map(s=>({...s,interval:{...s.interval},
    mealBreak:s.mealBreak?{...s.mealBreak}:null}));
  const rule = input.workConstraints.mealBreak;
  const minute=(v:string)=>Number(v.slice(0,2))*60+Number(v.slice(3,5));
  const clock=(n:number)=>String(Math.floor(n/60)).padStart(2,"0")+":"+
    String(n%60).padStart(2,"0");
  const week=(date:string)=>{
    const d=new Date(date+"T00:00:00Z");
    d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);
    return d.toISOString().slice(0,10);
  };
  const key=(s:DatedWorkShift)=>s.personId+"|"+week(s.date);
  const preferred=[720,780,840];
  const overlaps=(a:DatedWorkShift,b:DatedWorkShift):number=>{
    if(!a.mealBreak||!b.mealBreak||a.date!==b.date)return 0;
    return Math.max(0,Math.min(minute(a.mealBreak.end),minute(b.mealBreak.end))-
      Math.max(minute(a.mealBreak.start),minute(b.mealBreak.start)));
  };
  const score=(shifts:DatedWorkShift[]):number=>{
    const grouped=new Map<string,number[]>();
    let cost=0;
    for(const shift of shifts){
      if(!shift.mealBreak)continue;
      const start=minute(shift.mealBreak.start);
      const group=key(shift);
      grouped.set(group,[...(grouped.get(group)??[]),start]);
      const outside=Math.max(0,720-start,start-840);
      if(outside>0)cost+=480+outside*6;
      cost+=Math.min(...preferred.map(p=>Math.abs(start-p)))/2;
    }
    for(const starts of grouped.values()){
      if(starts.length<2)continue;
      // Median minimizes total absolute deviation. Weekly consistency is
      // deliberately more important than small collision improvements.
      const sorted=[...starts].sort((a,b)=>a-b);
      const median=sorted[Math.floor(sorted.length/2)];
      cost+=12*starts.reduce((sum,n)=>sum+Math.abs(n-median),0);
    }
    for(let i=0;i<shifts.length;i++)
      for(let j=i+1;j<shifts.length;j++)
        cost+=2*overlaps(shifts[i],shifts[j]);
    return cost;
  };
  const mealAt=(shift:DatedWorkShift,start:number):DatedWorkShift|null=>{
    if(!shift.mealBreak)return null;
    const shiftStart=minute(shift.interval.start);
    const shiftEnd=minute(shift.interval.end);
    const offset=start-shiftStart;
    if(offset<rule.earliestStartAfterWorkMinutes ||
      offset>rule.latestStartAfterWorkMinutes ||
      start+rule.durationMinutes>shiftEnd)return null;
    return {...shift,mealBreak:{start:clock(start),
      end:clock(start+rule.durationMinutes)}};
  };
  const valid=(trial:DatedWorkShift[],changedDates:string[]):boolean=>{
    for(const date of new Set(changedDates)){
      const op=getOperatingIntervalsForDate(date,
        input.operatingCalendar.weeklyOperatingHours,
        input.operatingCalendar.exceptions);
      const presence=resolvePresenceForDate(date,
        input.presence.weeklyPresenceRequirements,
        input.presence.presenceExceptions,
        input.operatingCalendar.weeklyOperatingHours,
        input.operatingCalendar.exceptions);
      if(presence.status!=="configured"||
        !checkPresenceForWorkShifts(date,op,presence.requirements,
          trial.filter(s=>s.date===date), input.people).valid)return false;
    }
    return validateWorkConstraints({
      timeZone:input.timeZone,rules:input.workConstraints,
      targetPeriod:{startDate:input.startDate,endDate:input.endDate},
      knownSchedule:{startDate:contextStart,endDate:contextEnd,
        complete:true,shifts:[...external,...trial]},
    }).status==="valid";
  };
  let current=score(schedule);
  let probes=0;
  const maxProbes=3500;
  const test=(trial:DatedWorkShift[],dates:string[]):boolean=>{
    if(probes++>=maxProbes)return false;
    const next=score(trial);
    if(next>=current-0.001 || !valid(trial,dates))return false;
    schedule=trial;current=next;return true;
  };
  // A coordinated weekly proposal can harmonize several days atomically.
  const groups=[...new Set(schedule.filter(s=>s.mealBreak).map(key))].sort();
  for(const group of groups){
    if(probes>=maxProbes)break;
    const indices=schedule.map((s,i)=>({s,i})).filter(x=>
      x.s.mealBreak && key(x.s)===group).map(x=>x.i);
    if(indices.length<2)continue;
    const starts=indices.map(i=>minute(schedule[i].mealBreak!.start));
    const candidates=[...new Set([...preferred,...starts,
      ...Array.from({length:9},(_,j)=>720+j*15)])];
    let bestCost=current;
    let best:DatedWorkShift[]|null=null;
    for(const target of candidates){
      const trial=[...schedule];
      const dates:string[]=[];
      for(const i of indices){
        const changed=mealAt(schedule[i],target);
        if(changed){trial[i]=changed;dates.push(changed.date);}
      }
      if(dates.length<2 || !dates.some(date=>trial.some((s,i)=>
        s.date===date && s.mealBreak?.start!==schedule[i].mealBreak?.start)))
        continue;
      const cost=score(trial);
      if(cost>=bestCost-0.001||probes++>=maxProbes)continue;
      if(!valid(trial,dates))continue;
      best=trial;bestCost=cost;
    }
    if(best){schedule=best;current=bestCost;}
    // When not every date permits the same start, seek the closest valid
    // individual improvements, without imposing an artificial hard rule.
    for(const i of indices){
      if(probes>=maxProbes)break;
      const existing=schedule[i];
      const candidatesForDay=[...new Set([...preferred,...starts,
        ...Array.from({length:9},(_,j)=>720+j*15)])];
      for(const start of candidatesForDay){
        const changed=mealAt(existing,start);
        if(!changed||changed.mealBreak?.start===existing.mealBreak?.start)continue;
        const trial=[...schedule];trial[i]=changed;
        test(trial,[existing.date]);
      }
    }
  }
  // Coordinated exchanges allow one person to take a consistent meal time
  // while another shifts to the freed slot without losing required coverage.
  for(let round=0;round<2&&probes<maxProbes;round++){
    let improved=false;
    for(let i=0;i<schedule.length&&probes<maxProbes;i++){
      const first=schedule[i];
      if(!first.mealBreak)continue;
      for(let j=i+1;j<schedule.length&&probes<maxProbes;j++){
        const second=schedule[j];
        if(!second.mealBreak||first.date!==second.date||
          first.personId===second.personId)continue;
        const nextFirst=mealAt(first,minute(second.mealBreak.start));
        const nextSecond=mealAt(second,minute(first.mealBreak.start));
        if(!nextFirst||!nextSecond)continue;
        const trial=[...schedule];
        trial[i]=nextFirst;trial[j]=nextSecond;
        if(test(trial,[first.date])){improved=true;break;}
      }
    }
    if(!improved)break;
  }
  return schedule;
}

/**
 * Company-specific hard policy: when a day is short enough, any assigned
 * person must cover its complete single operating interval. A day with no
 * assigned shifts remains valid when presence requirements allow it.
 * Multi-interval days are not implicitly constrained by the short-day rule.\n  * An inherited presence minimum still applies independently to every open interval.
 */
function satisfiesFullShortDayPolicy(
  input: GenerateConstrainedPeriodInput,
  shifts: DatedWorkShift[]
): boolean {
  const limit = input.workRules.fullShortDayMaximumMinutes ?? 0;
  if (limit <= 0) return true;
  const minutes = (value: string) => Number(value.slice(0,2))*60+Number(value.slice(3,5));
  for (const shift of shifts) {
    const operation = getOperatingIntervalsForDate(shift.date,
      input.operatingCalendar.weeklyOperatingHours,
      input.operatingCalendar.exceptions);
    if (operation.length !== 1) continue;
    const interval = operation[0];
    const duration = minutes(interval.end)-minutes(interval.start);
    if (duration > limit || duration <= 0) continue;
    // Full attendance can include a mandatory meal break; work/coverage
    // validators decide whether that break is legal.
    if (shift.interval.start !== interval.start ||
        shift.interval.end !== interval.end) return false;
  }
  return true;
}

/**
 * Full attendance is an interval, not necessarily continuous effective work.
 * A mandatory/optional meal must be represented when it fits inside that
 * exact attendance span. The work validator remains the final authority.
 */
function fullShortDayShiftCandidates(
  date: string,
  personId: string,
  interval: TimeInterval,
  rules: WorkConstraintConfiguration
): DatedWorkShift[] {
  const minute = (value: string) =>
    Number(value.slice(0,2)) * 60 + Number(value.slice(3,5));
  const clock = (value: number) =>
    String(Math.floor(value/60)).padStart(2,"0") + ":" +
    String(value%60).padStart(2,"0");
  const start = minute(interval.start);
  const end = minute(interval.end);
  const span = end - start;
  if (!Number.isSafeInteger(span) || span <= 0) return [];
  const variants: DatedWorkShift[] = [];
  if (span <= rules.mealBreak.requiredAboveEffectiveMinutes &&
      span <= rules.maximumDailyEffectiveMinutes) {
    variants.push({date,personId,interval:{...interval},mealBreak:null});
  }
  const work = span - rules.mealBreak.durationMinutes;
  if (work > 0 && work <= rules.maximumDailyEffectiveMinutes) {
    for (let offset=rules.mealBreak.earliestStartAfterWorkMinutes;
      offset <= rules.mealBreak.latestStartAfterWorkMinutes; offset+=15) {
      if (offset <= 0 || offset + rules.mealBreak.durationMinutes >= span)
        continue;
      variants.push({
        date,personId,interval:{...interval},
        mealBreak:{
          start:clock(start+offset),
          end:clock(start+offset+rules.mealBreak.durationMinutes),
        },
      });
    }
  }
  return variants;
}

/**
 * Bounded multi-day improvement: move effective hours away from long shifts
 * to enable a complete short operating day. All changes are committed
 * atomically after independent work and coverage validation.
 */
function rebalanceForCompleteShortDays(
  input: GenerateConstrainedPeriodInput,
  original: DatedWorkShift[],
  external: DatedWorkShift[],
  contextStart: string,
  contextEnd: string
): DatedWorkShift[] {
  let schedule = original.map(s => ({...s,interval:{...s.interval},
    mealBreak:s.mealBreak?{...s.mealBreak}:null}));
  const threshold = input.workRules.fullShortDayMaximumMinutes ?? 0;
  if (!threshold) return schedule;
  const minutes = (v:string) => Number(v.slice(0,2))*60+Number(v.slice(3,5));
  const clock = (n:number) => String(Math.floor(n/60)).padStart(2,"0")+":"+
    String(n%60).padStart(2,"0");
  const effective = (s:DatedWorkShift) => minutes(s.interval.end)-
    minutes(s.interval.start)-(s.mealBreak ?
      minutes(s.mealBreak.end)-minutes(s.mealBreak.start):0);
  const week = (date:string) => {
    const d=new Date(date+"T00:00:00Z");
    d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);
    return d.toISOString().slice(0,10);
  };
  const allValid=(proposal:DatedWorkShift[]):boolean => {
    if(!satisfiesFullShortDayPolicy(input,proposal))return false;
    const dates=[...new Set(proposal.map(s=>s.date))];
    for(const date of dates){
      const operating=getOperatingIntervalsForDate(date,
        input.operatingCalendar.weeklyOperatingHours,
        input.operatingCalendar.exceptions);
      const presence=resolvePresenceForDate(date,
        input.presence.weeklyPresenceRequirements,
        input.presence.presenceExceptions,
        input.operatingCalendar.weeklyOperatingHours,
        input.operatingCalendar.exceptions);
      if(presence.status!=="configured" ||
        !checkPresenceForWorkShifts(date,operating,presence.requirements,
          proposal.filter(s=>s.date===date), input.people).valid)return false;
    }
    return validateWorkConstraints({
      timeZone:input.timeZone,rules:input.workConstraints,
      targetPeriod:{startDate:input.startDate,endDate:input.endDate},
      knownSchedule:{startDate:contextStart,endDate:contextEnd,
        complete:true,shifts:[...external,...proposal]},
    }).status==="valid" &&
      validatePersonWeeklyContractCaps(input.people,[...external,...proposal],
        input.workConstraints.maximumWeeklyEffectiveMinutes,input.timeZone,
        input.startDate,input.endDate).valid;
  };
  let checks=0;
  for(let stamp=Date.parse(input.startDate+"T00:00:00Z");
    stamp<=Date.parse(input.endDate+"T00:00:00Z") && checks<1200;
    stamp+=DAY){
    const date=new Date(stamp).toISOString().slice(0,10);
    const op=getOperatingIntervalsForDate(date,
      input.operatingCalendar.weeklyOperatingHours,
      input.operatingCalendar.exceptions);
    if(op.length!==1)continue;
    const duration=minutes(op[0].end)-minutes(op[0].start);
    if(duration<=0||duration>threshold)continue;
    for(const person of input.people.filter(p=>p.active)){
      if(checks>=1200)break;
      if(schedule.some(s=>s.personId===person.id&&s.date===date))continue;
      const availability=input.availabilities.find(a=>a.personId===person.id);
      if(!availability || !isSchedulableForInterval(date,op[0],availability,
        input.operatingCalendar.weeklyOperatingHours,
        input.operatingCalendar.exceptions))continue;
      const sameWeek=(s:DatedWorkShift)=>s.personId===person.id &&
        week(s.date)===week(date);
      const personShifts=schedule.filter(sameWeek);
      const weeklyMinutes=[...personShifts,...external.filter(sameWeek)]
        .reduce((sum,s)=>sum+effective(s),0);
      const fullDayCandidates=fullShortDayShiftCandidates(
        date,person.id,op[0],input.workConstraints);
      for(const candidate of fullDayCandidates){
      const candidateEffective=duration-(candidate.mealBreak
        ? minutes(candidate.mealBreak.end)-minutes(candidate.mealBreak.start):0);
      const reduction=Math.max(0,weeklyMinutes+candidateEffective-
        personWeeklyHardMax(person,input.workConstraints.maximumWeeklyEffectiveMinutes));
      if(reduction%15!==0 || personShifts.length===0 && reduction>0)continue;
      const donors=personShifts.filter(s=>s.date!==date &&
        getOperatingIntervalsForDate(s.date,
          input.operatingCalendar.weeklyOperatingHours,
          input.operatingCalendar.exceptions).some(i=>
            minutes(i.end)-minutes(i.start)>threshold));
      if(!donors.length && reduction>0)continue;
      // Seek the flattest durations first, then test different choices
      // of trimming the start or end of each donor.
      const cuts=new Map<string,number>();
      for(const donor of donors)cuts.set(donor.date,0);
      let remaining=reduction;
      while(remaining>0){
        const eligible=donors.filter(d=>effective(d)-(cuts.get(d.date)??0)>15);
        if(!eligible.length)break;
        eligible.sort((a,b)=>(effective(b)-(cuts.get(b.date)??0))-
          (effective(a)-(cuts.get(a.date)??0)) || a.date.localeCompare(b.date));
        cuts.set(eligible[0].date,(cuts.get(eligible[0].date)??0)+15);
        remaining-=15;
      }
      if(remaining>0)continue;
      const cutDonors=donors.filter(d=>(cuts.get(d.date)??0)>0);
      const patterns=Math.min(1<<Math.min(cutDonors.length,12),256);
      for(let mask=0;mask<patterns&&checks<1200;mask++){
        checks++;
        const trial=schedule.map(s=>({...s,interval:{...s.interval},
          mealBreak:s.mealBreak?{...s.mealBreak}:null}));
        let viable=true;
        for(let j=0;j<cutDonors.length;j++){
          const donor=cutDonors[j],cut=cuts.get(donor.date)!;
          const index=trial.findIndex(s=>s.personId===person.id&&s.date===donor.date);
          const shift=trial[index];
          const trimStart=Boolean(mask&(1<<j));
          const start=minutes(shift.interval.start)+(trimStart?cut:0);
          const end=minutes(shift.interval.end)-(trimStart?0:cut);
          const adjusted={...shift,interval:{start:clock(start),end:clock(end)}};
          if(shift.mealBreak){
            const mealStart=minutes(shift.mealBreak.start);
            const mealEnd=minutes(shift.mealBreak.end);
            if(mealStart<start||mealEnd>end){viable=false;break;}
          }
          if(!isSchedulableForInterval(shift.date,adjusted.interval,availability,
            input.operatingCalendar.weeklyOperatingHours,
            input.operatingCalendar.exceptions)){viable=false;break;}
          trial[index]=adjusted;
        }
        if(!viable)continue;
        trial.push(candidate);
        if(allValid(trial)){schedule=trial;break;}
      }
      if(schedule.some(s=>s.personId===person.id&&s.date===date))break;
      }
    }
  }
  return schedule;
}

/**
 * An explicit opt-in turns all open dates with nonempty schedulable
 * availability into mandatory workdays. Non-working dates remain untouched.
 * This is NOT inferred from generic availability unless configured.
 */
function missingRequiredWorkdays(
  input: GenerateConstrainedPeriodInput,
  assignments: DatedWorkShift[],
  dates: string[]
): Array<{date: string; personId: string}> {
  if (!input.workRules.requireShiftsOnAvailableDays &&
      !input.people.some(p=>p.requiredWorkDates?.length)) return [];
  const assigned = new Set(assignments.map(s => s.date+"|"+s.personId));
  const missing: Array<{date: string; personId: string}> = [];
  for (const date of dates) {
    for (const person of input.people.filter(p => p.active && employedOn(p,date))) {
      const availability = input.availabilities.find(a => a.personId === person.id);
      if (!availability) continue;
      const permitted = getSchedulableIntervalsForDate(date,availability,
        input.operatingCalendar.weeklyOperatingHours,
        input.operatingCalendar.exceptions);
      if ((isExplicitRequiredWorkday(person,date) ||
          (input.workRules.requireShiftsOnAvailableDays && permitted.length>0)) &&
          !assigned.has(date+"|"+person.id))
        missing.push({date,personId:person.id});
    }
  }
  return missing;
}

/**
 * Multi-day repair for missing mandatory workdays. Construct an additional
 * shift and redistribute the same person's weekly minutes across existing
 * comparable days. Only an atomic, independently validated proposal commits.
 * Bounded local search; failure must remain visible, never a "valid" result.
 */
function fillRequiredWorkdays(
  input: GenerateConstrainedPeriodInput,
  original: DatedWorkShift[],
  external: DatedWorkShift[],
  knownStart: string,
  knownEnd: string,
  dates: string[]
): DatedWorkShift[] {
  if (!input.workRules.requireShiftsOnAvailableDays &&
      !input.people.some(p=>p.requiredWorkDates?.length)) return original;
  let schedule = original.map(s=>({...s,interval:{...s.interval},
    mealBreak:s.mealBreak?{...s.mealBreak}:null}));
  const minute=(v:string)=>Number(v.slice(0,2))*60+Number(v.slice(3,5));
  const clock=(v:number)=>String(Math.floor(v/60)).padStart(2,"0")+":"+
    String(v%60).padStart(2,"0");
  const effective=(shift:DatedWorkShift)=>minute(shift.interval.end)-
    minute(shift.interval.start)-(shift.mealBreak?
      minute(shift.mealBreak.end)-minute(shift.mealBreak.start):0);
  const week=(date:string)=>{
    const d=new Date(date+"T00:00:00Z");
    d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);
    return d.toISOString().slice(0,10);
  };
  const meal=input.workConstraints.mealBreak;
  const maxDaily=input.workConstraints.maximumDailyEffectiveMinutes;
  const maxWeekly=input.workConstraints.maximumWeeklyEffectiveMinutes;
  const threshold=input.workRules.fullShortDayMaximumMinutes ?? 0;
  const operating=(date:string)=>getOperatingIntervalsForDate(date,
    input.operatingCalendar.weeklyOperatingHours,
    input.operatingCalendar.exceptions);
  const short=(date:string)=>threshold>0 && operating(date).length===1 &&
    minute(operating(date)[0].end)-minute(operating(date)[0].start)<=threshold;
  const valid=(proposal:DatedWorkShift[]):boolean=>{
    if(!satisfiesFullShortDayPolicy(input,proposal))return false;
    if(missingRequiredWorkdays(input,proposal,dates).length >
      missingRequiredWorkdays(input,schedule,dates).length-1)return false;
    for(const date of [...new Set(proposal.map(s=>s.date))]){
      const op=operating(date);
      const presence=resolvePresenceForDate(date,
        input.presence.weeklyPresenceRequirements,
        input.presence.presenceExceptions,
        input.operatingCalendar.weeklyOperatingHours,
        input.operatingCalendar.exceptions);
      if(presence.status!=="configured" ||
        !checkPresenceForWorkShifts(date,op,presence.requirements,
          proposal.filter(s=>s.date===date), input.people).valid)return false;
    }
    return validateWorkConstraints({
      timeZone:input.timeZone,rules:input.workConstraints,
      targetPeriod:{startDate:input.startDate,endDate:input.endDate},
      knownSchedule:{startDate:knownStart,endDate:knownEnd,
        complete:true,shifts:[...external,...proposal]},
    }).status==="valid" &&
      validatePersonWeeklyContractCaps(input.people,[...external,...proposal],
        input.workConstraints.maximumWeeklyEffectiveMinutes,input.timeZone,
        input.startDate,input.endDate).valid;
  };
  let checks=0;
  const budget=5000;
  for (const {date,personId} of missingRequiredWorkdays(input,schedule,dates)) {
    if(checks>=budget)break;
    const availability=input.availabilities.find(a=>a.personId===personId);
    if(!availability||schedule.some(s=>s.date===date&&s.personId===personId))
      continue;
    const allowed=getSchedulableIntervalsForDate(date,availability,
      input.operatingCalendar.weeklyOperatingHours,
      input.operatingCalendar.exceptions);
    const current=[...schedule,...external].filter(s=>s.personId===personId &&
      week(s.date)===week(date)).reduce((n,s)=>n+effective(s),0);
    const person = input.people.find(p=>p.id===personId)!;
    const personLimit = personWeeklyHardMax(person,maxWeekly);
    const donors=schedule.filter(s=>s.personId===personId &&
      week(s.date)===week(date)&&s.date!==date && !short(s.date));
    const shortTotal=schedule.filter(s=>s.personId===personId &&
      week(s.date)===week(date)&&short(s.date)).reduce((n,s)=>n+effective(s),0);
    const fullCount=donors.length+(short(date)?0:1);
    const mean=fullCount>0?
      Math.round((Math.min(current,personLimit)-shortTotal)/fullCount/15)*15:0;
    const proposedWork: number[]=[];
    if(short(date) && operating(date).length===1){
      const attendanceMinutes=minute(operating(date)[0].end)-
        minute(operating(date)[0].start);
      proposedWork.push(attendanceMinutes);
      const withMeal=attendanceMinutes-meal.durationMinutes;
      if(withMeal>0 && !proposedWork.includes(withMeal))
        proposedWork.push(withMeal);
    }else{
      // Prefer equal full-day effective hours, then nearby alternatives.
      for(let deviation=0;deviation<=180;deviation+=15){
        for(const sign of deviation===0?[1]:[1,-1]){
          const work=mean+sign*deviation;
          if(work>=15 && work<=maxDaily && !proposedWork.includes(work))
            proposedWork.push(work);
        }
      }
    }
    let fixed=false;
    for(const work of proposedWork){
      if(fixed||checks>=budget)break;
      if(work>maxDaily)continue;
      const operation=operating(date);
      const shortMeal=short(date) && operation.length===1 &&
        minute(operation[0].end)-minute(operation[0].start)===
          work+meal.durationMinutes;
      const needsMeal=work>meal.requiredAboveEffectiveMinutes || shortMeal;
      const span=work+(needsMeal?meal.durationMinutes:0);
      const reduction=Math.max(0,current+work-personLimit);
      if(reduction%15!==0||(!donors.length&&reduction>0))continue;
      // Water-fill cuts from the longest comparable days, to preserve balance.
      const cuts=new Map<string,number>();
      const ordered=[...donors].sort((a,b)=>a.date.localeCompare(b.date));
      for(const d of ordered)cuts.set(d.date,0);
      let left=reduction;
      while(left>0){
        const eligible=ordered.filter(d=>
          effective(d)-(cuts.get(d.date)??0)>=30);
        if(!eligible.length)break;
        eligible.sort((a,b)=>
          (effective(b)-(cuts.get(b.date)??0))-
          (effective(a)-(cuts.get(a.date)??0)) ||
          a.date.localeCompare(b.date));
        const chosen=eligible[0];
        cuts.set(chosen.date,(cuts.get(chosen.date)??0)+15);
        left-=15;
      }
      if(left>0)continue;
      const modified=ordered.filter(d=>(cuts.get(d.date)??0)>0);
      const combinations=Math.min(1<<Math.min(modified.length,10),256);
      for(let mask=0;mask<combinations && !fixed && checks<budget;mask++){
        const trial=schedule.map(s=>({...s,interval:{...s.interval},
          mealBreak:s.mealBreak?{...s.mealBreak}:null}));
        let possible=true;
        for(let index=0;index<modified.length;index++){
          const donor=modified[index],cut=cuts.get(donor.date)!;
          const shiftIndex=trial.findIndex(s=>s.personId===personId &&
            s.date===donor.date);
          const item=trial[shiftIndex];
          const start=minute(item.interval.start)+((mask&(1<<index))?cut:0);
          const end=minute(item.interval.end)-((mask&(1<<index))?0:cut);
          // When a shift begins later, move its meal as well to keep
          // the legal effective-work-before-meal offset unchanged.
          const mealOffset=(mask&(1<<index))?cut:0;
          const adjustedMeal=item.mealBreak?{
            start:clock(minute(item.mealBreak.start)+mealOffset),
            end:clock(minute(item.mealBreak.end)+mealOffset),
          }:null;
          if(start>=end || (adjustedMeal &&
            (minute(adjustedMeal.start)<start ||
              minute(adjustedMeal.end)>end))){possible=false;break;}
          const interval={start:clock(start),end:clock(end)};
          if(!isSchedulableForInterval(donor.date,interval,availability,
            input.operatingCalendar.weeklyOperatingHours,
            input.operatingCalendar.exceptions)){possible=false;break;}
          trial[shiftIndex]={...item,interval,mealBreak:adjustedMeal};
        }
        if(!possible)continue;
        for(const range of allowed){
          if(fixed||checks>=budget)break;
          const first=minute(range.start),last=minute(range.end)-span;
          for(let start=first;start<=last&&!fixed&&checks<budget;start+=15){
            const offsets=needsMeal?
              Array.from({length:Math.floor(
                (meal.latestStartAfterWorkMinutes-
                  meal.earliestStartAfterWorkMinutes)/15)+1},
                (_,i)=>meal.earliestStartAfterWorkMinutes+i*15)
              :[0];
            // Avoid locking meal times to the original candidate.
            offsets.sort((a,b)=>{
              const preference=(o:number)=>Math.min(...[720,780,840]
                .map(p=>Math.abs(start+o-p)));
              return preference(a)-preference(b)||a-b;
            });
            for(const offset of offsets){
              if(++checks>budget)break;
              if(needsMeal && offset+meal.durationMinutes>span)continue;
              const candidate:DatedWorkShift={
                date,personId,interval:{start:clock(start),end:clock(start+span)},
                mealBreak:needsMeal?{start:clock(start+offset),
                  end:clock(start+offset+meal.durationMinutes)}:null,
              };
              if(!isSchedulableForInterval(date,candidate.interval,availability,
                input.operatingCalendar.weeklyOperatingHours,
                input.operatingCalendar.exceptions))continue;
              const proposal=[...trial,candidate];
              if(valid(proposal)){schedule=proposal;fixed=true;break;}
            }
          }
        }
      }
    }
  }
  return schedule;
}

/**
 * Backtracks ACROSS dates. It does not fix the first valid daily solution
 * and only reject the final period: a daily accepted candidate is passed
 * to a visitor that must also solve the remaining dates.
 *
 * Before publishing a period, the independent work validator checks the
 * COMPLETE schedule (known external shifts + all generated target shifts)
 * and the daily generator has certified coverage for each open day.
 */
export function generateConstrainedPeriodSchedule(
  input: GenerateConstrainedPeriodInput
): GenerateConstrainedPeriodResult {
  const start = civilDate(input.startDate);
  const end = civilDate(input.endDate);
  if (start === null || end === null || start > end) {
    return resultWith("invalid_input", [
      "O período deve ter datas civis válidas, inicial anterior ou igual à final.",
    ]);
  }
  const dayCount = (end - start) / DAY + 1;
  if (dayCount > MAX_CONSTRAINED_PERIOD_DAYS) {
    return resultWith("invalid_input", [
      `O gerador condicionado suporta até ${MAX_CONSTRAINED_PERIOD_DAYS} dias consecutivos.`,
    ]);
  }

  // Fail closed before searching: an official approval owns its calendar dates.
  // Proposals remain append-only and cannot implicitly revise approved work.
  if (input.protectedApprovedPeriods !== undefined) {
    if (!Array.isArray(input.protectedApprovedPeriods) || input.protectedApprovedPeriods.some(
      period => !period || civilDate(period.startDate) === null ||
        civilDate(period.endDate) === null || period.startDate > period.endDate
    )) {
      return resultWith("invalid_input", [
        "O contexto de períodos oficialmente aprovados é inválido.",
      ]);
    }
    if (input.protectedApprovedPeriods.some(period =>
      period.startDate <= input.endDate && period.endDate >= input.startDate
    )) {
      return resultWith("invalid_input", [
        "O período solicitado sobrepõe-se a um horário oficialmente aprovado. "+
        "Esse horário está protegido; utiliza uma revisão oficial para o alterar.",
      ]);
    }
  }

  const policyIssues=validatePeopleSchedulingPolicies(input.people ?? []);
  for(const person of input.people??[]){
    policyIssues.push(...validateEmploymentPeriods(person.employmentPeriods)
      .map(issue=>person.name+": "+issue));
  }
  if (policyIssues.length) return resultWith("invalid_input",policyIssues);
  const maxNodes = input.maxSearchNodes ?? DEFAULT_GLOBAL_MAX_NODES;
  if (!Number.isSafeInteger(maxNodes) || maxNodes < 1) {
    return resultWith("invalid_input", [
      "O limite global de pesquisa deve ser um inteiro positivo.",
    ]);
  }

  if (!input.externalContext ||
      typeof input.externalContext.completeOutsideTarget !== "boolean") {
    return resultWith("invalid_input", [
      "É obrigatória a declaração explícita do contexto exterior ao período.",
    ]);
  }
  if (!Array.isArray(input.externalContext.shifts)) {
    return resultWith("invalid_input", [
      "É obrigatória uma lista de turnos exteriores conhecidos.",
    ]);
  }

  // The first version does not support pre-assigned/fixed shifts INSIDE
  // the target period. They need a separate constraint model.
  if (input.externalContext.shifts.some(shift =>
    typeof shift?.date === "string" &&
    isWithin(shift.date, input.startDate, input.endDate)
  )) {
    return resultWith("invalid_input", [
      "O contexto exterior não pode conter turnos dentro do período gerado.",
    ]);
  }

  const target = { startDate: input.startDate, endDate: input.endDate };
  const outside = input.externalContext;
  // Validate untrusted schedule structure through the work validator
  // below, not through a sorting function that could throw on bad data.
  const externalShifts = [...outside.shifts].sort(
    (a, b) => (a?.date ?? "").localeCompare(b?.date ?? "") ||
      (a?.personId ?? "").localeCompare(b?.personId ?? "", "en") ||
      (a?.interval?.start ?? "").localeCompare(b?.interval?.start ?? "")
  );
  const knownSchedule = (shifts: DatedWorkShift[], complete: boolean) => ({
    startDate: outside.startDate,
    endDate: outside.endDate,
    complete,
    shifts: [...externalShifts, ...shifts],
  });

  // First validate the rules, IANA zone and outer date range. With an
  // explicitly incomplete schedule the validator NEVER asserts global
  // validity. We do not infer unlisted shifts are absent.
  const initial = validateWorkConstraints({
    timeZone: input.timeZone,
    rules: input.workConstraints,
    targetPeriod: target,
    knownSchedule: knownSchedule([], false),
  });
  if (initial.status === "invalid_input") {
    return resultWith(
      "invalid_input", initial.issues, [],
      initial.requiredContext, initial.violations
    );
  }
  const required = initial.requiredContext;
  if (!required) {
    return resultWith("invalid_input", ["Não foi possível calcular o contexto necessário."]);
  }
  if (!outside.completeOutsideTarget ||
      outside.startDate > required.startDate ||
      outside.endDate < required.endDate) {
    return resultWith("incomplete_context", [
      `É necessário confirmar todos os turnos e ausências exteriores ao período entre ${required.startDate} e ${required.endDate}.`,
    ], [], required);
  }
  const outsideCap = validatePersonWeeklyContractCaps(
    input.people,externalShifts,input.workConstraints.maximumWeeklyEffectiveMinutes,
    input.timeZone,input.startDate,input.endDate);
  if (!outsideCap.valid) {
    return resultWith("invalid_input",[
      "O contexto exterior excede limites contratuais ou contém durações inválidas.",
      ...outsideCap.issues,
    ],[],required);
  }
  const missingOutside=missingRequiredOutsideWorkdays(
    input.people,externalShifts,input.startDate,input.endDate,
    outside.startDate,outside.endDate);
  if(missingOutside.length){
    return resultWith("invalid_input",[
      "O contexto exterior foi declarado completo, mas contém dias de trabalho obrigatórios sem turno.",
      ...missingOutside.map(item=>item.personId+" ("+item.date+"): turno exterior obrigatório em falta."),
    ],[],required);
  }
  if (initial.violations.length > 0) {
    return resultWith(
      "invalid_input",
      ["O contexto exterior conhecido já viola regras obrigatórias de trabalho."],
      [], required, initial.violations
    );
  }

  const dates = Array.from(
    { length: dayCount },
    (_, index) => dayString(start + index * DAY)
  );
  const shortage = provenWeeklyCapacityShortage(input, dates);
  if (shortage) {
    return resultWith("incomplete", [
      shortage,
      "O diagnóstico é um limite inferior comprovado; nenhuma pesquisa foi necessária.",
    ], [], required);
  }
  const diagnostics: ConstrainedPeriodDayDiagnostic[] = dates.map(date => ({
    date,
    lastDailyStatus: null,
    attempts: 0,
    rejectedByWorkRules: 0,
    foundAssignments: 0,
    issues: [],
    shortages: [],
  }));
  const budget: MealAwareSearchBudget = {
    maxNodes,
    exploredNodes: 0,
    limitReached: false,
  };
  const selected: DatedWorkShift[] = [];
  let accepted: DatedWorkShift[] | null = null;
  let rejectedByWorkRules = 0;
  let lastWorkViolations: WorkConstraintViolation[] = [];
  let invalidInternalResult: string | null = null;

  const checkPartial = (added: DatedWorkShift[]): boolean => {
    const result = validateWorkConstraints({
      timeZone: input.timeZone,
      rules: input.workConstraints,
      targetPeriod: target,
      knownSchedule: knownSchedule([...selected, ...added], false),
    });
    if (result.status === "invalid_input") {
      invalidInternalResult =
        `Erro ao validar candidatos: ${result.issues.join(" ")}`;
      return false;
    }
    const caps=validatePersonWeeklyContractCaps(
      input.people,[...externalShifts,...selected,...added],
      input.workConstraints.maximumWeeklyEffectiveMinutes,
      input.timeZone,input.startDate,input.endDate);
    if (result.violations.length > 0 || !caps.valid) {
      rejectedByWorkRules++;
      lastWorkViolations = result.violations;
      return false;
    }
    return true;
  };

  const searchDate = (index: number): boolean => {
    if (invalidInternalResult || budget.limitReached) return false;
    if (index === dates.length) {
      const checked = validateWorkConstraints({
        timeZone: input.timeZone,
        rules: input.workConstraints,
        targetPeriod: target,
        knownSchedule: knownSchedule(selected, true),
      });
      const caps=validatePersonWeeklyContractCaps(
        input.people,[...externalShifts,...selected],
        input.workConstraints.maximumWeeklyEffectiveMinutes,
        input.timeZone,input.startDate,input.endDate);
      if (checked.status !== "valid" || !caps.valid) {
        if (checked.status === "invalid_input" ||
            checked.status === "incomplete_context") {
          invalidInternalResult = checked.issues.join(" ") ||
            "Falha na validação final do contexto.";
        } else {
          rejectedByWorkRules++;
          lastWorkViolations = checked.violations;
        }
        return false;
      }
      accepted = [...selected];
      return true;
    }

    const diagnostic = diagnostics[index];
    diagnostic.attempts++;
    const dayInput: GenerateMealAwareDayInput = {
      date: dates[index],
      people: input.people.map(person=>({...person,
        active:person.active && employedOn(person,dates[index])})),
      availabilities: input.availabilities,
      operatingCalendar: input.operatingCalendar,
      workRules: input.workRules,
      presence: input.presence,
      workConstraints: input.workConstraints,
      timeZone: input.timeZone,
      maxSearchNodes: maxNodes,
    };

    const dayResult = searchMealAwareDaySchedule(dayInput, {
      budget,
      flexibleDurations: true,
      acceptSolution: (assignments) => {
        if (!satisfiesFullShortDayPolicy(input, assignments) || !checkPartial(assignments)) {
          diagnostic.rejectedByWorkRules++;
          return false;
        }
        selected.push(...assignments);
        const completed = searchDate(index + 1);
        selected.splice(selected.length - assignments.length, assignments.length);
        return completed;
      },
    });
    diagnostic.lastDailyStatus = dayResult.status;
    diagnostic.issues = dayResult.issues;
    diagnostic.shortages = dayResult.shortages;
    diagnostic.foundAssignments = dayResult.assignments.length;

    if (dayResult.status === "generated") return true;
    if (dayResult.status === "closed") return searchDate(index + 1);
    if (dayResult.status === "invalid_input") {
      invalidInternalResult = dayResult.issues.join(" ");
    }
    return false;
  };

  const found = searchDate(0);
  if (invalidInternalResult) {
    return resultWith(
      "invalid_input", [invalidInternalResult], diagnostics,
      required, lastWorkViolations, budget.exploredNodes, rejectedByWorkRules
    );
  }
  if (found && accepted !== null) {
    const assignments: DatedWorkShift[] = stabilizeWeeklyMealPatterns(input,
      staggerPreferredMeals(input,
        improveCoupledWeeklyClockPatterns(input,
          repairSwappedWeekdayStarts(input,
            alignWeekdayClockPatterns(input,
          regularizeWeekdayShifts(input,
            fillRequiredWorkdays(input,
              rebalanceForCompleteShortDays(input,
                improveWeeklyHours(input, accepted, externalShifts,
                  outside.startDate, outside.endDate),
                externalShifts, outside.startDate, outside.endDate),
              externalShifts, outside.startDate, outside.endDate, dates),
            externalShifts, outside.startDate, outside.endDate),
          externalShifts, outside.startDate, outside.endDate),
        externalShifts, outside.startDate, outside.endDate),
          externalShifts, outside.startDate, outside.endDate),
        externalShifts, outside.startDate, outside.endDate),
      externalShifts, outside.startDate, outside.endDate);
    const missing = missingRequiredWorkdays(input,assignments,dates);
    if(missing.length>0){
      return resultWith("incomplete", [
        "Não foi possível atribuir um turno a todos os dias de trabalho obrigatórios.",
        "Dias em falta: "+missing.map(item=>item.personId+" ("+item.date+")").join(", ")+".",
        "A pesquisa limitada não demonstra que não exista outra solução.",
      ],diagnostics,required);
    }
    if (!satisfiesFullShortDayPolicy(input, assignments)) {
      return resultWith("incomplete", ["A regra de jornada integral em dias curtos não foi cumprida."], diagnostics, required);
    }
    const certification = certifyFinalGeneratedSchedule(input, assignments);
    if (!certification.valid) {
      return resultWith("incomplete", [
        "A validação independente rejeitou o resultado depois da otimização.",
        ...certification.issues,
      ], diagnostics, required, certification.workViolations,
      budget.exploredNodes, rejectedByWorkRules);
    }
    return {
      status: "generated",
      validationScope: "period_work_and_coverage_when_generated",
      assignments: [...assignments].sort(
        (a, b) => a.date.localeCompare(b.date) ||
          a.personId.localeCompare(b.personId, "en")
      ),
      days: diagnostics,
      issues: [],
      requiredContext: required,
      workViolations: [],
      exploredNodes: budget.exploredNodes,
      rejectedByWorkRules,
    };
  }

  if (budget.limitReached) {
    return resultWith(
      "search_limit", [
        "A pesquisa global atingiu o limite de nós antes de encontrar um horário de período válido.",
        "Não foi demonstrada a impossibilidade fora da pesquisa limitada.",
      ], diagnostics, required, lastWorkViolations,
      budget.exploredNodes, rejectedByWorkRules
    );
  }
  return resultWith(
    "incomplete", [
      "Não foi encontrado um período que cumpra simultaneamente cobertura, refeições, descanso e horas de trabalho.",
      "Não foi demonstrada a impossibilidade fora do espaço de candidatos V0.",
    ], diagnostics, required, lastWorkViolations,
    budget.exploredNodes, rejectedByWorkRules
  );
}
