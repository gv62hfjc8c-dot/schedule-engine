import test from "node:test";
import assert from "node:assert/strict";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {DayScheduleTimeline} from "../src/DayScheduleTimeline";
import {buildDailyTimeline} from "../src/dailyTimeline";
import {suggestedWeeklyOpeningHours} from "../src/operatingHours";
import type {WorkAssignment} from "../src/workAssignments";

const ANA="1a2b3c4d-3333-4444-8aaa-123456789abc";
const RUI="1a2b3c4d-3333-4444-8aaa-123456789abd";
const day="2026-11-16";
const names=new Map([[ANA,"Teste 1"],[RUI,"Teste 2"]]);

function config(){
  const hours=suggestedWeeklyOpeningHours();
  hours.days[0].intervals=[{start:"08:30",end:"19:00"}];
  hours.days[6].intervals=[{start:"14:00",end:"19:00"}];
  return hours;
}
function html(date:string,shifts:WorkAssignment[],selected:string|null,
  hasProposal=true){
  const data=buildDailyTimeline(date,shifts,[ANA,RUI],config());
  return renderToStaticMarkup(createElement(DayScheduleTimeline,{
    timeline:data,names,selectedMemberId:selected,hasProposal,
  }));
}

test("selecionar Teste 1 destaca-o sem ocultar Teste 2 ou a cobertura",()=>{
  const shifts:WorkAssignment[]=[
    {date:day,memberId:ANA,start:"08:30",end:"17:30",
      mealBreak:{start:"12:00",end:"13:00"}},
    {date:day,memberId:RUI,start:"10:00",end:"19:00",
      mealBreak:{start:"13:00",end:"14:00"}},
  ];
  const body=html(day,shifts,ANA);
  assert.match(body,/Teste 1/);
  assert.match(body,/Teste 2/);
  assert.match(body,/is-highlighted/);
  assert.match(body,/Cobertura/);
  assert.match(body,/Pausa 12:00–13:00/);
  assert.match(body,/Abertura totalmente coberta/);
  assert.match(body,/08:30/);
  assert.match(body,/19:00/);
});

test("falta de cobertura aparece no gráfico e na avaliação do dia",()=>{
  const shifts:WorkAssignment[]=[
    {date:day,memberId:ANA,start:"08:30",end:"17:30",
      mealBreak:{start:"12:00",end:"13:00"}},
    {date:day,memberId:RUI,start:"10:00",end:"19:00",
      mealBreak:{start:"12:00",end:"13:00"}},
  ];
  const body=html(day,shifts,null);
  assert.match(body,/Sem cobertura: 60 min/);
  assert.match(body,/daily-coverage-bar is-empty/);
});

test("domingo usa 14h–19h mesmo com configuração longa à segunda",()=>{
  const date="2026-11-22";
  const body=html(date,[
    {date,memberId:ANA,start:"14:00",end:"19:00"},
  ],RUI);
  assert.match(body,/Escala de 14:00 a 19:00/);
  assert.doesNotMatch(body,/Escala de 08:30/);
  assert.match(body,/Teste 2/);
  assert.match(body,/Sem turno/);
});

test("sem proposta, não inventa validação de cobertura",()=>{
  const body=html(day,[],null,false);
  assert.match(body,/Ainda não há uma proposta mensal para avaliar a cobertura/);
  assert.doesNotMatch(body,/Sem cobertura: 630 min/);
});

test("dia encerrado apresenta estado explícito em vez de eixo fictício",()=>{
  const opening=config();
  opening.days[6].intervals=[];
  const timeline=buildDailyTimeline("2026-11-22",[],[ANA],opening);
  const body=renderToStaticMarkup(createElement(DayScheduleTimeline,{
    timeline,names,selectedMemberId:null,hasProposal:true,
  }));
  assert.match(body,/A empresa está encerrada neste dia/);
  assert.doesNotMatch(body,/daily-timeline-axis-track/);
});

test("turno e pausa têm controlos arrastáveis acessíveis sem botões aninhados",()=>{
  const shifts:WorkAssignment[]=[
    {date:day,memberId:ANA,start:"08:30",end:"17:30",
      mealBreak:{start:"12:00",end:"13:00"}},
    {date:day,memberId:RUI,start:"10:00",end:"19:00",
      mealBreak:{start:"13:00",end:"14:00"}},
  ];
  const timeline=buildDailyTimeline(day,shifts,[ANA,RUI],config());
  const callbacks={
    onPreviewMove:()=>{},
    onCommitMove:()=>{},
  };
  const enabled=renderToStaticMarkup(createElement(DayScheduleTimeline,{
    timeline,names,selectedMemberId:ANA,hasProposal:true,editable:true,
    ...callbacks,
  }));
  assert.match(enabled,/Mover turno de Teste 1/);
  assert.match(enabled,/Mover pausa de Teste 1/);
  assert.match(enabled,/Arrasta a barra verde/);
  assert.match(enabled,/is-highlighted/);
  // The movable meal is a SIBLING of its shift, not a nested button.
  assert.doesNotMatch(enabled,/<button[^>]*>[^]*?<button/);
  const readOnly=renderToStaticMarkup(createElement(DayScheduleTimeline,{
    timeline,names,selectedMemberId:null,hasProposal:true,
  }));
  assert.match(readOnly,/disabled=""/);
  assert.doesNotMatch(readOnly,/Arrasta a barra verde/);
});
