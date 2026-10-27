import { useState } from "react";
import { WEEKDAYS } from "../utils/operatingCalendar";
import { createEmptyWeeklyAvailability } from "../utils/availability";
import { createEmptyWeeklyPresenceRequirements } from "../utils/presence";
import { INITIAL_WORK_CONSTRAINTS } from "../utils/workConstraints";
import { approveSchedule, cancelApprovedSchedule, replaceApprovedSchedule, createApprovedScheduleLedger, listApprovedShifts, queryApprovedExternalContext, type ApprovedScheduleLedger, type ApprovalEnvironment, type ApprovalMutationResult } from "../utils/approvedSchedules";
import { readGeneratorMode, saveGeneratorMode } from "./generatorUiPreferences";
import type {
  OperatingCalendarConfiguration,
  Person,
  PersonAvailability,
  PresenceConfiguration,
  WorkRulesConfiguration,
} from "../types";
import DailyGeneratorPanel from "./DailyGeneratorPanel";
import PeriodGeneratorPanel from "./PeriodGeneratorPanel";
import ConstrainedPeriodGeneratorPanel from "./ConstrainedPeriodGeneratorPanel";

interface ScheduleGeneratorPanelProps {
  people: Person[];
  availabilities: PersonAvailability[];
  operatingCalendar: OperatingCalendarConfiguration;
  workRules: WorkRulesConfiguration;
  presence: PresenceConfiguration;
}

export default function ScheduleGeneratorPanel(
  props: ScheduleGeneratorPanelProps
) {
  const [mode, setMode] = useState<"day" | "period" | "constrained" | "approval">(readGeneratorMode);

  return (
    <>
      <nav className="generator-mode-switch" aria-label="Modo de geração">
        <button
          type="button"
          className={mode === "day" ? "generator-mode-active" : ""}
          aria-pressed={mode === "day"}
          onClick={() => { setMode("day"); saveGeneratorMode("day"); }}
        >
          Um dia
        </button>
        <button
          type="button"
          className={mode === "period" ? "generator-mode-active" : ""}
          aria-pressed={mode === "period"}
          onClick={() => { setMode("period"); saveGeneratorMode("period"); }}
        >
          Vários dias · V0
        </button>
        <button
          type="button"
          className={mode === "constrained" ? "generator-mode-active" : ""}
          aria-pressed={mode === "constrained"}
          onClick={() => { setMode("constrained"); saveGeneratorMode("constrained"); }}
        >
          Vários dias · regras P6.3
        </button>
        <button type="button" className={mode === "approval" ? "generator-mode-active" : ""} aria-pressed={mode === "approval"} onClick={() => setMode("approval")}>Laboratório PR #17</button>
      </nav>

      {mode === "day" ? (
        <DailyGeneratorPanel {...props} />
      ) : mode === "period" ? (
        <PeriodGeneratorPanel {...props} />
      ) : mode === "constrained" ? (
        <ConstrainedPeriodGeneratorPanel {...props} />
      ) : (
        <ApprovalPlayground />
      )}
    </>
  );
}

/**
 * Deliberately isolated, deterministic local PR #17 demonstration.
 * No application settings, localStorage or Supabase data are read or written.
 * Ledger exists only in this component's React state.
 */
