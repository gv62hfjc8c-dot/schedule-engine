import { useEffect, useRef, useState } from "react";

interface Props {
  value: string;
  onChange: (event: { target: { value: string } }) => void;
  id?: string;
  className?: string;
  "aria-label"?: string;
}
const DAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const fmt = new Intl.DateTimeFormat("pt-PT", {month:"long",year:"numeric",timeZone:"UTC"});
function valid(s:string) {return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s+"T12:00:00Z")) && new Date(s+"T12:00:00Z").toISOString().slice(0,10)===s;}
export default function CalendarDateInput({value,onChange,id,className, "aria-label":ariaLabel}:Props) {
  const [open,setOpen] = useState(false);
  const [month,setMonth] = useState(()=>valid(value)?value.slice(0,7):new Date().toISOString().slice(0,7));
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(()=>{if(open && valid(value))setMonth(value.slice(0,7));},[open,value]);
  useEffect(()=>{if(open)dialog.current?.querySelector<HTMLButtonElement>('[aria-current="date"]')?.focus();},[open,month]);
  const [year,monthIndex] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year,monthIndex-1,1));
  const offset = (first.getUTCDay()+6)%7;
  const last = new Date(Date.UTC(year,monthIndex,0)).getUTCDate();
  function shift(delta:number) {const d=new Date(Date.UTC(year,monthIndex-1+delta,1));setMonth(d.toISOString().slice(0,7));}
  function choose(day:number) {setOpen(false);onChange({target:{value:month+"-"+String(day).padStart(2,"0")}});}
  return <div className="custom-date-field">
    <button id={id} className={"custom-date-trigger "+(className||"")} type="button"
      aria-label={ariaLabel||"Escolher data"} aria-expanded={open} aria-haspopup="dialog" onClick={(event)=>{event.stopPropagation();setOpen(!open);}}>
      <span>{valid(value)?new Intl.DateTimeFormat("pt-PT",{day:"2-digit",month:"2-digit",year:"numeric",timeZone:"UTC"}).format(new Date(value+"T12:00:00Z")):"Selecionar data"}</span>
      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>
    </button>
    {open && <><button type="button" className="picker-backdrop" aria-label="Fechar calendário" onClick={(event)=>{event.stopPropagation();setOpen(false);}}/>
      <div className="custom-calendar-popover" role="dialog" aria-label="Calendário" ref={dialog}
        onKeyDown={e=>{if(e.key==="Escape")setOpen(false);}}>
        <div className="calendar-toolbar">
          <button type="button" onClick={()=>shift(-1)} aria-label="Mês anterior">‹</button>
          <strong>{fmt.format(first)}</strong>
          <button type="button" onClick={()=>shift(1)} aria-label="Mês seguinte">›</button>
        </div>
        <div className="calendar-grid">
          {DAYS.map(day=><span className="calendar-day-name" key={day}>{day}</span>)}
          {Array.from({length:offset},(_,i)=><span key={"empty-"+i}/>)}
          {Array.from({length:last},(_,i)=>i+1).map(day=><button key={day} type="button"
            aria-current={value===month+"-"+String(day).padStart(2,"0")?"date":undefined}
            className={value===month+"-"+String(day).padStart(2,"0")?"calendar-selected":""}
            onClick={()=>choose(day)}>{day}</button>)}
        </div>
        <div className="calendar-footer"><button type="button" className="calendar-close" onClick={(event)=>{event.stopPropagation();setOpen(false);}}>Concluído</button></div>
        <button type="button" className="calendar-today" onClick={()=>{setOpen(false);const now=new Date();const local=new Date(now.getTime()-now.getTimezoneOffset()*60000);const date=local.toISOString().slice(0,10);onChange({target:{value:date}});}}>Hoje</button>
      </div></>}
  </div>;
}
