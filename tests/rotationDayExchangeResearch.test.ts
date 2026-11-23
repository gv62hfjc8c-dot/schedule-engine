import test from "node:test";
import assert from "node:assert/strict";
import {analyzeRestDayExchangeOpportunities}
  from "../src/rotationDayExchangeResearch";
import {suggestedWeeklyOpeningHours,WEEKDAYS}
  from "../src/operatingHours";
import {addCivilDays,civilDayOfWeek}
  from "../src/schedulePeriods";
import type {TeamRoster} from "../src/team";
import type {WorkAssignment} from "../src/workAssignments";
import type {
  WeekendRotationResult,PlannedRotationWeek,
  WeekdayNumbers,
} from "../src/weekendRotation";

const START="2026-11-02";
const id=(number:number)=>"00000000-0000-4000-8000-"+
  String(number).padStart(12,"0");
const [A,B,C]=[id(1),id(2),id(3)];
type Sample=Parameters<typeof analyzeRestDayExchangeOpportunities>[0];

function fixture():Sample {
  const team:TeamRoster={members:[
    {id:A,name:"Pessoa A",active:true,qualifiedRoles:["sales"],
      weeklyDaysOff:2,fixedDaysOff:["friday"],
      weekendRest:{minimumWeekdayDaysOffOnFullWeekend:1}},
    {id:B,name:"Pessoa B",active:true,qualifiedRoles:["sales"],
      weeklyDaysOff:1,fixedDaysOff:["tuesday"],
      weekendRest:{minimumWeekdayDaysOffOnFullWeekend:1}},
    {id:C,name:"Pessoa C",active:true,qualifiedRoles:["sales"],
      weeklyDaysOff:1,fixedDaysOff:["wednesday"],
      weekendRest:{minimumWeekdayDaysOffOnFullWeekend:1}},
  ]};
  const openingHours=suggestedWeeklyOpeningHours();
  for(let d=0;d<6;d++)
    openingHours.days[d].intervals=[{start:"08:30",end:"19:00"}];
  openingHours.days[6].intervals=[{start:"14:00",end:"19:00"}];

  const assignments:WorkAssignment[]=[];
  for(let w=0;w<4;w++)for(let d=0;d<7;d++){
    const date=addCivilDays(START,7*w+d);
    const aWorking=w===0?d<=3:(d!==3&&d!==4);
    const bWorking=d!==1;
    const cWorking=d!==2;
    if(aWorking){
      if(d===6)assignments.push({
        memberId:A,date,start:"14:00",end:"19:00",role:"sales",
      });
      else {
        const long=w===0&&d<=1;
        assignments.push({
          memberId:A,date,start:long?"08:30":"09:00",
          end:"19:00",mealBreak:{start:"12:00",end:"13:00"},
          role:"sales",
        });
      }
    }
    if(bWorking)assignments.push(d===6?
      {memberId:B,date,start:"14:00",end:"19:00",role:"sales"}:
      {memberId:B,date,start:"08:30",end:"16:30",
        mealBreak:{start:"11:30",end:"12:30"},role:"sales"});
    if(cWorking)assignments.push(d===6?
      {memberId:C,date,start:"14:00",end:"19:00",role:"sales"}:
      {memberId:C,date,start:"11:00",end:"19:00",
        mealBreak:{start:"14:00",end:"15:00"},role:"sales"});
  }
  const weeks:PlannedRotationWeek[]=Array.from({length:4},(_,w)=>{
    const weekStart=addCivilDays(START,7*w);
    const saturday=addCivilDays(weekStart,5);
    const sunday=addCivilDays(weekStart,6);
    const members=team.members.map(m=>{
      const daysWithoutWork=Array.from({length:7},(_,d)=>
        addCivilDays(weekStart,d)).filter(date=>
        !assignments.some(s=>s.date===date&&s.memberId===m.id));
      return {
        memberId:m.id,daysWithoutWork,
        fullWeekendOff:daysWithoutWork.includes(saturday)&&
          daysWithoutWork.includes(sunday),
        effectiveMinutesUpperBound:null,
      };
    });
    const fullWeekendOffMemberIds=members.filter(m=>m.fullWeekendOff)
      .map(m=>m.memberId);
    const presentByWeekday=Object.fromEntries(WEEKDAYS.map((day,d)=>[
      day.id,assignments.filter(s=>
        s.date===addCivilDays(weekStart,d)).length,
    ])) as WeekdayNumbers;
    return {
      weekStart,saturday,sunday,members,fullWeekendOffMemberIds,
      presentByWeekday,
    };
  });
  const rotation:WeekendRotationResult={
    status:"planned",weeks,issues:[],historyProvided:false,
    weekendCounts:team.members.map(member=>({
      memberId:member.id,prior:0,
      planned:weeks.filter(w=>
        w.fullWeekendOffMemberIds.includes(member.id)).length,
    })),
  };
  return {
    cycleStart:START,team,openingHours,assignments,rotation,
  };
}

