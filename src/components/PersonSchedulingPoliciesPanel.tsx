import { useState } from "react";
import type { Person } from "../types";
import { validSchedulingDate } from "../utils/personSchedulingPolicies";

interface Props {
  people: Person[];
  onChange(people: Person[]): void;
}

function readMinutes(raw:string): number | undefined | null {
  if (raw.trim()==="") return undefined;
  const hours=Number(raw);
  const minutes=Math.round(hours*60);
  if (!Number.isFinite(hours) || hours < 0 || hours > 168 ||
    !Number.isSafeInteger(minutes) || Math.abs(hours*60-minutes)>0.001 ||
    minutes%15!==0) return null;
  return minutes;
}

/**
 * Domain-only per-person scheduling profiles. Absence of fields preserves
 * the original 40h company maximum / weekly preference (PR41).
 */
export default function PersonSchedulingPoliciesPanel({people,onChange}:Props) {
  const [draftDates,setDraftDates]=useState<Record<string,string>>({});
  const active=people.filter(person=>person.active);
  const update=(id:string,patch:Partial<Person>)=>
    onChange(people.map(person=>person.id===id?{...person,...patch}:person));
  const format=(minutes:number|undefined)=>minutes===undefined?"":String(minutes/60);
  return <section className="panel" aria-label="Contratos e dias de trabalho obrigatórios">
    <div className="panel-header">
      <div><p className="section-kicker">Regras por colaborador</p>
        <h2>Carga contratual e objetivos</h2></div>
    </div>
    <p className="section-description">
      Limite contratual: hard constraint semanal. Objetivo: soft constraint
      que orienta a distribuição, mas pode não ser atingido por falta de
      cobertura ou disponibilidade. Campos vazios mantêm as regras anteriores
      (máximo e objetivo de 40h). Os dias obrigatórios são independentes da
      disponibilidade geral e têm de respeitar as restantes regras.
    </p>
    {active.length===0 && <p className="section-description">Adiciona colaboradores ativos para configurar regras individuais.</p>}
    <div className="se-contract-list">
    {active.map(person=><div className="se-contract-row" key={person.id}>
      <div><strong>{person.name}</strong><small>
        Limite {person.weeklyContractMinutes===undefined?"da empresa":person.weeklyContractMinutes/60+"h"} ·
        alvo {person.weeklyTargetMinutes===undefined?"automático":person.weeklyTargetMinutes/60+"h"}
      </small></div>
      <label className="se-control">
        <span>Máximo contratual (h/semana)</span>
        <input type="number" min="0" max="168" step="0.25" placeholder="40"
          value={format(person.weeklyContractMinutes)}
          onChange={event=>{
            const parsed=readMinutes(event.target.value);
            if(parsed===null)return;
            const max=parsed===undefined?2400:parsed;
            update(person.id,{
              weeklyContractMinutes:parsed,
              weeklyTargetMinutes:person.weeklyTargetMinutes!==undefined &&
                person.weeklyTargetMinutes>max ? undefined : person.weeklyTargetMinutes,
            });
          }}/>
      </label>
      <label className="se-control">
        <span>Objetivo semanal (h)</span>
        <input type="number" min="0" max="168" step="0.25"
          placeholder={String((person.weeklyContractMinutes??2400)/60)}
          value={format(person.weeklyTargetMinutes)}
          onChange={event=>{
            const parsed=readMinutes(event.target.value);
            if(parsed===null || (parsed!==undefined &&
              parsed>(person.weeklyContractMinutes??2400))) return;
            update(person.id,{weeklyTargetMinutes:parsed});
          }}/>
      </label>
      <div className="se-contract-dates">
        <label className="se-control"><span>Dia obrigatório (data civil)</span>
          <input type="date" value={draftDates[person.id]??""}
            onChange={event=>setDraftDates(previous=>({...previous,[person.id]:event.target.value}))}/>
        </label>
        <button type="button" className="se-outline"
          disabled={!validSchedulingDate(draftDates[person.id]??"")}
          onClick={()=>{
            const date=draftDates[person.id];
            if(!validSchedulingDate(date) || person.requiredWorkDates?.includes(date))return;
            update(person.id,{requiredWorkDates:[...(person.requiredWorkDates??[]),date].sort()});
            setDraftDates(previous=>({...previous,[person.id]:""}));
          }}>Adicionar</button>
      </div>
      {Boolean(person.requiredWorkDates?.length) && <div className="se-contract-chips" aria-label={"Datas obrigatórias de "+person.name}>
        {person.requiredWorkDates!.map(date=><button type="button" className="se-outline" key={date}
          title={"Remover a obrigação de "+date}
          onClick={()=>update(person.id,{requiredWorkDates:person.requiredWorkDates!.filter(d=>d!==date)})}>
          {date} ×
        </button>)}
      </div>}
    </div>)}
    </div>
  </section>;
}
