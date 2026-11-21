import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDailyTimeline,dailyTimelineTicks,minuteLabel,timelinePosition,
} from "../src/dailyTimeline";
import {suggestedWeeklyOpeningHours} from "../src/operatingHours";
import type {WorkAssignment} from "../src/workAssignments";

const ANA="1a2b3c4d-3333-4444-8aaa-123456789abc";
const RUI="1a2b3c4d-3333-4444-8aaa-123456789abd";
const CARLA="1a2b3c4d-3333-4444-8aaa-123456789abe";
const date="2026-11-16"; // Monday

function hours(start="08:30",end="19:00"){
  const h=suggestedWeeklyOpeningHours();
  h.days[0].intervals=[{start,end}];
  h.days[6].intervals=[{start:"14:00",end:"19:00"}];
  return h;
}
function shift(
  memberId:string,start:string,end:string,
  meal?:{start:string;end:string},
):WorkAssignment{
  return {date,memberId,start,end,...(meal?{mealBreak:meal}:{})};
}

test("a escala começa e acaba exatamente nas horas de abertura, não em meia-noite",()=>{
  const view=buildDailyTimeline(date,[],[ANA,RUI],hours());
  assert.deepEqual(view.bounds,{start:510,end:1140});
  assert.equal(view.ticks[0],510);
  assert.equal(view.ticks.at(-1),1140);
  assert.ok(view.ticks.every(t=>t>=510&&t<=1140));
  assert.equal(view.openingMinutes,630);
  assert.equal(view.openingStatus,"loaded");
  assert.deepEqual(view.members.map(m=>m.memberId),[ANA,RUI]);
  assert.deepEqual(view.coverage,[{start:510,end:1140,count:0}]);
  assert.equal(view.uncoveredMinutes,630);
  assert.equal(minuteLabel(510),"08:30");
});

test("domingo curto tem eixo próprio 14h–19h e escalados de cinco horas",()=>{
  const sunday="2026-11-22";
  const person:WorkAssignment={date:sunday,memberId:ANA,start:"14:00",end:"19:00"};
  const view=buildDailyTimeline(sunday,[person],[ANA,RUI],hours());
  assert.deepEqual(view.bounds,{start:840,end:1140});
  assert.deepEqual(view.coverage,[{start:840,end:1140,count:1}]);
  assert.equal(view.scheduledMinutes,300);
  assert.equal(view.workingMembers,1);
  assert.equal(view.uncoveredMinutes,0);
  assert.equal(view.members[1].shifts.length,0);
});

test("pausas internas mantêm um turno e são excluídas da cobertura minuto a minuto",()=>{
  const view=buildDailyTimeline(date,[
    shift(ANA,"08:30","17:30",{start:"12:00",end:"13:00"}),
    shift(RUI,"10:00","19:00",{start:"13:00",end:"14:00"}),
  ],[ANA,RUI,CARLA],hours());
  assert.equal(view.members[0].shifts.length,1);
  assert.deepEqual(view.members[0].shifts[0].meals,[{start:720,end:780}]);
  assert.equal(view.scheduledMinutes,16*60);
  assert.equal(view.workingMembers,2);
  assert.deepEqual(view.coverage,[
    {start:510,end:600,count:1},
    {start:600,end:720,count:2},
    {start:720,end:840,count:1},
    {start:840,end:1050,count:2},
    {start:1050,end:1140,count:1},
  ]);
  assert.equal(view.uncoveredMinutes,0);
  assert.equal(view.peakConcurrent,2);
  assert.equal(view.members[2].shifts.length,0);
});

test("pausas simultâneas revelam falta de cobertura e quantificam os minutos",()=>{
  const view=buildDailyTimeline(date,[
    shift(ANA,"08:30","17:30",{start:"12:00",end:"13:00"}),
    shift(RUI,"10:00","19:00",{start:"12:30",end:"13:30"}),
  ],[ANA,RUI],hours());
  assert.ok(view.coverage.some(span=>
    span.start===750&&span.end===780&&span.count===0));
  assert.equal(view.uncoveredMinutes,30);
});

