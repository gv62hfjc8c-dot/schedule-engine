import {useEffect,useMemo,useState} from "react";
import {monthCells,monthLabel,selectedDayLabel} from "./calendar";
import {generateSchedule,type GenerationResult} from "./generateSchedule";
import {certifySchedule,type CertificationReport} from "./certifySchedule";
import {loadTeamDraftFromBrowser} from "./teamDraftRepository";
import {loadOpeningHoursDraftFromBrowser} from "./openingHoursDraftRepository";
import {
  loadMonthlyDraftFromBrowser,saveMonthlyDraftToBrowser,
  readExternalMonthlyContextFromBrowser,readPriorRollingHistoryFromBrowser,
  type MonthlyDraftLoad,
} from "./monthlyScheduleDraftRepository";
import {assignmentMinutes,type WorkAssignment} from "./workAssignments";
import {calendarScheduleView} from "./calendarScheduleView";
import type {MealBreak} from "./mealBreaks";
import {calculateRolling28Day} from "./rolling28Day";
import {enumerateCivilDays,resolvePlanningPeriod} from "./schedulePeriods";
import {buildDailyTimeline} from "./dailyTimeline";
import {DayScheduleTimeline} from "./DayScheduleTimeline";
import type {WeeklyOpeningHours} from "./operatingHours";
import {moveTimelineAssignment,type TimelineMove} from "./timelineEditing";
import {restRecordsFromRotation,type PlannedRestWeekMember} from "./plannedRest";

const WEEKDAYS=["Seg","Ter","Qua","Qui","Sex","Sáb","Dom"];

type Feedback={kind:"error"|"success";message:string};
type MonthView={year:number;month:number};
interface SourceSnapshot {
  team:ReturnType<typeof loadTeamDraftFromBrowser>;
  opening:ReturnType<typeof loadOpeningHoursDraftFromBrowser>;
  context:ReturnType<typeof readExternalMonthlyContextFromBrowser>;
  hoursHistory:ReturnType<typeof readPriorRollingHistoryFromBrowser>;
}
interface ManualEdit {
  assignments:WorkAssignment[];
  history:WorkAssignment[][];
  sources:SourceSnapshot;
  sourceSignature:string;
  hoursPolicy:"rolling28"|undefined;
}
function loadSources(year:number,month:number):SourceSnapshot {
  return {
    team:loadTeamDraftFromBrowser(),
    opening:loadOpeningHoursDraftFromBrowser(),
    context:readExternalMonthlyContextFromBrowser(year,month),
    hoursHistory:readPriorRollingHistoryFromBrowser(year,month),
  };
}
function sourceError(sources:SourceSnapshot):string|null {
  if(sources.team.status!=="loaded")
    return "Configura uma equipa válida com colaboradores ativos antes de gerar. Consulta Configuração → Equipa.";
  if(sources.opening.status!=="loaded")
    return "Configura primeiro o funcionamento da empresa. Consulta Configuração → Funcionamento.";
  if(!sources.context.ok)return sources.context.message;
  if(!sources.hoursHistory.ok)return sources.hoursHistory.message;
  return null;
}
function certificationForSaved(
  sources:SourceSnapshot,year:number,month:number,
  assignments:WorkAssignment[],
  mealBreaks:MealBreak[]=[],mealBreakPolicy:"v1"|"v2"|undefined=undefined,
  hoursPolicy:"rolling28"|undefined=undefined
):CertificationReport|null {
  if(sources.team.status!=="loaded"||
    sources.opening.status!=="loaded"||!sources.context.ok)return null;
  return certifySchedule({
    period:{mode:"monthly",year,month},
    team:sources.team.value,openingHours:sources.opening.value,
    externalContext:sources.context.context,candidateAssignments:assignments,
    mealBreaks,mealBreakPolicy,hoursPolicy,
  });
}
function stateText(report:CertificationReport|null,
  hoursPolicy:"rolling28"|undefined):string {
  if(!report)return "Não foi possível verificar esta proposta com os dados atuais.";
  if(report.status==="valid")
    return hoursPolicy==="rolling28"
      ?"Regras obrigatórias implementadas verificadas. A média de 40h por 28 dias é um objetivo de equilíbrio, não um limite legal certificado."
      :"40 horas semanais e restantes regras implementadas verificadas. Não é uma aprovação definitiva.";
  if(report.status==="insufficient_context")
    return "Proposta por certificar: faltam dados de semanas que atravessam outros meses.";
  return "A proposta tem conflitos de horas, dias sem trabalho, pausas ou cobertura do funcionamento.";
}
function memberLabel(memberId:string,names:Map<string,string>):string {
  return names.get(memberId)??"Colaborador não encontrado";
}

