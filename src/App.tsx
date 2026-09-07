// App.tsx
// Fase 1 (+ dia fixo/fim de semana): vista semanal + colaboradores. O motor de geração automática
// (cobertura por equipa, dia fixo com desempate justo, fim de semana em rotação, reforço por
// função secundária) já corre por baixo, gerado UMA SEMANA de cada vez.
import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import type { Cell, Colaborador, Equipa, Schedule } from "./types";
import { COVERAGE_CONFIG, DEFAULT_STAFF, LS_KEY } from "./constants";
import { addDays, mondayOf, weekDates, dateKey, todayKey } from "./utils/dates";
import { generateWeekSchedule, weekAlerts, readWeekendBonus, isEmployedOn } from "./utils/autoSchedule";
import { S, C, FONT } from "./styles";
import { WeeklyView } from "./components/WeeklyView";
import { AlertBanner } from "./components/AlertBanner";
import { CoverageGauge } from "./components/CoverageGauge";
import { StaffManager } from "./components/StaffManager";
import { WeekendPanel } from "./components/WeekendPanel";
import { ResumoView } from "./components/ResumoView";
import { SuggestionBanner } from "./components/SuggestionBanner";
import { suggestAfterEdit, type SwapSuggestion } from "./utils/suggestions";
import { loadState, saveState } from "./storage/storage";

export default function App() {
  const saved = useMemo(loadState, []);
  const today = new Date();

  const [staff, setStaff] = useState<Colaborador[]>(saved?.staff ?? DEFAULT_STAFF);
  const [schedule, setSchedule] = useState<Schedule>(saved?.schedule ?? {});
  const [generatedWeeks, setGeneratedWeeks] = useState<string[]>(saved?.generatedWeeks ?? []);
  const [refDate, setRefDate] = useState<Date>(saved?.refDate ? new Date(saved.refDate) : today);
  const [showStaff, setShowStaff] = useState(false);
  const [view, setView] = useState<"semanal" | "resumo">("semanal");
  const [toast, setToast] = useState<string | null>(null);
  const [pendingSuggestion, setPendingSuggestion] = useState<SwapSuggestion | null>(null);

  useEffect(() => {
    setPendingSuggestion(null); // não faz sentido uma sugestão de uma semana ficar visível noutra
  }, [refDate]);

  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify({ staff, schedule, generatedWeeks, refDate: refDate.toISOString() }));
  }, [staff, schedule, generatedWeeks, refDate]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const monday = useMemo(() => mondayOf(refDate.getFullYear(), refDate.getMonth(), refDate.getDate()), [refDate]);
  const mondayKey = dateKey(monday.getFullYear(), monday.getMonth(), monday.getDate());
  const dates = useMemo(() => weekDates(refDate.getFullYear(), refDate.getMonth(), refDate.getDate()), [refDate]);

  const weekNotGenerated = !generatedWeeks.includes(mondayKey);
  const staffThisWeek = useMemo(
    () => staff.filter((s) => dates.some((d) => isEmployedOn(s, dateKey(d.getFullYear(), d.getMonth(), d.getDate())))),
    [staff, dates]
  );
  const alerts = useMemo(() => weekAlerts(dates, schedule, staff, COVERAGE_CONFIG), [dates, schedule, staff]);
  const bonus = useMemo(() => readWeekendBonus(monday, staff, schedule), [monday, staff, schedule]);

