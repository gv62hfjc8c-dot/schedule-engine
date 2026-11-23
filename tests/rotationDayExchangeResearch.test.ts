import test from "node:test";
import assert from "node:assert/strict";
import {analyzeRestDayExchangeOpportunities}
  from "../src/rotationDayExchangeResearch";
import {buildScheduleDiagnostic,type ScheduleDiagnosticInput}
  from "../src/diagnosticExport";
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


test("PR96: JSON expõe hipótese como investigação e não como horário validado",()=>{
  const research=fixture();
  const base:ScheduleDiagnosticInput={
    exportedAt:"2026-11-23T10:00:00Z",
    year:2026,month:11,mode:"generated_preview",
    team:research.team,openingHours:research.openingHours,
    assignments:research.assignments,
    savedAssignments:null,mealBreaks:[],
    mealBreakPolicy:"v2",hoursPolicy:"rolling28",
    functionalCoveragePolicy:null,plannedRest:[],
    externalContext:null,rollingHistory:null,
    sourceStatuses:{
      team:"loaded",openingHours:"loaded",
      adjacentMonths:"loaded",rollingHistory:"loaded",
      savedMonth:"loaded",
    },
    generation:{
      status:"valid",candidateAssignments:[...research.assignments],
      certification:{status:"valid",period:null,issues:[],weeks:[]},
      shortfalls:[],rotation:research.rotation!,
    },
    displayedCertification:null,
    currentConfigurationCertification:null,
    settingsMatchGeneratedPreview:true,
  };
  const diag=buildScheduleDiagnostic(base);
  assert.ok(diag.analysis.cycleLongDays);
  assert.ok(diag.analysis.cycleRestExchange);
  assert.equal(diag.analysis.cycleRestExchange.certainty,
    "necessary_conditions_only");
  assert.ok(diag.analysis.cycleRestExchange.opportunities.length>0);
  assert.ok(diag.analysis.cycleRestExchangeEvaluation,
    "o diagnóstico expõe ensaios concretos sem alterar a proposta");
  assert.equal(diag.analysis.cycleRestExchangeEvaluation.certainty,
    "current_engine_constraints_only");
  assert.equal("candidateAssignments" in
    (diag.analysis.cycleRestExchangeEvaluation.best??{}),false,
    "o diagnóstico não publica outro horário como se fosse o apresentado");
  assert.match(diag.interpretation.cycleRestExchange,/NÃO são horários/);
  const noRotation=buildScheduleDiagnostic({
    ...base,generation:null,
  });
  assert.equal(noRotation.analysis.cycleRestExchange,null,
    "dados históricos ou manuais sem rotação explícita não autorizam inferir folgas");
});

test("PR96 fase 2: experimenta turnos reais sem alterar a proposta original",async()=>{
  const {evaluateRestDayExchangeCandidates}=await import("../src/restDayExchangeEvaluation");
  const input=fixture();
  // Keep the sample fully covered even when one colleague has their fixed rest.
  for(const shift of input.assignments){
    if(shift.memberId===A && civilDayOfWeek(shift.date)===1 &&
      shift.start==="09:00"){shift.start="08:30";shift.end="18:30";}
    if(shift.memberId===A && civilDayOfWeek(shift.date)===2 &&
      shift.mealBreak)shift.mealBreak={start:"13:00",end:"14:00"};
  }
  const original=JSON.stringify(input);
  const analysis=evaluateRestDayExchangeCandidates(input);
  assert.ok(analysis);
  assert.equal(analysis.certainty,"current_engine_constraints_only");
  assert.equal(analysis.baselineCertificationStatus,"valid");
  assert.ok(analysis.evaluatedOpportunities>0);
  assert.equal(analysis.trials.length,analysis.evaluatedOpportunities);
  assert.ok(analysis.best,
    "o cenário sintético de controlo deve demonstrar pelo menos uma melhoria concreta: "+JSON.stringify(analysis.trials));
  assert.equal(JSON.stringify(input),original,"o estudo não pode modificar dados originais");
  assert.deepEqual(evaluateRestDayExchangeCandidates(input),analysis,
    "a exploração deve ser determinística");
  if(analysis.best){
    assert.equal(analysis.best.certification.status,"valid");
    assert.ok(analysis.best.longDays<analysis.baselineLongDays);
    assert.equal(analysis.best.candidateAssignments.filter(s=>
      s.memberId===A&&s.date==="2026-11-15").length,0);
    assert.equal(analysis.best.candidateAssignments.filter(s=>
      s.memberId===A&&s.date==="2026-11-12").length,1);
    for(const member of input.team.members){
      const sum=analysis.best.candidateAssignments.filter(s=>
        s.memberId===member.id).reduce((total,s)=>
        total+(Number(s.end.slice(0,2))*60+Number(s.end.slice(3))-
          Number(s.start.slice(0,2))*60-Number(s.start.slice(3))-
          (s.mealBreak?60:0)),0);
      assert.equal(sum,9600);
    }
  }
});

