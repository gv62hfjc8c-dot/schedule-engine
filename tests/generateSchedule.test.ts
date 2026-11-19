import test from "node:test";
import assert from "node:assert/strict";
import {generateSchedule,type GenerationInput} from "../src/generateSchedule";
import {certifySchedule} from "../src/certifySchedule";
import {civilDayOfWeek,enumerateCivilDays,resolvePlanningPeriod} from "../src/schedulePeriods";
import {suggestedWeeklyOpeningHours} from "../src/operatingHours";
import {assignmentMinutes,type WorkAssignment} from "../src/workAssignments";

const ANA="1a2b3c4d-3333-4444-8aaa-123456789abc";
const RUI="1a2b3c4d-3333-4444-8aaa-123456789abd";
const team=()=>({members:[{id:ANA,name:"Ana",active:true}]});
function opening(){
  const hours=suggestedWeeklyOpeningHours();
  for(const day of hours.days)day.intervals=
    day.day==="saturday"||day.day==="sunday"?[]:
      [{start:"08:00",end:"21:00"}];
  return hours;
}
function input(period:GenerationInput["period"]):GenerationInput{
  return {period,team:team(),openingHours:opening()};
}
function week(start="2026-11-02"):GenerationInput{
  return input({mode:"weekly",start});
}
function previousNextContext(){
  const assignments:WorkAssignment[]=[];
  const completeDates=[
    ...enumerateCivilDays({start:"2026-10-26",endExclusive:"2026-11-01"}),
    ...enumerateCivilDays({start:"2026-12-01",endExclusive:"2026-12-07"}),
  ];
  for(const date of completeDates){
    if(civilDayOfWeek(date)<5)
      assignments.push({memberId:ANA,date,start:"09:00",end:"17:00"});
  }
  return {assignments,completeDates};
}
const total=(assignments:WorkAssignment[])=>assignments
  .reduce((sum,entry)=>sum+assignmentMinutes(entry),0);

test("PR77: gera realmente 5×8h por semana e invoca certificação automática",()=>{
  const data=week();
  const out=generateSchedule(data);
  assert.equal(out.status,"valid");
  assert.equal(out.certification.status,"valid");
  assert.equal(out.certification.issues.length,0);
  assert.equal(total(out.candidateAssignments),2400);
  assert.equal(out.candidateAssignments.length,5);
  assert.deepEqual(out.candidateAssignments.map(a=>a.date),[
    "2026-11-02","2026-11-03","2026-11-04","2026-11-05","2026-11-06",
  ]);
  assert.ok(out.candidateAssignments.every(a=>a.start==="08:00"&&a.end==="16:00"));
  assert.deepEqual(out.shortfalls,[]);
});

test("A geração é determinística, pura e nunca escreve nos inputs",()=>{
  const data=week();
  const before=JSON.stringify(data);
  const first=generateSchedule(data);
  const second=generateSchedule(data);
  assert.deepEqual(first,second);
  assert.equal(JSON.stringify(data),before);
  assert.deepEqual(certifySchedule({...data,candidateAssignments:first.candidateAssignments}),
    first.certification);
});

test("14, 21 e 28 dias cumprem 40h em CADA semana, não apenas no total",()=>{
  for(const [mode,numberOfWeeks] of [
    ["14d",2],["21d",3],["28d",4],
  ] as const){
    const out=generateSchedule(input({mode,start:"2026-11-02"}));
    assert.equal(out.status,"valid",mode);
    assert.equal(out.certification.weeks.length,numberOfWeeks);
    assert.ok(out.certification.weeks.every(w=>w.actualMinutes===2400));
    assert.equal(total(out.candidateAssignments),numberOfWeeks*2400);
  }
});

test("Gera para todos os ativos; inativos nunca recebem turnos",()=>{
  const data=week();
  data.team={members:[
    {id:ANA,name:"Ana",active:true},
    {id:RUI,name:"Rui",active:true},
  ]};
  const both=generateSchedule(data);
  assert.equal(both.status,"valid");
  assert.equal(total(both.candidateAssignments),4800);
  assert.deepEqual(new Set(both.candidateAssignments.map(a=>a.memberId)),new Set([ANA,RUI]));
  (data.team as ReturnType<typeof team>).members[1].active=false;
  const one=generateSchedule(data);
  assert.equal(one.status,"valid");
  assert.equal(total(one.candidateAssignments),2400);
  assert.ok(one.candidateAssignments.every(a=>a.memberId===ANA));
});


