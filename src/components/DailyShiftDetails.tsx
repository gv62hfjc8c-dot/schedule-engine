import type {DatedWorkShift} from "../types";

interface DailyShiftDetailsProps {
  shift: DatedWorkShift | null;
  effectiveHours?: string;
  /** The label is factual only when its source is explicitly historical. */
  emptyLabel?: string;
}

export default function DailyShiftDetails({shift,effectiveHours,emptyLabel}:DailyShiftDetailsProps){
  if(!shift)return <span className="daily-shift-empty">{emptyLabel??"Sem turno atribuído"}</span>;
  return <div className="daily-shift-details" aria-label="Detalhes do turno">
    <div className="daily-shift-time">
      <span className="daily-shift-field">Turno</span>
      <strong>{shift.interval.start}–{shift.interval.end}</strong>
    </div>
    <div className="daily-shift-time">
      <span className="daily-shift-field">Refeição</span>
      <strong>{shift.mealBreak?
        shift.mealBreak.start+"–"+shift.mealBreak.end:"Sem pausa registada"}</strong>
    </div>
    {effectiveHours&&<div className="daily-shift-time daily-shift-total">
      <span className="daily-shift-field">Trabalho efetivo</span>
      <strong>{effectiveHours}</strong>
    </div>}
  </div>;
}