const DEMO_DATE = "2026-10-26";
const DEMO_ZONE = "Atlantic/Azores";
function demonstrationEnvironment(): ApprovalEnvironment {
  const emptyHours = Object.fromEntries(WEEKDAYS.map(day => [day, []])) as unknown as
    ApprovalEnvironment["operatingCalendar"]["weeklyOperatingHours"];
  const availability = ["a", "b"].map(personId => ({
    personId,
    weeklyAvailability: createEmptyWeeklyAvailability(),
    exceptions: [{ date: DEMO_DATE, intervals: [{start:"09:00",end:"13:00"}] }],
  }));
  return {
    people: [
      { id:"a",name:"Pessoa A (demonstração)",active:true },
      { id:"b",name:"Pessoa B (demonstração)",active:true },
    ],
    availabilities: availability,
    operatingCalendar: {
      weeklyOperatingHours: emptyHours,
      exceptions:[{date:DEMO_DATE,intervals:[{start:"09:00",end:"13:00"}]}],
    },
    presence: {
      weeklyPresenceRequirements:createEmptyWeeklyPresenceRequirements(),
      presenceExceptions:[{date:DEMO_DATE,requirements:{
        minimumAtOpening:1,minimumDuringOperation:1,minimumAtClosing:1,
      }}],
    },
    workConstraints:structuredClone(INITIAL_WORK_CONSTRAINTS),
  };
}
function demoDraft(id:string, personId:string) {
  return {
    id,startDate:DEMO_DATE,endDate:DEMO_DATE,timeZone:DEMO_ZONE,
    shifts:[{date:DEMO_DATE,personId,interval:{start:"09:00",end:"13:00"},mealBreak:null}],
  };
}
function ApprovalPlayground() {
  const fresh = () => createApprovedScheduleLedger({
    startDate:"2026-10-25",endDate:"2026-11-02",
  },DEMO_ZONE,true);
  const [ledger,setLedger] = useState<ApprovedScheduleLedger>(fresh);
  const [message,setMessage] = useState("Ainda não executaste nenhuma operação.");
  const environment = demonstrationEnvironment();
  const active = ledger.records.find(record => record.status === "approved");
  const current = listApprovedShifts(ledger);
  const context = queryApprovedExternalContext({
    ledger,targetPeriod:{startDate:DEMO_DATE,endDate:DEMO_DATE},
    workConstraints:INITIAL_WORK_CONSTRAINTS,timeZone:DEMO_ZONE,
  });
  const run = (action: string, result: ApprovalMutationResult) => {
    if (result.ok) {
      setLedger(result.ledger);
      setMessage(action + ": concluída. Versão " + result.ledger.version + ".");
    } else {
      setMessage(action + ": recusada (" + result.failure.code + "). " +
        result.failure.issues.join(" ") +
        result.failure.workViolations.map(v => v.message).join(" "));
    }
  };
  const now = () => new Date().toISOString();
  const approve = (personId:string) => run("Aprovar",approveSchedule({
    ledger,expectedVersion:ledger.version,at:now(),
    draft:demoDraft("demo-" + (ledger.records.length+1),personId),environment,
  }));
  return (
    <div className="generator-layout period-generator-layout">
      <section className="panel generator-panel">
        <div className="panel-header"><div><p className="section-kicker">PR #17 · demonstração local</p>
          <h2>Aprovação de horários</h2></div></div>
        <p className="section-description">Laboratório isolado com duas pessoas fictícias,
          segunda-feira 26/10/2026, operação 09:00–13:00 e presença mínima de uma pessoa.
          Não utiliza nem modifica os teus colaboradores, simulações ou dados do Supabase.
          O histórico desaparece quando atualizas a página.</p>
        <p><strong>Passo 1:</strong> Aprova o turno da Pessoa A.</p>
        <div className="p63-action-row">
          <button type="button" className="primary-button"
            onClick={() => approve("a")}>Aprovar Pessoa A</button>
        </div>
        <p><strong>Passo 2:</strong> Tenta aprovar outro horário para o mesmo dia.</p>
        <div className="p63-action-row">
          <button type="button" onClick={() => approve("b")}>Tentar aprovar Pessoa B</button>
        </div>
        <p><strong>Passo 3:</strong> Experimenta cancelar ou substituir o horário ativo.</p>
        <div className="p63-action-row">
          <button type="button" disabled={!active} onClick={() => {
            if (!active) return;
            run("Cancelar",cancelApprovedSchedule({
              ledger,expectedVersion:ledger.version,
              scheduleId:active.id,at:now(),
            }));
          }}>Cancelar aprovação</button>
          <button type="button" disabled={!active} onClick={() => {
            if (!active) return;
            const personId = active.shifts[0]?.personId === "a" ? "b" : "a";
            run("Substituir",replaceApprovedSchedule({
              ledger,expectedVersion:ledger.version,at:now(),
              replaceId:active.id,
              draft:demoDraft("substituicao-" + (ledger.records.length+1),personId),
              environment,
            }));
          }}>Substituir por outra pessoa</button>
        </div>
        <div className="p63-action-row"><button type="button" onClick={() => {
          setLedger(fresh());setMessage("Demonstração reiniciada: ledger vazio, versão 0.");
        }}>Reiniciar laboratório</button></div>
      </section>
      <section className="panel generator-results" aria-live="polite">
        <div className="panel-header"><div><p className="section-kicker">Estado em memória</p>
          <h2>Resultado das operações</h2></div></div>
        <div className="generator-result-body">
          <p role="status"><strong>{message}</strong></p>
          <p>Versão do ledger: <strong>{ledger.version}</strong></p>
          <p>Horário ativo: <strong>{active?.id ?? "Nenhum"}</strong></p>
          <p>Consulta do período pelo gerador: <strong>{
            context.status === "target_occupied" ? "Ocupado — não gerar por cima" :
            context.status === "ready" ? "Livre — geração permitida" : context.status
          }</strong></p>
          <h3>Turnos atualmente aprovados</h3>
          {current.length ? current.map((shift,i) => (
            <p key={i}>{shift.date} · {shift.personId === "a" ? "Pessoa A" : "Pessoa B"} ·
              {" "}{shift.interval.start}–{shift.interval.end}</p>
          )) : <p>Nenhum turno ativo.</p>}
          <h3>Histórico preservado</h3>
          {ledger.records.length ? ledger.records.map(record => (
            <p key={record.id}><strong>{record.id}</strong>: {record.status} ·
              aprovado em {record.approvedAt} · substitui {record.replacesId ?? "—"}</p>
          )) : <p>Ainda não existem registos.</p>}
        </div>
      </section>
    </div>
  );
}