test("09–19 com duas pessoas: uma abre e a outra fecha, mantendo 40h cada",()=>{
  const data=week();
  const hours=opening();
  for(const day of hours.days)if(day.intervals.length)
    day.intervals=[{start:"09:00",end:"19:00"}];
  data.openingHours=hours;
  data.team={members:[
    {id:ANA,name:"Ana",active:true},
    {id:RUI,name:"Rui",active:true},
  ]};
  const result=generateSchedule(data);
  assert.equal(result.status,"valid");
  assert.equal(result.certification.status,"valid");
  assert.deepEqual(result.certification.weeks.map(w=>w.actualMinutes),[2400,2400]);
  for(const date of enumerateCivilDays({start:"2026-11-02",endExclusive:"2026-11-07"})){
    const shifts=result.candidateAssignments.filter(a=>a.date===date);
    assert.equal(shifts.length,2);
    assert.deepEqual(shifts.map(a=>[a.start,a.end]).sort(),[
      ["09:00","17:00"],["11:00","19:00"],
    ]);
  }
  const monday=result.candidateAssignments.find(a=>a.date==="2026-11-02"&&a.memberId===ANA);
  const tuesday=result.candidateAssignments.find(a=>a.date==="2026-11-03"&&a.memberId===ANA);
  assert.ok(monday&&tuesday);
  assert.notEqual(monday.start,tuesday.start,"A preferência deve rodar entre colaboradores");
});

test("Regressão no calendário mensal: novembro 2026, dois ativos, 09h–19h",()=>{
  const hours=opening();
  for(const day of hours.days)if(day.intervals.length)
    day.intervals=[{start:"09:00",end:"19:00"}];
  const data:GenerationInput={
    period:{mode:"monthly",year:2026,month:11},
    openingHours:hours,
    team:{members:[
      {id:ANA,name:"Ana",active:true},
      {id:RUI,name:"Rui",active:true},
    ]},
  };
  const before=JSON.stringify(data);
  const result=generateSchedule(data);
  assert.equal(result.status,"insufficient_context");
  assert.ok(result.certification.issues.some(e=>e.code==="CONTEXT_INCOMPLETE"));
  assert.ok(result.candidateAssignments.every(a=>
    a.date>="2026-11-01" && a.date<"2026-12-01"));
  const shifts=result.candidateAssignments
    .filter(a=>a.date==="2026-11-02").map(a=>[a.start,a.end]).sort();
  assert.deepEqual(shifts,[["09:00","17:00"],["11:00","19:00"]]);
  assert.equal(JSON.stringify(data),before);
});

test("Três colaboradores distribuem os inícios pelo período aberto, sem cobertura hard",()=>{
  const CARLA="1a2b3c4d-3333-4444-8aaa-123456789abe";
  const data=week();
  const hours=opening();
  for(const day of hours.days)if(day.intervals.length)
    day.intervals=[{start:"09:00",end:"19:00"}];
  data.openingHours=hours;
  data.team={members:[
    {id:ANA,name:"Ana",active:true},
    {id:RUI,name:"Rui",active:true},
    {id:CARLA,name:"Carla",active:true},
  ]};
  const result=generateSchedule(data);
  assert.equal(result.status,"valid");
  const monday=result.candidateAssignments.filter(a=>a.date==="2026-11-02");
  assert.deepEqual(monday.map(a=>[a.start,a.end]).sort(),[
    ["09:00","17:00"],["10:00","18:00"],["11:00","19:00"],
  ]);
  assert.deepEqual(result.certification.weeks.map(w=>w.actualMinutes),[2400,2400,2400]);
});

