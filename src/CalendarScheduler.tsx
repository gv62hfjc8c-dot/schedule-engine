import {useState} from "react";
import {monthCells,monthLabel,selectedDayLabel} from "./calendar";
import {generateSchedule,type GenerationResult} from "./generateSchedule";
import {certifySchedule,type CertificationReport} from "./certifySchedule";
import {loadTeamDraftFromBrowser} from "./teamDraftRepository";
import {loadOpeningHoursDraftFromBrowser} from "./openingHoursDraftRepository";
import {
  loadMonthlyDraftFromBrowser,saveMonthlyDraftToBrowser,
  readExternalMonthlyContextFromBrowser,type MonthlyDraftLoad,
} from "./monthlyScheduleDraftRepository";
import {assignmentMinutes,type WorkAssignment} from "./workAssignments";
import {calendarScheduleView} from "./calendarScheduleView";
import type {MealBreak} from "./mealBreaks";

const WEEKDAYS=["Seg","Ter","Qua","Qui","Sex","Sáb","Dom"];

type Feedback={kind:"error"|"success";message:string};
type MonthView={year:number;month:number};
interface SourceSnapshot {
  team:ReturnType<typeof loadTeamDraftFromBrowser>;
  opening:ReturnType<typeof loadOpeningHoursDraftFromBrowser>;
  context:ReturnType<typeof readExternalMonthlyContextFromBrowser>;
}
function loadSources(year:number,month:number):SourceSnapshot {
  return {
    team:loadTeamDraftFromBrowser(),
    opening:loadOpeningHoursDraftFromBrowser(),
    context:readExternalMonthlyContextFromBrowser(year,month),
  };
}
function sourceError(sources:SourceSnapshot):string|null {
  if(sources.team.status!=="loaded")
    return "Configura uma equipa válida com colaboradores ativos antes de gerar. Consulta Configuração → Equipa.";
  if(sources.opening.status!=="loaded")
    return "Configura primeiro o funcionamento da empresa. Consulta Configuração → Funcionamento.";
  if(!sources.context.ok)return sources.context.message;
  return null;
}
function certificationForSaved(
  sources:SourceSnapshot,year:number,month:number,
  assignments:WorkAssignment[],
  mealBreaks:MealBreak[]=[],mealBreakPolicy:"v1"|"v2"|undefined=undefined
):CertificationReport|null {
  if(sources.team.status!=="loaded"||
    sources.opening.status!=="loaded"||!sources.context.ok)return null;
  return certifySchedule({
    period:{mode:"monthly",year,month},
    team:sources.team.value,openingHours:sources.opening.value,
    externalContext:sources.context.context,candidateAssignments:assignments,
    mealBreaks,mealBreakPolicy,
  });
}
function stateText(report:CertificationReport|null):string {
  if(!report)return "Não foi possível verificar esta proposta com os dados atuais.";
  if(report.status==="valid")
    return "40 horas semanais e restantes regras implementadas verificadas. Não é uma aprovação definitiva.";
  if(report.status==="insufficient_context")
    return "Proposta por certificar: faltam dados de semanas que atravessam outros meses.";
  return "A proposta tem conflitos de horas, dias sem trabalho, pausas ou cobertura do funcionamento.";
}
function memberLabel(memberId:string,names:Map<string,string>):string {
  return names.get(memberId)??"Colaborador não encontrado";
}

