import { useEffect, useState } from "react";
import { supabaseAuthClient } from "../persistence/supabaseInstance";
import { createSupabaseGeneratedScheduleRepository } from "../persistence/supabaseGeneratedScheduleRepository";
import type { StoredGeneratedSchedule } from "../persistence/generatedScheduleRepository";
import ScheduleViews from "./ScheduleViews";

const archive = supabaseAuthClient
  ? createSupabaseGeneratedScheduleRepository(supabaseAuthClient)
  : null;

/** Contextual archive inside Horários; deliberately not a new top-level tab. */
export default function GeneratedScheduleHistory({ onExit }: { onExit: () => void }) {
  const [items, setItems] = useState<StoredGeneratedSchedule[]>([]);
  const [selected, setSelected] = useState<StoredGeneratedSchedule | null>(null);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setProblem(null);
    if (!archive) {
      setProblem("A ligação Supabase não está configurada.");
      setLoading(false);
      return;
    }
    void archive.list().then(rows => {
      if (live) setItems(rows);
    }).catch(error => {
      if (live) setProblem(error instanceof Error ? error.message :
        "Não foi possível consultar as propostas guardadas.");
    }).finally(() => {
      if (live) setLoading(false);
    });
    return () => { live = false; };
  }, [attempt]);

  if (selected) {
    return (
      <section className="panel generator-panel">
        <div className="panel-header">
          <div>
            <p className="section-kicker">Histórico · proposta não aprovada</p>
            <h2>{selected.startDate} a {selected.endDate}</h2>
            <p className="generator-hint">
              Guardada em {new Date(selected.createdAt).toLocaleString("pt-PT")}.
              Esta consulta não altera nem aprova o horário.
            </p>
          </div>
          <button type="button" onClick={() => setSelected(null)}>Voltar à lista</button>
        </div>
        <ScheduleViews
          assignments={selected.payload.shifts}
          people={selected.payload.people}
          startDate={selected.startDate}
          endDate={selected.endDate}
        />
      </section>
    );
  }

  return (
    <section className="panel generator-panel" aria-label="Histórico de propostas">
      <div className="panel-header">
        <div>
          <p className="section-kicker">Consulta de horários</p>
          <h2>Propostas guardadas</h2>
        </div>
        <button type="button" onClick={onExit}>Voltar ao planeamento</button>
      </div>
      <p className="section-description">
        Últimas 60 propostas guardadas nesta conta. São resultados de geração,
        não horários oficialmente aprovados nem registos de horas trabalhadas.
      </p>
      <div className="p63-action-row">
        <button type="button" disabled={loading}
          onClick={() => setAttempt(x => x + 1)}>Atualizar histórico</button>
        {loading && <span className="generator-hint" role="status">A consultar…</span>}
      </div>
      {problem && <p className="generator-issue" role="alert">{problem}</p>}
      {!loading && !problem && items.length === 0 &&
        <p>Não existem propostas guardadas nesta conta.</p>}
      <div className="period-day-list">
        {items.map(item => (
          <article className="period-day-card" key={item.id}>
            <div className="period-day-heading">
              <div>
                <strong>{item.startDate} a {item.endDate}</strong>
                <span>{new Date(item.createdAt).toLocaleString("pt-PT")}
                  {" · "}{item.payload.shifts.length} turnos</span>
              </div>
              <span className="work-rule-badge">Não aprovada</span>
            </div>
            <button type="button" onClick={() => setSelected(item)}>
              Consultar proposta
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
