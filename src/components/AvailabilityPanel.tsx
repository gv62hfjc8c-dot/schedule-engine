import {useEffect,useState} from "react";
import type {
  AvailabilityException,OperatingHoursException,PersonAvailability,TimeInterval,
  Weekday,WeeklyOperatingHours,
} from "../types";
import {WEEKDAYS,getOperatingIntervalsForDate} from "../utils/operatingCalendar";
import {validateEditedIntervals} from "../utils/intervalEditing";
import {validSchedulingDate} from "../utils/personSchedulingPolicies";
import {
  availabilityDayStatus,validateAvailabilityException,withAvailabilityDecision,
  type AvailabilityDayStatus,
} from "../utils/availabilityConfiguration";
import IntervalListEditor from "./IntervalListEditor";
import CivilDateField from "./CivilDateField";

const names:Record<Weekday,string>={
  monday:"Segunda",tuesday:"Terça",wednesday:"Quarta",thursday:"Quinta",
  friday:"Sexta",saturday:"Sábado",sunday:"Domingo",
};
const format=(items:TimeInterval[])=>
  items.map(x=>x.start+"–"+x.end).join(" · ");
type Decision="unconfigured"|"unavailable"|"available";
type BulkMode="full"|"custom"|"unavailable";

interface Props {
  availability:PersonAvailability;
  weeklyHours:WeeklyOperatingHours;
  operatingExceptions:OperatingHoursException[];
  onChange(next:PersonAvailability):void;
  onDraftOpenChange?(open:boolean):void;
}
function allowedOnDate(
  date:string,weekly:WeeklyOperatingHours,exceptions:OperatingHoursException[],
):TimeInterval[]{
  if(!validSchedulingDate(date))return [];
  try{return getOperatingIntervalsForDate(date,weekly,exceptions);}
  catch{return [];}
}

