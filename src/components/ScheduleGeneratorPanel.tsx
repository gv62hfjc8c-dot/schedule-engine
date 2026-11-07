import type {
  OperatingCalendarConfiguration,
  Person,
  PersonAvailability,
  PresenceConfiguration,
  WorkRulesConfiguration,
} from "../types";
import type {
  GeneratedSchedulePayload,
  StoredGeneratedSchedule,
} from "../persistence/generatedScheduleRepository";
import ConstrainedPeriodGeneratorPanel from "./ConstrainedPeriodGeneratorPanel";

interface ScheduleGeneratorPanelProps {
  people: Person[];
  availabilities: PersonAvailability[];
  operatingCalendar: OperatingCalendarConfiguration;
  workRules: WorkRulesConfiguration;
  presence: PresenceConfiguration;
  operationTimeZone: string;
  initialDate?: string;
  onSaveGenerated?(
    payload: GeneratedSchedulePayload,
    proposalId: string,
  ): Promise<StoredGeneratedSchedule>;
  onBackToCalendar?(): void;
}

/**
 * Only the constrained generator is part of the live application.
 *
 * Former in-browser approval and mocked Supabase laboratories were never
 * rendered by this wrapper. Their original code remains in Git history;
 * the actual approved-schedule domain tests remain untouched.
 *
 * Never infer official approval from a generated or archived proposal.
 */
export default function ScheduleGeneratorPanel(props: ScheduleGeneratorPanelProps) {
  return <ConstrainedPeriodGeneratorPanel {...props} />;
}
