import type {
  DatedWorkShift, OperatingCalendarConfiguration, Person,
  PersonAvailability, PresenceConfiguration, WorkConstraintConfiguration,
  WorkRulesConfiguration,
} from "../types";

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

export interface GeneratedScheduleRepository {
  save(payload: GeneratedSchedulePayload): Promise<StoredGeneratedSchedule>;
  /** All proposals overlapping a civil date interval. No arbitrary recent-only cap. */
  listBetween(startDate: string, endDate: string): Promise<StoredGeneratedSchedule[]>;
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
  return true;
}
