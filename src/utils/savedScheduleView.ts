import type { StoredGeneratedSchedule } from "../persistence/generatedScheduleRepository";
import type { SchedulePreview } from "./monthlyScheduleView";

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
