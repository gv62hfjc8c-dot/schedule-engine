import type { StoredGeneratedSchedule, UnreadableGeneratedSchedule } from "../persistence/generatedScheduleRepository";
import type { OperatingCalendarConfiguration } from "../types";
import { dayKind, type DayKind, type SchedulePreview } from "./monthlyScheduleView";

/**
 * Proposals are immutable snapshots, not approved shifts. A calendar date
 * displays one snapshot, never a synthetic combination of multiple proposals.
 */
export function proposalsForDay(
  records: StoredGeneratedSchedule[], date: string
): StoredGeneratedSchedule[] {
  return records.filter(record => record.startDate <= date && date <= record.endDate)
    .sort((a,b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

export function selectedProposalForDay(
  records: StoredGeneratedSchedule[], date: string, selectedId: string | null
): StoredGeneratedSchedule | null {
  const options = proposalsForDay(records,date);
  return options.find(record => record.id === selectedId) ?? options[0] ?? null;
}

/**
 * Never stitch an apparent monthly schedule together implicitly. In focused
 * mode, missing days remain missing, even if another archived proposal covers
 * them. In overview mode, each day is explicitly an independent snapshot.
 */
export function calendarProposalForDay(
  records: StoredGeneratedSchedule[], date: string, focusedId: string | null
): StoredGeneratedSchedule | null {
  if (!focusedId) return selectedProposalForDay(records,date,null);
  return proposalsForDay(records,date).find(record=>record.id===focusedId) ?? null;
}

export interface CalendarArchiveOverview {
  sourceIds: string[];
  overlappingDays: number;
  mixedSources: boolean;
}
export function calendarArchiveOverview(
  records: StoredGeneratedSchedule[], dates: string[], focusedId: string | null
): CalendarArchiveOverview {
  const sources=new Set<string>();
  let overlappingDays=0;
  for(const date of dates){
    const options=proposalsForDay(records,date);
    if(options.length>1) overlappingDays++;
    const displayed=calendarProposalForDay(records,date,focusedId);
    if(displayed) sources.add(displayed.id);
  }
  return {
    sourceIds:[...sources],
    overlappingDays,
    mixedSources:sources.size>1,
  };
}

/**
 * A malformed archive entry may still have trustworthy date metadata. Only
 * mark affected dates indeterminate; if its date bounds are missing, fail
 * conservatively across the whole requested calendar window.
 */
export function unreadableArchiveAffectsDate(
  unreadable: UnreadableGeneratedSchedule[], date: string
): boolean {
  return unreadable.some(item =>
    !item.startDate || !item.endDate ||
    item.startDate <= date && date <= item.endDate);
}

export type ArchiveDayState =
  | DayKind | "loading" | "failed" | "outside-proposal" | "unknown";

/**
 * One source of truth for calendar and side-panel status. Loading failures,
 * unknown archived records, and days outside a focused proposal cannot be
 * presented as confirmed "unplanned" or "closed".
 */
export function archiveDayState(input: {
  date: string;
  records: StoredGeneratedSchedule[];
  unreadable: UnreadableGeneratedSchedule[];
  operation: OperatingCalendarConfiguration;
  focusedProposalId: string | null;
  loadState: "loading"|"ready"|"failed";
  selectedProposalId?: string | null;
}): ArchiveDayState {
  if(input.loadState!=="ready") return input.loadState;
  const record=input.focusedProposalId
    ? calendarProposalForDay(input.records,input.date,input.focusedProposalId)
    : selectedProposalForDay(input.records,input.date,input.selectedProposalId??null);
  if(!record && input.focusedProposalId) return "outside-proposal";
  if(!record && unreadableArchiveAffectsDate(input.unreadable,input.date))
    return "unknown";
  return dayKind(input.date,
    record?.payload.configuration.operatingCalendar??input.operation,
    record?previewFromStored(record):null);
}

export function previewFromStored(record: StoredGeneratedSchedule): SchedulePreview {
  return {
    startDate: record.startDate, endDate: record.endDate,
    timeZone: record.timeZone, assignments: record.payload.shifts,
  };
}

export function savedProposalLabel(record: StoredGeneratedSchedule): string {
  return new Intl.DateTimeFormat("pt-PT", {
    day:"2-digit", month:"2-digit", year:"numeric",
    hour:"2-digit", minute:"2-digit",
  }).format(new Date(record.createdAt));
}
