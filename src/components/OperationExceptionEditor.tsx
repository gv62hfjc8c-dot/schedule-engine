import {useState} from "react";
import type {OperatingHoursException, WeeklyOperatingHours} from "../types";
import {getWeekday} from "../utils/operatingCalendar";
import {
  createOperationExceptionDraft,
  validateOperationExceptionDraft,
  type OperationExceptionDraft,
} from "../utils/operationConfigurationDraft";
import IntervalListEditor from "./IntervalListEditor";
import CalendarDateInput from "./CalendarDateInput";

interface Props {
  initial?: OperatingHoursException;
  existing: OperatingHoursException[];
  editingIndex: number | null;
  weeklyHours: WeeklyOperatingHours;
  onSave(next: OperatingHoursException): void;
  onCancel(): void;
}

export default function OperationExceptionEditor({
  initial,existing,editingIndex,weeklyHours,onSave,onCancel,
}: Props) {
  const [draft,setDraft]=useState<OperationExceptionDraft>(
    ()=>createOperationExceptionDraft(initial)
  );
  const [issue,setIssue]=useState("");
  const [suggested,setSuggested]=useState(false);
  const update=(patch:Partial<OperationExceptionDraft>)=>{
    setIssue("");
    setDraft(current=>({...current,...patch}));
  };

  function chooseMode(mode:"closed"|"open") {
    if(mode==="closed") {
      update({mode});
      return;
    }
    const date=draft.date;
    const template=date ? weeklyHours[getWeekday(date)] : [];
    update({mode,intervals:draft.intervals.length
      ? draft.intervals
      : template.length
        ? template.map(interval=>({...interval}))
        : [{start:"09:00",end:"18:00"}]});
    setSuggested(true);
  }

  function submit(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation=validateOperationExceptionDraft(draft,existing,editingIndex);
    if(!validation.valid) {
      setIssue(validation.issue);
      return;
    }
    onSave(validation.value);
  }

  return <form className="operation-exception-draft" onSubmit={submit}
    aria-label={initial?"Editar exceção":"Nova exceção"}>
    <div className="operation-exception-fields">
      <label className="operation-exception-date">
        <span>Data da exceção</span>
        <CalendarDateInput value={draft.date}
          aria-label="Data da exceção"
          onChange={event=>update({date:event.target.value})}/>
      </label>
      <label>
        <span>Motivo</span>
        <input type="text" maxLength={160} value={draft.reason}
          placeholder="Ex.: Feriado, inventário ou evento especial"
          onChange={event=>update({reason:event.target.value})}/>
      </label>
    </div>
    <fieldset className="operation-exception-mode">
      <legend>Funcionamento nesta data</legend>
      <label>
        <input type="radio" name="exceptionMode"
          checked={draft.mode==="closed"}
          onChange={()=>chooseMode("closed")}/>
        Encerrado
      </label>
      <label>
        <input type="radio" name="exceptionMode"
          checked={draft.mode==="open"}
          onChange={()=>chooseMode("open")}/>
        Aberto com horário especial
      </label>
    </fieldset>
    {draft.mode==="open" && <div className="operation-exception-open">
      {suggested && <p className="operation-exception-hint">
        Horário sugerido — confirma ou altera antes de guardar.
      </p>}
      <IntervalListEditor
        label="horário especial"
        intervals={draft.intervals}
        onChange={intervals=>update({intervals})}
        operationMode
      />
    </div>}
    {issue && <p className="presence-validation" role="alert">{issue}</p>}
    <div className="operation-exception-actions">
      <button type="button" className="se-outline" onClick={onCancel}>Cancelar</button>
      <button type="submit" className="primary-button">Guardar exceção</button>
    </div>
  </form>;
}