function MonthWorkspace({
  year,month,todayString,selectedMemberId,onSelectMember,onPendingEditsChange,
}:{
  year:number;month:number;todayString:string;
  selectedMemberId:string|null;
  onSelectMember:(id:string|null)=>void;
  onPendingEditsChange:(pending:boolean)=>void;
}) {
  const [initial]=useState(()=>loadMonthlyDraftFromBrowser(year,month));
  const [saved,setSaved]=useState<WorkAssignment[]|null>(
    ()=>initial.status==="loaded"?initial.assignments:null
  );
  const [savedMealBreaks,setSavedMealBreaks]=useState<MealBreak[]>(
    ()=>initial.status==="loaded"?initial.mealBreaks:[]
  );
  const [savedPolicy,setSavedPolicy]=useState<"v1"|"v2"|undefined>(
    ()=>initial.status==="loaded"?initial.mealBreakPolicy:undefined
  );
  const [savedHoursPolicy,setSavedHoursPolicy]=useState<"rolling28"|undefined>(
    ()=>initial.status==="loaded"?initial.hoursPolicy:undefined
  );
  const [savedRotationRest,setSavedRotationRest]=useState<PlannedRestWeekMember[]|null>(
    ()=>initial.status==="loaded"&&initial.rotationRest!==undefined
      ?initial.rotationRest:null
  );
  const [hoursHistory,setHoursHistory]=useState(
    ()=>readPriorRollingHistoryFromBrowser(year,month)
  );
  const [revision,setRevision]=useState<string|null>(
    ()=>initial.status==="loaded"?initial.revision:null
  );
  const [preview,setPreview]=useState<GenerationResult|null>(null);
  const [manualEdit,setManualEdit]=useState<ManualEdit|null>(null);
  // A moving pointer can temporarily alter coverage without certifying the
  // entire month for every pixel. Only the released position is committed.
  const [dragCandidate,setDragCandidate]=useState<WorkAssignment[]|null>(null);
  useEffect(()=>{
    onPendingEditsChange(manualEdit!==null);
    return ()=>onPendingEditsChange(false);
  },[onPendingEditsChange,manualEdit!==null]);
  useEffect(()=>{
    if(!manualEdit)return;
    const onBeforeUnload=(event:BeforeUnloadEvent)=>{
      event.preventDefault();
      event.returnValue="";
    };
    window.addEventListener("beforeunload",onBeforeUnload);
    return ()=>window.removeEventListener("beforeunload",onBeforeUnload);
  },[manualEdit!==null]);
  const [sourceSignature,setSourceSignature]=useState<string|null>(null);
  const [selectedDate,setSelectedDate]=useState<string|null>(null);
  const [feedback,setFeedback]=useState<Feedback|null>(null);
  const [dailyOpening,setDailyOpening]=useState<WeeklyOpeningHours|null>(()=>{
    const opening=loadOpeningHoursDraftFromBrowser();
    return opening.status==="loaded"?opening.value:null;
  });
  const [activeMemberIds,setActiveMemberIds]=useState<string[]>(()=>{
    const team=loadTeamDraftFromBrowser();
    return team.status==="loaded"
      ?team.value.members.filter(member=>member.active).map(member=>member.id):[];
  });
  const [names,setNames]=useState<Map<string,string>>(()=>{
    const team=loadTeamDraftFromBrowser();
    return new Map(team.status==="loaded"?
      team.value.members.map(member=>[member.id,member.name]):[]);
  });
  const [savedReport,setSavedReport]=useState<CertificationReport|null>(()=>{
    if(initial.status!=="loaded")return null;
    return certificationForSaved(loadSources(year,month),year,month,
      initial.assignments,initial.mealBreaks,
      initial.mealBreakPolicy,initial.hoursPolicy);
  });
  const data=dragCandidate??manualEdit?.assignments??
    preview?.candidateAssignments??saved??[];
  // Legacy PR84 v1 drafts may still carry separate meal records.
  // New v2 shifts contain their own pause, never a second work shift.
  const legacyMealBreaks=preview?[]:savedMealBreaks;
  const legacyDraft=saved!==null&&preview===null&&savedPolicy!=="v2";
  const manualReport=useMemo(()=>manualEdit
    ?certificationForSaved(manualEdit.sources,year,month,
      manualEdit.assignments,[],"v2",manualEdit.hoursPolicy)
    :null,[manualEdit,year,month]);
  const report=manualEdit?manualReport:
    preview?.certification??(legacyDraft?null:savedReport);
  // A display-only projection: certification and saving ALWAYS use full data.
  const view=calendarScheduleView(data,selectedMemberId);
  const byDay=view.byDay;
  const activeHoursPolicy=manualEdit?manualEdit.hoursPolicy:
    preview?"rolling28":savedHoursPolicy;
  const period=resolvePlanningPeriod({mode:"monthly",year,month});
  const throughDate=selectedDate??
    enumerateCivilDays(period).at(-1)!;
  const hasMonthProposal=preview!==null||saved!==null;
  const rolling=selectedMemberId!==null&&hasMonthProposal&&hoursHistory.ok
    ?calculateRolling28Day({
      memberId:selectedMemberId,throughDate,
      assignments:[...hoursHistory.context.assignments as WorkAssignment[],...data],
      completeDates:[...hoursHistory.context.completeDates as string[],
        ...enumerateCivilDays(period)],
    }):null;
  const formatHours=(minutes:number)=>
    (minutes/60).toLocaleString("pt-PT",{maximumFractionDigits:2})+" h";
  const visibleRestRecords=preview?.rotation?.status==="planned"
    ?restRecordsFromRotation(preview.rotation)
    :preview===null?savedRotationRest??[]:[];
  const previewRestDays=new Set<string>(
    selectedMemberId!==null && hasMonthProposal
      ?visibleRestRecords.filter(member=>member.memberId===selectedMemberId)
        .flatMap(member=>member.daysWithoutWork)
      :[]
  );
  const savedWeekendOverview=new Map<string,string[]>();
  if(preview===null)
    for(const record of savedRotationRest??[]){
      if(!record.fullWeekendOff)continue;
      const colleagues=savedWeekendOverview.get(record.weekStart)??[];
      colleagues.push(record.memberId);
      savedWeekendOverview.set(record.weekStart,colleagues);
    }
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
  // Calendar filter is read-only and NEVER hides colleagues from daily analysis.
  const dayAssignments=selectedDate
    ?data.filter(assignment=>assignment.date===selectedDate):[];
  const dayMealBreaks=selectedDate
    ?legacyMealBreaks.filter(meal=>meal.date===selectedDate):[];
  const dailyTimeline=selectedDate
    ?buildDailyTimeline(selectedDate,data,activeMemberIds,dailyOpening,
      legacyMealBreaks):null;
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
  const timelineEditable=!isBlocked && dailyOpening!==null &&
    ((preview!==null&&preview.status!=="invalid_input") ||
      (saved!==null&&savedPolicy==="v2"));

  function previewTimelineMove(move:TimelineMove|null){
    if(!move){setDragCandidate(null);return;}
    const base=manualEdit?.assignments??preview?.candidateAssignments??saved??[];
    const changed=moveTimelineAssignment(base,move);
    setDragCandidate(changed.changed?changed.assignments:null);
  }

  function commitTimelineMove(move:TimelineMove){
    setDragCandidate(null);
    if(!timelineEditable)return;
    const base=manualEdit?.assignments??preview?.candidateAssignments??saved??[];
    if(!moveTimelineAssignment(base,move).changed)return;
    const sources=loadSources(year,month);
    const problem=sourceError(sources);
    if(problem){setFeedback({kind:"error",message:problem});return;}
    const signature=JSON.stringify(sources);
    const expected=manualEdit?.sourceSignature??(preview?sourceSignature:null);
    if(expected!==null && signature!==expected){
      setFeedback({kind:"error",message:
        "Os dados usados no horário foram alterados. Reabre ou regenera a proposta antes de editar."});
      return;
    }
    setManualEdit(previous=>{
      const before=previous?.assignments??preview?.candidateAssignments??saved??[];
      const changed=moveTimelineAssignment(before,move);
      if(!changed.changed)return previous;
      return {
        assignments:changed.assignments,
        history:[...(previous?.history??[]),[...before]],
        sources:previous?.sources??sources,
        sourceSignature:previous?.sourceSignature??signature,
        hoursPolicy:previous?previous.hoursPolicy:
          preview?"rolling28":savedHoursPolicy,
      };
    });
    setFeedback(null);
  }

  function undoTimelineEdit(){
    setDragCandidate(null);
    setManualEdit(previous=>{
      if(!previous || previous.history.length===0)return previous;
      const before=previous.history[previous.history.length-1];
      const history=previous.history.slice(0,-1);
      return history.length===0?null:{...previous,assignments:before,history};
    });
    setFeedback(null);
  }

  function discardTimelineEdits(){
    setDragCandidate(null);
    setManualEdit(null);
    setFeedback(null);
  }

  function generate(){
    if(manualEdit && !window.confirm(
      "Descartar as alterações manuais e gerar um novo horário mensal?"))return;
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
       sources.opening.status!=="loaded"||!sources.context.ok||
       !sources.hoursHistory.ok)return;
    const result=generateSchedule({
      period:{mode:"monthly",year,month},
      team:sources.team.value,openingHours:sources.opening.value,
      externalContext:sources.context.context,
      mealBreakPolicy:"v2",hoursPolicy:"rolling28",
      hoursHistory:sources.hoursHistory.context,
    });
    setPreview(result);
    setManualEdit(null);
    setDragCandidate(null);
    setHoursHistory(sources.hoursHistory);
    setSourceSignature(JSON.stringify(sources));
    setNames(new Map(sources.team.value.members.map(member=>[member.id,member.name])));
    setDailyOpening(sources.opening.value);
    setActiveMemberIds(sources.team.value.members.filter(member=>
      member.active).map(member=>member.id));
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
    if(isBlocked || dragCandidate!==null)return;
    const candidates=manualEdit?.assignments??preview?.candidateAssignments;
    const hoursPolicy=manualEdit?manualEdit.hoursPolicy:
      preview?"rolling28" as const:undefined;
    const expected=manualEdit?.sourceSignature??sourceSignature;
    if(!candidates || expected===null ||
       (!manualEdit && (preview?.status==="invalid" ||
         preview?.status==="invalid_input")))return;
    const currentSources=loadSources(year,month);
    const problem=sourceError(currentSources);
    if(problem){
      setFeedback({kind:"error",message:problem});
      return;
    }
    if(JSON.stringify(currentSources)!==expected){
      setFeedback({kind:"error",message:
        "Os dados da empresa, da equipa ou dos outros meses mudaram. Reabre ou regenera antes de guardar."});
      return;
    }
    // Always certify the FULL edited month again, not only the selected day.
    const currentReport=certificationForSaved(currentSources,year,month,
      candidates,[],"v2",hoursPolicy);
    if(!currentReport || currentReport.status==="invalid"){
      setFeedback({kind:"error",message:
        "A edição contém conflitos obrigatórios. Corrige-os antes de guardar a proposta."});
      return;
    }
    if(saved!==null &&
      !window.confirm("Substituir a proposta guardada deste mês? Os horários dos outros meses não serão alterados."))return;
    const rest=preview?.rotation?.status==="planned"
      ?restRecordsFromRotation(preview.rotation)
      :preview===null?savedRotationRest??undefined:undefined;
    const result=saveMonthlyDraftToBrowser(
      year,month,candidates,revision,
      undefined,"v2",hoursPolicy,rest
    );
    if(!result.ok){
      setFeedback({kind:"error",message:result.message});
      return;
    }
    setSaved(result.assignments);
    setSavedMealBreaks(result.mealBreaks);
    setSavedPolicy(result.mealBreakPolicy);
    setSavedHoursPolicy(result.hoursPolicy);
    setSavedRotationRest(result.rotationRest??null);
    setRevision(result.revision);
    setSavedReport(currentReport);
    setPreview(null);
    setManualEdit(null);
    setDragCandidate(null);
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
            {(manualEdit!==null || (preview!==null &&
              (preview.status==="valid"||preview.status==="insufficient_context"))) &&
              <button type="button" className="button schedule-save" onClick={save}
                disabled={dragCandidate!==null || (manualEdit!==null &&
                  report?.status==="invalid")}>
                Guardar proposta
              </button>}
            {manualEdit&&<>
              <button type="button" className="button schedule-undo"
                onClick={undoTimelineEdit}>Desfazer alteração</button>
              <button type="button" className="button schedule-discard"
                onClick={discardTimelineEdits}>Descartar edições</button>
            </>}
          </div>
        </div>
        <p className="schedule-storage-note">
          {saved===null?"Ainda não existe uma proposta guardada para este mês.":
            "Existe uma proposta guardada neste dispositivo para este mês."}
          {" "}A geração não altera os horários dos outros meses.
        </p>
        {manualEdit&&<p className="schedule-edit-banner" role="status">
          Alterações manuais por guardar — {manualEdit.history.length}
          {" "}{manualEdit.history.length===1?"movimento":"movimentos"}.
          {report?.status==="invalid"
            ?" Existem conflitos a corrigir antes da gravação."
            :report?.status==="insufficient_context"
              ?" Falta contexto histórico para certificar totalmente."
              :" Regras implementadas verificadas nesta versão."}
        </p>}
        {dragCandidate&&<p className="schedule-edit-banner" role="status">
          Movimento em curso: a cobertura é provisória até largares a barra.
        </p>}
        {legacyDraft&&
          <p className="schedule-storage-note" role="status">
            Este rascunho utiliza o modelo anterior de horários.
            Para aplicar turnos únicos com pausa interna e a nova regra de
            cobertura, gera uma nova proposta. O registo atual só é
            substituído após confirmação.
          </p>}
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
          <span className={"schedule-status schedule-status-"+
            (dragCandidate?"unknown":report?.status??"unknown")}>
            {dragCandidate?"Movimento em curso":legacyDraft?"Modelo anterior":
              report?.status==="valid"?"Regras verificadas":
              report?.status==="insufficient_context"?"Contexto incompleto":
              report?.status==="invalid"?"Com problemas":"Não verificado"}
          </span>
          <p>{dragCandidate
            ?"A cobertura é provisória. A certificação será atualizada ao largar a barra."
            :legacyDraft
              ?"Este rascunho não foi certificado pelas regras novas de pausas e cobertura."
              :stateText(report,activeHoursPolicy)}</p>
          {!dragCandidate&&report&&report.issues.length>0&&<div className="schedule-issues">
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
        {preview?.rotation&&<div className="schedule-rotation-overview"
          aria-label="Rotação de fins de semana na proposta">
          <h3>Fins de semana completos — rotação proposta</h3>
          <p>O motor procura distribuir os descansos de forma equilibrada.
            A frequência depende das folgas fixas e da cobertura, não de
            um ciclo obrigatório de quatro semanas.</p>
          {preview.rotation.issues.length>0&&<p role="alert" className="form-error">
            {preview.rotation.issues.map(issue=>issue.message).join(" ")}
          </p>}
          {preview.rotation.weeks.length>0&&<div className="schedule-rotation-weeks">
            {preview.rotation.weeks.map(week=><div key={week.weekStart}
              className="schedule-rotation-week">
              <span>Semana de {week.weekStart}</span>
              <strong>{week.fullWeekendOffMemberIds.length===0
                ? "Sem fim de semana completo atribuído"
                :week.fullWeekendOffMemberIds.map(id=>memberLabel(id,names))
                  .join(" · ")}</strong>
            </div>)}
          </div>}
          {preview.rotationTargetShortfalls?.length?(
            <p className="schedule-rotation-warning" role="status">
              A capacidade disponível não permite atingir a referência de
              160 horas em todos os blocos de quatro semanas. O motor não
              cria horas fictícias para compensar a diferença.
            </p>
          ):null}
          <small>O descanso planeado é guardado com a proposta.
            A cobertura minuto a minuto e as pausas são verificadas
            separadamente pelo certificador.</small>
        </div>}
        {preview===null&&savedRotationRest!==null&&
          savedRotationRest.length>0&&
          <div className="schedule-rotation-overview"
            aria-label="Rotação de fins de semana guardada">
            <h3>Fins de semana completos — proposta guardada</h3>
            <div className="schedule-rotation-weeks">
              {[...new Set(savedRotationRest.map(record=>record.weekStart))]
                .sort().map(weekStart=><div key={weekStart}
                  className="schedule-rotation-week">
                  <span>Semana de {weekStart}</span>
                  <strong>{(savedWeekendOverview.get(weekStart)??[]).length===0
                    ?"Sem fim de semana completo atribuído"
                    :savedWeekendOverview.get(weekStart)!.map(id=>
                      memberLabel(id,names)).join(" · ")}</strong>
                </div>)}
            </div>
            <small>Descansos explicitamente planeados, não inferidos
              de dias sem turno. A proposta continua a ser um rascunho local.</small>
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
          {selectedMemberId!==null&&hasMonthProposal&&
            <div className="schedule-member-rolling" role="status">
              {rolling?.status==="complete"
                ?<p><strong>Últimos 28 dias ({rolling.start} a {rolling.endInclusive})</strong>
                  {" · "}{formatHours(rolling.actualMinutes!)} planeadas
                  {" / "}{formatHours(rolling.targetMinutes!)} de referência
                  {" · Desvio "}{rolling.differenceMinutes!>0?"+":""}
                  {formatHours(rolling.differenceMinutes!)}</p>
                :<p><strong>Últimos 28 dias</strong>
                  {" · Saldo por apurar: "}
                  {rolling?.status==="insufficient_context"
                    ?rolling.missingDates.length+" dias sem histórico confirmado."
                    :hoursHistory.ok
                      ?"Não existem dados suficientes para este cálculo."
                      :hoursHistory.message}
                </p>}
              <small>Indicador de planeamento; não representa dívida, crédito salarial nem trabalho realizado.</small>
            </div>}
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
                    <span className="calendar-member-empty">
                      {previewRestDays.has(cell.date!)
                        ?"Descanso planeado":"Sem turno"}
                    </span>}
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
              " O filtro mostra apenas este colaborador no calendário e não altera o horário; o detalhe do dia mostra toda a equipa."}
          </p>
        </section>
        <section className="surface detail-panel" aria-label="Detalhe do dia" aria-live="polite">
          <p className="surface-kicker">Detalhe do dia</p>
          <h2>{selectedDate?selectedDayLabel(selectedDate):"Seleciona uma data"}</h2>
          {selectedDate&&dailyTimeline&&
            <DayScheduleTimeline timeline={dailyTimeline}
              names={names} selectedMemberId={selectedMemberId}
              hasProposal={hasMonthProposal}
              editable={timelineEditable}
              onPreviewMove={previewTimelineMove}
              onCommitMove={commitTimelineMove}/>}
          {manualEdit && !dragCandidate && report?.status==="invalid" &&
            <div className="daily-edit-conflicts" role="alert">
              <strong>Alteração com conflitos</strong>
              <p>A posição foi mantida para poderes corrigir o horário.
                A gravação está bloqueada enquanto existirem violações obrigatórias.</p>
              <ul>
                {report.issues.filter(issue=>
                  issue.date===selectedDate).slice(0,5).map((issue,index)=>
                  <li key={issue.code+"-"+index}>{issue.message}
                    {issue.gapStart&&issue.gapEnd
                      ?" ("+issue.gapStart+"–"+issue.gapEnd+")":""}</li>)}
              </ul>
            </div>}
          {selectedDate
            ?dayAssignments.length>0
              ?<details className="daily-shift-details" open={dayAssignments.length<=8}>
                <summary>Consultar detalhes dos turnos ({dayAssignments.length})</summary>
                <div className="day-work-list">
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
              </details>
              :<>
                <span className="detail-state">Sem turno atribuído</span>
                <p>Não existem turnos atribuídos à equipa neste dia.</p>
                <p className="detail-explanation">
                  Um dia sem turnos registados não corresponde automaticamente a uma folga.
                </p>
              </>
            :<p>Seleciona um dia do calendário para consultar o seu horário.</p>}
        </section>
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
  const [hasPendingEdits,setHasPendingEdits]=useState(false);
  const [visible,setVisible]=useState<MonthView>(()=>{
    const date=new Date();
    return {year:date.getFullYear(),month:date.getMonth()+1};
  });
  const now=new Date();
  const todayString=String(now.getFullYear()).padStart(4,"0")+"-"+
    String(now.getMonth()+1).padStart(2,"0")+"-"+
    String(now.getDate()).padStart(2,"0");

  function mayLeaveMonth():boolean {
    return !hasPendingEdits || window.confirm(
      "Existem alterações manuais por guardar. Mudar de mês irá descartá-las. Continuar?");
  }
  function navigate(direction:number){
    if(!mayLeaveMonth())return;
    setHasPendingEdits(false);
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
          if((visible.year!==date.getFullYear() ||
              visible.month!==date.getMonth()+1) && !mayLeaveMonth())return;
          setHasPendingEdits(false);
          setVisible({year:date.getFullYear(),month:date.getMonth()+1});
        }}>Hoje</button>
        <button type="button" className="icon-button" onClick={()=>navigate(1)}
          aria-label="Mês seguinte">›</button>
      </div>
      <MonthWorkspace key={visible.year+"-"+visible.month}
        year={visible.year} month={visible.month} todayString={todayString}
        selectedMemberId={selectedMemberId} onSelectMember={setSelectedMemberId}
        onPendingEditsChange={setHasPendingEdits}/>
    </>
  );
}