test("PR96: descanso de domingo curto para quinta preserva folgas e pode reduzir o piso de 2 para 0",()=>{
  const input=fixture();
  const previous=JSON.stringify(input);
  const report=analyzeRestDayExchangeOpportunities(input);
  assert.ok(report);
  assert.equal(report.certainty,"necessary_conditions_only");
  assert.equal(report.cycleStart,START);
  assert.equal(report.cycleEndExclusive,"2026-11-30");
  assert.equal(report.baselineObservedLongDays,2);
  assert.equal(report.baselineMathematicalMinimum,2);
  assert.equal(report.targetDailyHeadcount,2);
  const proposed=report.opportunities.find(option=>
    option.memberId===A &&
    option.restInsteadOfWorking==="2026-11-15" &&
    option.workInsteadOfRest==="2026-11-12");
  assert.ok(proposed,JSON.stringify(report.opportunities));
  assert.equal(proposed.baselineMemberMinimumLongDays,2);
  assert.equal(proposed.hypotheticalMemberMinimumLongDays,0);
  assert.equal(proposed.potentialLongDayReduction,2);
  assert.equal(proposed.sundayHeadcountBefore,3);
  assert.equal(proposed.sundayHeadcountAfter,2);
  assert.equal(proposed.roleToCover,"sales");
  assert.equal(JSON.stringify(input),previous,
    "apenas investigar; não alterar os turnos ou a rotação");
  assert.deepEqual(analyzeRestDayExchangeOpportunities(input),report,
    "a pesquisa tem de ser determinística");
});

test("PR96: não inventa potencial quando faltam horas, rotação ou descanso explícito",()=>{
  const input=fixture();
  assert.equal(analyzeRestDayExchangeOpportunities({
    ...input,rotation:null,
  }),null);
  const incomplete=fixture();
  incomplete.assignments=incomplete.assignments.filter(s=>
    !(s.memberId===A&&s.date==="2026-11-09"));
  assert.equal(analyzeRestDayExchangeOpportunities(incomplete),null);
  const contradictory=fixture();
  contradictory.rotation!.weeks[1].members[0].daysWithoutWork.push(
    "2026-11-15");
  assert.equal(analyzeRestDayExchangeOpportunities(contradictory),null);
  assert.equal(analyzeRestDayExchangeOpportunities({
    ...input,cycleStart:"2026-11-03",
  }),null,"o início do ciclo deve ser uma segunda-feira");
});

test("PR96: não propõe deixar uma função totalmente vazia no domingo",()=>{
  const input=fixture();
  input.team.members[0].qualifiedRoles=["sales","checkout"];
  for(const shift of input.assignments)
    if(shift.memberId===A && civilDayOfWeek(shift.date)===6)
      shift.role="checkout";
  const report=analyzeRestDayExchangeOpportunities(input);
  assert.ok(report);
  assert.equal(report.opportunities.length,0,
    "retirar o único Caixa do domingo não é uma oportunidade aceitável");
});

test("PR96: sem capacidade de 9h30 nos dias normais, não inventa um ciclo viável",()=>{
  const input=fixture();
  input.openingHours.days[0].intervals=[{start:"09:00",end:"17:00"}];
  assert.equal(analyzeRestDayExchangeOpportunities(input),null,
    "turnos existentes excedem a abertura alterada");
});

test("PR96: candidato nunca é aplicado ao calendário nem marcado como certificado",()=>{
  const report=analyzeRestDayExchangeOpportunities(fixture());
  assert.ok(report);
  assert.ok(report.opportunities.length>0);
  assert.equal("candidateAssignments" in report,false);
  assert.equal("certification" in report,false);
  assert.equal("newShift" in report.opportunities[0],false);
});
