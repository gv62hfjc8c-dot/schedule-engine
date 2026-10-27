import { Children, isValidElement, useEffect, useRef, useState, type ReactNode } from "react";

interface TimeWheelSelectProps {
  value: string;
  onChange: (event: { target: { value: string } }) => void;
  children: ReactNode;
  disabled?: boolean;
}
export default function TimeWheelSelect({ value, onChange, children, disabled }: TimeWheelSelectProps) {
  const options = Children.toArray(children).flatMap(child => {
    // Existing option maps arrive as child elements; preserve supplied valid times.
    return isValidElement<{ value?: string; children?: ReactNode }>(child) && typeof child.props.value === "string"
      ? [child.props.value] : [];
  });
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.indexOf(value);
  useEffect(() => {
    if (!open) return;
    ref.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({block:"center"});
  }, [open, value]);
  function pick(next: string) { onChange({target:{value:next}}); setOpen(false); }
  function move(direction: number) {
    if (!options.length) return;
    pick(options[Math.max(0, Math.min(options.length - 1, selected + direction))]);
  }
  return <div className="time-wheel-field">
    <button type="button" disabled={disabled} className="time-wheel-trigger"
      aria-label={"Hora: " + value} aria-haspopup="listbox" aria-expanded={open}
      onClick={() => setOpen(!open)}
      onKeyDown={event => { if (event.key === "ArrowDown") {event.preventDefault();move(1);} if(event.key === "ArrowUp"){event.preventDefault();move(-1);} }}>
      <span>{value}</span><span aria-hidden="true" className="time-wheel-chevrons">⌃<br/>⌄</span>
    </button>
    {open && <><button type="button" aria-label="Fechar seleção de hora" className="picker-backdrop" onClick={() => setOpen(false)}/>
      <div className="time-wheel-popover" role="dialog" aria-label="Escolher hora">
        <div className="picker-heading"><strong>Escolher hora</strong><button type="button" onClick={() => setOpen(false)}>Concluído</button></div>
        <div className="time-wheel-list" role="listbox" ref={ref} aria-label="Horas disponíveis">
          <div className="time-wheel-spacer" aria-hidden="true"/>
          {options.map(time => <button key={time} role="option" aria-selected={time===value} type="button"
            className={"time-wheel-option"+(time===value?" selected":"")} onClick={()=>pick(time)}>{time}</button>)}
          <div className="time-wheel-spacer" aria-hidden="true"/>
        </div>
      </div></>}
  </div>;
}