test("PR96 fase 2: recusa candidato se o horário inicial não estiver certificado",async()=>{
  const {evaluateRestDayExchangeCandidates}=await import("../src/restDayExchangeEvaluation");
  const input=fixture();
  input.assignments=input.assignments.filter(s=>!
    (s.memberId===B&&s.date==="2026-11-02"));
  const analysis=evaluateRestDayExchangeCandidates(input);
  assert.equal(analysis,null,"a fase 1 exige baseline com 160h por trabalhador");
});

test("PR96 fase 2: diagnóstico mensal não confunde 1/30 novembro com ciclo 02–29",async()=>{
  const {evaluateRestDayExchangeCandidates}=await import("../src/restDayExchangeEvaluation");
  const base=fixture();
  const expected=evaluateRestDayExchangeCandidates(base);
  assert.ok(expected);
  const withBoundaries={
    ...base,assignments:[
      {memberId:B,date:"2026-11-01",start:"14:00",end:"19:00",role:"sales"},
      ...base.assignments,
      {memberId:A,date:"2026-11-30",start:"09:00",end:"18:00",
        mealBreak:{start:"12:00",end:"13:00"},role:"sales"},
    ],
  };
  const result=evaluateRestDayExchangeCandidates(withBoundaries);
  assert.deepEqual(result,expected,
    "dias fora das 4 semanas não podem bloquear os ensaios nem criar créditos fictícios");
});

test("PR96 fase 3: novembro anonimizado — seis jornadas sem degradar função",async()=>{
  const {readFileSync}=await import("node:fs");
  const {evaluateRestDayExchangeCandidates}=await import("../src/restDayExchangeEvaluation");
  const source=JSON.parse(readFileSync(
    new URL("./fixtures/pr96-november-anonymized.json",import.meta.url),"utf8"
  )) as Sample;
  const unchanged=JSON.stringify(source);
  const result=evaluateRestDayExchangeCandidates(source);
  assert.ok(result,"as 4 semanas e a rotação devem ser conhecidas");
  assert.equal(result.baselineCertificationStatus,"valid");
  assert.equal(result.baselineLongDays,8);
  assert.equal(result.baselineSoloMinutes,0);
  assert.equal(result.baselineRoleGapMinutes,21120);
  assert.equal(result.evaluatedOpportunities,2);
  console.log("PR96_REAL_NOVEMBER_TRIALS",JSON.stringify(result.trials));
  const {searchBalancedFunctionalDay}=await import("../src/functionalDaySearch");
  const {clockMinutes}=await import("../src/workAssignments");
  const day=source.assignments.filter(s=>s.date==="2026-11-12");
  day.push({memberId:source.team.members[3].id,date:"2026-11-12",
    start:"08:30",end:"15:30",
    mealBreak:{start:"12:30",end:"13:30"},role:"sales"});
  const foundDay=searchBalancedFunctionalDay({
    date:"2026-11-12",shifts:day,
    opening:source.openingHours.days[3].intervals.map(w=>({
      start:clockMinutes(w.start),end:clockMinutes(w.end),
    })),members:source.team.members,roles:["checkout","sales"],
    minutesOverride:new Map([[source.team.members[0].id,390]]),
    maxSoloMinutes:0,
  });
  console.log("PR96_JOINT_DAY_FOUND",Boolean(foundDay));
  assert.ok(foundDay,"o planeamento conjunto tem de encontrar um dia válido");
  assert.ok(result.best,JSON.stringify(result.trials));
  assert.equal(result.best.longDays,6);
  assert.equal(result.best.certification.status,"valid");
  assert.equal(result.best.soloMinutes,0);
  assert.ok(result.best.roleGapMinutes!==null &&
    result.best.roleGapMinutes<=result.baselineRoleGapMinutes);
  assert.equal(JSON.stringify(source),unchanged,
    "nem as folgas, nem a rotação, nem os turnos podem sofrer mutação");
  assert.deepEqual(evaluateRestDayExchangeCandidates(source),result,
    "a investigação de jornadas longas deve ser determinística");
});

