import {
  minuteLabel,timelinePosition,type DailyTimeline,type TimelineInterval,
} from "./dailyTimeline";

interface DayScheduleTimelineProps {
  timeline:DailyTimeline;
  names:ReadonlyMap<string,string>;
  selectedMemberId:string|null;
  hasProposal:boolean;
}

const hours=(minutes:number)=>
  (minutes/60).toLocaleString("pt-PT",{maximumFractionDigits:2})+" h";

function position(interval:TimelineInterval,bounds:TimelineInterval){
  const placed=timelinePosition(interval,bounds);
  return placed?{left:placed.left+"%",width:placed.width+"%"}:undefined;
}

/**
 * Pure visual projection of the complete daily team, not the calendar's
 * individual-member filter. The current member is highlighted, never hidden.
 */
export function DayScheduleTimeline({
  timeline,names,selectedMemberId,hasProposal,
}:DayScheduleTimelineProps){
  const {bounds,opening,openingStatus,coverage,members,ticks}=timeline;
  const selected=selectedMemberId?.toLowerCase()??null;
  const span=bounds?bounds.end-bounds.start:0;
  const trackWidth=Math.max(540,Math.ceil(span/60)*64);
  return (
    <div className="daily-operational-view">
      <div className="daily-operational-heading">
        <div>
          <h3>Visão da equipa</h3>
          <p>Turnos e pausas por colaborador, alinhados com o funcionamento deste dia.</p>
        </div>
        {openingStatus==="loaded"&&hasProposal&&
          <span className={"daily-coverage-status"+
            (timeline.uncoveredMinutes>0?" is-uncovered":" is-covered")}>
            {timeline.uncoveredMinutes===0
              ?"Abertura totalmente coberta"
              :"Sem cobertura: "+timeline.uncoveredMinutes+" min"}
          </span>}
      </div>

      <div className="daily-overview-stats" aria-label="Resumo do dia">
        <div><span>Escalados</span>
          <strong>{hasProposal?timeline.workingMembers:"—"}</strong></div>
        <div><span>Horas previstas</span>
          <strong>{hasProposal?hours(timeline.scheduledMinutes):"—"}</strong></div>
        <div><span>Funcionamento</span>
          <strong>{openingStatus==="loaded"?hours(timeline.openingMinutes):
            openingStatus==="closed"?"Encerrado":"Por configurar"}</strong></div>
        <div><span>Colaboradores em simultâneo</span>
          <strong>{hasProposal&&openingStatus==="loaded"
            ?timeline.peakConcurrent:"—"}</strong></div>
      </div>

      {openingStatus==="missing"?
        <p className="daily-timeline-notice">
          Não foi possível consultar o funcionamento guardado da empresa.
          A escala temporal do dia fica indisponível até existir uma configuração válida.
        </p>
      :openingStatus==="closed"?
        <p className="daily-timeline-notice">
          A empresa está encerrada neste dia. Não há janela de funcionamento para representar.
          {timeline.workingMembers>0&&
            " Existem turnos atribuídos que devem ser revistos."}
        </p>
      :bounds&&
        <>
          {!hasProposal&&<p className="daily-timeline-notice">
            Ainda não há uma proposta mensal para avaliar a cobertura.
            O gráfico utiliza apenas as horas de funcionamento configuradas.
          </p>}
          <div className="daily-timeline-scroll" role="region"
            aria-label="Linha temporal dos horários da equipa"
            tabIndex={0}>
            <div className="daily-timeline-table"
              style={{minWidth:trackWidth+235+"px"}}>
              <div className="daily-timeline-row daily-timeline-axis">
                <span className="daily-timeline-person">Colaborador</span>
                <div className="daily-timeline-track" aria-label={
                  "Escala de "+minuteLabel(bounds.start)+" a "+minuteLabel(bounds.end)
                }>
                  {ticks.map((tick,i)=>
                    <span key={tick}
                      className={"daily-timeline-tick-label"+
                        (i===0?" is-first":i===ticks.length-1?" is-last":"")}
                      style={{left:(tick-bounds.start)/span*100+"%"}}>
                      {minuteLabel(tick)}
                    </span>)}
                </div>
                <span className="daily-timeline-total">Horas</span>
              </div>

              {members.map(row=>
                <div className={"daily-timeline-row daily-timeline-member"+
                  (row.memberId===selected?" is-highlighted":"")}
                  key={row.memberId}>
                  <span className="daily-timeline-person"
                    title={names.get(row.memberId)??row.memberId}>
                    <strong>{names.get(row.memberId)??"Colaborador desconhecido"}</strong>
                    {row.shifts.length===0&&
                      <small>Sem turno</small>}
                  </span>
                  <div className="daily-timeline-track daily-timeline-lane">
                    {opening.map((interval,i)=>
                      <span className="daily-timeline-open-window" key={"open-"+i}
                        style={position(interval,bounds)}/>)}
                    {ticks.slice(1,-1).map(tick=>
                      <span className="daily-timeline-guide" key={tick}
                        style={{left:(tick-bounds.start)/span*100+"%"}}/>)}
                    {row.shifts.map((shift,i)=>{
                      const placed=position(shift,bounds);
                      return placed?
                        <span className="daily-timeline-shift" key={"shift-"+i}
                          style={placed}
                          role="img"
                          aria-label={"Turno "+minuteLabel(shift.start)+
                            "–"+minuteLabel(shift.end)+
                            (shift.meals.length?" com pausa para refeição":"")}
                          title={"Turno "+minuteLabel(shift.start)+"–"+
                            minuteLabel(shift.end)+
                            (shift.meals.length?" · Pausa "+shift.meals.map(m=>
                              minuteLabel(m.start)+"–"+minuteLabel(m.end)).join(", "):"")}>
                          {shift.meals.map((meal,j)=>
                            <span className="daily-timeline-meal" key={j}
                              style={{
                                left:(meal.start-shift.start)/
                                  (shift.end-shift.start)*100+"%",
                                width:(meal.end-meal.start)/
                                  (shift.end-shift.start)*100+"%",
                              }} title={"Pausa "+minuteLabel(meal.start)+
                                "–"+minuteLabel(meal.end)}/>)}
                        </span>:null;
                    })}
                    {row.legacyMeals.map((meal,i)=>
                      <span className="daily-timeline-meal-legacy" key={"legacy-"+i}
                        style={position(meal,bounds)}
                        title={"Pausa "+minuteLabel(meal.start)+"–"+
                          minuteLabel(meal.end)}/>)}
                  </div>
                  <span className="daily-timeline-total">
                    {row.shifts.length>0?hours(row.workMinutes):"—"}
                  </span>
                </div>)}

              <div className="daily-timeline-row daily-timeline-coverage-row">
                <span className="daily-timeline-person">
                  <strong>Cobertura</strong>
                  <small>Em trabalho efetivo</small>
                </span>
                <div className="daily-timeline-track daily-coverage-lane"
                  aria-label="Colaboradores em trabalho efetivo ao longo da abertura">
                  {opening.map((interval,i)=>
                    <span className="daily-timeline-open-window" key={"open-"+i}
                      style={position(interval,bounds)}/>)}
                  {hasProposal&&coverage.map((interval,i)=>{
                    const placed=position(interval,bounds);
                    return placed?
                      <span key={"coverage-"+i}
                        className={"daily-coverage-bar"+
                          (interval.count===0?" is-empty":
                            interval.count===1?" is-one":" is-multiple")}
                        style={placed}
                        title={minuteLabel(interval.start)+"–"+
                          minuteLabel(interval.end)+": "+
                          interval.count+" a trabalhar"}
                        aria-label={interval.count+" colaboradores de "+
                          minuteLabel(interval.start)+" a "+minuteLabel(interval.end)}>
                        {(interval.end-interval.start)/span>=0.065
                          ?interval.count:null}
                      </span>:null;
                  })}
                  {ticks.slice(1,-1).map(tick=>
                    <span className="daily-timeline-guide" key={tick}
                      style={{left:(tick-bounds.start)/span*100+"%"}}/>)}
                </div>
                <span className="daily-timeline-total">
                  {hasProposal?timeline.peakConcurrent+" máx.":"—"}
                </span>
              </div>
            </div>
          </div>
          <div className="daily-timeline-legend">
            <span><i className="daily-legend-work"/>Trabalho</span>
            <span><i className="daily-legend-meal"/>Pausa de refeição</span>
            <span><i className="daily-legend-coverage"/>Cobertura</span>
            <span><i className="daily-legend-gap"/>Sem cobertura</span>
          </div>
          <p className="daily-timeline-footnote">
            A escala ajusta-se à primeira abertura e ao último fecho deste dia.
            Em dias com funcionamento repartido, os intervalos encerrados não
            são contabilizados como falhas de cobertura.
            {selected&&" O colaborador filtrado está destacado; a equipa mantém-se visível."}
          </p>
        </>}
    </div>
  );
}
