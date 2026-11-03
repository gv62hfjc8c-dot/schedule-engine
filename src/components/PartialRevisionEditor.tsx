import { useMemo, useState } from "react";
import type {
  ApprovedScheduleLedger, ApprovedScheduleRecord, ApprovalEnvironment,
  AbsenceReason,
} from "../utils/approvedSchedules";
import {
  reviseApprovedScheduleForAbsence,
} from "../utils/partialScheduleRevision";
import type { OfficialScheduleAction } from "../persistence/officialScheduleRepository";

interface Props {
  source: ApprovedScheduleRecord;
  ledger: ApprovedScheduleLedger;
  environment: ApprovalEnvironment;
  busy: boolean;
  onCancel(): void;
  onApprove(action: OfficialScheduleAction): Promise<void>;
}

const reasons: { value: AbsenceReason; label: string }[] = [
  {value:"sick_leave",label:"Baixa / ausência por doença"},
  {value:"vacation",label:"Férias"},
  {value:"leave",label:"Licença"},
  {value:"accident",label:"Acidente / impedimento"},
  {value:"departure",label:"Saída da equipa"},
  {value:"other",label:"Outro impedimento"},
];

function zoneToday(zone:string):string {
  try {
    const parts=new Intl.DateTimeFormat("en-GB",{
      timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit",
    }).formatToParts(new Date());
    const get=(key:string)=>parts.find(p=>p.type===key)?.value??"";
    return get("year")+"-"+get("month")+"-"+get("day");
  } catch { return "9999-12-31"; }
}

/**
 * Focused workflow inside an existing approved roster. It never writes the
 * ledger directly: local preview is advisory, server performs real approval.
 */
