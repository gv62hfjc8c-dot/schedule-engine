import {useEffect,useId,useRef,useState} from "react";
import {
  calendarMonth,formatCivilDate,isoCivilDate,parseCivilDateInput,
  PORTUGUESE_MONTHS,PORTUGUESE_WEEKDAYS,shiftCalendarMonth,
} from "../utils/civilDatePicker";

interface Props {
  label:string;
  value:string;
  onChange(nextIsoDate:string):void;
  required?:boolean;
}

function currentMonth(value:string):{year:number;month:number} {
  const date=parseCivilDateInput(value);
  if(date)return {year:Number(date.slice(0,4)),month:Number(date.slice(5,7))};
  const today=new Date();
  return {year:today.getFullYear(),month:today.getMonth()+1};
}

/**
 * An accessible, predictable calendar instead of Safari's tiny, browser-owned
 * <input type="date"> popup. The only value sent to the parent is ISO YYYY-MM-DD.
 * Text entry accepts pt-PT (DD/MM/AAAA) and ISO (for imports/automated tests).
 */
export default function CivilDateField({label,value,onChange,required=false}:Props) {
  const id=useId();
  const dialogRef=useRef<HTMLDialogElement>(null);
  const triggerRef=useRef<HTMLButtonElement>(null);
  const inputRef=useRef<HTMLInputElement>(null);
  const [open,setOpen]=useState(false);
  const [month,setMonth]=useState(()=>currentMonth(value));
  const [draftText,setDraftText]=useState<string|null>(null);
  const [touched,setTouched]=useState(false);

  const text=draftText??formatCivilDate(value);
  const invalid=text.trim()!==""&&parseCivilDateInput(text)===null;
  const displayMonth=calendarMonth(month.year,month.month);

  useEffect(()=>{
    const dialog=dialogRef.current;
    if(!dialog)return;
    if(open&&!dialog.open)dialog.showModal();
    if(!open&&dialog.open)dialog.close();
  },[open]);

  useEffect(()=>{
    if(inputRef.current)
      inputRef.current.setCustomValidity(invalid
        ?"Data inválida. Introduz DD/MM/AAAA ou escolhe no calendário.":"");
  },[invalid,text]);

  function openCalendar() {
    setMonth(currentMonth(value));
    setOpen(true);
  }
  function closeCalendar() {
    setOpen(false);
    triggerRef.current?.focus();
  }
  function selectDate(iso:string) {
    setDraftText(null);
    setTouched(false);
    onChange(iso);
    closeCalendar();
  }
  function changeText(next:string,input:HTMLInputElement) {
    setDraftText(next);
    setTouched(false);
    const iso=parseCivilDateInput(next);
    input.setCustomValidity(next.trim()!==""&&!iso
      ?"Data inválida. Introduz DD/MM/AAAA ou escolhe no calendário.":"");
    onChange(iso??"");
  }
  function move(delta:number) {
    setMonth(current=>shiftCalendarMonth(current.year,current.month,delta));
  }

  const cells=Array.from({length:displayMonth.rows*7},(_,index)=>{
    const day=index-displayMonth.offset+1;
    return day>=1&&day<=displayMonth.days?day:null;
  });

  return <div className="civil-date-field">
    <div className="civil-date-control">
      <input
        id={id} ref={inputRef} type="text" inputMode="numeric"
        aria-label={label} autoComplete="off"
        placeholder="DD/MM/AAAA" value={text} required={required}
        aria-invalid={touched&&invalid}
        onChange={event=>changeText(event.target.value,event.currentTarget)}
        onBlur={()=>{
          setTouched(true);
          if(!invalid)setDraftText(null);
        }}
      />
      <button ref={triggerRef} type="button" className="civil-date-open"
        aria-label={"Escolher "+label.toLowerCase()}
        aria-haspopup="dialog" aria-expanded={open}
        onClick={openCalendar}>
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="1.8"
          strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="5" width="18" height="16" rx="2"/>
          <path d="M7 3v4M17 3v4M3 10h18"/>
        </svg>
        <span>Calendário</span>
      </button>
    </div>
    {touched&&invalid&&<span className="civil-date-error" role="alert">
      Data inválida. Utiliza DD/MM/AAAA ou escolhe no calendário.
    </span>}

    <dialog ref={dialogRef} className="civil-calendar-dialog"
      aria-label={"Calendário: "+label}
      onClose={()=>setOpen(false)}
      onCancel={()=>setOpen(false)}>
      <div className="civil-calendar-header">
        <div>
          <strong>Escolher data</strong>
          <span>{label}</span>
        </div>
        <button type="button" className="civil-calendar-close"
          aria-label="Fechar calendário" onClick={closeCalendar}>×</button>
      </div>
      <div className="civil-calendar-nav">
        <button type="button" aria-label="Mês anterior"
          disabled={month.year===1&&month.month===1}
          onClick={()=>move(-1)}>‹</button>
        <select value={month.month} aria-label="Mês do calendário"
          onChange={event=>setMonth(old=>({...old,month:Number(event.target.value)}))}>
          {PORTUGUESE_MONTHS.map((name,index)=>
            <option key={name} value={index+1}>{name}</option>)}
        </select>
        <input type="number" inputMode="numeric"
          aria-label="Ano do calendário" min={1} max={9999}
          value={month.year}
          onChange={event=>{
            const next=Number(event.target.value);
            if(Number.isSafeInteger(next)&&next>=1&&next<=9999)
              setMonth(old=>({...old,year:next}));
          }}/>
        <button type="button" aria-label="Mês seguinte"
          disabled={month.year===9999&&month.month===12}
          onClick={()=>move(1)}>›</button>
      </div>
      <div className="civil-calendar-weekdays" aria-hidden="true">
        {PORTUGUESE_WEEKDAYS.map(day=><span key={day}>{day}</span>)}
      </div>
      <div className="civil-calendar-days" role="group"
        aria-label={"Dias de "+PORTUGUESE_MONTHS[month.month-1]+" de "+month.year}>
        {cells.map((day,index)=>day===null
          ?<span key={"blank-"+index} aria-hidden="true"/>
          :<button key={day} type="button"
            className={isoCivilDate(month.year,month.month,day)===value?"is-selected":""}
            aria-label={day+" de "+PORTUGUESE_MONTHS[month.month-1]+" de "+month.year}
            aria-pressed={isoCivilDate(month.year,month.month,day)===value}
            onClick={()=>selectDate(isoCivilDate(month.year,month.month,day))}>
            {day}
          </button>)}
      </div>
      <div className="civil-calendar-footer">
        <button type="button" onClick={()=>selectDate((()=>{
          const now=new Date();
          return isoCivilDate(now.getFullYear(),now.getMonth()+1,now.getDate());
        })())}>Hoje</button>
        <button type="button" onClick={closeCalendar}>Cancelar</button>
      </div>
    </dialog>
  </div>;
}
