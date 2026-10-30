import { useEffect, useMemo, useState } from "react";
import type { Person } from "../types";
import type { GenerateConstrainedPeriodResult } from "../utils/constrainedPeriodGenerator";

type Shift = GenerateConstrainedPeriodResult["assignments"][number];
type View = "day" | "week" | "month";

interface Props {
  assignments: Shift[];
  people: Person[];
  startDate: string;
  endDate: string;
}

function addDays(date: string, amount: number): string {
  const dateUtc = new Date(date + "T12:00:00Z");
  dateUtc.setUTCDate(dateUtc.getUTCDate() + amount);
  return dateUtc.toISOString().slice(0, 10);
}
function monday(date: string): string {
  const d = new Date(date + "T12:00:00Z");
  return addDays(date, -(d.getUTCDay() + 6) % 7);
}
function monthStart(date: string): string { return date.slice(0, 7) + "-01"; }
function monthMove(date: string, amount: number): string {
  const d = new Date(monthStart(date) + "T12:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + amount);
  return d.toISOString().slice(0, 10);
}
function label(date: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("pt-PT", { ...options, timeZone: "UTC" }).format(new Date(date + "T12:00:00Z"));
}
function timeMinutes(time: string): number { return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)); }
function shiftLabel(shift: Shift): string { return shift.interval.start + "–" + shift.interval.end; }
function mealLabel(shift: Shift): string { return shift.mealBreak ? shift.mealBreak.start + "–" + shift.mealBreak.end : "Sem pausa"; }

