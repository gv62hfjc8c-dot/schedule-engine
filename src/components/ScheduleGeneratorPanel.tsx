import { useRef, useState } from "react";
import { executeApprovedScheduleCommand, type ApprovedScheduleCommand, type TrustedApprovalPorts } from "../application/executeApprovedScheduleCommand";
import { createSupabaseApprovedLedgerRepository } from "../persistence/supabaseApprovedLedgerRepository";
import { WEEKDAYS } from "../utils/operatingCalendar";
import { createEmptyWeeklyAvailability } from "../utils/availability";
import { createEmptyWeeklyPresenceRequirements } from "../utils/presence";
import { INITIAL_WORK_CONSTRAINTS } from "../utils/workConstraints";
import { approveSchedule, cancelApprovedSchedule, replaceApprovedSchedule, createApprovedScheduleLedger, listApprovedShifts, queryApprovedExternalContext, type ApprovedScheduleLedger, type ApprovalEnvironment, type ApprovalMutationResult } from "../utils/approvedSchedules";
import type {
  OperatingCalendarConfiguration,
  Person,
  PersonAvailability,
  PresenceConfiguration,
  WorkRulesConfiguration,
} from "../types";
import ConstrainedPeriodGeneratorPanel from "./ConstrainedPeriodGeneratorPanel";

interface ScheduleGeneratorPanelProps {
  people: Person[];
  availabilities: PersonAvailability[];
  operatingCalendar: OperatingCalendarConfiguration;
  workRules: WorkRulesConfiguration;
  presence: PresenceConfiguration;
}

