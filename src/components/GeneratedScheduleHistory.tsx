import { useEffect, useState } from "react";
import { supabaseAuthClient } from "../persistence/supabaseInstance";
import { createSupabaseGeneratedScheduleRepository } from "../persistence/supabaseGeneratedScheduleRepository";
import { createOfficialScheduleRepository,
  type OfficialScheduleAction } from "../persistence/officialScheduleRepository";
import type { StoredGeneratedSchedule } from "../persistence/generatedScheduleRepository";
import type { ApprovedScheduleLedger, ApprovedScheduleRecord } from "../utils/approvedSchedules";
import ScheduleViews from "./ScheduleViews";

const proposals = supabaseAuthClient
  ? createSupabaseGeneratedScheduleRepository(supabaseAuthClient) : null;
const official = supabaseAuthClient
  ? createOfficialScheduleRepository(supabaseAuthClient) : null;

const statusLabel=(status:ApprovedScheduleRecord["status"]|null)=>
  status==="approved"?"Aprovado":
  status==="superseded"?"Substituído":
  status==="cancelled"?"Cancelado":"Não aprovado";

const overlaps=(a:{startDate:string;endDate:string},
  b:{startDate:string;endDate:string})=>
  a.startDate<=b.endDate && b.startDate<=a.endDate;

