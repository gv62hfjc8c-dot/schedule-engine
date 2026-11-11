import {useState} from "react";
import {validSchedulingDate} from "../utils/personSchedulingPolicies";
import {
  selectedCycleLength,
  type AccountingCycleDays,
} from "../utils/accountingCycleConfiguration";

interface Props {
  anchorDate:string;
  days?:AccountingCycleDays;
  decisionConfirmed:boolean;
  onSave(anchorDate:string,days?:AccountingCycleDays):void;
  onDraftOpenChange?(open:boolean):void;
}

export default function OperationCycleSettings({
  anchorDate,days,decisionConfirmed,onSave,onDraftOpenChange,
}:Props){
  const [open,setOpen]=useState(false);
  const [choice,setChoice]=useState<"none"|"7"|"14"|"28">("none");
  const [draftAnchor,setDraftAnchor]=useState("");
  const [issue,setIssue]=useState("");
  const selected=selectedCycleLength(anchorDate,days);

  const summary=selected
    ? `Ciclo de ${selected} dias · início ${anchorDate}`
    : decisionConfirmed?"Sem ciclo fixo":"Por decidir no onboarding";

  function edit(){
    setChoice(selected?String(selected) as "7"|"14"|"28":"none");
    setDraftAnchor(anchorDate);
    setIssue("");
    setOpen(true);
    onDraftOpenChange?.(true);
  }
  function close(){
    setOpen(false);
    setIssue("");
    onDraftOpenChange?.(false);
  }
  function submit(){
    if(choice==="none"){
      onSave("");
      close();
      return;
    }
    if(!validSchedulingDate(draftAnchor)){
      setIssue("Escolhe uma data de início válida antes de guardar.");
      return;
    }
    onSave(draftAnchor,Number(choice) as AccountingCycleDays);
    close();
  }
  return <div className="operation-cycle-choice" aria-label="Ciclo de trabalho">
    <div className="operation-cycle-summary">
      <div className="operation-cycle-summary-copy">
        <span>Ciclo de trabalho (opcional)</span>
        <strong>{summary}</strong>
      </div>
      {!open && <button type="button" className="se-outline"
        onClick={edit}>{decisionConfirmed?"Alterar ciclo":"Escolher ciclo"}</button>}
    </div>
    {open && <div className="operation-cycle-editor" role="group"
      aria-label="Escolher ciclo de trabalho">
      <p>Esta escolha define apenas a referência contabilística. Não limita a duração dos horários gerados.</p>
      <fieldset>
        <legend>A empresa utiliza um ciclo fixo?</legend>
        <label><input type="radio" name="accounting-cycle-choice"
          checked={choice==="none"} onChange={()=>{setChoice("none");setIssue("");}}/>
          Não, sem ciclo fixo</label>
        <label><input type="radio" name="accounting-cycle-choice"
          checked={choice!=="none"}
          onChange={()=>{setChoice(selected?String(selected) as "7"|"14"|"28":"28");setIssue("");}}/>
          Sim, utiliza um ciclo</label>
      </fieldset>
      {choice!=="none" && <div className="operation-cycle-fields">
        <label>
          <span>Qual é o ciclo?</span>
          <select aria-label="Duração do ciclo de trabalho" value={choice}
            onChange={event=>setChoice(event.target.value as "7"|"14"|"28")}>
            <option value="7">Semanal — 7 dias</option>
            <option value="14">Quinzenal — 14 dias</option>
            <option value="28">Quatro semanas — 28 dias</option>
          </select>
        </label>
        <label>
          <span>Data de início do ciclo</span>
          <input type="date" aria-label="Data de início do ciclo"
            value={draftAnchor}
            onChange={event=>{setDraftAnchor(event.target.value);setIssue("");}}/>
        </label>
        {!draftAnchor && <small>Nenhuma data definida. Não será escolhida automaticamente.</small>}
      </div>}
      {issue && <p role="alert" className="presence-validation">{issue}</p>}
      <div className="operation-cycle-actions">
        <button type="button" className="se-outline" onClick={close}>Cancelar</button>
        <button type="button" className="primary-button"
          onClick={submit}>Guardar escolha do ciclo</button>
      </div>
    </div>}
  </div>;
}