test("Sem margem temporal, é normal haver turnos iguais: 8h abertas e 8h de trabalho",()=>{
  const data=week();
  const hours=opening();
  for(const day of hours.days)if(day.intervals.length)
    day.intervals=[{start:"09:00",end:"17:00"}];
  data.openingHours=hours;
  data.team={members:[
    {id:ANA,name:"Ana",active:true},
    {id:RUI,name:"Rui",active:true},
  ]};
  const result=generateSchedule(data);
  assert.equal(result.status,"valid");
  assert.equal(result.candidateAssignments.length,10);
  assert.ok(result.candidateAssignments.every(a=>a.start==="09:00"&&a.end==="17:00"));
});

test("Alternar turnos em funcionamento repartido não inclui pausas como trabalho",()=>{
  const data=week();
  const hours=opening();
  for(const day of hours.days)if(day.intervals.length)
    day.intervals=[{start:"09:00",end:"13:00"},{start:"14:00",end:"20:00"}];
  data.openingHours=hours;
  data.team={members:[
    {id:ANA,name:"Ana",active:true},
    {id:RUI,name:"Rui",active:true},
  ]};
  const result=generateSchedule(data);
  assert.equal(result.status,"valid");
  const monday=result.candidateAssignments.filter(a=>a.date==="2026-11-02");
  const perPerson=new Map<string,WorkAssignment[]>();
  for(const item of monday){
    perPerson.set(item.memberId,[...(perPerson.get(item.memberId)??[]),item]);
  }
  assert.equal(perPerson.size,2);
  assert.deepEqual([...perPerson.values()].map(items=>items.map(x=>[x.start,x.end]))
    .sort((a,b)=>a[0][0].localeCompare(b[0][0])),[
    [["09:00","13:00"],["14:00","18:00"]],
    [["11:00","13:00"],["14:00","20:00"]],
  ]);
  assert.deepEqual(result.certification.weeks.map(w=>w.actualMinutes),[2400,2400]);
});

test("As 8h/dia são uma preferência do algoritmo, não hard constraint",()=>{
  const data=week();
  const hours=opening();
  for(const day of hours.days)day.intervals=
    ["monday","tuesday","wednesday","thursday"].includes(day.day)
      ? [{start:"09:00",end:"19:00"}]:[];
  data.openingHours=hours;
  const out=generateSchedule(data);
  assert.equal(out.status,"valid");
  assert.equal(total(out.candidateAssignments),2400);
  assert.deepEqual(out.candidateAssignments.map(assignmentMinutes),[600,600,600,600]);
});

test("Quando há 7 dias abertos a 6h, o motor usa também o domingo para completar 40h",()=>{
  const data=week();
  const hours=opening();
  for(const day of hours.days)day.intervals=[{start:"10:00",end:"16:00"}];
  data.openingHours=hours;
  const out=generateSchedule(data);
  assert.equal(out.status,"valid");
  assert.equal(total(out.candidateAssignments),2400);
  assert.equal(out.candidateAssignments.length,7);
  assert.equal(out.candidateAssignments.at(-1)?.date,"2026-11-08");
  assert.equal(assignmentMinutes(out.candidateAssignments.at(-1)!),240);
});

test("Intervalos descontínuos do funcionamento geram trabalho efetivo separado",()=>{
  const data=week();
  const hours=opening();
  for(const day of hours.days)if(day.intervals.length){
    day.intervals=[{start:"09:00",end:"13:00"},{start:"14:00",end:"18:00"}];
  }
  data.openingHours=hours;
  const out=generateSchedule(data);
  assert.equal(out.status,"valid");
  assert.equal(out.candidateAssignments.length,10);
  assert.equal(total(out.candidateAssignments),2400);
  assert.deepEqual(out.candidateAssignments.slice(0,2).map(a=>[a.start,a.end]),
    [["09:00","13:00"],["14:00","18:00"]]);
});

