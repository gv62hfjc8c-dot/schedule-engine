import type {
  DatedWorkShift, OperatingCalendarConfiguration, Person, PersonAvailability,
} from "../types";
import { getOperatingIntervalsForDate } from "./operatingCalendar";
import { getEffectiveWorkMinutesInTimeZone } from "./workConstraints";
import { DEFAULT_OPERATION_TIME_ZONE } from "./operationTimeZone";
import { getSchedulableIntervalsForDate } from "./availability";
import {employedOn} from "./employmentPeriods";

/**
 * PR45 UI read model: a generated proposal is not an approved schedule.
 * Keep this separate from the scheduling engine and approval domain.
 */
export interface SchedulePreview {
  startDate: string;
  endDate: string;
  timeZone: string;
  assignments: DatedWorkShift[];
}

export type DayKind = "closed" | "proposal" | "unplanned";
export type TeamRowKind = "assigned" | "available" | "unavailable" | "unplanned";
export type TeamFilter = "all" | TeamRowKind | "selected";

export interface DayTeamRow {
  id: string;
  name: string;
  kind: TeamRowKind;
  shift: DatedWorkShift | null;
}
export interface DaySummary {
  total: number;
  assigned: number;
  available: number;
  unavailable: number;
  unplanned: number;
}

function parseCivil(date: string): Date {
  const parsed = new Date(date + "T12:00:00Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== date)
    throw new Error("Data civil inválida: " + date);
  return parsed;
}

export function addCivilDays(date: string, days: number): string {
  const parsed = parseCivil(date);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}
export function monthStart(date: string): string {
  parseCivil(date);
  return date.slice(0, 7) + "-01";
}
export function moveCalendarMonth(date: string, offset: number): string {
  const parsed = parseCivil(monthStart(date));
  parsed.setUTCMonth(parsed.getUTCMonth() + offset);
  return parsed.toISOString().slice(0, 10);
}
export function monthCalendarDates(month: string): string[] {
  const first = monthStart(month);
  const weekday = (parseCivil(first).getUTCDay() + 6) % 7;
  const start = addCivilDays(first, -weekday);
  const next = moveCalendarMonth(first, 1);
  const lastDay = addCivilDays(next, -1);
  const weeks = Math.ceil((weekday + Number(lastDay.slice(8, 10))) / 7);
  return Array.from({length: weeks * 7}, (_, i) => addCivilDays(start, i));
}
export function todayInTimeZone(timeZone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const get = (key: string) => parts.find(p => p.type === key)?.value ?? "";
  const date = get("year") + "-" + get("month") + "-" + get("day");
  parseCivil(date);
  return date;
}
export function proposalCovers(preview: SchedulePreview | null, date: string): boolean {
  return Boolean(preview && preview.startDate <= date && date <= preview.endDate);
}
export function dayKind(
  date: string,
  operation: OperatingCalendarConfiguration,
  preview: SchedulePreview | null
): DayKind {
  const intervals = getOperatingIntervalsForDate(
    date, operation.weeklyOperatingHours, operation.exceptions
  );
  if (!intervals.length) return "closed";
  return proposalCovers(preview, date) ? "proposal" : "unplanned";
}
export function dailyTeamRows(input: {
  date: string;
  people: Person[];
  availabilities: PersonAvailability[];
  operation: OperatingCalendarConfiguration;
  preview: SchedulePreview | null;
}): DayTeamRow[] {
  const {date, people, availabilities, operation, preview} = input;
  const covered = dayKind(date, operation, preview) === "proposal";
  const byPerson = new Map<string, DatedWorkShift>();
  if (covered && preview) {
    for (const shift of preview.assignments) {
      if (shift.date === date) byPerson.set(shift.personId, shift);
    }
  }
  return people.filter(person => person.active && employedOn(person,date)).map(person => {
    const shift = byPerson.get(person.id) ?? null;
    if (shift) return {id: person.id, name: person.name, kind: "assigned" as const, shift};
    if (!covered) return {id: person.id, name: person.name, kind: "unplanned" as const, shift: null};
    const availability = availabilities.find(item => item.personId === person.id);
    const eligible = availability ? getSchedulableIntervalsForDate(
      date, availability, operation.weeklyOperatingHours, operation.exceptions
    ).length > 0 : false;
    return {id: person.id, name: person.name,
      kind: eligible ? "available" as const : "unavailable" as const, shift: null};
  }).sort((a, b) => a.name.localeCompare(b.name, "pt-PT") || a.id.localeCompare(b.id));
}
export function daySummary(rows: DayTeamRow[]): DaySummary {
  return {
    total: rows.length,
    assigned: rows.filter(r => r.kind === "assigned").length,
    available: rows.filter(r => r.kind === "available").length,
    unavailable: rows.filter(r => r.kind === "unavailable").length,
    unplanned: rows.filter(r => r.kind === "unplanned").length,
  };
}
export function filterDailyTeam(
  rows: DayTeamRow[], filter: TeamFilter, search: string,
  selectedIds: ReadonlySet<string> = new Set()
): DayTeamRow[] {
  const query = search.trim().toLocaleLowerCase("pt-PT");
  return rows.filter(row =>
    (filter === "all" || (filter === "selected" ? selectedIds.has(row.id) : row.kind === filter)) &&
    row.name.toLocaleLowerCase("pt-PT").includes(query)
  );
}
/** Applies to ALL rows matching a filter, not merely the current page. */
export function toggleFilteredSelection(
  existing: ReadonlySet<string>, matchingIds: string[]
): Set<string> {
  const next = new Set(existing);
  if (matchingIds.length && matchingIds.every(id => next.has(id)))
    matchingIds.forEach(id => next.delete(id));
  else matchingIds.forEach(id => next.add(id));
  return next;
}
export function effectiveShiftMinutes(
  shift: DatedWorkShift, timeZone = DEFAULT_OPERATION_TIME_ZONE
): number {
  // NaN is intentional fail-closed, rather than silently miscounting DST.
  return getEffectiveWorkMinutesInTimeZone(shift,timeZone) ?? Number.NaN;
}
