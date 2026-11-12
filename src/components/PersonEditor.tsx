import {useState,type FormEvent} from "react";
import type {Person} from "../types";
import {validateEmploymentPeriods,type EmploymentPeriod} from "../utils/employmentPeriods";
import {validatePersonDraft,type EligibilityChoice} from "../utils/teamConfiguration";
import {validSchedulingDate} from "../utils/personSchedulingPolicies";

interface Props {
  initial?:Person;
  onSave(person:Person):void;
  onCancel():void;
}
function parseHours(raw:string):number|undefined|null {
  if(!raw.trim())return undefined;
  const minutes=Number(raw)*60;
  if(!Number.isSafeInteger(minutes)||minutes<0||minutes>7*24*60||
      minutes%15!==0)return null;
  return minutes;
}
const hours=(minutes?:number)=>minutes===undefined?"":String(minutes/60);

export default function PersonEditor({initial,onSave,onCancel}:Props){
  const [name,setName]=useState(initial?.name??"");
  const [eligibility,setEligibility]=useState<EligibilityChoice|null>(
    initial
      ?initial.employmentPeriods===undefined?"unrestricted":
        initial.employmentPeriods.length?"periods":"none"
      :null
  );
  const [periods,setPeriods]=useState<EmploymentPeriod[]>(
    ()=>initial?.employmentPeriods?.map(p=>({...p}))??[]);
  const [start,setStart]=useState("");
  const [end,setEnd]=useState("");
  const [contractHours,setContractHours]=useState(hours(initial?.weeklyContractMinutes));
  const [targetHours,setTargetHours]=useState(hours(initial?.weeklyTargetMinutes));
  const [qualifications,setQualifications]=useState(
    initial?.qualificationTags?.join(", ")??"");
  const [issue,setIssue]=useState("");

  function addPeriod(){
    if(!validSchedulingDate(start)||end!==""&&!validSchedulingDate(end)){
      setIssue("Indica datas de início e fim válidas.");
      return;
    }
    const updated=[...periods,{startDate:start,endDate:end||null}];
    const issues=validateEmploymentPeriods(updated);
    if(issues.length){setIssue(issues.join(" "));return;}
    setPeriods(updated);
    setStart("");
    setEnd("");
    setIssue("");
  }

  function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    const ceiling=parseHours(contractHours);
    const target=parseHours(targetHours);
    if(ceiling===null||target===null){
      setIssue("As horas semanais devem ser valores de 15 em 15 minutos, entre 0 e 168.");
      return;
    }
    const candidate:Person={
      ...(initial??{id:"",active:true,name:""}),
      name,
    };
    if(eligibility==="periods") candidate.employmentPeriods=periods.map(p=>({...p}));
    else if(eligibility==="none") candidate.employmentPeriods=[];
    else if(eligibility==="unrestricted") delete candidate.employmentPeriods;
    if(ceiling===undefined) delete candidate.weeklyContractMinutes;
    else candidate.weeklyContractMinutes=ceiling;
    if(target===undefined) delete candidate.weeklyTargetMinutes;
    else candidate.weeklyTargetMinutes=target;
    const tags=qualifications.split(",").map(t=>t.trim()).filter(Boolean);
    if(tags.length) candidate.qualificationTags=tags;
    else delete candidate.qualificationTags;
    const result=validatePersonDraft(candidate,eligibility);
    if(!result.valid){setIssue(result.issue);return;}
    onSave(result.person);
  }

  return <form className="team-person-draft"
    aria-label={initial?"Editar colaborador "+initial.name:"Novo colaborador"}
    onSubmit={submit}>
    <p className="team-draft-warning">Rascunho por confirmar. Nada é gravado até selecionares Guardar colaborador.</p>
    <fieldset className="team-draft-section">
      <legend>Identificação</legend>
      <label className="team-draft-field">
        <span>Nome do colaborador</span>
        <input type="text" maxLength={160} autoFocus value={name}
          onChange={e=>{setName(e.target.value);setIssue("");}}
          placeholder="Nome completo"/>
      </label>
      {initial&&<p>Estado atual: <strong>{initial.active?"Ativo":"Arquivado"}</strong>. O arquivo e a reativação são ações separadas.</p>}
    </fieldset>

    <fieldset className="team-draft-section">
      <legend>Vínculo e elegibilidade temporal</legend>
      <p>Escolhe quando esta pessoa pode ser escalada. Não é necessário existir um contrato de trabalho formal.</p>
      <label className="team-draft-radio">
        <input type="radio" name="team-eligibility" checked={eligibility==="unrestricted"}
          onChange={()=>{setEligibility("unrestricted");setIssue("");}}/>
        Sem restrição de datas (elegível enquanto estiver ativa)
      </label>
      <label className="team-draft-radio">
        <input type="radio" name="team-eligibility" checked={eligibility==="periods"}
          onChange={()=>{setEligibility("periods");setIssue("");}}/>
        Apenas em períodos definidos
      </label>
      {initial?.employmentPeriods?.length===0 && <label className="team-draft-radio">
        <input type="radio" name="team-eligibility" checked={eligibility==="none"}
          onChange={()=>{setEligibility("none");setIssue("");}}/>
        Sem períodos elegíveis (não escalável)
      </label>}
      {eligibility==="periods" && <div className="team-periods">
        {periods.length>0 && <ul>
          {periods.map((period,index)=><li key={index}>
            <span>{period.startDate} até {period.endDate??"sem data de fim"}</span>
            <button type="button" className="se-outline"
              onClick={()=>{setPeriods(current=>current.filter((_,i)=>i!==index));setIssue("");}}>
              Remover período
            </button>
          </li>)}
        </ul>}
        <div className="team-draft-grid">
          <label className="team-draft-field">
            <span>Data de início</span>
            <input type="date" aria-label="Data de início do vínculo" value={start}
              onChange={e=>{setStart(e.target.value);setIssue("");}}/>
          </label>
          <label className="team-draft-field">
            <span>Data de fim (opcional)</span>
            <input type="date" aria-label="Data de fim do vínculo" value={end}
              onChange={e=>{setEnd(e.target.value);setIssue("");}}/>
          </label>
        </div>
        <button type="button" className="se-outline" onClick={addPeriod}>
          Adicionar período ao rascunho
        </button>
      </div>}
      {initial?.employmentPeriods===undefined && <p className="team-legacy-note">
        Os dados existentes não têm datas de vínculo; o motor preserva esta elegibilidade sem limite por compatibilidade.
      </p>}
    </fieldset>

    <fieldset className="team-draft-section">
      <legend>Condições de trabalho (opcionais)</legend>
      <p>O limite contratual é obrigatório quando definido; o objetivo semanal é uma preferência de otimização, não uma obrigação.</p>
      <div className="team-draft-grid">
        <label className="team-draft-field">
          <span>Máximo contratual (horas por semana)</span>
          <input type="number" min="0" max="168" step="0.25"
            aria-label="Máximo contratual da pessoa" value={contractHours}
            placeholder="Usar limite da empresa"
            onChange={e=>{setContractHours(e.target.value);setIssue("");}}/>
        </label>
        <label className="team-draft-field">
          <span>Objetivo semanal (horas)</span>
          <input type="number" min="0" max="168" step="0.25"
            aria-label="Objetivo semanal da pessoa" value={targetHours}
            placeholder="Usar objetivo padrão"
            onChange={e=>{setTargetHours(e.target.value);setIssue("");}}/>
        </label>
      </div>
      <label className="team-draft-field">
        <span>Qualificações, separadas por vírgulas</span>
        <input type="text" aria-label="Qualificações da pessoa"
          value={qualifications} placeholder="Ex.: Receção, Caixa"
          onChange={e=>{setQualifications(e.target.value);setIssue("");}}/>
      </label>
    </fieldset>
    {issue&&<p className="form-error" role="alert">{issue}</p>}
    <div className="team-draft-actions">
      <button type="button" className="se-outline" onClick={onCancel}>Cancelar</button>
      <button type="submit" className="primary-button">Guardar colaborador</button>
    </div>
  </form>;
}
