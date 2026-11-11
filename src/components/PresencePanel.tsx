import {useEffect,useState} from "react";
import type {
  OperatingHoursException,Person,PersonAvailability,PresenceException,
  PresenceRequirement,Weekday,WeeklyOperatingHours,WeeklyPresenceRequirements,
} from "../types";
import {getOperatingIntervalsForDate,WEEKDAYS} from "../utils/operatingCalendar";
import {
  checkPresenceAvailabilityCapacity,defaultMinimumPresence,
  getPresencePhaseWindows,isPresenceRequirementValid,
} from "../utils/presence";
import {
  isCoverageConfirmed,validCoverageConfiguration,
  validatePresenceDraft,validatePresenceExceptionDraft,
} from "../utils/presenceConfiguration";
import type {OnboardingConfiguration} from "../utils/accountingCycleConfiguration";

interface Props {
  weeklyOperatingHours:WeeklyOperatingHours;
  operatingExceptions:OperatingHoursException[];
  people:Person[];
  availabilities:PersonAvailability[];
  weeklyRequirements:WeeklyPresenceRequirements;
  exceptions:PresenceException[];
  onWeeklyChange(next:WeeklyPresenceRequirements):void;
  onExceptionsChange(next:PresenceException[]):void;
  onboarding?:OnboardingConfiguration;
  operationConfirmed?:boolean;
  persistenceStatus?:"loading"|"saving"|"saved"|"error";
  onConfirmCoverage?():void;
  onDraftOpenChange?(open:boolean):void;
}
const labels:Record<Weekday,string>={
  monday:"Segunda",tuesday:"Terça",wednesday:"Quarta",
  thursday:"Quinta",friday:"Sexta",saturday:"Sábado",sunday:"Domingo",
};
const defaultRule=()=>defaultMinimumPresence();
const phaseLabels={
  minimumAtOpening:"Na abertura",
  minimumDuringOperation:"Período central",
  minimumAtClosing:"No fecho",
} as const;
type PhaseKey=keyof typeof phaseLabels;

function RequirementFields({value,onChange,qualifications,prefix}:{
  value:PresenceRequirement;onChange(next:PresenceRequirement):void;
  qualifications:string[];prefix:string;
}){
  return <div className="presence-edit-fields">
    {(Object.keys(phaseLabels) as PhaseKey[]).map(key=>
      <label className="presence-edit-field" key={key}>
        <span>{phaseLabels[key]}</span>
        <input type="number" min="0" step="1" inputMode="numeric"
          aria-label={prefix+": "+phaseLabels[key]}
          value={value[key]}
          onChange={event=>{
            const next=event.target.value===""?0:Number(event.target.value);
            if(Number.isSafeInteger(next)&&next>=0)
              onChange({...value,[key]:next});
          }}/>
      </label>)}
    {qualifications.length>0 &&
      <details className="presence-qualifications">
        <summary>Mínimos adicionais por qualificação</summary>
        {qualifications.map(tag=><label key={tag} className="presence-edit-field">
          <span>{tag}</span>
          <input type="number" min="0" max="1000" step="1"
            aria-label={prefix+": mínimo para "+tag}
            value={value.qualifiedCoverage?.[tag]??0}
            onChange={event=>{
              const next=Number(event.target.value||"0");
              if(!Number.isSafeInteger(next)||next<0||next>1000)return;
              const demands={...(value.qualifiedCoverage??{})};
              if(next===0)delete demands[tag];else demands[tag]=next;
              onChange({...value,qualifiedCoverage:Object.keys(demands).length?demands:undefined});
            }}/>
        </label>)}
      </details>}
  </div>;
}

const summary=(r:PresenceRequirement)=>{
  const list=`Abertura ${r.minimumAtOpening} · Centro ${r.minimumDuringOperation} · Fecho ${r.minimumAtClosing}`;
  const qualifications=r.qualifiedCoverage && Object.entries(r.qualifiedCoverage)
    .filter(([,n])=>n>0).map(([name,n])=>`${name}: ${n}`).join(" · ");
  return qualifications?list+" · "+qualifications:list;
};
const formatPeriods=(list:{start:string;end:string}[])=>
  list.map(x=>x.start+"–"+x.end).join(" · ");
const phaseDescription=(list:{start:string;end:string}[])=>{
  const windows=getPresencePhaseWindows(list);
  if(!windows)return null;
  return `Abertura: ${formatPeriods(windows.opening)} | Centro: ${formatPeriods(windows.central)} | Fecho: ${formatPeriods(windows.closing)}`;
};
function safeIntervals(date:string,weekly:WeeklyOperatingHours,exceptions:OperatingHoursException[]){
  try{return getOperatingIntervalsForDate(date,weekly,exceptions);}catch{return null;}
}