export default function AvailabilityPanel({
  availability,weeklyHours,operatingExceptions,onChange,onDraftOpenChange,
}:Props){
  const [editDay,setEditDay]=useState<Weekday|null>(null);
  const [dayMode,setDayMode]=useState<Decision>("unconfigured");
  const [dayIntervals,setDayIntervals]=useState<TimeInterval[]>([]);
  const [dayIssue,setDayIssue]=useState("");
  const [bulkOpen,setBulkOpen]=useState(false);
  const [bulkMode,setBulkMode]=useState<BulkMode>("full");
  const [bulkTargets,setBulkTargets]=useState<Weekday[]>([]);
  const [bulkIntervals,setBulkIntervals]=useState<TimeInterval[]>([]);
  const [bulkIssue,setBulkIssue]=useState("");
  const [exceptionIndex,setExceptionIndex]=useState<number|"new"|null>(null);
  const [exceptionDate,setExceptionDate]=useState("");
  const [exceptionMode,setExceptionMode]=useState<"available"|"unavailable"|null>(null);
  const [exceptionIntervals,setExceptionIntervals]=useState<TimeInterval[]>([]);
  const [exceptionIssue,setExceptionIssue]=useState("");
  const [removeIndex,setRemoveIndex]=useState<number|null>(null);
  const hasDraft=editDay!==null||bulkOpen||exceptionIndex!==null||removeIndex!==null;

  useEffect(()=>{onDraftOpenChange?.(hasDraft);},[hasDraft,onDraftOpenChange]);

  const openDays=WEEKDAYS.filter(day=>weeklyHours[day].length>0);
  const statuses=WEEKDAYS.map(day=>availabilityDayStatus(
    availability,day,weeklyHours[day]));
  const availableCount=statuses.filter(x=>x==="available").length;
  const configuredCount=statuses.filter(x=>x==="available"||x==="unavailable").length;
  const unknownCount=statuses.filter(x=>x==="unconfigured").length;
  const explicitUnavailableCount=statuses.filter(x=>x==="unavailable").length;

  function beginDay(day:Weekday){
    if(hasDraft)return;
    const status=availabilityDayStatus(availability,day,weeklyHours[day]);
    setEditDay(day);
    setDayMode(status==="unavailable"?"unavailable":
      availability.weeklyAvailability[day].length?"available":"unconfigured");
    setDayIntervals(availability.weeklyAvailability[day].map(x=>({...x})));
    setDayIssue("");
  }
  function saveDay(){
    if(!editDay)return;
    if(dayMode==="available"){
      if(dayIntervals.length===0){setDayIssue("Adiciona pelo menos um período.");return;}
      const checked=validateEditedIntervals(dayIntervals,weeklyHours[editDay]);
      if(!checked.valid){setDayIssue(checked.issue);return;}
      onChange(withAvailabilityDecision(availability,editDay,"available",checked.intervals));
    }else onChange(withAvailabilityDecision(availability,editDay,dayMode));
    setEditDay(null);setDayIssue("");
  }

  function beginBulk(){
    if(hasDraft)return;
    setBulkOpen(true);setBulkMode("full");setBulkTargets([...openDays]);
    setBulkIntervals(openDays[0]?
      weeklyHours[openDays[0]].map(x=>({...x})):[]);
    setBulkIssue("");
  }
  function saveBulk(){
    if(bulkTargets.length===0){setBulkIssue("Seleciona pelo menos um dia.");return;}
    let next=availability;
    for(const day of bulkTargets){
      if(weeklyHours[day].length===0)continue;
      const intervals=bulkMode==="full"?weeklyHours[day]:bulkIntervals;
      if(bulkMode!=="unavailable"){
        if(!intervals.length){setBulkIssue("Adiciona pelo menos um período.");return;}
        const checked=validateEditedIntervals(intervals,weeklyHours[day]);
        if(!checked.valid){
          setBulkIssue(names[day]+": "+checked.issue+
            " Usa «Todo o funcionamento» se os dias tiverem horários diferentes.");
          return;
        }
        next=withAvailabilityDecision(next,day,"available",checked.intervals);
      }else next=withAvailabilityDecision(next,day,"unavailable");
    }
    onChange(next);setBulkOpen(false);setBulkIssue("");
  }

  function beginException(index:"new"|number){
    if(hasDraft)return;
    setExceptionIndex(index);
    const source=typeof index==="number"?availability.exceptions[index]:null;
    setExceptionDate(source?.date??"");
    setExceptionMode(source?source.intervals.length?"available":"unavailable":null);
    setExceptionIntervals(source?.intervals.map(x=>({...x}))??[]);
    setExceptionIssue("");
  }
  function saveException(){
    if(exceptionMode===null){setExceptionIssue("Escolhe disponível ou indisponível nesta data.");return;}
    if(exceptionMode==="available"&&exceptionIntervals.length===0){
      setExceptionIssue("Adiciona um período para esta data.");return;
    }
    const value={date:exceptionDate,intervals:
      exceptionMode==="available"?exceptionIntervals:[]};
    const result=validateAvailabilityException(value,availability.exceptions,
      typeof exceptionIndex==="number"?exceptionIndex:null,
      weeklyHours,operatingExceptions);
    if(!result.valid){setExceptionIssue(result.issue);return;}
    const updated=typeof exceptionIndex==="number"?
      availability.exceptions.map((old,index)=>index===exceptionIndex?result.value:old):
      [...availability.exceptions,result.value];
    onChange({...availability,exceptions:updated});
    setExceptionIndex(null);setExceptionIssue("");
  }
  function deleteException(index:number){
    onChange({...availability,exceptions:availability.exceptions.filter((_,i)=>i!==index)});
    setRemoveIndex(null);
  }
  const exceptionAllowed=allowedOnDate(exceptionDate,weeklyHours,operatingExceptions);

  return <>
    <section className="overview-bar" aria-label="Resumo de disponibilidade">
      <div className="overview-item">
        <span>Dias com disponibilidade</span><strong>{availableCount} / {openDays.length}</strong>
      </div>
      <div className="overview-item">
        <span>Dias com decisão registada</span>
        <strong>{configuredCount} / {openDays.length}</strong>
      </div>
      <div className="overview-item">
        <span>Por configurar</span><strong>{unknownCount}</strong>
      </div>
    </section>

    <section className="panel availability-draft-panel">
      <div className="panel-header">
        <div>
          <p className="section-kicker">Configuração inicial · Etapa 4</p>
          <h2>Disponibilidade semanal</h2>
        </div>
        <p className="panel-help">
          Uma disponibilidade permite trabalhar, mas não obriga a criar um turno.
        </p>
      </div>
      <div className="availability-default-explanation">
        <div>
          <strong>Por configurar não significa indisponibilidade escolhida</strong>
          <p>Até definires os períodos, o motor não pode escalar esta pessoa.
            Podes declarar um dia indisponível ou aplicar um modelo a vários dias.</p>
        </div>
        {!bulkOpen&&<button type="button" className="se-outline"
          disabled={hasDraft} onClick={beginBulk}>Aplicar a vários dias</button>}
      </div>

      {bulkOpen&&<section className="availability-bulk-draft"
        aria-label="Configurar vários dias">
        <p>As alterações só serão gravadas depois de «Guardar dias selecionados».</p>
        <fieldset className="availability-choices">
          <legend>Modelo a aplicar</legend>
          <label><input type="radio" name="availability-bulk-mode" checked={bulkMode==="full"}
            onChange={()=>setBulkMode("full")}/>Disponível durante todo o funcionamento de cada dia</label>
          <label><input type="radio" name="availability-bulk-mode" checked={bulkMode==="custom"}
            onChange={()=>setBulkMode("custom")}/>Períodos iguais nos dias selecionados</label>
          <label><input type="radio" name="availability-bulk-mode" checked={bulkMode==="unavailable"}
            onChange={()=>setBulkMode("unavailable")}/>Indisponível nesses dias</label>
        </fieldset>
        {bulkMode==="custom"&&<IntervalListEditor inlineEditor
          label="disponibilidade conjunta" intervals={bulkIntervals}
          onChange={setBulkIntervals}/>}
        <fieldset className="availability-choices">
          <legend>Dias abrangidos</legend>
          <div className="availability-weekdays-checks">
            {openDays.map(day=><label key={day}>
              <input type="checkbox" checked={bulkTargets.includes(day)}
                onChange={e=>setBulkTargets(current=>e.target.checked?
                  [...current,day]:current.filter(x=>x!==day))}/>
              {names[day]}
            </label>)}
          </div>
        </fieldset>
        <p className="availability-hint">
          A aplicação aos dias selecionados substitui as configurações anteriores desses dias,
          sem alterar os restantes.
        </p>
        {bulkIssue&&<p className="presence-validation" role="alert">{bulkIssue}</p>}
        <div className="availability-draft-actions">
          <button type="button" className="se-outline"
            onClick={()=>{setBulkOpen(false);setBulkIssue("");}}>Cancelar</button>
          <button type="button" className="primary-button"
            onClick={saveBulk}>Guardar dias selecionados</button>
        </div>
      </section>}

      <div className="availability-week-grid">
        {WEEKDAYS.map(day=>{
          const operating=weeklyHours[day];
          const status=availabilityDayStatus(availability,day,operating);
          const intervals=availability.weeklyAvailability[day];
          const labels:Record<AvailabilityDayStatus,string>={
            closed:"Empresa fechada",unconfigured:"Por configurar",
            unavailable:"Indisponível",available:"Disponível",invalid:"Regra inválida",
          };
          return <article key={day} className="availability-week-card">
            <div className="availability-week-header">
              <div><strong>{names[day]}</strong>
                <span>{operating.length?format(operating):"Sem funcionamento"}</span></div>
              <span className={"availability-status status-"+status}>{labels[status]}</span>
            </div>
            {operating.length===0
              ?<p className="availability-muted">
                Não é necessário configurar este dia. Qualquer regra anterior é preservada.
              </p>
              :editDay===day
              ?<div className="availability-day-draft">
                <p>Rascunho de {names[day]}. Nenhuma alteração é gravada antes de Guardar.</p>
                <fieldset className="availability-choices">
                  <legend>Disponibilidade deste dia</legend>
                  <label><input type="radio" name={"availability-day-"+day}
                    checked={dayMode==="available"} onChange={()=>{
                      setDayMode("available");setDayIssue("");
                      if(dayIntervals.length===0)setDayIntervals(operating.map(x=>({...x})));
                    }}/>Disponível nos períodos indicados</label>
                  <label><input type="radio" name={"availability-day-"+day}
                    checked={dayMode==="unavailable"}
                    onChange={()=>{setDayMode("unavailable");setDayIssue("");}}/>
                    Indisponível por decisão explícita</label>
                  <label><input type="radio" name={"availability-day-"+day}
                    checked={dayMode==="unconfigured"} onChange={()=>{setDayMode("unconfigured");setDayIssue("");}}/>
                    Repor por configurar</label>
                </fieldset>
                {dayMode==="available"&&<IntervalListEditor inlineEditor
                  label={"disponibilidade de "+names[day]}
                  intervals={dayIntervals} allowed={operating}
                  onChange={setDayIntervals}/>}
                {dayIssue&&<p className="presence-validation" role="alert">{dayIssue}</p>}
                <div className="availability-draft-actions">
                  <button type="button" className="se-outline"
                    onClick={()=>{setEditDay(null);setDayIssue("");}}>Cancelar</button>
                  <button type="button" className="primary-button"
                    onClick={saveDay}>Guardar disponibilidade</button>
                </div>
              </div>
              :<>
                <p className="availability-muted">
                  {status==="available"?format(intervals):
                   status==="unavailable"?"Não poderá ser escalado neste dia.":
                   status==="invalid"?"Revê os períodos anteriores; a configuração é inválida.":
                   "Ainda não foi definida qualquer disponibilidade."}
                </p>
                <button type="button" className="se-outline"
                  disabled={hasDraft} onClick={()=>beginDay(day)}>
                  {status==="unconfigured"?"Definir disponibilidade":"Editar disponibilidade"}
                </button>
              </>}
          </article>;
        })}
      </div>
      <p className="availability-hint">
        {explicitUnavailableCount} dia(s) assinalado(s) como indisponível(is) de forma explícita.
        Os intervalos de um dia fechado não contam como disponibilidade escalável.
      </p>
    </section>

    <section className="panel availability-exceptions-panel">
      <div className="panel-header">
        <div><p className="section-kicker">Datas específicas</p><h2>Exceções de disponibilidade</h2></div>
        <button type="button" className="primary-button" disabled={hasDraft}
          onClick={()=>beginException("new")}>+ Adicionar</button>
      </div>
      <p className="section-description">
        Uma exceção substitui a disponibilidade semanal apenas naquela data.
        Selecionar Adicionar abre um rascunho, não cria um registo.
      </p>
      {exceptionIndex!==null&&<section className="availability-exception-draft"
        aria-label="Rascunho de exceção de disponibilidade">
        <p>Configuração por confirmar. Seleciona a data e a decisão explícita.</p>
        <div className="availability-date-row">
          <label>Data da exceção</label>
          <CivilDateField label="Data da exceção de disponibilidade"
            value={exceptionDate} onChange={setExceptionDate}/>
        </div>
        {validSchedulingDate(exceptionDate)&&
          <p className="availability-hint">{exceptionAllowed.length?
            "Funcionamento nesta data: "+format(exceptionAllowed):
            "A empresa está fechada nesta data."}</p>}
        <fieldset className="availability-choices">
          <legend>Disponibilidade nesta data</legend>
          <label><input type="radio" name="availability-exception-mode"
            checked={exceptionMode==="available"} onChange={()=>{
              setExceptionMode("available");setExceptionIssue("");
              if(!exceptionIntervals.length)
                setExceptionIntervals(exceptionAllowed.map(x=>({...x})));
            }}/>Disponível nos períodos seguintes</label>
          <label><input type="radio" name="availability-exception-mode"
            checked={exceptionMode==="unavailable"}
            onChange={()=>{setExceptionMode("unavailable");setExceptionIssue("");}}/>
            Indisponível nesta data</label>
        </fieldset>
        {exceptionMode==="available"&&<IntervalListEditor inlineEditor
          label="disponibilidade excecional"
          intervals={exceptionIntervals} allowed={exceptionAllowed}
          onChange={setExceptionIntervals}/>}
        {exceptionIssue&&<p className="presence-validation" role="alert">{exceptionIssue}</p>}
        <div className="availability-draft-actions">
          <button type="button" className="se-outline"
            onClick={()=>{setExceptionIndex(null);setExceptionIssue("");}}>Cancelar</button>
          <button type="button" className="primary-button"
            onClick={saveException}>Guardar exceção</button>
        </div>
      </section>}
      {availability.exceptions.length===0&&exceptionIndex===null
        ?<div className="empty-state"><div className="empty-icon">◎</div>
          <strong>Sem exceções definidas</strong>
          <p>Aplica-se a disponibilidade semanal em cada data.</p></div>
        :<div className="availability-exception-list">
          {availability.exceptions.map((item,index)=><article key={item.date+"-"+index}
            className="availability-exception-card">
            <div>
              <strong>{item.date}</strong>
              <p>{item.intervals.length?format(item.intervals):"Indisponível nesta data"}</p>
            </div>
            <div className="availability-draft-actions">
              {removeIndex===index
                ?<>
                  <button type="button" className="se-outline"
                    onClick={()=>setRemoveIndex(null)}>Cancelar</button>
                  <button type="button" className="se-outline"
                    onClick={()=>deleteException(index)}>Confirmar remoção</button>
                </>
                :<>
                  <button type="button" className="se-outline" disabled={hasDraft}
                    onClick={()=>beginException(index)}>Editar</button>
                  <button type="button" className="se-outline" disabled={hasDraft}
                    onClick={()=>setRemoveIndex(index)}>Remover</button>
                </>}
            </div>
          </article>)}
        </div>}
    </section>
  </>;
}
