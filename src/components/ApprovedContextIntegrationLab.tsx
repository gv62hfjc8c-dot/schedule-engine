import {useState} from "react";
import type {ApprovalEnvironment, ApprovedScheduleLedger} from "../utils/approvedSchedules";
import {approveSchedule,createApprovedScheduleLedger,queryApprovedExternalContext,listApprovedShifts} from "../utils/approvedSchedules";
import {generateConstrainedPeriodSchedule,type GenerateConstrainedPeriodResult} from "../utils/constrainedPeriodGenerator";
import {INITIAL_WORK_CONSTRAINTS} from "../utils/workConstraints";
import {createEmptyWeeklyAvailability} from "../utils/availability";
import {createEmptyWeeklyPresenceRequirements} from "../utils/presence";
import {WEEKDAYS} from "../utils/operatingCalendar";
import type {WeeklyOperatingHours} from "../types";

/** End-to-end local demonstration: REAL approval core + REAL context query + REAL P6.3.
 * Deliberately NOT a server or Supabase approval; no remote persistence or actual users.
 */
const MON="2026-10-26";
const TUE="2026-10-27";
const ZONE="Atlantic/Azores";
const hour=(start:string,end:string)=>[{start,end}];
const monday=hour("16:00","22:00");
const tuesday=hour("08:00","12:00");
function environment():ApprovalEnvironment {
  const weeklyOperatingHours=Object.fromEntries(
    WEEKDAYS.map(d=>[d,[]])
  ) as unknown as WeeklyOperatingHours;
  const people=[{id:"a",name:"Pessoa A",active:true},{id:"b",name:"Pessoa B",active:true}];
  const availabilities=people.map(p=>({
    personId:p.id,
    weeklyAvailability:createEmptyWeeklyAvailability(),
    exceptions:[
      {date:MON,intervals:p.id==="a"?monday:[]},
      {date:TUE,intervals:tuesday},
    ],
  }));
  return {
    people,availabilities,
    operatingCalendar:{weeklyOperatingHours,exceptions:[
      {date:MON,intervals:monday},{date:TUE,intervals:tuesday},
    ]},
    presence:{
      weeklyPresenceRequirements:createEmptyWeeklyPresenceRequirements(),
      presenceExceptions:[MON,TUE].map(date=>({date,requirements:{
        minimumAtOpening:1,minimumDuringOperation:1,minimumAtClosing:1,
      }})),
    },
    workConstraints:structuredClone(INITIAL_WORK_CONSTRAINTS),
  };
}
const empty=()=>createApprovedScheduleLedger(
  {startDate:"2026-10-25",endDate:"2026-11-09"},ZONE,true
);
export default function ApprovedContextIntegrationLab(){
  const [ledger,setLedger]=useState<ApprovedScheduleLedger>(empty);
  const [status,setStatus]=useState("Ainda não existem horários aprovados.");
  const [result,setResult]=useState<GenerateConstrainedPeriodResult|null>(null);
  const env=environment();
  const mondayContext=queryApprovedExternalContext({
    ledger,targetPeriod:{startDate:MON,endDate:MON},
    workConstraints:env.workConstraints,timeZone:ZONE,
  });
  const tuesdayContext=queryApprovedExternalContext({
    ledger,targetPeriod:{startDate:TUE,endDate:TUE},
    workConstraints:env.workConstraints,timeZone:ZONE,
  });
  const approve=()=>{
    setResult(null);
    const response=approveSchedule({
      ledger,expectedVersion:ledger.version,at:new Date().toISOString(),
      environment:env,draft:{
        id:"monday-approved",startDate:MON,endDate:MON,timeZone:ZONE,
        shifts:[{date:MON,personId:"a",interval:{start:"16:00",end:"22:00"},mealBreak:null}],
      },
    });
    if(!response.ok){
      setStatus("Aprovação recusada: "+response.failure.code+" — "+response.failure.issues.join(" "));
      return;
    }
    setLedger(response.ledger);
    setStatus("Aprovado: segunda-feira, Pessoa A, 16:00–22:00. Ledger versão "+response.ledger.version+".");
  };
  const generate=()=>{
    setResult(null);
    const context=queryApprovedExternalContext({
      ledger,targetPeriod:{startDate:TUE,endDate:TUE},
      workConstraints:env.workConstraints,timeZone:ZONE,
    });
    if(context.status!=="ready"||!context.externalContext){
      setStatus("Geração bloqueada: "+context.status+". "+context.issues.join(" "));
      return;
    }
    const generated=generateConstrainedPeriodSchedule({
      startDate:TUE,endDate:TUE,timeZone:ZONE,
      ...env,workRules:{standardShiftDurationMinutes:480},
      externalContext:context.externalContext,maxSearchNodes:5000,
    });
    setResult(generated);
    setStatus("Geração de terça: "+generated.status+
      ". O motor considerou "+context.externalContext.shifts.length+
      " turno(s) aprovado(s) fora do período.");
  };
  const approved=listApprovedShifts(ledger);
  return <div className="generator-layout period-generator-layout">
    <section className="panel generator-panel">
      <div className="panel-header"><div>
        <p className="section-kicker">P6.4 · integração do contexto aprovado</p>
        <h2>Do horário aprovado ao próximo horário</h2>
      </div></div>
      <p>Demonstração isolada com o núcleo real de aprovação, consulta de contexto e motor P6.3.
        Nada é guardado no Supabase. As pessoas são fictícias e o estado desaparece ao atualizar a página.</p>
      <p><strong>Segunda, 26/10:</strong> Pessoa A disponível 16:00–22:00.
        <strong> Terça, 27/10:</strong> Pessoas A e B disponíveis 08:00–12:00.</p>
      <p>Se a Pessoa A trabalhar na segunda até às 22:00, não pode começar terça às 08:00:
        só teria 10 horas de descanso, menos que as 11 horas obrigatórias.</p>
      <p><strong>1. Aprovar compromisso de segunda-feira</strong></p>
      <button type="button" onClick={approve}>Aprovar segunda-feira para Pessoa A</button>
      <p><strong>2. Gerar terça com contexto consultado automaticamente</strong></p>
      <button type="button" onClick={generate}>Gerar terça-feira com horários aprovados</button>
      <p><button type="button" onClick={()=>{
        setLedger(empty());setResult(null);setStatus("Laboratório reiniciado.");
      }}>Reiniciar laboratório</button></p>
      <p className="generator-hint">Contexto completo aqui significa apenas a declaração controlada
        do laboratório. Na aplicação real deve vir de uma fonte autorizada, não de uma suposição do browser.</p>
    </section>
    <section className="panel generator-results" aria-live="polite">
      <div className="panel-header"><div>
        <p className="section-kicker">Estado e verificação</p><h2>Resultado da integração</h2>
      </div></div>
      <p role="status"><strong>{status}</strong></p>
      <p>Ledger: versão <strong>{ledger.version}</strong></p>
      <p>Segunda-feira: <strong>{mondayContext.status==="target_occupied"?
        "Ocupada por horário aprovado":mondayContext.status}</strong></p>
      <p>Contexto para terça: <strong>{tuesdayContext.status}</strong></p>
      <h3>Turnos aprovados</h3>
      {approved.length?approved.map((shift,i)=><p key={i}>{shift.date} ·
        Pessoa {shift.personId.toUpperCase()} · {shift.interval.start}–{shift.interval.end}</p>):
        <p>Nenhum turno aprovado.</p>}
      {result&&<><h3>Horário gerado para terça</h3>
        <p>Estado: <strong>{result.status}</strong></p>
        {result.assignments.map((shift,i)=><p key={i}>Pessoa {shift.personId.toUpperCase()} ·
          {shift.interval.start}–{shift.interval.end}</p>)}
        {result.issues.map((issue,i)=><p key={i} className="generator-issue">{issue}</p>)}
      </>}
    </section>
  </div>;
}