export default function PresencePanel({
  weeklyOperatingHours,operatingExceptions,people,availabilities,
  weeklyRequirements,exceptions,onWeeklyChange,onExceptionsChange,
  onboarding,operationConfirmed=false,persistenceStatus="saved",
  onConfirmCoverage,onDraftOpenChange,
}:Props){
  const [bulkOpen,setBulkOpen]=useState(false);
  const [bulkMode,setBulkMode]=useState<"uniform"|"phases">("uniform");
  const [bulkCount,setBulkCount]=useState(1);
  const [bulkRule,setBulkRule]=useState<PresenceRequirement>(defaultRule);
  const [bulkScope,setBulkScope]=useState<"inherited"|"all">("inherited");
  const [bulkIssue,setBulkIssue]=useState("");
  const [editingDay,setEditingDay]=useState<Weekday|null>(null);
  const [dayRule,setDayRule]=useState<PresenceRequirement>(defaultRule);
  const [dayIssue,setDayIssue]=useState("");
  const [resetDay,setResetDay]=useState<Weekday|null>(null);
  const [editingException,setEditingException]=useState<"new"|number|null>(null);
  const [exceptionDraft,setExceptionDraft]=useState<PresenceException>({
    date:"",requirements:null,
  });
  const [exceptionIssue,setExceptionIssue]=useState("");
  const [removingException,setRemovingException]=useState<number|null>(null);
  const hasDraft=bulkOpen||editingDay!==null||editingException!==null;
  useEffect(()=>onDraftOpenChange?.(hasDraft),[hasDraft,onDraftOpenChange]);

  const openDays=WEEKDAYS.filter(day=>weeklyOperatingHours[day].length>0);
  const invalidDays=openDays.filter(day=>weeklyRequirements[day]!==null &&
    !isPresenceRequirementValid(weeklyRequirements[day]!)).length;
  const customDays=openDays.filter(day=>weeklyRequirements[day]!==null).length;
  const inheritedDays=openDays.length-customDays;
  const qualifications=[...new Set(people.filter(p=>p.active)
    .flatMap(p=>p.qualificationTags??[]))].sort();
  const byId=new Map(availabilities.map(item=>[item.personId,item]));
  const confirmed=isCoverageConfirmed(
    onboarding,operationConfirmed,weeklyOperatingHours,operatingExceptions,
    weeklyRequirements,exceptions,
  );
  const valid=validCoverageConfiguration(weeklyOperatingHours,weeklyRequirements,exceptions);

  const closeBulk=()=>{setBulkOpen(false);setBulkIssue("");};
  const closeDay=()=>{setEditingDay(null);setDayIssue("");};
  function applyBulk(){
    const draft=bulkMode==="uniform"
      ?{minimumAtOpening:bulkCount,minimumDuringOperation:bulkCount,
        minimumAtClosing:bulkCount}
      :bulkRule;
    const result=validatePresenceDraft(draft);
    if(!result.valid){setBulkIssue(result.issue);return;}
    const updated={...weeklyRequirements};
    let applied=0;
    for(const day of openDays){
      if(bulkScope==="inherited" && updated[day]!==null)continue;
      updated[day]={...result.requirement};
      applied++;
    }
    if(applied>0)onWeeklyChange(updated);
    closeBulk();
  }
  function beginDay(day:Weekday){
    closeBulk();setResetDay(null);setEditingDay(day);
    setDayRule(weeklyRequirements[day]
      ? structuredClone(weeklyRequirements[day]) : defaultRule());
    setDayIssue("");
  }
  function saveDay(){
    if(!editingDay)return;
    const result=validatePresenceDraft(dayRule);
    if(!result.valid){setDayIssue(result.issue);return;}
    onWeeklyChange({...weeklyRequirements,[editingDay]:result.requirement});
    closeDay();
  }
  function beginException(index:"new"|number){
    closeBulk();closeDay();setRemovingException(null);
    setEditingException(index);setExceptionIssue("");
    const existing=typeof index==="number"?exceptions[index]:null;
    setExceptionDraft(existing
      ?{date:existing.date,requirements:existing.requirements
        ? structuredClone(existing.requirements):null}
      :{date:"",requirements:null});
  }
  function saveException(){
    const checked=validatePresenceExceptionDraft(exceptionDraft,exceptions,
      typeof editingException==="number"?editingException:null);
    if(!checked.valid){setExceptionIssue(checked.issue);return;}
    if(editingException==="new")onExceptionsChange([...exceptions,checked.value]);
    else if(typeof editingException==="number")
      onExceptionsChange(exceptions.map((x,i)=>i===editingException?checked.value:x));
    setEditingException(null);setExceptionIssue("");
  }
  function cancelException(){setEditingException(null);setExceptionIssue("");}

  return <>
    <section className="overview-bar" aria-label="Resumo de presença">
      <div className="overview-item"><span>Dias abertos</span><strong>{openDays.length}</strong></div>
      <div className="overview-item"><span>Cobertura mínima ativa</span>
        <strong>{openDays.length-invalidDays} / {openDays.length}</strong></div>
      <div className="overview-item"><span>Com regra padrão de 1 pessoa</span>
        <strong>{inheritedDays}</strong></div>
    </section>

    <section className="panel presence-panel">
      <div className="panel-header">
        <div><p className="section-kicker">Configuração inicial · Etapa 2</p>
          <h2>Cobertura necessária</h2></div>
        <p className="panel-help">Mínimos obrigatórios, não quantidades exatas.
          O gerador pode escalar mais pessoas.</p>
      </div>
      <div className="presence-default-explanation">
        <div>
          <strong>Regra padrão: 1 pessoa durante todo o funcionamento</strong>
          <p>Aplica-se automaticamente a cada dia aberto sem personalização,
            incluindo todas as suas faixas de funcionamento. Não são criadas regras
            a zero. A empresa pode personalizar dias ou aceitar este padrão.</p>
        </div>
        {!bulkOpen && <button type="button" className="se-outline"
          onClick={()=>{closeDay();setBulkOpen(true);setBulkIssue("");}}>
          Configurar vários dias
        </button>}
      </div>

      {bulkOpen && <div className="presence-bulk-editor" role="group"
        aria-label="Configurar cobertura de vários dias">
        <p>Define uma regra e escolhe onde a aplicar. Nenhuma alteração é guardada até confirmares.</p>
        <fieldset className="presence-mode-options">
          <legend>Tipo de cobertura</legend>
          <label><input type="radio" name="presence-bulk-mode"
            checked={bulkMode==="uniform"} onChange={()=>setBulkMode("uniform")}/>
            Uniforme durante o funcionamento</label>
          <label><input type="radio" name="presence-bulk-mode"
            checked={bulkMode==="phases"} onChange={()=>setBulkMode("phases")}/>
            Personalizada por abertura, período central e fecho</label>
        </fieldset>
        {bulkMode==="uniform"
          ?<label className="presence-edit-field presence-uniform">
            <span>Mínimo de colaboradores em simultâneo</span>
            <input type="number" min="0" step="1"
              aria-label="Mínimo uniforme de colaboradores" value={bulkCount}
              onChange={e=>{
                const n=Number(e.target.value||"0");
                if(Number.isSafeInteger(n)&&n>=0)setBulkCount(n);
              }}/>
          </label>
          :<RequirementFields prefix="Aplicação semanal"
            value={bulkRule} qualifications={qualifications}
            onChange={setBulkRule}/>}
        <fieldset className="presence-mode-options">
          <legend>Aplicar a que dias?</legend>
          <label><input type="radio" name="presence-scope"
            checked={bulkScope==="inherited"} onChange={()=>setBulkScope("inherited")}/>
            Apenas dias com regra padrão ({inheritedDays})</label>
          <label><input type="radio" name="presence-scope"
            checked={bulkScope==="all"} onChange={()=>setBulkScope("all")}/>
            Todos os {openDays.length} dias abertos (substitui personalizações)</label>
        </fieldset>
        {bulkScope==="all"&&customDays>0 &&
          <p className="presence-capacity-note">Vais substituir as regras personalizadas de {customDays} dias.</p>}
        {bulkIssue && <p className="presence-validation" role="alert">{bulkIssue}</p>}
        <div className="presence-draft-actions">
          <button type="button" className="se-outline" onClick={closeBulk}>Cancelar</button>
          <button type="button" className="primary-button" onClick={applyBulk}>
            Aplicar e guardar mínimos</button>
        </div>
      </div>}

      <div className="presence-week-grid">
        {WEEKDAYS.map(day=>{
          const closed=weeklyOperatingHours[day].length===0;
          const raw=weeklyRequirements[day];
          const custom=raw!==null;
          const r=raw??defaultRule();
          const validRule=isPresenceRequirementValid(r);
          const capacity=validRule && !closed && people.some(p=>p.active)
            ?checkPresenceAvailabilityCapacity(
              weeklyOperatingHours[day],r,
              people.filter(p=>p.active).map(p=>
                byId.get(p.id)?.weeklyAvailability[day]??[]))
            :null;
          const shortage=capacity?.shortages[0];
          return <article className={"presence-day presence-compact-day"+
            (closed?" is-closed":"")} key={day}>
            <div className="presence-day-head">
              <div><strong>{labels[day]}</strong>
                <span>{closed?"Fechado":formatPeriods(weeklyOperatingHours[day])}</span>
              </div>
              {!closed && <span className={"presence-rule-kind"+(custom?" custom":"")}>
                {custom?"Personalizada":"Padrão"}</span>}
            </div>
            {closed?<p className="presence-muted">
              Sem cobertura necessária. As regras anteriores ficam preservadas.</p>
            :editingDay===day
              ?<div className="presence-day-draft">
                <p>Os valores só entram em vigor depois de Guardar.</p>
                <RequirementFields value={dayRule} onChange={setDayRule}
                  qualifications={qualifications} prefix={labels[day]}/>
                {dayIssue && <p role="alert" className="presence-validation">{dayIssue}</p>}
                <div className="presence-draft-actions">
                  <button className="se-outline" type="button" onClick={closeDay}>Cancelar</button>
                  <button className="primary-button" type="button" onClick={saveDay}>
                    Guardar mínimos</button>
                </div>
              </div>
              :<>
                <p className="presence-muted">
                  {validRule ? custom?summary(r):"Mínimo de 1 pessoa em todo o horário"
                    :"Regra inválida — requer correção"}
                </p>
                <div className="presence-day-actions">
                  <button className="se-outline" type="button"
                    onClick={()=>beginDay(day)}>
                    {custom?"Editar mínimos":"Personalizar"}
                  </button>
                  {custom && (resetDay===day
                    ? <><button className="se-outline" type="button"
                        onClick={()=>setResetDay(null)}>Cancelar</button>
                       <button className="se-outline" type="button"
                        onClick={()=>{onWeeklyChange({...weeklyRequirements,[day]:null});setResetDay(null);}}>
                        Confirmar padrão</button></>
                    :<button className="presence-text-button" type="button"
                      onClick={()=>setResetDay(day)}>Repor padrão</button>)}
                </div>
                {shortage && <p className="presence-capacity-note">
                  Disponibilidades atualmente insuficientes em {shortage.interval.start}–{shortage.interval.end}:
                  {" "}{shortage.actual} elegíveis para {shortage.required} necessários.
                  Diagnóstico preliminar, não é uma proposta de horário.</p>}
                <details className="presence-phase-details">
                  <summary>Ver fases de 30 minutos</summary>
                  <p>{phaseDescription(weeklyOperatingHours[day])}</p>
                </details>
              </>}
          </article>;
        })}
      </div>
      {invalidDays>0 && <p role="alert" className="presence-validation">
        Existem {invalidDays} dias com cobertura personalizada inválida.</p>}
    </section>

    <section className="panel presence-panel">
      <div className="panel-header">
        <div><p className="section-kicker">Datas específicas</p>
          <h2>Exceções de cobertura</h2></div>
        <button className="primary-button" type="button"
          onClick={()=>beginException("new")}>+ Adicionar</button>
      </div>
      <p className="section-description">
        Uma exceção substitui a regra semanal nessa data. Sem personalização,
        aplica-se o padrão de 1 pessoa; em dias fechados, não existe cobertura.
      </p>
      {editingException==="new" && <div className="presence-exception-draft">
        <PresenceExceptionEditor value={exceptionDraft} onChange={setExceptionDraft}
          weekly={weeklyOperatingHours} operatingExceptions={operatingExceptions}
          issue={exceptionIssue} qualifications={qualifications}
          onSave={saveException} onCancel={cancelException}/>
      </div>}
      {exceptions.length===0 && editingException!=="new"
        ?<div className="empty-state">
          <div className="empty-icon">◎</div>
          <strong>Sem exceções de cobertura</strong>
          <p>Aplicam-se as regras semanais ou o mínimo padrão de 1 pessoa.</p>
        </div>
        :<div className="presence-exceptions">
          {exceptions.map((item,index)=>
            <article className="presence-exception" key={item.date}>
              {editingException===index
                ?<PresenceExceptionEditor value={exceptionDraft}
                  onChange={setExceptionDraft} issue={exceptionIssue}
                  weekly={weeklyOperatingHours}
                  operatingExceptions={operatingExceptions}
                  qualifications={qualifications}
                  onSave={saveException} onCancel={cancelException}/>
                :<>
                  <div className="presence-exception-top">
                    <div><strong>{item.date}</strong>
                      <p>{item.requirements?summary(item.requirements):
                        "Regra padrão de 1 pessoa"}</p></div>
                    <div className="presence-day-actions">
                      <button type="button" className="se-outline"
                        onClick={()=>beginException(index)}>Editar</button>
                      {removingException===index
                        ?<><button type="button" className="se-outline"
                          onClick={()=>setRemovingException(null)}>Cancelar</button>
                          <button type="button" className="se-outline"
                            onClick={()=>{
                              onExceptionsChange(exceptions.filter((_,i)=>i!==index));
                              setRemovingException(null);
                            }}>Confirmar remoção</button></>
                        :<button type="button" className="se-outline"
                          onClick={()=>setRemovingException(index)}>Remover</button>}
                    </div>
                  </div>
                </>}
            </article>)}
        </div>}
    </section>

    <section className="panel presence-confirm-panel" aria-label="Confirmação de cobertura">
      <div>
        <p className="section-kicker">Configuração inicial · Etapa 2</p>
        <h2>{confirmed?"Cobertura confirmada":"Confirmar cobertura da empresa"}</h2>
        <p>{confirmed
          ?"A cobertura foi confirmada e está guardada. Mudanças posteriores exigem nova confirmação."
          :"Podes aceitar o mínimo padrão de 1 pessoa em todos os dias abertos sem criar seis regras. Também podes confirmar as personalizações já guardadas."}</p>
        <p>Esta confirmação valida as regras de cobertura, não garante que a equipa existente
          permita construir um horário viável.</p>
      </div>
      {confirmed
        ?<strong className="guided-status done">Etapa 2 confirmada</strong>
        :<button type="button" className="primary-button"
          disabled={!operationConfirmed||!valid||persistenceStatus!=="saved"||hasDraft}
          onClick={onConfirmCoverage}>
          Confirmar cobertura
        </button>}
      {!operationConfirmed && <p className="presence-validation">
        Confirma primeiro o funcionamento da empresa na Etapa 1.</p>}
    </section>
    <p className="presence-disclaimer">
      Cobertura padrão ou personalizada é uma hard constraint real. O motor exige
      presença durante cada intervalo aberto; pausas sem substituição não contam.
      A viabilidade depende ainda das disponibilidades, vínculos e outras regras.
      Cobertura permanente 24h e atravessamento da meia-noite não estão certificados.
    </p>
  </>;
}

