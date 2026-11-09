import { useState } from "react";
import type { TimeInterval } from "../types";
import {
  addInterval,editInterval,removeInterval,
  type IntervalEditResult,
} from "../utils/intervalEditing";

const starts=Array.from({length:96},(_,i)=>{
  const t=i*15;
  return String(Math.floor(t/60)).padStart(2,"0")+":"+
    String(t%60).padStart(2,"0");
});
const ends=[...starts.slice(1),"24:00"];

interface Props {
  label:string;
  intervals:TimeInterval[];
  allowed?:TimeInterval[];
  onChange(next:TimeInterval[]):void;
}

/**
 * Advanced, but operational, editor: no mock data, no bypasses, no hidden
 * columns. Invalid or overlapping edits are rejected before persistence.
 * Collapsed by default for a single interval to preserve the PR45 UI.
 */
export default function IntervalListEditor({
  label,intervals,allowed,onChange,
}:Props){
  const [issue,setIssue]=useState("");
  const commit=(result:IntervalEditResult)=>{
    if(!result.valid){setIssue(result.issue);return;}
    setIssue("");
    onChange(result.intervals);
  };
  return <details className="se-multi-interval-editor"
    open={intervals.length>1 ? true : undefined}>
    <summary>Gerir períodos ({intervals.length}) — {label}</summary>
    <div className="se-multi-interval-content">
      <p className="se-multi-interval-help">
        Períodos independentes em passos de 15 minutos. Não podem sobrepor-se.
        {allowed && " A disponibilidade tem de caber dentro do funcionamento."}
      </p>
      {intervals.length===0 &&
        <p className="se-multi-interval-help">Nenhum período configurado.</p>}
      {intervals.map((interval,index)=><div className="se-multi-interval-row"
        key={index}>
        <label>
          <span>Início {index+1}</span>
          <select value={interval.start}
            onChange={event=>commit(editInterval(
              intervals,index,{...interval,start:event.target.value},allowed))}>
            {starts.map(v=><option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <label>
          <span>Fim {index+1}</span>
          <select value={interval.end}
            onChange={event=>commit(editInterval(
              intervals,index,{...interval,end:event.target.value},allowed))}>
            {ends.map(v=><option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <button type="button" className="se-outline"
          aria-label={"Remover período "+(index+1)+" de "+label}
          onClick={()=>commit(removeInterval(intervals,index,allowed))}>
          Remover período
        </button>
      </div>)}
      <button className="se-outline" type="button"
        disabled={allowed?.length===0}
        onClick={()=>commit(addInterval(intervals,allowed))}>
        + Adicionar período
      </button>
      {issue && <p className="presence-validation" role="alert">{issue}</p>}
    </div>
  </details>;
}