const runGenerate = (forced?: Parameters<typeof generateWeekSchedule>[4]) => {
    const { schedule: sched, avisos } = generateWeekSchedule(monday, staff, COVERAGE_CONFIG, schedule, forced);
    setSchedule(sched);
    setGeneratedWeeks((prev) => Array.from(new Set([...prev, mondayKey])));
    setToast(avisos.length > 0 ? `Gerado — ${avisos.length} dia(s) com cobertura em falta, ver avisos abaixo.` : "Gerado sem avisos.");
  };

  const handleGenerate = () => {
    if (!weekNotGenerated) {
      const ok = window.confirm("Esta semana já tinha sido gerada. Gerar outra vez substitui TODAS as células, incluindo alterações manuais. Continuar?");
      if (!ok) return;
    }
    runGenerate();
  };

  const handleChangeBonus = (team: Equipa, nome: string | null) => {
    const hasData = dates.some((d) => staff.some((s) => schedule[`${s.nome}-${dateKey(d.getFullYear(), d.getMonth(), d.getDate())}`]));
    if (hasData) {
      const ok = window.confirm("Trocar o fim de semana volta a gerar a semana inteira (não só essa pessoa), substituindo alterações manuais já feitas. Continuar?");
      if (!ok) return;
    }
    runGenerate({ ...bonus, [team]: nome });
  };

  const handleCellChange = (nome: string, key: string, cell: Cell) => {
    const oldType = schedule[`${nome}-${key}`]?.type;
    const newSchedule = { ...schedule, [`${nome}-${key}`]: cell };
    setSchedule(newSchedule);
    const suggestion = suggestAfterEdit(nome, key, oldType, cell.type, staff, newSchedule, COVERAGE_CONFIG);
    setPendingSuggestion(suggestion);
  };

  const handleAceitarSugestao = () => {
    if (!pendingSuggestion) return;
    setSchedule((prev) => {
      const next = { ...prev };
      pendingSuggestion.aplicar.forEach(({ nome, dateStr, cell }) => { next[`${nome}-${dateStr}`] = cell; });
      return next;
    });
    setPendingSuggestion(null);
  };

  const handleRecusarSugestao = () => setPendingSuggestion(null);

  const handleExport = () => {
    const data = JSON.stringify({ staff, schedule, generatedWeeks, refDate: refDate.toISOString() }, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `borja-reis-horarios-backup-${todayKey()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setToast("Cópia de segurança descarregada.");
  };

  const handleImportFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.staff) || typeof parsed.schedule !== "object") {
          window.alert("Este ficheiro não parece ser uma cópia de segurança válida desta app.");
          return;
        }
        const ok = window.confirm("Importar isto substitui TODOS os dados atuais desta app neste navegador (colaboradores, semanas, tudo). Continuar?");
        if (!ok) return;
        setStaff(parsed.staff);
        setSchedule(parsed.schedule);
        setGeneratedWeeks(Array.isArray(parsed.generatedWeeks) ? parsed.generatedWeeks : []);
        if (parsed.refDate) setRefDate(new Date(parsed.refDate));
        setToast("Dados importados com sucesso.");
      } catch {
        window.alert("Não consegui ler este ficheiro — confirma que é um .json exportado por esta app.");
      }
    };
    reader.readAsText(file);
  };

  const weekLabel = `${dates[0].getDate()}/${dates[0].getMonth() + 1} – ${dates[6].getDate()}/${dates[6].getMonth() + 1}`;

  return (
    <div style={S.app}>
      <header style={S.header}>
        <div>
          <h1 style={S.headerTitle}>Borja Reis · Horários</h1>
          <div style={S.headerSub}>Mega Loja Borja Reis — vista semanal</div>
        </div>
        <div style={S.weekNav}>
          <button style={view === "semanal" ? S.primaryBtn : S.ghostBtn} onClick={() => setView("semanal")}>Semanal</button>
          <button style={view === "resumo" ? S.primaryBtn : S.ghostBtn} onClick={() => setView("resumo")}>Resumo</button>
        </div>
        {view === "semanal" && (
          <div style={S.weekNav}>
            <button style={S.navBtn} onClick={() => setRefDate((d) => addDays(d, -7))}>‹ Semana</button>
            <div style={S.weekLabel}>{weekLabel}</div>
            <button style={S.navBtn} onClick={() => setRefDate((d) => addDays(d, 7))}>Semana ›</button>
          </div>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <button style={S.ghostBtn} onClick={handleExport} title="Descarrega um ficheiro .json com tudo o que está guardado">
            Exportar
          </button>
          <label style={{ ...S.ghostBtn, cursor: "pointer", display: "inline-block" }}>
            Importar
            <input
              type="file"
              accept="application/json"
              style={{ display: "none" }}
              onChange={(e: ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) handleImportFile(f); e.target.value = ""; }}
            />
          </label>
          <button style={S.ghostBtn} onClick={() => setShowStaff((v) => !v)}>
            {showStaff ? "Fechar colaboradores" : "Colaboradores"}
          </button>
          {view === "semanal" && (
            <button style={S.primaryBtn} onClick={handleGenerate}>
              {weekNotGenerated ? "Gerar semana automaticamente" : "Gerar de novo"}
            </button>
          )}
        </div>
      </header>

      <div style={S.main}>
        {toast && (
          <div style={{ ...S.alertRow, background: C.okBg, color: C.ok, fontWeight: 600, marginBottom: 14 }}>
            {toast}
          </div>
        )}

        {view === "semanal" ? (
          <>
            <AlertBanner alerts={alerts} />
            {pendingSuggestion && (
              <div style={{ marginBottom: 14 }}>
                <SuggestionBanner suggestion={pendingSuggestion} onAceitar={handleAceitarSugestao} onRecusar={handleRecusarSugestao} />
              </div>
            )}
            {staffThisWeek.length > 0 && <WeekendPanel bonus={bonus} staff={staffThisWeek} onChange={handleChangeBonus} />}
            <CoverageGauge dates={dates} schedule={schedule} staff={staffThisWeek} coverage={COVERAGE_CONFIG} />
            <WeeklyView dates={dates} staff={staffThisWeek} schedule={schedule} onCellChange={handleCellChange} />
          </>
        ) : (
          <ResumoView staff={staff} schedule={schedule} />
        )}

        {showStaff && <StaffManager staff={staff} onChange={setStaff} />}

        <div style={{ marginTop: 14, fontSize: 11, color: C.inkMuted, fontFamily: FONT.body }}>
          Cobertura mínima por equipa, dia fixo por pessoa, rotação de fim de semana completo e
          distribuição justa de folgas já automáticos. Continuidade entre meses e ajuste às metas
          de horas semanais ficam para as próximas fases.
        </div>
      </div>
    </div>
  );
}