test("PR96 fase 3: testemunho independente 8→6, com lacuna funcional e solo preservados",async()=>{
  const {readFileSync}=await import("node:fs");
  const {certifySchedule}=await import("../src/certifySchedule");
  const {analyzeFunctionalCapacity}=await import("../src/functionalCapacityAnalysis");
  const {measureSimultaneousCoverage}=await import("../src/simultaneousCoverage");
  const {assignmentMinutes}=await import("../src/workAssignments");
  const source=JSON.parse(readFileSync(
    new URL("./fixtures/pr96-november-anonymized.json",import.meta.url),"utf8"
  )) as Sample;
  const members=source.team.members.map(m=>m.id);
  const [a,joao,diogo,lidio,sandro,,paula,floriberto]=members;
  const copy=source.assignments.map(shift=>({...shift,
    ...(shift.mealBreak?{mealBreak:{...shift.mealBreak}}:{})
  }));
  const updated=copy.filter(shift=>!(
    shift.memberId===lidio && shift.date==="2026-11-15"
  ));
  const change=(memberId:string,date:string,start:string,end:string,
    meal:string,role:string)=>{
    const shift=updated.find(s=>s.memberId===memberId&&s.date===date);
    assert.ok(shift,memberId+"|"+date);
    const next=(minutes:number)=>String(Math.floor(minutes/60))
      .padStart(2,"0")+":"+String(minutes%60).padStart(2,"0");
    const begin=Number(meal.slice(0,2))*60+Number(meal.slice(3));
    shift.start=start;shift.end=end;
    shift.mealBreak={start:meal,end:next(begin+60)};
    shift.role=role;
  };
  for(const date of ["2026-11-18","2026-11-19"])
    change(lidio,date,"09:00","19:00","13:00","sales");
  change(a,"2026-11-12","11:30","19:00","14:30","sales");
  change(sandro,"2026-11-12","08:30","18:30","12:30","checkout");
  change(joao,"2026-11-12","10:00","19:00","13:30","sales");
  change(diogo,"2026-11-12","08:30","17:30","11:30","sales");
  change(a,"2026-11-13","09:30","18:00","13:00","checkout");
  updated.push({memberId:lidio,date:"2026-11-12",
    start:"08:30",end:"15:30",
    mealBreak:{start:"12:30",end:"13:30"},role:"sales"});
  const cert=certifySchedule({
    period:{mode:"28d",start:"2026-11-02"},
    team:source.team,openingHours:source.openingHours,
    candidateAssignments:updated,mealBreakPolicy:"v2",
    hoursPolicy:"rolling28",functionalCoveragePolicy:"qualified50",
  });
  assert.equal(cert.status,"valid",JSON.stringify(cert.issues));
  for(const member of members)
    assert.equal(updated.filter(s=>s.memberId===member)
      .reduce((sum,s)=>sum+assignmentMinutes(s),0),9600);
  assert.equal(updated.filter(s=>assignmentMinutes(s)>540).length,6);
  const functional=analyzeFunctionalCapacity({
    period:{mode:"28d",start:"2026-11-02"},team:source.team,
    openingHours:source.openingHours,assignments:updated,minimumPercent:50,
  });
  assert.equal(functional?.observedRoleGapMinutes,21120);
  let solo=0;
  for(let i=0;i<28;i++){
    const date=addCivilDays("2026-11-02",i);
    const opening=source.openingHours.days[civilDayOfWeek(date)].intervals
      .map(w=>({
        start:Number(w.start.slice(0,2))*60+Number(w.start.slice(3)),
        end:Number(w.end.slice(0,2))*60+Number(w.end.slice(3)),
      }));
    const coverage=measureSimultaneousCoverage(
      updated.filter(s=>s.date===date),opening);
    assert.equal(coverage.uncoveredMinutes,0);
    solo+=coverage.soloMinutes;
  }
  assert.equal(solo,0);
});