test("Funcionamento com apenas 20h semanais torna 40h impossíveis",()=>{
  const data=week();
  const hours=opening();
  for(const day of hours.days)if(day.intervals.length){
    day.intervals=[{start:"09:00",end:"13:00"}];
  }
  data.openingHours=hours;
  const out=generateSchedule(data);
  assert.equal(out.status,"invalid");
  assert.equal(out.certification.status,"invalid");
  assert.equal(total(out.candidateAssignments),1200);
  assert.equal(out.shortfalls.length,1);
  assert.equal(out.shortfalls[0].missingMinutes,1200);
  assert.ok(out.certification.issues.some(i=>i.code==="WEEKLY_HOURS_MISSING"));
});

test("Um mês com contexto completo é certificado e nunca escreve nos meses externos",()=>{
  const data=input({mode:"monthly",year:2026,month:11});
  data.externalContext=previousNextContext();
  const original=JSON.stringify(data.externalContext);
  const out=generateSchedule(data);
  assert.equal(out.status,"valid");
  assert.equal(out.certification.status,"valid");
  assert.equal(out.certification.weeks.length,6);
  assert.deepEqual(out.certification.weeks.map(w=>w.actualMinutes),
    [2400,2400,2400,2400,2400,2400]);
  assert.ok(out.candidateAssignments.length>0);
  assert.ok(out.candidateAssignments.every(a=>
    a.date>="2026-11-01" && a.date<"2026-12-01"));
  assert.equal(out.candidateAssignments.filter(a=>a.date==="2026-11-30").length,1);
  assert.equal(out.candidateAssignments.find(a=>a.date==="2026-11-30")?.end,"16:00");
  assert.equal(JSON.stringify(data.externalContext),original);
});

test("Contexto de meses vizinhos incompleto não é inventado nem certificado",()=>{
  const data=input({mode:"monthly",year:2026,month:11});
  const snapshot=JSON.stringify(data);
  const out=generateSchedule(data);
  assert.equal(out.status,"insufficient_context");
  assert.equal(out.certification.status,"insufficient_context");
  assert.ok(out.certification.issues.some(i=>i.code==="CONTEXT_INCOMPLETE"));
  assert.equal(JSON.stringify(data),snapshot);
  assert.ok(out.candidateAssignments.every(a=>a.date.startsWith("2026-11-")));
  // A única segunda-feira de novembro na semana de dezembro é planeada
  // conservadoramente a 8h; o motor não inventa 32h em dezembro.
  assert.equal(assignmentMinutes(out.candidateAssignments.find(a=>
    a.date==="2026-11-30")!),480);
});

test("Contexto completo que exige trabalhar num domingo encerrado é impossível",()=>{
  const data=input({mode:"monthly",year:2026,month:11});
  data.externalContext=previousNextContext();
  (data.externalContext.assignments as WorkAssignment[])
    .splice(0,1); // 32h de outubro em vez de 40h
  const original=JSON.stringify(data.externalContext);
  const out=generateSchedule(data);
  assert.equal(out.status,"invalid");
  assert.ok(out.certification.issues.some(i=>
    i.code==="WEEKLY_HOURS_MISSING"&&i.weekStart==="2026-10-26"));
  assert.equal(out.candidateAssignments.some(a=>a.date<"2026-11-01"),false);
  assert.equal(JSON.stringify(data.externalContext),original);
});

test("40h já existentes fora do mês não provocam horas adicionais dentro do mês",()=>{
  const data=input({mode:"monthly",year:2026,month:11});
  data.externalContext=previousNextContext();
  // A primeira semana já tinha 40h em outubro, portanto não gera
  // atribuições para 1 novembro, mesmo que a empresa abrisse domingo.
  const hours=opening();
  hours.days[6].intervals=[{start:"10:00",end:"19:00"}];
  data.openingHours=hours;
  const out=generateSchedule(data);
  assert.equal(out.status,"valid");
  assert.equal(out.candidateAssignments.some(a=>a.date==="2026-11-01"),false);
});

test("O estado de aprovação dos outros meses nunca influencia a permissão de escrita",()=>{
  for(const state of ["aprovado","rascunho","incompleto"]){
    const data=input({mode:"monthly",year:2026,month:11});
    data.externalContext={
      ...previousNextContext(),
      status:state, // campo de metadados ignorado pela função pura
    } as unknown as GenerationInput["externalContext"];
    const out=generateSchedule(data);
    assert.equal(out.status,"valid");
    assert.ok(out.candidateAssignments.every(a=>a.date.startsWith("2026-11-")));
  }
});