export default function PartialRevisionEditor({
  source,ledger,environment,busy,onCancel,onApprove,
}:Props) {
  const earliest=source.startDate>zoneToday(source.timeZone)
    ?source.startDate:zoneToday(source.timeZone);
  const options=useMemo(()=>{
    const ids=[...new Set(source.shifts.map(s=>s.personId))];
    return ids.map(id=>({
      id,name:source.people?.find(p=>p.id===id)?.name??
        environment.people.find(p=>p.id===id)?.name??id,
    }));
  },[source,environment.people]);
  const [personId,setPersonId]=useState(options[0]?.id??"");
  const [startDate,setStartDate]=useState(earliest);
  const [endDate,setEndDate]=useState(earliest);
  const [reason,setReason]=useState<AbsenceReason>("sick_leave");
  const [note,setNote]=useState("");
  const [substitutes,setSubstitutes]=useState<Record<string,string>>({});
  const [validation,setValidation]=useState<{
    valid:boolean;issues:string[];total:number;removed:number;
  }|null>(null);

  const affected=source.shifts.filter(s=>
    s.personId===personId&&s.date>=startDate&&s.date<=endDate)
    .sort((a,b)=>a.date.localeCompare(b.date));
  const replacements=affected.filter(s=>Boolean(substitutes[s.date])).map(s=>({
    date:s.date,personId:substitutes[s.date],
  }));
  function changed(){
    setValidation(null);
  }
  function preview(){
    const check=reviseApprovedScheduleForAbsence({
      ledger,environment,
      request:{
        sourceId:source.id,revisionId:"preview-"+crypto.randomUUID(),
        expectedVersion:ledger.version,at:new Date().toISOString(),
        personId,startDate,endDate,reason,
        ...(note.trim()?{note:note.trim()}:{}),
        replacements,
      },
    });
    setValidation(check.ok
      ?{valid:true,issues:[],removed:affected.length,
          total:check.record.shifts.length}
      :{valid:false,issues:check.failure.issues,
          removed:affected.length,total:0});
  }
  const blocked=earliest>source.endDate;
  const valid=validation?.valid===true;
  const personLabel=options.find(p=>p.id===personId)?.name??personId;

  return <div className="p63-violations" role="region" aria-label="Revisão parcial">
    <h3>Registar ocorrência · revisão parcial</h3>
    <p className="generator-hint">
      O horário aprovado continua vigente até confirmares uma nova versão.
      Os restantes turnos serão mantidos sem alterações.
    </p>
    {blocked?<p className="generator-issue" role="alert">
      Este período já terminou. Alterações retroativas exigem um processo
      administrativo distinto, não uma revisão operacional.
    </p>:<>
      <div className="generator-controls period-generator-controls">
        <label className="select-field">
          <span>Colaborador afetado</span>
          <select value={personId} onChange={e=>{
            setPersonId(e.target.value);setSubstitutes({});changed();
          }}>
            {options.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="select-field">
          <span>Início</span>
          <input type="date" value={startDate}
            min={earliest} max={source.endDate}
            onChange={e=>{
              setStartDate(e.target.value);
              if(e.target.value>endDate)setEndDate(e.target.value);
              setSubstitutes({});changed();
            }}/>
        </label>
        <label className="select-field">
          <span>Fim</span>
          <input type="date" value={endDate}
            min={startDate} max={source.endDate}
            onChange={e=>{
              setEndDate(e.target.value);setSubstitutes({});changed();
            }}/>
        </label>
        <label className="select-field">
          <span>Motivo</span>
          <select value={reason} onChange={e=>{
            setReason(e.target.value as AbsenceReason);changed();
          }}>
            {reasons.map(p=><option key={p.value} value={p.value}>
              {p.label}</option>)}
          </select>
        </label>
      </div>
      <label className="select-field">
        <span>Observação administrativa (opcional, sem dados clínicos)</span>
        <input type="text" value={note} maxLength={240}
          onChange={e=>{setNote(e.target.value);changed();}}
          placeholder="Ex.: indisponibilidade comunicada à gestão"/>
      </label>
      <h4>Turnos afetados · {personLabel}</h4>
      {affected.length===0?<p className="generator-issue">
        Esta pessoa não tem turnos nas datas selecionadas.
      </p>:<div className="period-day-list">
        {affected.map(shift=>{
          const busyIds=new Set(source.shifts.filter(s=>
            s.date===shift.date).map(s=>s.personId));
          const eligible=environment.people.filter(p=>
            p.active&&p.id!==personId&&!busyIds.has(p.id));
          return <div key={shift.date} className="period-day-card">
            <div className="period-day-heading">
              <div>
                <strong>{shift.date} · {shift.interval.start}–{shift.interval.end}</strong>
                <span>Turno original a retirar da pessoa afetada</span>
              </div>
            </div>
            <label className="select-field">
              <span>Substituição direta (opcional)</span>
              <select value={substitutes[shift.date]??""}
                onChange={e=>{
                  setSubstitutes(old=>({...old,[shift.date]:e.target.value}));
                  changed();
                }}>
                <option value="">Sem substituto — verificar cobertura</option>
                {eligible.map(person=><option key={person.id} value={person.id}>
                  {person.name}</option>)}
              </select>
            </label>
          </div>;
        })}
      </div>}
      <p className="generator-hint">
        Um substituto recebe o mesmo turno e refeição. O motor verifica se
        tem disponibilidade e horas legais; não redistribui automaticamente
        jornadas de outros colaboradores nesta primeira versão.
      </p>
      {reason==="departure"&&<p className="generator-hint">
        Para impedir escalas posteriores, arquiva também esta pessoa em Equipa.
        Esta revisão afeta apenas o período aprovado selecionado.
      </p>}
      <div className="p63-action-row">
        <button type="button" onClick={onCancel} disabled={busy}>
          Cancelar
        </button>
        <button type="button" onClick={preview} disabled={busy||!affected.length}>
          Validar revisão
        </button>
        <button type="button" className="primary-button"
          disabled={busy||!valid}
          onClick={()=>void onApprove({
            kind:"revise",sourceId:source.id,personId,startDate,endDate,
            reason,...(note.trim()?{note:note.trim()}:{}),
            replacements,expectedVersion:ledger.version,
          })}>
          {busy?"A confirmar…":"Aprovar nova versão"}
        </button>
      </div>
      {validation&&(
        <div className="generator-hint" role={valid?"status":"alert"}>
          {valid
            ?`Revisão válida na pré-visualização: ${validation.removed}
              turno(s) afetado(s), ${validation.total} no horário revisto.
              O servidor voltará a validar antes de aprovar.`
            :<>Revisão ainda não válida:
              {validation.issues.map((issue,i)=><p key={i}>{issue}</p>)}
            </>}
        </div>
      )}
    </>}
  </div>;
}
