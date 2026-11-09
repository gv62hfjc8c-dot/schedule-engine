import type {
  DatedWorkShift, OperatingCalendarConfiguration, Person,
  PersonAvailability, PresenceConfiguration, WorkConstraintConfiguration,
  WorkRulesConfiguration,
} from "../types";
import { APP_STATE_VERSION } from "./stateRepository";
import { isPersistedAppState } from "./localStorageStateRepository";
import { prepareExplicitEmptyContext } from "../utils/explicitEmptyContext";
import { certifyFinalGeneratedSchedule } from "../utils/finalScheduleCertification";

/**
 * A stored generated proposal is never an approved or authoritative schedule.
 * Browser-created snapshots may be read for history, but only a trusted
 * server-side command can later approve one against the authoritative state.
 */
export interface GeneratedSchedulePayload {
  schemaVersion: 1;
  validationScope: "user_attested_no_external_shifts";
  startDate: string;
  endDate: string;
  timeZone: string;
  shifts: DatedWorkShift[];
  people: Person[];
  configuration: {
    availabilities: PersonAvailability[];
    operatingCalendar: OperatingCalendarConfiguration;
    workRules: WorkRulesConfiguration;
    presence: PresenceConfiguration;
    workConstraints: WorkConstraintConfiguration;
  };
}

export interface StoredGeneratedSchedule {
  id: string;
  createdAt: string;
  startDate: string;
  endDate: string;
  timeZone: string;
  payload: GeneratedSchedulePayload;
}

/** A corrupt record is never used as a schedule, and its presence stays visible. */
export interface UnreadableGeneratedSchedule {
  id: string | null;
  startDate: string | null;
  endDate: string | null;
}
export interface GeneratedScheduleArchiveResult {
  records: StoredGeneratedSchedule[];
  unreadable: UnreadableGeneratedSchedule[];
}