/** PR #32: single public generator. Legacy experiments remain in source for tests. */
export default function ScheduleGeneratorPanel(props: ScheduleGeneratorPanelProps) {
  return <ConstrainedPeriodGeneratorPanel {...props} />;
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

/**
 * PR #18 browser contract lab: the REAL approved-ledger repository adapter
 * talks to a deterministic fake Supabase REST/RPC service in memory.
 * No network, credentials, configured people or Supabase writes.
 */
function StoragePlayground() {
  const remote = useRef<ApprovedScheduleLedger | null>(null);
  const [tabA,setTabA] = useState<ApprovedScheduleLedger | null>(null);
  const [tabB,setTabB] = useState<ApprovedScheduleLedger | null>(null);
  const [message,setMessage] = useState("Servidor simulado sem qualquer registo. Começa por consultar.");
  const [history,setHistory] = useState<string[]>([]);
  const [busy,setBusy] = useState(false);
  const user = {id:"11111111-1111-4111-8111-111111111111",email:"lab@example.test"};
  const fakeClient = {
    user,
    async request(path:string, init?:RequestInit):Promise<Response> {
      if (path.startsWith("/rest/v1/schedule_engine_approved_ledgers") && !init) {
        return Response.json(remote.current
          ? [{ledger_version:remote.current.version,payload:structuredClone(remote.current)}]
          : []);
      }
      if (path === "/rest/v1/rpc/save_schedule_engine_approved_ledger" &&
          init?.method === "POST") {
        const args = JSON.parse(String(init.body)) as {
          p_expected_version:number;p_payload:ApprovedScheduleLedger;
          p_attest_complete:boolean;
        };
        const old = remote.current;
        if (!old) {
          if (args.p_expected_version !== -1 || args.p_payload.version !== 0 ||
            args.p_payload.complete || args.p_payload.records.length) {
            return Response.json({code:"40001",message:"Inicialização inválida."},{status:409});
          }
        } else {
          if (args.p_expected_version !== old.version ||
            args.p_payload.version !== old.version+1)
            return Response.json({code:"40001",message:"Conflito de versão: a leitura está desatualizada."},{status:409});
          if (JSON.stringify(args.p_payload.coverage)!==JSON.stringify(old.coverage) ||
            args.p_payload.timeZone!==old.timeZone)
            return Response.json({code:"22023",message:"Escopo não pode mudar."},{status:400});
          if (!old.complete && args.p_payload.complete && !args.p_attest_complete)
            return Response.json({code:"22023",message:"É necessária confirmação explícita."},{status:400});
        }
        remote.current=structuredClone(args.p_payload);
        return Response.json(remote.current.version);
      }
      return Response.json({message:"Rota desconhecida."},{status:404});
    },
  };
  const adapter = () => createSupabaseApprovedLedgerRepository(fakeClient);
  const run = async (label:string, action:()=>Promise<void>) => {
    setBusy(true);
    try {
      await action();
      setMessage(label + ": concluído.");
      setHistory(h=>[...h,label+" — sucesso"]);
    } catch(e) {
      const detail=e instanceof Error?e.message:String(e);
      setMessage(label+": recusado. "+detail);
      setHistory(h=>[...h,label+" — recusado: "+detail]);
    } finally {setBusy(false);}
  };
  const initial = () => createApprovedScheduleLedger(
    {startDate:"2026-10-25",endDate:"2026-11-09"},
    "Atlantic/Azores",false);
  const readA = () => run("Ler na aba A",async()=>{
    const value=await adapter().load();setTabA(value);
    if (!value) throw new Error("Registo desconhecido: ainda não existe.");
  });
  const initialize = () => run("Inicializar registo",async()=>{
    const value=initial();await adapter().save(value,null);setTabA(value);
  });
  const attest = () => run("Confirmar contexto",async()=>{
    if (!tabA) throw new Error("Consulta ou inicialização necessária.");
    const next={...tabA,version:tabA.version+1,complete:true};
    await adapter().save(next,tabA.version,{attestComplete:true});setTabA(next);
  });
  const increment = () => run("Guardar nova versão",async()=>{
    if (!tabA) throw new Error("Ainda não há registo na aba A.");
    const next={...tabA,version:tabA.version+1};
    await adapter().save(next,tabA.version);setTabA(next);
  });
  const status = (value:ApprovedScheduleLedger|null) =>
    value ? "versão "+value.version+" · contexto "+(value.complete?"confirmado":"não confirmado")
      : "sem registo carregado";
  return (
    <div className="generator-layout period-generator-layout">
      <section className="panel generator-panel">
        <div className="panel-header"><div><p className="section-kicker">PR #18 · persistência isolada</p>
          <h2>Laboratório do repositório de horários</h2></div></div>
        <p>Esta experiência utiliza o adaptador real do PR #18 com um serviço Supabase
          simulado em memória. Não usa rede, não grava dados reais e reinicia ao atualizar a página.</p>
        <p><strong>1. Consultar antes de existir qualquer registo</strong></p>
        <button type="button" disabled={busy} onClick={readA}>Ler na aba A</button>
        <p><strong>2. Inicializar, sem assumir ausência confirmada de turnos</strong></p>
        <button type="button" disabled={busy} onClick={initialize}>Inicializar registo vazio</button>
        <p><strong>3. Confirmar expressamente o contexto conhecido</strong></p>
        <button type="button" disabled={busy} onClick={attest}>Confirmar contexto completo</button>
        <p><strong>4. Simular uma segunda aba e uma alteração concorrente</strong></p>
        <button type="button" disabled={busy} onClick={()=>run("Ler na aba B",async()=>{
          setTabB(await adapter().load());
        })}>Ler na aba B</button>
        <button type="button" disabled={busy} onClick={increment}>Guardar nova versão na aba A</button>
        <button type="button" disabled={busy} onClick={()=>run("Gravar pela aba B",async()=>{
          if (!tabB) throw new Error("Lê primeiro na aba B.");
          const next={...tabB,version:tabB.version+1};
          await adapter().save(next,tabB.version);setTabB(next);
        })}>Tentar gravar versão antiga na aba B</button>
        <p><button type="button" disabled={busy} onClick={()=>{
          remote.current=null;setTabA(null);setTabB(null);
          setMessage("Laboratório reiniciado.");setHistory([]);
        }}>Reiniciar laboratório</button></p>
      </section>
      <section className="panel generator-results" aria-live="polite">
        <div className="panel-header"><div><p className="section-kicker">Estado das leituras</p>
          <h2>Servidor e duas abas</h2></div></div>
        <p role="status"><strong>{message}</strong></p>
        <p><strong>Servidor:</strong> {status(remote.current)}</p>
        <p><strong>Aba A:</strong> {status(tabA)}</p>
        <p><strong>Aba B:</strong> {status(tabB)}</p>
        <p>Os registos são sempre cópias isoladas. Uma gravação com versão antiga
          deve receber conflito e não alterar o servidor.</p>
        <h3>Histórico das operações nesta experiência</h3>
        {history.length ? history.map((entry,i)=><p key={i}>{i+1}. {entry}</p>)
          : <p>Nenhuma operação executada.</p>}
      </section>
    </div>
  );
}

/**
 * PR #19 browser learning lab. The REAL application command handler is
 * invoked with fake server-owned ports; this is NOT a security boundary.
 * No browser-supplied owner/environment/clock and no external side effects.
 */
function TrustedApprovalPlayground() {
  const seed = () => createApprovedScheduleLedger(
    {startDate:"2026-10-25",endDate:"2026-11-09"},DEMO_ZONE,true);
  const server = useRef<ApprovedScheduleLedger>(seed());
  const [version,setVersion] = useState(0);
  const [message,setMessage] = useState("Nenhum comando executado.");
  const [events,setEvents] = useState<string[]>([]);
  const [busy,setBusy] = useState(false);
  const active = server.current.records.find(r=>r.status==="approved");
  const command = async (label:string, draft:ApprovedScheduleCommand, anonymous=false,
    envFailure=false, conflict=false) => {
    setBusy(true);
    let writes=0, environmentReads=0;
    const ports:TrustedApprovalPorts = {
      authenticateOwner:async()=>anonymous?null:"test-owner",
      loadLedger:async(owner)=>{
        if(owner!=="test-owner")throw Error("Owner inválido");
        return structuredClone(server.current);
      },
      loadEnvironment:async(owner)=>{
        environmentReads++;
        if(owner!=="test-owner" || envFailure)throw Error("Configuração indisponível");
        return demonstrationEnvironment();
      },
      now:()=>new Date().toISOString(),
      commit:async(owner,next,expected)=>{
        if(owner!=="test-owner")throw Error("Owner inválido");
        if(conflict || server.current.version!==expected)return "conflict";
        server.current=structuredClone(next);
        writes++;
        return "saved";
      },
    };
    try {
      const result=await executeApprovedScheduleCommand(draft,ports);
      const detail=result.ok
        ? "aprovado; versão "+result.version+"; estado "+result.record.status
        : "recusado ("+result.code+"): "+result.issues.join(" ");
      setMessage(label+": "+detail+". Gravações: "+writes+
        "; leituras de configuração: "+environmentReads+".");
      setEvents(rows=>[...rows,label+" — "+detail]);
      setVersion(server.current.version);
    } finally {setBusy(false);}
  };
  const draft = () => demoDraft("trusted-"+(server.current.records.length+1),"a");
  const approve = (expectedVersion:number, anonymous=false,envFailure=false,conflict=false) =>
    command("Aprovar horário",{
      kind:"approve",expectedVersion,draft:draft(),
    },anonymous,envFailure,conflict);
  return (
    <div className="generator-layout period-generator-layout">
      <section className="panel generator-panel">
        <div className="panel-header"><div><p className="section-kicker">PR #19 · fronteira de confiança simulada</p>
          <h2>Comandos de aprovação protegidos</h2></div></div>
        <p>O comando real do PR #19 corre neste laboratório com serviços de
          autenticação, leitura e gravação fictícios. Não é um servidor seguro,
          não comunica com Supabase e não altera dados reais.</p>
        <p><strong>1. Tentar aprovar sem autenticação</strong></p>
        <button type="button" disabled={busy} onClick={()=>approve(version,true)}>
          Testar sessão não autenticada
        </button>
        <p><strong>2. Testar uma versão já desatualizada</strong></p>
        <button type="button" disabled={busy} onClick={()=>approve(Math.max(-1,version-1))}>
          Testar versão incorreta
        </button>
        <p><strong>3. Validar um comando de aprovação</strong></p>
        <button type="button" disabled={busy} onClick={()=>approve(version)}>
          Aprovar com identidade e contexto válidos
        </button>
        <p><strong>4. Impedir aprovação quando o servidor falha</strong></p>
        <button type="button" disabled={busy} onClick={()=>approve(version,false,true)}>
          Simular configuração indisponível
        </button>
        <button type="button" disabled={busy} onClick={()=>approve(version,false,false,true)}>
          Simular conflito na gravação
        </button>
        <p><strong>5. Cancelar sem consultar configurações operacionais</strong></p>
        <button type="button" disabled={busy||!active}
          onClick={()=>active&&command("Cancelar horário",{
            kind:"cancel",expectedVersion:version,scheduleId:active.id,
          },false,true)}>
          Cancelar aprovação ativa
        </button>
        <p><button type="button" disabled={busy} onClick={()=>{
          server.current=seed();setVersion(0);setMessage("Laboratório reiniciado.");setEvents([]);
        }}>Reiniciar laboratório</button></p>
      </section>
      <section className="panel generator-results" aria-live="polite">
        <div className="panel-header"><div><p className="section-kicker">Contrato de comando</p>
          <h2>Resultado no servidor fictício</h2></div></div>
        <p role="status"><strong>{message}</strong></p>
        <p>Versão do ledger: <strong>{version}</strong></p>
        <p>Horário ativo: <strong>{active?.id??"Nenhum"}</strong></p>
        <p>Registos preservados: <strong>{server.current.records.length}</strong></p>
        <h3>Operações executadas</h3>
        {events.length?events.map((entry,i)=><p key={i}>{i+1}. {entry}</p>):
          <p>Sem operações.</p>}
      </section>
    </div>
  );
}