function MonthWorkspace({
  year,month,todayString,selectedMemberId,onSelectMember,
}:{
  year:number;month:number;todayString:string;
  selectedMemberId:string|null;
  onSelectMember:(id:string|null)=>void;
}) {
  const [initial]=useState(()=>loadMonthlyDraftFromBrowser(year,month));
  const [saved,setSaved]=useState<WorkAssignment[]|null>(
    ()=>initial.status==="loaded"?initial.assignments:null
  );
  const [savedMealBreaks,setSavedMealBreaks]=useState<MealBreak[]>(
    ()=>initial.status==="loaded"?initial.mealBreaks:[]
  );
  const [revision,setRevision]=useState<string|null>(
    ()=>initial.status==="loaded"?initial.revision:null
  );
  const [preview,setPreview]=useState<GenerationResult|null>(null);
  const [sourceSignature,setSourceSignature]=useState<string|null>(null);
  const [selectedDate,setSelectedDate]=useState<string|null>(null);
  const [feedback,setFeedback]=useState<Feedback|null>(null);
  const [names,setNames]=useState<Map<string,string>>(()=>{
    const team=loadTeamDraftFromBrowser();
    return new Map(team.status==="loaded"?
      team.value.members.map(member=>[member.id,member.name]):[]);
  });
  const [savedReport,setSavedReport]=useState<CertificationReport|null>(()=>{
    if(initial.status!=="loaded")return null;
    return certificationForSaved(loadSources(year,month),year,month,
      initial.assignments,initial.mealBreaks,initial.mealBreakPolicy);
  });
  const data=preview?.candidateAssignments??saved??[];
  // Legacy PR84 v1 drafts may still carry separate meal records.
  // New v2 shifts contain their own pause, never a second work shift.
  const legacyMealBreaks=preview?[]:savedMealBreaks;
  const report=preview?.certification??savedReport;
  // A display-only projection: certification and saving ALWAYS use full data.
  const view=calendarScheduleView(data,selectedMemberId);
  const byDay=view.byDay;
  const memberOptions=new Map(names);
  for(const entry of data){
    if(!memberOptions.has(entry.memberId))
      memberOptions.set(entry.memberId,"Colaborador não encontrado ("+
        entry.memberId.slice(0,8)+")");
  }
  if(selectedMemberId!==null && !memberOptions.has(selectedMemberId))
    memberOptions.set(selectedMemberId,"Colaborador não encontrado ("+
      selectedMemberId.slice(0,8)+")");
  const cells=monthCells(year,month-1);
  const dayAssignments=selectedDate?(byDay.get(selectedDate)??[]):[];
  const dayMealBreaks=selectedDate?legacyMealBreaks.filter(meal=>
    meal.date===selectedDate &&
    (selectedMemberId===null||meal.memberId===selectedMemberId)
  ):[];
  const dayTimeline=[
    ...dayAssignments.map((assignment,index)=>({
      kind:"work" as const,start:assignment.start,
      memberId:assignment.memberId,index,assignment,
    })),
    ...dayMealBreaks.map((meal,index)=>({
      kind:"meal" as const,start:meal.start,
      memberId:meal.memberId,index,meal,
    })),
  ].sort((a,b)=>a.start.localeCompare(b.start)||
    a.memberId.localeCompare(b.memberId));
  const isBlocked=initial.status==="invalid"||initial.status==="unavailable";

  function generate(){
    if(isBlocked){
      setFeedback({kind:"error",message:"O registo deste mês não pode ser lido. Não será substituído automaticamente."});
      return;
    }
    const sources=loadSources(year,month);
    const problem=sourceError(sources);
    if(problem){
      setFeedback({kind:"error",message:problem});
      return;
    }
    if(sources.team.status!=="loaded"||
       sources.opening.status!=="loaded"||!sources.context.ok)return;
    const result=generateSchedule({
      period:{mode:"monthly",year,month},
      team:sources.team.value,openingHours:sources.opening.value,
      externalContext:sources.context.context,
      mealBreakPolicy:"v2",
    });
    setPreview(result);
    setSourceSignature(JSON.stringify(sources));
    setNames(new Map(sources.team.value.members.map(member=>[member.id,member.name])));
    if(selectedMemberId!==null &&
      !sources.team.value.members.some(member=>member.id===selectedMemberId) &&
      !result.candidateAssignments.some(a=>a.memberId===selectedMemberId))
      onSelectMember(null);
    setFeedback(result.status==="invalid_input"?
      {kind:"error",message:"Os dados de entrada não permitem gerar uma proposta."}:
      result.status==="invalid"?
      {kind:"error",message:"A proposta não cumpre alguma regra obrigatória de horas, folgas, pausas ou cobertura. Consulta os problemas encontrados."}:
      {kind:"success",message:"Proposta gerada. Revê o resultado e guarda-a apenas se estiver correta."});
  }

  function save(){
    if(isBlocked || !preview || sourceSignature===null ||
       preview.status==="invalid"||preview.status==="invalid_input")return;
    const currentSources=loadSources(year,month);
    const problem=sourceError(currentSources);
    if(problem){
      setFeedback({kind:"error",message:problem});
      return;
    }
    if(JSON.stringify(currentSources)!==sourceSignature){
      setFeedback({kind:"error",message:"Os dados da empresa, da equipa ou dos outros meses mudaram. Gera novamente antes de guardar."});
      return;
    }
    const currentReport=certificationForSaved(currentSources,year,month,
      preview.candidateAssignments,[],"v2");
    if(!currentReport || currentReport.status==="invalid"){
      setFeedback({kind:"error",message:"A proposta não passa a certificação atual. Não foi guardada."});
      return;
    }
    if(saved!==null &&
      !window.confirm("Substituir a proposta guardada deste mês? Os horários dos outros meses não serão alterados."))return;
    const result=saveMonthlyDraftToBrowser(
      year,month,preview.candidateAssignments,revision,
      undefined,"v2"
    );
    if(!result.ok){
      setFeedback({kind:"error",message:result.message});
      return;
    }
    setSaved(result.assignments);
    setSavedMealBreaks(result.mealBreaks);
    setRevision(result.revision);
    setSavedReport(currentReport);
    setPreview(null);
    setSourceSignature(null);
    setFeedback({kind:"success",message:"Proposta de "+monthLabel(year,month-1)+
      " guardada neste navegador. Não foi aprovada nem sincronizada com outros dispositivos."});
  }

  return (
    <>
      <header className="page-heading">
        <div>
          <p className="eyebrow">Planeamento</p>
          <h1>Horários</h1>
          <p>Gera, consulta e guarda propostas mensais para a tua equipa.</p>
        </div>
      </header>
      <section className="surface schedule-controls" aria-label="Geração de horário">
        <div className="schedule-controls-heading">
          <div>
            <p className="surface-kicker">Proposta mensal</p>
            <h2>{monthLabel(year,month-1)}</h2>
            <p>O motor distribui automaticamente os turnos conforme a equipa e o funcionamento guardado.</p>
          </div>
          <div className="schedule-buttons">
            <button type="button" className="button button-primary"
              disabled={isBlocked} onClick={generate}>Gerar horário</button>
            {preview && (preview.status==="valid"||preview.status==="insufficient_context") &&
              <button type="button" className="button schedule-save" onClick={save}>
                Guardar proposta
              </button>}
          </div>
        </div>
        <p className="schedule-storage-note">
          {saved===null?"Ainda não existe uma proposta guardada para este mês.":
            "Existe uma proposta guardada neste dispositivo para este mês."}
          {" "}A geração não altera os horários dos outros meses.
        </p>
        {isBlocked&&<p role="alert" className="form-error">
          {initial.status==="invalid"
            ?"Os dados guardados deste mês são inválidos. Não serão apagados nem substituídos automaticamente."
            :"O armazenamento deste dispositivo não está disponível."}
        </p>}
        {feedback&&<p role={feedback.kind==="error"?"alert":"status"}
          className={feedback.kind==="error"?"form-error":"form-success"}>
          {feedback.message}
        </p>}
        {(preview||saved)&&<div className="schedule-certification" aria-live="polite">
          <span className={"schedule-status schedule-status-"+(report?.status??"unknown")}>
            {report?.status==="valid"?"Regras verificadas":
              report?.status==="insufficient_context"?"Contexto incompleto":
              report?.status==="invalid"?"Com problemas":"Não verificado"}
          </span>
          <p>{stateText(report)}</p>
          {report&&report.issues.length>0&&<div className="schedule-issues">
            <strong>Problemas encontrados</strong>
            <ul>
              {report.issues.slice(0,5).map((issue,index)=>
                <li key={issue.code+"-"+index}>
                  {issue.message}{issue.weekStart?" — semana de "+issue.weekStart:""}
                    {issue.date?" — "+issue.date:""}
                    {issue.gapStart&&issue.gapEnd?
                      " ("+issue.gapStart+"–"+issue.gapEnd+")":""}
                </li>)}
            </ul>
            {report.issues.length>5&&<p>
              Existem mais {report.issues.length-5} problemas no resultado.</p>}
          </div>}
        </div>}
      </section>
      <div className="calendar-layout">
        <section className="surface calendar-panel" aria-label="Calendário mensal">
          <header className="calendar-header">
            <div>
              <p className="surface-kicker">Calendário</p>
              <h2>{monthLabel(year,month-1)}</h2>
            </div>
            <div className="schedule-member-filter">
              <label htmlFor="schedule-member-filter">Ver horário de</label>
              <select id="schedule-member-filter"
                value={selectedMemberId??""}
                onChange={event=>onSelectMember(
                  event.target.value===""?null:event.target.value
                )}>
                <option value="">Toda a equipa</option>
                {[...memberOptions].map(([id,name])=>
                  <option key={id} value={id}>{name}</option>)}
              </select>
            </div>
          </header>
          {selectedMemberId!==null&&
            <p className="schedule-member-summary" role="status">
              <strong>{memberLabel(selectedMemberId,memberOptions)}</strong>
              {" · "}{(view.totalMinutes/60).toLocaleString("pt-PT")} h
              {" · "}{view.workingDays} dias com turno neste mês
            </p>}
          <div className="calendar-grid" aria-label={monthLabel(year,month-1)}>
            {WEEKDAYS.map(day=><span className="weekday" key={day}>{day}</span>)}
            {cells.map((cell,index)=>cell.day===null
              ? <span className="empty-day" key={"empty-"+index} aria-hidden="true"/>
              : <button type="button" key={cell.date}
                className={"calendar-day"+
                  (cell.date===todayString?" is-today":"")+
                  (cell.date===selectedDate?" is-selected":"")+
                  ((byDay.get(cell.date!)?.length??0)>0?" has-assignments":"")}
                onClick={()=>setSelectedDate(cell.date)}
                aria-label={selectedDayLabel(cell.date!)+", "+
                  (byDay.get(cell.date!)?.length??0)+" intervalos de trabalho"}
                aria-pressed={selectedDate===cell.date}>
                <span>{cell.day}</span>
                {(byDay.get(cell.date!)?.length??0)>0
                  ?(selectedMemberId!==null
                    ?<span className="calendar-member-shifts">
                      {byDay.get(cell.date!)!.map((shift,index)=>
                        <span key={shift.memberId+"-"+index}>
                          {shift.start}–{shift.end}
                          {shift.mealBreak&&
                            <span className="calendar-meal-time">
                              Pausa {shift.mealBreak.start}–{shift.mealBreak.end}
                            </span>}
                        </span>)}
                      {legacyMealBreaks.filter(meal=>meal.date===cell.date &&
                        meal.memberId===selectedMemberId).map((meal,i)=>
                        <span className="calendar-meal-time"
                          key={"meal-"+i}>
                          Pausa {meal.start}–{meal.end}
                        </span>)}
                    </span>
                    :<span className="calendar-assignment-count">
                      {byDay.get(cell.date!)!.length} turnos
                    </span>)
                  :selectedMemberId!==null && data.length>0 &&
                    <span className="calendar-member-empty">Sem turno</span>}
              </button>)}
          </div>
          <p className="calendar-footnote">
            <span className="neutral-dot" aria-hidden="true"/>
            {data.length===0
              ?"Sem turnos guardados ou propostos neste mês."
              :preview
                ?"A apresentar uma proposta ainda não guardada."
                :"A apresentar a proposta guardada neste dispositivo."}
            {selectedMemberId!==null&&
              " O filtro mostra apenas este colaborador e não altera o horário."}
          </p>
        </section>
        <aside className="surface detail-panel" aria-label="Detalhe do dia" aria-live="polite">
          <p className="surface-kicker">Detalhe do dia</p>
          <h2>{selectedDate?selectedDayLabel(selectedDate):"Seleciona uma data"}</h2>
          {selectedDate
            ?dayAssignments.length>0
              ?<div className="day-work-list">
                {dayTimeline.map(item=>item.kind==="work"
                  ?<div className="day-work-item"
                    key={"work-"+item.memberId+"-"+item.index}>
                    <strong>{memberLabel(item.memberId,names)}</strong>
                    <span>Turno {item.assignment.start}–{item.assignment.end}</span>
                    {item.assignment.mealBreak&&
                      <span className="meal-inline">
                        Pausa para refeição:
                        {" "}{item.assignment.mealBreak.start}–{item.assignment.mealBreak.end}
                      </span>}
                    <span>{(assignmentMinutes(item.assignment)/60).toLocaleString("pt-PT")} h de trabalho efetivo</span>
                  </div>
                  :<div className="day-work-item day-meal-item"
                    key={"meal-"+item.memberId+"-"+item.index}>
                    <strong>{memberLabel(item.memberId,names)} · Pausa para refeição</strong>
                    <span>{item.meal.start}–{item.meal.end}</span>
                    <span>1 hora, não contabilizada como trabalho</span>
                  </div>)}
              </div>
              :<>
                <span className="detail-state">Sem turno atribuído</span>
                <p>{selectedMemberId===null
                  ?"Não existem turnos atribuídos a este dia."
                  :"Este colaborador não tem turno atribuído neste dia."}</p>
                <p className="detail-explanation">
                  Um dia sem turnos registados não corresponde automaticamente a uma folga.
                </p>
              </>
            :<p>Seleciona um dia do calendário para consultar o seu horário.</p>}
        </aside>
      </div>
      <p className="schedule-disclaimer">
        As propostas são rascunhos locais, não horários aprovados. A certificação
        atual verifica apenas as regras já implementadas; não garante ainda
        o cumprimento de todos os descansos e requisitos legais.
      </p>
    </>
  );
}