export interface GeneratedScheduleRepository {
  /**
   * Idempotent when the same UUID and identical snapshot are retried.
   * Never overwrite a previously archived proposal.
   */
  save(payload: GeneratedSchedulePayload, proposalId?: string): Promise<StoredGeneratedSchedule>;
  /** Strict query: fails closed when any archived row cannot be validated. */
  listBetween(startDate: string, endDate: string): Promise<StoredGeneratedSchedule[]>;
  /** Read verified proposals while explicitly reporting any unreadable rows. */
  listBetweenDetailed(startDate: string, endDate: string): Promise<GeneratedScheduleArchiveResult>;
  /** Most recently persisted proposal across all periods. */
  latest(): Promise<StoredGeneratedSchedule | null>;
}

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d|24:00$/;
const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const validDate = (s: unknown): s is string => {
  if (typeof s !== "string" || !datePattern.test(s)) return false;
  const date = new Date(s + "T00:00:00Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === s;
};
const duration = (start: string, end: string) => {
  const m = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  return m(end) - m(start);
};


const WEEKDAYS = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"] as const;

function validScheduleIntervals(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  const intervals: Array<{start:number;end:number}> = [];
  for (const interval of value) {
    if (!isObject(interval) || typeof interval.start !== "string" ||
        typeof interval.end !== "string" ||
        !timePattern.test(interval.start) || !timePattern.test(interval.end) ||
        interval.start === "24:00" || duration(interval.start,interval.end) <= 0)
      return false;
    const toMinutes = (v:string) => Number(v.slice(0,2))*60 + Number(v.slice(3,5));
    intervals.push({start:toMinutes(interval.start),end:toMinutes(interval.end)});
  }
  intervals.sort((a,b)=>a.start-b.start);
  return intervals.every((interval,i)=>i===0 || intervals[i-1].end <= interval.start);
}

function validStoredConfiguration(value: GeneratedSchedulePayload): boolean {
  const c=value.configuration;
  if (!isPersistedAppState({
    version: APP_STATE_VERSION,
    weeklyOperatingHours:c.operatingCalendar.weeklyOperatingHours,
    exceptions:c.operatingCalendar.exceptions,
    people:value.people, availabilities:c.availabilities,
    workRules:c.workRules,
    weeklyPresenceRequirements:c.presence.weeklyPresenceRequirements,
    presenceExceptions:c.presence.presenceExceptions,
  })) return false;
  try { new Intl.DateTimeFormat("en",{timeZone:value.timeZone}); }
  catch { return false; }
  const rules = c.workConstraints;
  const meal = rules.mealBreak;
  const integer = (n:unknown) => typeof n==="number" && Number.isSafeInteger(n);
  if (!meal || !integer(rules.minimumRestBetweenShiftsMinutes) ||
      rules.minimumRestBetweenShiftsMinutes <= 0 ||
      !integer(rules.maximumDailyEffectiveMinutes) ||
      rules.maximumDailyEffectiveMinutes <= 0 ||
      !integer(rules.maximumWeeklyEffectiveMinutes) ||
      rules.maximumWeeklyEffectiveMinutes <= 0 ||
      !integer(meal.requiredAboveEffectiveMinutes) ||
      meal.requiredAboveEffectiveMinutes < 0 ||
      !integer(meal.durationMinutes) || meal.durationMinutes <= 0 ||
      !integer(meal.earliestStartAfterWorkMinutes) ||
      !integer(meal.latestStartAfterWorkMinutes) ||
      meal.earliestStartAfterWorkMinutes < 0 ||
      meal.latestStartAfterWorkMinutes < meal.earliestStartAfterWorkMinutes)
    return false;

  if (!WEEKDAYS.every(day=>validScheduleIntervals(
    c.operatingCalendar.weeklyOperatingHours[day]))) return false;
  if (!c.operatingCalendar.exceptions.every(e=>
    validDate(e.date) && validScheduleIntervals(e.intervals))) return false;
  const ids = new Set(value.people.map(p=>p.id));
  if (!c.availabilities.every(a=>ids.has(a.personId) &&
      WEEKDAYS.every(day=>validScheduleIntervals(a.weeklyAvailability[day])) &&
      a.exceptions.every(e=>validDate(e.date)&&validScheduleIntervals(e.intervals))))
    return false;
  if (!c.presence.presenceExceptions.every(e=>validDate(e.date))) return false;
  return true;
}

export function isGeneratedSchedulePayload(value: unknown): value is GeneratedSchedulePayload {
  if (!isObject(value) || value.schemaVersion !== 1 ||
    value.validationScope !== "user_attested_no_external_shifts" ||
    !validDate(value.startDate) || !validDate(value.endDate) ||
    value.startDate > value.endDate || typeof value.timeZone !== "string" ||
    !value.timeZone || !Array.isArray(value.shifts) ||
    !Array.isArray(value.people) || !isObject(value.configuration)) return false;
  const c = value.configuration;
  if (!Array.isArray(c.availabilities) || !isObject(c.operatingCalendar) ||
    !isObject(c.workRules) || !isObject(c.presence) || !isObject(c.workConstraints)) return false;
  const people = new Set<string>();
  for (const person of value.people) {
    if (!isObject(person) || typeof person.id !== "string" ||
      typeof person.name !== "string" || typeof person.active !== "boolean" ||
      people.has(person.id)) return false;
    people.add(person.id);
  }
  const unique = new Set<string>();
  for (const shift of value.shifts) {
    if (!isObject(shift) || !validDate(shift.date) ||
      shift.date < value.startDate || shift.date > value.endDate ||
      typeof shift.personId !== "string" || !people.has(shift.personId) ||
      !isObject(shift.interval) ||
      typeof shift.interval.start !== "string" ||
      typeof shift.interval.end !== "string" ||
      !timePattern.test(shift.interval.start) ||
      !timePattern.test(shift.interval.end) ||
      duration(shift.interval.start, shift.interval.end) <= 0) return false;
    const key = shift.date + "|" + shift.personId;
    if (unique.has(key)) return false;
    unique.add(key);
    if (shift.mealBreak !== null) {
      if (!isObject(shift.mealBreak) ||
        typeof shift.mealBreak.start !== "string" ||
        typeof shift.mealBreak.end !== "string" ||
        !timePattern.test(shift.mealBreak.start) ||
        !timePattern.test(shift.mealBreak.end) ||
        duration(shift.mealBreak.start, shift.mealBreak.end) <= 0 ||
        shift.mealBreak.start <= shift.interval.start ||
        shift.mealBreak.end >= shift.interval.end) return false;
    }
  }
  return validStoredConfiguration(value as unknown as GeneratedSchedulePayload);
}

/**
 * Independently re-evaluate the archived shifts against THEIR ORIGINAL
 * personnel, availability, operation, mandatory coverage and work rules.
 * The stored user attestation is only a declared external context; this
 * verifies internal consistency, never authoritative approval.
 *
 * Strict readers quarantine failing rows; they NEVER delete or modify them.
 */
export function certifyGeneratedSchedulePayload(
  value:unknown,
):{valid:boolean;issues:string[]}{
  if(!isGeneratedSchedulePayload(value))return {
    valid:false,issues:["Estrutura do snapshot incompatível."],
  };
  const c=value.configuration;
  const declared=prepareExplicitEmptyContext({
    startDate:value.startDate,endDate:value.endDate,
    timeZone:value.timeZone,rules:c.workConstraints,
    confirmedNoExternalShifts:true,
  });
  if(declared.status!=="ready"||!declared.externalContext)
    return {valid:false,issues:declared.issues.length?declared.issues:
      ["Não foi possível reconstituir o contexto do snapshot."]};
  const result=certifyFinalGeneratedSchedule({
    startDate:value.startDate,endDate:value.endDate,
    timeZone:value.timeZone,
    people:value.people,availabilities:c.availabilities,
    operatingCalendar:c.operatingCalendar,workRules:c.workRules,
    presence:c.presence,workConstraints:c.workConstraints,
    externalContext:declared.externalContext,
  },value.shifts);
  return {valid:result.valid,issues:result.issues};
}