export default function GeneratedScheduleHistory({ onExit }: { onExit: () => void }) {
  const [items,setItems]=useState<StoredGeneratedSchedule[]>([]);
  const [ledger,setLedger]=useState<ApprovedScheduleLedger|null>(null);
  const [selected,setSelected]=useState<StoredGeneratedSchedule|null>(null);
  const [selectedOfficial,setSelectedOfficial]=useState<ApprovedScheduleRecord|null>(null);
  const [loading,setLoading]=useState(false);
  const [mutating,setMutating]=useState(false);
  const [problem,setProblem]=useState<string|null>(null);
  const [notice,setNotice]=useState<string|null>(null);
  const [attempt,setAttempt]=useState(0);

  useEffect(()=>{
    let live=true;
    setLoading(true);
    setProblem(null);
    if(!proposals||!official){
      setProblem("A ligação Supabase não está configurada.");
      setLoading(false);
      return;
    }
    void Promise.all([proposals.list(),official.load()])
      .then(([rows,current])=>{
        if(live){setItems(rows);setLedger(current);}
      }).catch(err=>{
        if(live)setProblem(err instanceof Error?err.message:
          "Não foi possível consultar os horários.");
      }).finally(()=>{if(live)setLoading(false);});
    return ()=>{live=false;};
  },[attempt]);

  function refresh(){setAttempt(i=>i+1);}
  const version=ledger?.version??0;
  const current=ledger?.records.filter(r=>r.status==="approved")??[];
  const recordFor=(id:string)=>ledger?.records.find(r=>r.id===id)??null;
  const selectedRecord=selected?recordFor(selected.id):null;
  const occupying=selected?current.find(r=>overlaps(r,selected))??null:null;
  const canReplace=selected&&occupying &&
    occupying.startDate===selected.startDate &&
    occupying.endDate===selected.endDate;
  const blocked=Boolean(occupying&&!canReplace);

  async function perform(action:OfficialScheduleAction){
    if(!official||mutating)return;
    const verb=action.kind==="cancel"?"cancelar":"confirmar";
    if(!window.confirm("Queres realmente "+verb+
      " este horário oficial? A operação ficará registada no histórico."))return;
    setMutating(true);
    setProblem(null);
    setNotice(null);
    try{
      const result=await official.execute(action);
      if(!result.ok){
        setProblem(result.issues.join(" ")||
          "A operação não foi autorizada. Atualiza o histórico.");
      }else{
        setNotice(action.kind==="approve"?"Horário aprovado oficialmente.":
          action.kind==="replace"?"Nova versão oficial aprovada.":
          "Aprovação cancelada e preservada no histórico.");
        setSelectedOfficial(null);
        refresh();
      }
    }catch(err){
      setProblem(err instanceof Error?err.message:
        "A aprovação não foi confirmada. Atualiza o histórico.");
    }finally{setMutating(false);}
  }

  if(selected||selectedOfficial){
    const shown=selectedOfficial??selectedRecord;
    const shifts=selected?.payload.shifts??shown?.shifts??[];
    const start=selected?.startDate??shown?.startDate??"";
    const end=selected?.endDate??shown?.endDate??"";
    const people=shown?.people?.map(p=>({...p,active:false}))??
      selected?.payload.people??shifts.map(s=>s.personId)
      .filter((v,i,a)=>a.indexOf(v)===i)
      .map(id=>({id,name:id,active:false}));
    return <section className="panel generator-panel">
      <div className="panel-header">
        <div>
          <p className="section-kicker">Horário · {statusLabel(shown?.status??null)}</p>
          <h2>{start} a {end}</h2>
          <p className="generator-hint">As versões oficiais são preservadas.
            As propostas não são comprovativos de horas efetivamente trabalhadas.</p>
        </div>
        <button type="button" onClick={()=>{
          setSelected(null);setSelectedOfficial(null);
        }}>Voltar ao histórico</button>
      </div>
      {problem&&<p role="alert" className="generator-issue">{problem}</p>}
      {notice&&<p role="status" className="generator-hint">{notice}</p>}
      {selected&&selectedRecord&&selectedRecord.status!=="approved"&&(
        <p className="generator-hint">
          Esta proposta já teve uma aprovação oficial que foi
          {selectedRecord.status==="cancelled"?" cancelada":" substituída"}.
          Para voltar a planear o período, gera e guarda uma nova proposta.
        </p>
      )}
      {selected&&!selectedRecord&&(
        <div className="p63-action-row">
          {blocked?<p className="generator-issue">
            Já existe um horário aprovado parcialmente sobreposto.
            Só é possível substituir diretamente um período com as mesmas datas.
          </p>:<button type="button" className="primary-button"
            disabled={mutating||loading}
            onClick={()=>void perform(canReplace?{
              kind:"replace",candidateId:selected.id,
              replaceId:occupying!.id,expectedVersion:version,
            }:{
              kind:"approve",candidateId:selected.id,
              expectedVersion:version,
            })}>
            {mutating?"A confirmar…":canReplace?
              "Substituir versão oficial":"Aprovar oficialmente"}
          </button>}
        </div>
      )}
      {shown?.status==="approved"&&(
        <div className="p63-action-row">
          <button type="button" disabled={mutating}
            onClick={()=>void perform({
              kind:"cancel",scheduleId:shown.id,expectedVersion:version,
            })}>Cancelar aprovação</button>
        </div>
      )}
      <ScheduleViews assignments={shifts} people={people}
        startDate={start} endDate={end}/>
    </section>;
  }

  return <section className="panel generator-panel" aria-label="Histórico de horários">
    <div className="panel-header">
      <div>
        <p className="section-kicker">Horários · histórico</p>
        <h2>Propostas e horários oficiais</h2>
      </div>
      <button type="button" onClick={onExit}>Voltar ao planeamento</button>
    </div>
    <p className="section-description">
      Propostas guardadas, aprovações, substituições e cancelamentos.
      Um horário só é oficial após confirmação do servidor.
    </p>
    <div className="p63-action-row">
      <button type="button" disabled={loading||mutating}
        onClick={refresh}>Atualizar histórico</button>
      {loading&&<span className="generator-hint" role="status">A consultar…</span>}
      {ledger&&<span className="generator-hint">Versão oficial {ledger.version}</span>}
    </div>
    {problem&&<p className="generator-issue" role="alert">{problem}</p>}
    {notice&&<p className="generator-hint" role="status">{notice}</p>}
    {ledger&&ledger.records.length>0&&(
      <div className="period-day-list">
        <h3>Histórico oficial</h3>
        {ledger.records.slice().reverse().map(record=>(
          <article key={record.id} className="period-day-card">
            <div className="period-day-heading">
              <div>
                <strong>{record.startDate} a {record.endDate}</strong>
                <span>{record.approvedAt} · {record.shifts.length} turnos</span>
              </div>
              <span className="work-rule-badge">{statusLabel(record.status)}</span>
            </div>
            <button type="button" onClick={()=>{
              setSelected(items.find(item=>item.id===record.id)??null);
              setSelectedOfficial(record);
            }}>Consultar versão</button>
          </article>
        ))}
      </div>
    )}
    <div className="period-day-list">
      <h3>Propostas geradas</h3>
      {!loading&&!problem&&items.length===0&&
        <p>Não existem propostas guardadas nesta conta.</p>}
      {items.map(item=>{
        const status=recordFor(item.id)?.status??null;
        return <article className="period-day-card" key={item.id}>
          <div className="period-day-heading">
            <div>
              <strong>{item.startDate} a {item.endDate}</strong>
              <span>{new Date(item.createdAt).toLocaleString("pt-PT")}
                {" · "}{item.payload.shifts.length} turnos</span>
            </div>
            <span className="work-rule-badge">{statusLabel(status)}</span>
          </div>
          <button type="button" onClick={()=>{
            setSelected(item);setSelectedOfficial(null);
          }}>Consultar proposta</button>
        </article>;
      })}
    </div>
  </section>;
}