test("Contexto com dados inválidos bloqueia geração, sem turnos fabricados",()=>{
  const data=input({mode:"monthly",year:2026,month:11});
  data.externalContext={
    assignments:[{memberId:ANA,date:"2026-10-30",start:"16:00",end:"09:00"}],
    completeDates:[],
  };
  const out=generateSchedule(data);
  assert.equal(out.status,"invalid_input");
  assert.deepEqual(out.candidateAssignments,[]);
  assert.equal(out.certification.status,"invalid");
});

test("A equipa inválida e o funcionamento inválido não produzem propostas",()=>{
  const data=week();
  data.team={members:[]};
  assert.equal(generateSchedule(data).status,"invalid_input");
  assert.deepEqual(generateSchedule(data).candidateAssignments,[]);
  data.team=team();
  data.openingHours={days:[]};
  assert.equal(generateSchedule(data).status,"invalid_input");
  assert.deepEqual(generateSchedule(data).candidateAssignments,[]);
});

test("Sem cobertura mínima: não tenta preencher todos os períodos de abertura",()=>{
  const out=generateSchedule(week());
  assert.equal(out.status,"valid");
  // 08:00–21:00 aberto, mas 16:00–21:00 sem ninguém é permitido.
  assert.ok(out.candidateAssignments.every(a=>a.end<"21:00"));
});

test("O resultado nunca assume que um dia sem turno é uma folga",()=>{
  const out=generateSchedule(week());
  assert.ok(out.candidateAssignments.every(a=>
    Object.keys(a).sort().join(",")==="date,end,memberId,start"));
});

test("Frenteira mensal: 38h em outubro são completadas apenas em novembro",()=>{
  const data=input({mode:"monthly",year:2026,month:11});
  const external=previousNextContext();
  const friday=external.assignments.find(a=>a.date==="2026-10-30");
  assert.ok(friday);
  friday.end="15:00"; // agora outubro tem 38 horas
  data.externalContext=external;
  const hours=opening();
  hours.days[6].intervals=[{start:"10:00",end:"18:00"}]; // domingo 1/11
  data.openingHours=hours;
  const snapshot=JSON.stringify(external);
  const generated=generateSchedule(data);
  assert.equal(generated.status,"valid");
  const nov1=generated.candidateAssignments.filter(a=>a.date==="2026-11-01");
  assert.equal(nov1.length,1);
  assert.equal(assignmentMinutes(nov1[0]),120);
  assert.equal(JSON.stringify(external),snapshot);
});

test("Mês de 31 dias: dezembro cruza novembro e janeiro, mas só escreve dezembro",()=>{
  const data=input({mode:"monthly",year:2026,month:12});
  const external={
    assignments:[{
      memberId:ANA,date:"2026-11-30",start:"09:00",end:"17:00",
    }],
    completeDates:["2026-11-30","2027-01-01","2027-01-02","2027-01-03"],
  };
  data.externalContext=external;
  const snapshot=JSON.stringify(external);
  const out=generateSchedule(data);
  assert.equal(out.status,"valid");
  assert.equal(resolvePlanningPeriod(data.period).endExclusive,"2027-01-01");
  assert.ok(out.candidateAssignments.every(a=>
    a.date>="2026-12-01" && a.date<"2027-01-01"));
  assert.ok(out.certification.weeks.every(w=>w.actualMinutes===2400));
  const last=out.candidateAssignments.filter(a=>a.date>="2026-12-28");
  assert.equal(last.length,4);
  assert.ok(last.every(a=>assignmentMinutes(a)===600));
  assert.equal(JSON.stringify(external),snapshot);
});