export function CalendarScheduler(){
  const [selectedMemberId,setSelectedMemberId]=useState<string|null>(null);
  const [visible,setVisible]=useState<MonthView>(()=>{
    const date=new Date();
    return {year:date.getFullYear(),month:date.getMonth()+1};
  });
  const now=new Date();
  const todayString=String(now.getFullYear()).padStart(4,"0")+"-"+
    String(now.getMonth()+1).padStart(2,"0")+"-"+
    String(now.getDate()).padStart(2,"0");

  function navigate(direction:number){
    setVisible(previous=>{
      const next=new Date(previous.year,previous.month-1+direction,1);
      return {year:next.getFullYear(),month:next.getMonth()+1};
    });
  }
  return (
    <>
      <div className="schedule-month-navigation">
        <button type="button" className="icon-button" onClick={()=>navigate(-1)}
          aria-label="Mês anterior">‹</button>
        <button type="button" className="today-button" onClick={()=>{
          const date=new Date();
          setVisible({year:date.getFullYear(),month:date.getMonth()+1});
        }}>Hoje</button>
        <button type="button" className="icon-button" onClick={()=>navigate(1)}
          aria-label="Mês seguinte">›</button>
      </div>
      <MonthWorkspace key={visible.year+"-"+visible.month}
        year={visible.year} month={visible.month} todayString={todayString}
        selectedMemberId={selectedMemberId} onSelectMember={setSelectedMemberId}/>
    </>
  );
}
