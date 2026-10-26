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
import ConstrainedPeriodGeneratorPanel from "./ConstrainedPeriodGeneratorPanel";

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
  const [mode, setMode] = useState<"day" | "period" | "constrained">("day");

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
        <button
          type="button"
          className={mode === "constrained" ? "generator-mode-active" : ""}
          aria-pressed={mode === "constrained"}
          onClick={() => setMode("constrained")}
        >
          Vários dias · regras P6.3
        </button>
      </nav>

      {mode === "day" ? (
        <DailyGeneratorPanel {...props} />
      ) : mode === "period" ? (
        <PeriodGeneratorPanel {...props} />
      ) : (
        <ConstrainedPeriodGeneratorPanel {...props} />
      )}
    </>
  );
}