function PresenceExceptionEditor({value,onChange,weekly,operatingExceptions,
  qualifications,issue,onSave,onCancel}:{
  value:PresenceException;onChange(next:PresenceException):void;
  weekly:WeeklyOperatingHours;operatingExceptions:OperatingHoursException[];
  qualifications:string[];issue:string;onSave():void;onCancel():void;
}){
  const operating=value.date?safeIntervals(value.date,weekly,operatingExceptions):null;
  return <div className="presence-exception-editor" role="group"
    aria-label="Editar exceção de cobertura">
    <p>Rascunho por confirmar. A data e os mínimos só são gravados após Guardar.</p>
    <label className="presence-edit-field">
      <span>Data da exceção</span>
      <input type="date" aria-label="Data da exceção de cobertura"
        value={value.date}
        onChange={e=>onChange({...value,date:e.target.value})}/>
    </label>
    {operating && !operating.length &&
      <p className="presence-muted">A empresa está fechada nesta data. Não se aplica cobertura.</p>}
    <fieldset className="presence-mode-options">
      <legend>Regra nesta data</legend>
      <label><input type="radio" name="presence-exception-kind"
        checked={value.requirements===null}
        onChange={()=>onChange({...value,requirements:null})}/>
        Usar mínimo padrão de 1 pessoa</label>
      <label><input type="radio" name="presence-exception-kind"
        checked={value.requirements!==null}
        onChange={()=>onChange({...value,requirements:defaultRule()})}/>
        Personalizar cobertura da data</label>
    </fieldset>
    {value.requirements && <RequirementFields
      prefix="Exceção de cobertura" value={value.requirements}
      qualifications={qualifications}
      onChange={requirements=>onChange({...value,requirements})}/>}
    {issue&&<p role="alert" className="presence-validation">{issue}</p>}
    <div className="presence-draft-actions">
      <button className="se-outline" type="button" onClick={onCancel}>Cancelar</button>
      <button className="primary-button" type="button" onClick={onSave}>Guardar exceção</button>
    </div>
  </div>;
}