test("abertura repartida não conta o encerramento como falha de cobertura",()=>{
  const h=hours();
  h.days[0].intervals=[
    {start:"09:00",end:"12:00"},
    {start:"14:00",end:"18:00"},
  ];
  const view=buildDailyTimeline(date,[
    shift(ANA,"09:00","12:00"),shift(ANA,"14:00","18:00"),
  ],[ANA],h);
  assert.deepEqual(view.bounds,{start:540,end:1080});
  assert.equal(view.openingMinutes,420);
  assert.equal(view.uncoveredMinutes,0);
  assert.deepEqual(view.coverage,[
    {start:540,end:720,count:1},
    {start:840,end:1080,count:1},
  ]);
});

test("dias fechados e configuração ausente não são equiparados",()=>{
  const closed=buildDailyTimeline("2026-11-17",[],[ANA],hours());
  // Tuesday still has the suggested 09:00-18:00 opening.
  assert.equal(closed.openingStatus,"loaded");
  const noConfig=buildDailyTimeline(date,[],[ANA],null);
  assert.equal(noConfig.openingStatus,"missing");
  assert.equal(noConfig.bounds,null);
  const h=hours();
  h.days[0].intervals=[];
  const noOpening=buildDailyTimeline(date,[],[ANA],h);
  assert.equal(noOpening.openingStatus,"closed");
  assert.equal(noOpening.bounds,null);
  assert.equal(noOpening.uncoveredMinutes,0);
});

test("duas atribuições simultâneas da mesma pessoa não duplicam a contagem da equipa",()=>{
  const view=buildDailyTimeline(date,[
    shift(ANA,"08:30","14:00"),shift(ANA,"10:00","19:00"),
  ],[ANA],hours());
  assert.equal(view.coverage.length,1);
  assert.equal(view.coverage[0].count,1);
  assert.equal(view.peakConcurrent,1);
});

test("pausa legada separada também é deduzida do trabalho efetivo para cobertura",()=>{
  const view=buildDailyTimeline(date,[
    shift(ANA,"09:00","18:00"),
  ],[ANA],hours("09:00","18:00"),[
    {memberId:ANA,date,start:"12:00",end:"13:00"},
  ]);
  assert.deepEqual(view.coverage,[
    {start:540,end:720,count:1},
    {start:720,end:780,count:0},
    {start:780,end:1080,count:1},
  ]);
  assert.equal(view.uncoveredMinutes,60);
});

test("percentagens de barras respeitam o eixo configurado e cortam sem inventar turnos",()=>{
  const bounds={start:510,end:1140};
  assert.deepEqual(timelinePosition({start:510,end:825},bounds),
    {left:0,width:50});
  assert.deepEqual(timelinePosition({start:840,end:1140},bounds),
    {left:(330/630)*100,width:(300/630)*100});
  assert.deepEqual(timelinePosition({start:0,end:510},bounds),null);
  assert.deepEqual(timelinePosition({start:1110,end:1200},bounds),
    {left:(600/630)*100,width:(30/630)*100});
  assert.deepEqual(dailyTimelineTicks(840,1140),[840,900,960,1020,1080,1140]);
});

test("a projeção é pura: não altera nem filtra turnos em função de uma seleção",()=>{
  const assignments=[
    shift(ANA,"08:30","17:30",{start:"12:00",end:"13:00"}),
    shift(RUI,"10:00","19:00",{start:"13:00",end:"14:00"}),
  ];
  const before=JSON.stringify(assignments);
  const first=buildDailyTimeline(date,assignments,[ANA,RUI,CARLA],hours());
  const again=buildDailyTimeline(date,assignments,[ANA,RUI,CARLA],hours());
  assert.deepEqual(first,again);
  assert.equal(JSON.stringify(assignments),before);
  assert.equal(first.members.length,3);
});