test("Excesso já existente no mês anterior é inválido, não uma falta fictícia",()=>{
  const data=input({mode:"monthly",year:2026,month:11});
  const external=previousNextContext();
  external.assignments.push({
    memberId:ANA,date:"2026-10-31",start:"09:00",end:"17:00",
  });
  data.externalContext=external;
  const out=generateSchedule(data);
  assert.equal(out.status,"invalid");
  assert.ok(out.certification.issues.some(i=>i.code==="WEEKLY_HOURS_EXCESS"&&
    i.weekStart==="2026-10-26"));
  assert.equal(out.shortfalls.some(s=>s.weekStart==="2026-10-26"),false);
  assert.ok(out.candidateAssignments.every(a=>a.date.startsWith("2026-11-")));
});


test("As entradas podem usar passos de 30 ou 60 min, sem regras de cobertura",()=>{
  const data=week();
  const hours=opening();
  for(const day of hours.days){
    day.intervals=["saturday","sunday"].includes(day.day)
      ? []:[{start:"09:00",end:"19:00"}];
  }
  data.openingHours=hours;
  data.team={members:[
    {id:ANA,name:"Ana",active:true},
    {id:RUI,name:"Rui",active:true},
    {id:"1a2b3c4d-3333-4444-8aaa-123456789abe",name:"Carla",active:true},
    {id:"1a2b3c4d-3333-4444-8aaa-123456789abf",name:"Pedro",active:true},
  ]};
  const thirty=generateSchedule({...data,preferences:{startSpacingMinutes:30}});
  const sixty=generateSchedule({...data,preferences:{startSpacingMinutes:60}});
  assert.equal(thirty.status,"valid");
  assert.equal(sixty.status,"valid");
  assert.deepEqual(new Set(thirty.candidateAssignments
    .filter(a=>a.date==="2026-11-02").map(a=>a.start)),
  new Set(["09:00","09:30","10:30","11:00"]));
  assert.deepEqual(new Set(sixty.candidateAssignments
    .filter(a=>a.date==="2026-11-02").map(a=>a.start)),
  new Set(["09:00","10:00","11:00"]));
  assert.ok(thirty.candidateAssignments.every(a=>
    (Number(a.start.slice(3))-0)%30===0));
  assert.ok(sixty.candidateAssignments.every(a=>a.start.endsWith(":00")));
  assert.deepEqual(thirty.certification.weeks.map(w=>w.actualMinutes),
    sixty.certification.weeks.map(w=>w.actualMinutes));
  assert.ok(sixty.candidateAssignments.some(a=>
    sixty.candidateAssignments.filter(b=>b.date===a.date&&b.start===a.start).length>1),
    "Com mais pessoas do que posições horárias, entradas coincidentes são válidas.");
});

test("A preferência de entradas não vira hard constraint do certificador",()=>{
  const data=week();
  const hours=opening();
  for(const day of hours.days)day.intervals=
    ["saturday","sunday"].includes(day.day)?[]:[{start:"09:00",end:"19:00"}];
  data.openingHours=hours;
  const assignments=enumerateCivilDays({
    start:"2026-11-02",endExclusive:"2026-11-07",
  }).map(date=>({memberId:ANA,date,start:"09:15",end:"17:15"}));
  const report=certifySchedule({...data,candidateAssignments:assignments});
  assert.equal(report.status,"valid");
});

test("Rotação atravessa novembro/dezembro sem reiniciar no dia 1",()=>{
  const data=week("2026-11-30");
  const hours=opening();
  for(const day of hours.days)day.intervals=
    ["saturday","sunday"].includes(day.day)?[]:[{start:"09:00",end:"19:00"}];
  data.openingHours=hours;
  data.team={members:[
    {id:ANA,name:"Ana",active:true},
    {id:RUI,name:"Rui",active:true},
  ]};
  const weekly=generateSchedule(data);
  const december=generateSchedule({...data,period:{
    mode:"monthly",year:2026,month:12,
  }});
  assert.equal(weekly.status,"valid");
  assert.equal(december.status,"insufficient_context");
  const dec1=(shifts:WorkAssignment[])=>shifts
    .filter(a=>a.date==="2026-12-01").map(a=>[a.memberId,a.start,a.end]).sort();
  assert.deepEqual(dec1(weekly.candidateAssignments),dec1(december.candidateAssignments));
  assert.ok(december.candidateAssignments.every(a=>a.date.startsWith("2026-12-")));
});
