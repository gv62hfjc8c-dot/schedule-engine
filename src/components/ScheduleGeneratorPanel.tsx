import { useState } from "react";
import type {
  OperatingCalendarConfiguration,
  Person,
  PersonAvailability,
  PresenceConfiguration,
  WorkRulesConfiguration,
} from "../types";
import DailyGeneratorPanel from "./DailyGeneratorPanel";
import PeriodGeneratorPanel from "./PeriodGeneratorPanel";

interface ScheduleGeneratorPanelProps {
  people: Person[];
  availabilities: PersonAvailability[];
  operatingCalendar: OperatingCalendarConfiguration;
  workRules: WorkRulesConfiguration;
  presence: PresenceConfiguration;
}

export default function ScheduleGeneratorPanel(
  props: ScheduleGeneratorPanelProps
) {
  const [mode, setMode] = useState<"day" | "period">("day");

  return (
    <>
      <nav className="generator-mode-switch" aria-label="Modo de geração">
        <button
          type="button"
          className={mode === "day" ? "generator-mode-active" : ""}
          aria-pressed={mode === "day"}
          onClick={() => setMode("day")}
        >
          Um dia
        </button>
        <button
          type="button"
          className={mode === "period" ? "generator-mode-active" : ""}
          aria-pressed={mode === "period"}
          onClick={() => setMode("period")}
        >
          Vários dias · V0
        </button>
      </nav>

      {mode === "day" ? (
        <DailyGeneratorPanel {...props} />
      ) : (
        <PeriodGeneratorPanel {...props} />
      )}
    </>
  );
}