export default function ScheduleViews({ assignments, people, startDate, endDate }: Props) {
  const [view, setView] = useState<View>("week");
  const [cursor, setCursor] = useState(startDate);
  useEffect(() => { setCursor(startDate); setView("week"); }, [startDate, endDate, assignments]);

  const names = useMemo(() => new Map(people.map(p => [p.id, p.name])), [people]);
  const getName = (id: string) => names.get(id) ?? id;
  const byDate = useMemo(() => {
    const result = new Map<string, Shift[]>();
    for (const shift of assignments) result.set(shift.date, [...(result.get(shift.date) ?? []), shift]);
    return result;
  }, [assignments]);
  const dateShifts = (date: string) => (byDate.get(date) ?? []).slice().sort((a,b) => a.interval.start.localeCompare(b.interval.start));
  const weekStart = monday(cursor);
  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const calendarStart = monday(monthStart(cursor));
  const calendarDates = Array.from({ length: 42 }, (_, i) => addDays(calendarStart, i));
  const monthKey = cursor.slice(0, 7);
  const visibleDates = view === "day" ? [cursor] : view === "week" ? weekDates : calendarDates.filter(date => date.startsWith(monthKey));
  const visibleShifts = visibleDates.flatMap(date => dateShifts(date));
  const inPeriod = (date: string) => date >= startDate && date <= endDate;

  function navigate(amount: number) {
    setCursor(previous => view === "month" ? monthMove(previous, amount) : addDays(previous, amount * (view === "week" ? 7 : 1)));
  }
  const heading = view === "day" ? label(cursor, { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    : view === "week" ? label(weekStart, {day:"2-digit",month:"short"}) + " — " + label(addDays(weekStart, 6), {day:"2-digit",month:"short",year:"numeric"})
    : label(monthStart(cursor), { month:"long",year:"numeric" });

  return <section className="panel schedule-views-panel" aria-label="Visualização do horário gerado">
    <div className="schedule-views-header">
      <div>
        <p className="section-kicker">Resultado da simulação</p>
        <h2>Horário gerado</h2>
        <p className="schedule-views-disclaimer">Proposta válida apenas no cenário declarado. Não é um horário aprovado ou guardado.</p>
      </div>
      <div className="schedule-view-switch" role="group" aria-label="Vista do horário">
        {([["day","Dia"],["week","Semana"],["month","Mês"]] as const).map(([key,text]) =>
          <button key={key} type="button" className={view === key ? "active" : ""} aria-pressed={view === key} onClick={() => setView(key)}>{text}</button>)}
      </div>
    </div>
    <div className="schedule-views-toolbar">
      <div className="schedule-view-navigation">
        <button type="button" aria-label="Período anterior" onClick={() => navigate(-1)}>‹</button>
        <strong>{heading}</strong>
        <button type="button" aria-label="Período seguinte" onClick={() => navigate(1)}>›</button>
      </div>
      <span className="schedule-view-count">{visibleShifts.length} turno(s) nesta vista</span>
    </div>
    {view === "day" && <div className="schedule-day-view">
      {!inPeriod(cursor) && <p className="schedule-outside-note">Este dia está fora do período simulado ({startDate} a {endDate}).</p>}
      {inPeriod(cursor) && dateShifts(cursor).length === 0 && <p className="schedule-empty-day">Sem turnos atribuídos neste dia.</p>}
      {dateShifts(cursor).map((shift, index) => <div className="schedule-day-shift" key={shift.personId + "-" + index}>
        <div><strong>{getName(shift.personId)}</strong><span>{shift.mealBreak ? "Refeição " + shift.mealBreak.start + "–" + shift.mealBreak.end : "Sem pausa obrigatória"}</span></div>
        <strong>{shiftLabel(shift)}</strong>
        <div className="schedule-shift-bar" role="img" aria-label={"Turno " + shiftLabel(shift) + (shift.mealBreak ? ", pausa " + mealLabel(shift) : "")}>
          <span className="schedule-shift-work" style={{ left: Math.max(0, timeMinutes(shift.interval.start) / 1440 * 100) + "%", width: Math.max(1, (timeMinutes(shift.interval.end) - timeMinutes(shift.interval.start)) / 1440 * 100) + "%" }} />
          {shift.mealBreak && <span className="schedule-shift-meal" style={{ left: timeMinutes(shift.mealBreak.start) / 1440 * 100 + "%", width: (timeMinutes(shift.mealBreak.end) - timeMinutes(shift.mealBreak.start)) / 1440 * 100 + "%" }} />}
        </div>
      </div>)}
    </div>}
    {view === "week" && <div className="schedule-week-scroll">
      <table className="schedule-week-table">
        <thead><tr><th scope="col">Pessoa</th>{weekDates.map(date => <th key={date} scope="col">
          <span>{label(date,{weekday:"short"})}</span><strong>{label(date,{day:"2-digit",month:"2-digit"})}</strong>
        </th>)}</tr></thead>
        <tbody>{people.filter(person => person.active || assignments.some(s => s.personId === person.id)).map(person =>
          <tr key={person.id}><th scope="row">{person.name}</th>{weekDates.map(date =>
            <td key={date} className={!inPeriod(date) ? "schedule-outside-period" : ""}>{dateShifts(date).filter(s => s.personId === person.id).map((shift,index) =>
              <div className="schedule-week-shift" key={index} title={shift.mealBreak ? "Refeição: " + shift.mealBreak.start + "–" + shift.mealBreak.end : ""}><strong>{shiftLabel(shift)}</strong>{shift.mealBreak && <small className="schedule-week-meal">Pausa {mealLabel(shift)}</small>}</div>)}
              {inPeriod(date) && !dateShifts(date).some(s => s.personId === person.id) && <span className="schedule-day-off">—</span>}
            </td>)}</tr>)}</tbody>
      </table>
    </div>}
    {view === "month" && <div className="schedule-month-grid">
      {["Seg","Ter","Qua","Qui","Sex","Sáb","Dom"].map(day => <span className="schedule-month-weekday" key={day}>{day}</span>)}
      {calendarDates.map(date => <button type="button" key={date}
        className={"schedule-month-cell" + (date.startsWith(monthKey) ? "" : " outside-month") + (!inPeriod(date) ? " outside-period" : "")}
        onClick={() => { setCursor(date); setView("day"); }}
        aria-label={label(date,{day:"numeric",month:"long"}) + ": " + dateShifts(date).length + " turnos. Ver dia."}>
        <strong>{Number(date.slice(8,10))}</strong>
        {inPeriod(date) && dateShifts(date).slice(0,3).map((shift,index) => <span className="schedule-month-shift" key={shift.personId + index}><b>{getName(shift.personId)}</b><span>{shiftLabel(shift)}</span>{shift.mealBreak && <span className="schedule-month-meal">Pausa {mealLabel(shift)}</span>}</span>)}
        {inPeriod(date) && dateShifts(date).length > 3 && <small>+{dateShifts(date).length - 3} turnos</small>}
      </button>)}
    </div>}
    <p className="schedule-views-footer">Os dias fora do período gerado não contêm dados de turnos aprovados. Mudar de vista não executa novamente o motor.</p>
  </section>;
}
