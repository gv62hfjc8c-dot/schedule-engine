import { Children, isValidElement, useEffect, useRef, useState, type ReactNode } from "react";

interface TimeWheelSelectProps {
  value: string;
  onChange: (event: { target: { value: string } }) => void;
  children: ReactNode;
  disabled?: boolean;
}

export default function TimeWheelSelect({ value, onChange, children, disabled }: TimeWheelSelectProps) {
  // The availability and operating-hours rules supply the allowed combinations.
  const options = Children.toArray(children).flatMap(child =>
    isValidElement<{ value?: string }>(child) && typeof child.props.value === "string"
      ? [child.props.value] : []
  );
  const hours = [...new Set(options.map(time => time.slice(0, 2)))];
  const [open, setOpen] = useState(false);
  const [draftHour, setDraftHour] = useState(value.slice(0, 2));
  const [draftMinute, setDraftMinute] = useState(value.slice(3, 5));
  const hourList = useRef<HTMLDivElement>(null);
  const minuteList = useRef<HTMLDivElement>(null);

  const minutes = [...new Set(options.filter(time => time.startsWith(draftHour + ":")).map(time => time.slice(3, 5)))];
  const candidate = draftHour + ":" + draftMinute;
  const valid = options.includes(candidate);

  function start() {
    setDraftHour(value.slice(0, 2));
    setDraftMinute(value.slice(3, 5));
    setOpen(true);
  }
  function selectHour(hour: string) {
    setDraftHour(hour);
    const available = options.filter(time => time.startsWith(hour + ":")).map(time => time.slice(3, 5));
    if (!available.includes(draftMinute)) setDraftMinute(available[0] ?? "00");
  }
  function confirm() {
    if (!valid) return;
    setOpen(false);
    if (candidate !== value) onChange({ target: { value: candidate } });
  }
  useEffect(() => {
    if (!open) return;
    hourList.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "center" });
    minuteList.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "center" });
  }, [open, draftHour, draftMinute]);

  return <div className="time-wheel-field">
    <button type="button" disabled={disabled} className="time-wheel-trigger"
      aria-label={"Hora: " + value} aria-haspopup="dialog" aria-expanded={open}
      onClick={(event) => { event.stopPropagation(); open ? setOpen(false) : start(); }}>
      <span>{value}</span><span aria-hidden="true" className="time-wheel-chevrons">⌃<br/>⌄</span>
    </button>
    {open && <>
      <button type="button" aria-label="Cancelar seleção de hora" className="picker-backdrop" onClick={(event) => { event.stopPropagation(); setOpen(false); }}/>
      <div className="time-wheel-popover time-wheel-dual" role="dialog" aria-label="Selecionar horas e minutos"
        onKeyDown={event => { if (event.key === "Escape") setOpen(false); }}>
        <div className="picker-heading">
          <strong>Selecionar hora</strong>
          <button type="button" disabled={!valid} onClick={(event) => { event.stopPropagation(); confirm(); }}>Concluído</button>
        </div>
        <div className="time-wheel-columns">
          <div className="time-wheel-column">
            <span className="time-wheel-caption">Horas</span>
            <div className="time-wheel-list" role="listbox" aria-label="Horas" ref={hourList}>
              <div className="time-wheel-spacer" aria-hidden="true"/>
              {hours.map(hour => <button key={hour} type="button" role="option"
                aria-selected={hour === draftHour}
                className={"time-wheel-option" + (hour === draftHour ? " selected" : "")}
                onClick={() => selectHour(hour)}>{hour}</button>)}
              <div className="time-wheel-spacer" aria-hidden="true"/>
            </div>
          </div>
          <span className="time-wheel-separator" aria-hidden="true">:</span>
          <div className="time-wheel-column">
            <span className="time-wheel-caption">Minutos</span>
            <div className="time-wheel-list" role="listbox" aria-label="Minutos" ref={minuteList}>
              <div className="time-wheel-spacer" aria-hidden="true"/>
              {minutes.map(minute => <button key={minute} type="button" role="option"
                aria-selected={minute === draftMinute}
                className={"time-wheel-option" + (minute === draftMinute ? " selected" : "")}
                onClick={() => setDraftMinute(minute)}>{minute}</button>)}
              <div className="time-wheel-spacer" aria-hidden="true"/>
            </div>
          </div>
        </div>
      </div>
    </>}
  </div>;
}
