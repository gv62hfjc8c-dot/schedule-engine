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
  assert.equal(monday.start,tuesday.start,
    "O mesmo colaborador deve manter o turno durante a semana");
});


test("PR82: mesmo turno de segunda a sexta; aberturas e fechos trocam na semana seguinte",()=>{
  const data=input({mode:"14d",start:"2026-11-02"});
  const hours=opening();
  for(const day of hours.days)if(day.intervals.length)
    day.intervals=[{start:"09:00",end:"19:00"}];
  data.openingHours=hours;
  data.team={members:[
    {id:ANA,name:"Ana",active:true},
    {id:RUI,name:"Rui",active:true},
  ]};
  const before=JSON.stringify(data);
  const out=generateSchedule(data);
  assert.equal(out.status,"valid");
  assert.deepEqual(out.certification.weeks.map(w=>w.actualMinutes),[
    2400,2400,2400,2400,
  ]);
  for(const [weekStart,weekEnd] of [
    ["2026-11-02","2026-11-07"],
    ["2026-11-09","2026-11-14"],
  ]){
    const dates=enumerateCivilDays({start:weekStart,endExclusive:weekEnd});
    for(const memberId of [ANA,RUI]){
      const shifts=out.candidateAssignments.filter(a=>
        a.memberId===memberId&&dates.includes(a.date));
      assert.equal(shifts.length,5);
      assert.equal(new Set(shifts.map(a=>a.start)).size,1,
        "A hora de entrada deve ser estável nos cinco dias da semana");
      assert.equal(new Set(shifts.map(a=>a.end)).size,1,
        "A hora de saída deve ser estável nos cinco dias da semana");
    }
  }
  const firstWeek=out.candidateAssignments.find(a=>a.memberId===ANA&&a.date==="2026-11-02");
  const secondWeek=out.candidateAssignments.find(a=>a.memberId===ANA&&a.date==="2026-11-09");
  const otherFirst=out.candidateAssignments.find(a=>a.memberId===RUI&&a.date==="2026-11-02");
  const otherSecond=out.candidateAssignments.find(a=>a.memberId===RUI&&a.date==="2026-11-09");
  assert.ok(firstWeek&&secondWeek&&otherFirst&&otherSecond);
  assert.notEqual(firstWeek.start,secondWeek.start);
  assert.equal(firstWeek.start,otherSecond.start);
  assert.equal(firstWeek.end,otherSecond.end);
  assert.equal(secondWeek.start,otherFirst.start);
  assert.equal(secondWeek.end,otherFirst.end);
  assert.equal(JSON.stringify(data),before);
});

test("PR82: os sete dias da semana partilham a mesma posição quando a capacidade o permite",()=>{
  const data=week("2026-11-02");
  const hours=opening();
  for(const day of hours.days)day.intervals=[{start:"09:00",end:"19:00"}];
  data.openingHours=hours;
  data.team={members:[
    {id:ANA,name:"Ana",active:true},
    {id:RUI,name:"Rui",active:true},
  ]};
  const result=generateSchedule(data);
  assert.equal(result.status,"valid");
  // Todos os dias abertos devem ser candidatos; nenhuma categoria de dia
  // (sábado, domingo ou outro) é ignorada pelo gerador.
  const ana=result.candidateAssignments.filter(a=>a.memberId===ANA);
  assert.equal(ana.length,7);
  assert.equal(total(ana),2400);
  assert.deepEqual(new Set(ana.map(a=>a.date)),
    new Set(enumerateCivilDays({start:"2026-11-02",endExclusive:"2026-11-09"})));
});



test("PR82: semana com seis dias de horários diferentes é distribuída sem ultrapassar 40h",()=>{
  const data=week("2026-11-02");
  const hours=opening();
  for(const day of hours.days){
    day.intervals=day.day==="sunday"?[]:
      day.day==="saturday"?[{start:"09:00",end:"13:00"}]:
        [{start:"09:00",end:"19:00"}];
  }
  data.openingHours=hours;
  data.team={members:[
    {id:ANA,name:"Ana",active:true},
    {id:RUI,name:"Rui",active:true},
  ]};
  const before=JSON.stringify(data);
  const result=generateSchedule(data);
  assert.equal(result.status,"valid");
  assert.equal(result.certification.status,"valid");
  assert.deepEqual(result.certification.issues,[]);
  assert.deepEqual(result.certification.weeks.map(w=>w.actualMinutes),
    [2400,2400]);
  for(const id of [ANA,RUI]){
    const shifts=result.candidateAssignments.filter(a=>a.memberId===id);
    const saturday=shifts.filter(a=>a.date==="2026-11-07");
    assert.equal(saturday.length,1);
    assert.deepEqual([saturday[0].start,saturday[0].end],
      ["09:00","13:00"],"Uma janela de 4h ocupada por 4h não necessita de turnos");
    assert.equal(assignmentMinutes(saturday[0]),240);
    assert.equal(total(shifts),2400);
    const weekdays=shifts.filter(a=>a.date>="2026-11-02"&&a.date<="2026-11-06");
    assert.equal(weekdays.length,5);
    assert.equal(total(weekdays),2160);
    assert.deepEqual(weekdays.map(assignmentMinutes).sort((a,b)=>a-b),
      [420,420,420,420,480],
      "Trabalho restante: 36h distribuídas por cinco dias com tempos alinhados");
    assert.ok(new Set(weekdays.map(a=>a.start)).size<=2);
    assert.ok(new Set(weekdays.map(a=>a.end)).size<=2);
  }
  assert.ok(result.candidateAssignments.every(a=>
    a.date>="2026-11-02"&&a.date<="2026-11-08"));
  assert.equal(JSON.stringify(data),before);
  assert.deepEqual(result,generateSchedule(data));
});


test("Uma janela reduzida é aproveitada por inteiro em qualquer dia da semana",()=>{
  for(let shortIndex=0;shortIndex<7;shortIndex++){
    const data=week();
    const hours=opening();
    for(let i=0;i<hours.days.length;i++){
      hours.days[i].intervals=i===shortIndex
        ?[{start:"09:00",end:"13:00"}]
        :[{start:"09:00",end:"19:00"}];
    }
    data.openingHours=hours;
    data.team={members:[
      {id:ANA,name:"Ana",active:true},
      {id:RUI,name:"Rui",active:true},
    ]};
    const snapshot=JSON.stringify(data);
    const out=generateSchedule(data);
    assert.equal(out.status,"valid",hours.days[shortIndex].day);
    assert.ok(out.certification.weeks.every(w=>w.actualMinutes===2400));
    const date=enumerateCivilDays({
      start:"2026-11-02",endExclusive:"2026-11-09",
    })[shortIndex];
    for(const id of [ANA,RUI]){
      const shift=out.candidateAssignments.filter(a=>
        a.memberId===id&&a.date===date);
      assert.equal(shift.length,1);
      assert.deepEqual([shift[0].start,shift[0].end],
        ["09:00","13:00"],
        "O turno completo não pode ser reduzido quando o dia é curto");
      assert.equal(total(out.candidateAssignments.filter(a=>a.memberId===id)),2400);
    }
    assert.equal(JSON.stringify(data),snapshot);
  }
});

test("Uma janela curta não é uma obrigação de cobertura se faltar carga semanal",()=>{
  const data=week();
  const hours=opening();
  for(let i=0;i<hours.days.length;i++){
    hours.days[i].intervals=i<4
      ? [{start:"09:00",end:"19:00"}]
      : i===4?[{start:"09:00",end:"13:00"}]:[];
  }
  data.openingHours=hours;
  const out=generateSchedule(data);
  assert.equal(out.status,"valid");
  assert.equal(out.certification.weeks[0].actualMinutes,2400);
  // A regra hard é a soma de 40h; o horário reduzido é uma preferência
  // que não torna a proposta inválida quando não é necessário utilizá-lo.
  assert.ok(out.candidateAssignments.every(a=>a.date<="2026-11-06"));
});

test("PR82: qualquer dia aberto é considerado, inclusive domingo e intervalos repartidos",()=>{
  const data=week("2026-11-02");
  const hours=opening();
  const intervals=[
    [{start:"08:00",end:"16:00"}],
    [{start:"10:00",end:"19:00"}],
    [{start:"09:00",end:"12:00"},{start:"13:00",end:"19:00"}],
    [{start:"11:00",end:"19:00"}],
    [{start:"09:00",end:"18:00"}],
    [{start:"09:00",end:"13:00"}],
    [{start:"10:00",end:"14:00"}],
  ];
  for(let i=0;i<hours.days.length;i++)
    hours.days[i].intervals=intervals[i];
  data.openingHours=hours;
  const out=generateSchedule(data);
  assert.equal(out.status,"valid");
  assert.equal(total(out.candidateAssignments),2400);
  assert.deepEqual(new Set(out.candidateAssignments.map(a=>a.date)),
    new Set(enumerateCivilDays({
      start:"2026-11-02",endExclusive:"2026-11-09",
    })));
  assert.ok(out.candidateAssignments.every(a=>
    assignmentMinutes(a)>0));
  assert.ok(out.certification.weeks.every(w=>w.actualMinutes===2400));
});

test("PR82: falta real de capacidade continua inválida, sem inventar horas",()=>{
  const data=week("2026-11-02");
  const hours=opening();
  for(const day of hours.days)
    day.intervals=day.day==="sunday"?[]:
      [{start:"09:00",end:"15:00"}]; // 6 × 6h = 36h
  data.openingHours=hours;
  const out=generateSchedule(data);
  assert.equal(out.status,"invalid");
  assert.equal(total(out.candidateAssignments),2160);
  assert.ok(out.shortfalls.some(s=>s.missingMinutes===240));
});

test("PR82: o dia de funcionamento reduzido também conta na semana de fronteira",()=>{
  const hours=opening();
  for(const day of hours.days)day.intervals=
    day.day==="sunday"?[]:
      day.day==="saturday"?[{start:"09:00",end:"13:00"}]:
        [{start:"09:00",end:"19:00"}];
  const teamData={members:[
    {id:ANA,name:"Ana",active:true},
    {id:RUI,name:"Rui",active:true},
  ]};
  const weekly=generateSchedule({
    period:{mode:"weekly",start:"2026-11-30"},
    openingHours:hours,team:teamData,
  });
  assert.equal(weekly.status,"valid");
  const monday=weekly.candidateAssignments.filter(a=>a.date==="2026-11-30");
  assert.equal(monday.length,2);
  const data:GenerationInput={
    period:{mode:"monthly",year:2026,month:12},
    openingHours:hours,team:teamData,
    externalContext:{
      assignments:monday,
      completeDates:["2026-11-30","2027-01-01","2027-01-02","2027-01-03"],
    },
  };
  const before=JSON.stringify(data);
  const december=generateSchedule(data);
  assert.equal(december.status,"valid");
  assert.ok(december.certification.weeks.every(w=>w.actualMinutes===2400));
  for(const id of [ANA,RUI]){
    const original=weekly.candidateAssignments.filter(a=>a.memberId===id);
    const projected=december.candidateAssignments.filter(a=>
      a.memberId===id && a.date>="2026-12-01" && a.date<"2026-12-07");
    assert.deepEqual(projected,original.filter(a=>a.date!=="2026-11-30"));
  }
  assert.equal(JSON.stringify(data),before);
  assert.ok(december.candidateAssignments.every(a=>a.date.startsWith("2026-12-")));
});

test("PR82: dezembro conserva o turno iniciado em novembro sem modificar novembro",()=>{
  const data=week("2026-11-30");
  const hours=opening();
  for(const day of hours.days)if(day.intervals.length)
    day.intervals=[{start:"09:00",end:"19:00"}];
  data.openingHours=hours;
  data.team={members:[
    {id:ANA,name:"Ana",active:true},
    {id:RUI,name:"Rui",active:true},
  ]};
  const previousWeek=generateSchedule(data);
  assert.equal(previousWeek.status,"valid");
  const november30=previousWeek.candidateAssignments.filter(a=>
    a.date==="2026-11-30").map(a=>({...a}));
  assert.equal(november30.length,2);
  const monthlyData:GenerationInput={
    ...data,
    period:{mode:"monthly",year:2026,month:12},
    externalContext:{
      assignments:november30,
      completeDates:["2026-11-30","2027-01-01","2027-01-02","2027-01-03"],
    },
  };
  const before=JSON.stringify(monthlyData);
  const december=generateSchedule(monthlyData);
  assert.equal(december.status,"valid");
  assert.ok(december.certification.weeks.every(w=>w.actualMinutes===2400));
  assert.ok(december.candidateAssignments.every(a=>
    a.date>="2026-12-01"&&a.date<"2027-01-01"));
  for(const monday of november30){
    const otherDays=december.candidateAssignments.filter(a=>
      a.memberId===monday.memberId&&
      a.date>="2026-12-01"&&a.date<="2026-12-04");
    assert.equal(otherDays.length,4);
    assert.ok(otherDays.every(a=>
      a.start===monday.start&&a.end===monday.end),
      "O turno da semana não pode mudar por atravessar o dia 1 do mês");
  }
  assert.equal(JSON.stringify(monthlyData),before,
    "O contexto de novembro tem de permanecer imutável");
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
  assert.ok(out.candidateAssignments.some(a=>a.date==="2026-11-08"));
  assert.deepEqual(out.candidateAssignments
    .map(assignmentMinutes).sort((a,b)=>a-b),
    [240,360,360,360,360,360,360],
    "Todos os dias são elegíveis, sem favorecer um dia concreto para o turno parcial.");
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


test("O motor escolhe sozinho entradas em horas ou meias horas",()=>{
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
  const result=generateSchedule(data);
  assert.equal(result.status,"valid");
  assert.deepEqual(new Set(result.candidateAssignments
    .filter(a=>a.date==="2026-11-02").map(a=>a.start)),
  new Set(["09:00","09:30","10:30","11:00"]));
  assert.ok(result.candidateAssignments.every(a=>
    Number(a.start.slice(3))%30===0));
  assert.ok(result.certification.weeks.every(w=>w.actualMinutes===2400));
  assert.deepEqual(result,generateSchedule(data));
});

test("A distribuição automática não vira hard constraint do certificador",()=>{
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


test("A grelha usa horas reais em funcionamento repartido não alinhado",()=>{
  const data=week();
  const hours=opening();
  for(const day of hours.days)day.intervals=
    ["saturday","sunday"].includes(day.day)
      ? []:[{start:"09:00",end:"09:45"},{start:"10:00",end:"18:15"}];
  data.openingHours=hours;
  data.team={members:[
    {id:ANA,name:"Ana",active:true},
    {id:RUI,name:"Rui",active:true},
  ]};
  const result=generateSchedule(data);
  assert.equal(result.status,"valid");
  const monday=result.candidateAssignments.filter(a=>a.date==="2026-11-02");
  assert.equal(monday.length,3);
  const starts=monday.map(a=>a.start);
  assert.deepEqual(starts.sort(),["09:00","10:00","10:00"]);
  assert.ok(result.candidateAssignments.every(a=>
    a.start.endsWith(":00")||a.start.endsWith(":30")));
  assert.deepEqual(result.certification.weeks.map(w=>w.actualMinutes),[2400,2400]);
});

test("Se não houver início alinhado possível, o motor prioriza a validade",()=>{
  const data=week();
  const hours=opening();
  for(const day of hours.days)day.intervals=
    ["saturday","sunday"].includes(day.day)
      ? []:[{start:"09:05",end:"17:05"}];
  data.openingHours=hours;
  data.team={members:[
    {id:ANA,name:"Ana",active:true},
    {id:RUI,name:"Rui",active:true},
  ]};
  const result=generateSchedule(data);
  assert.equal(result.status,"valid");
  assert.ok(result.candidateAssignments.every(a=>
    a.start==="09:05"&&a.end==="17:05"));
});


test("PR83: uma folga semanal preserva seis dias de trabalho quando a empresa abre seis dias",()=>{
  const data=week();
  const hours=opening();
  for(const day of hours.days)day.intervals=
    day.day==="sunday"?[]:day.day==="saturday"
      ?[{start:"09:00",end:"13:00"}]
      :[{start:"09:00",end:"19:00"}];
  data.openingHours=hours;
  data.team={members:[
    {id:ANA,name:"Ana",active:true,weeklyDaysOff:1},
  ]};
  const out=generateSchedule(data);
  assert.equal(out.status,"valid");
  assert.equal(total(out.candidateAssignments),2400);
  assert.equal(new Set(out.candidateAssignments.map(a=>a.date)).size,6);
  assert.deepEqual(out.candidateAssignments.filter(a=>a.date==="2026-11-07")
    .map(a=>[a.start,a.end]),[["09:00","13:00"]]);
});

test("PR83: duas folgas por semana, motor escolhe cinco dias, sem escolher dia na equipa",()=>{
  const data=input({mode:"14d",start:"2026-11-02"});
  const hours=opening();
  for(const day of hours.days)day.intervals=
    day.day==="sunday"?[]:day.day==="saturday"
      ?[{start:"09:00",end:"13:00"}]
      :[{start:"09:00",end:"19:00"}];
  data.openingHours=hours;
  data.team={members:[
    {id:ANA,name:"Ana",active:true,weeklyDaysOff:2},
    {id:RUI,name:"Rui",active:true,weeklyDaysOff:2},
  ]};
  const original=JSON.stringify(data);
  const out=generateSchedule(data);
  assert.equal(out.status,"valid");
  assert.deepEqual(out.certification.issues,[]);
  for(const person of [ANA,RUI]){
    const shifts=out.candidateAssignments.filter(a=>a.memberId===person);
    assert.equal(total(shifts),4800);
    for(const start of ["2026-11-02","2026-11-09"]){
      const dates=enumerateCivilDays({start,endExclusive:
        start==="2026-11-02"?"2026-11-09":"2026-11-16"});
      const period=shifts.filter(a=>dates.includes(a.date));
      assert.equal(new Set(period.map(a=>a.date)).size,5);
      assert.equal(total(period),2400);
      assert.deepEqual(period.filter(a=>civilDayOfWeek(a.date)===5)
        .map(a=>[a.start,a.end]),[["09:00","13:00"]]);
      assert.deepEqual(period.filter(a=>civilDayOfWeek(a.date)<5)
        .map(assignmentMinutes).sort((a,b)=>a-b),[540,540,540,540]);
    }
  }
  assert.equal(JSON.stringify(data),original);
  assert.deepEqual(out,generateSchedule(data));
});

test("PR83: três folgas por semana com 40h exige quatro dias longos de 10h",()=>{
  const data=week();
  const hours=opening();
  for(const day of hours.days)day.intervals=
    day.day==="sunday"?[]:day.day==="saturday"
      ?[{start:"09:00",end:"13:00"}]
      :[{start:"09:00",end:"19:00"}];
  data.openingHours=hours;
  data.team={members:[
    {id:ANA,name:"Ana",active:true,weeklyDaysOff:3},
  ]};
  const out=generateSchedule(data);
  assert.equal(out.status,"valid");
  assert.equal(out.candidateAssignments.length,4);
  assert.equal(total(out.candidateAssignments),2400);
  assert.ok(out.candidateAssignments.every(a=>assignmentMinutes(a)===600));
});

test("PR83: sem capacidade para 40h e dias de folga, nunca certifica falsamente",()=>{
  const data=week();
  const hours=opening();
  for(const day of hours.days)day.intervals=
    ["saturday","sunday"].includes(day.day)?[]:
      [{start:"09:00",end:"19:00"}];
  data.openingHours=hours;
  data.team={members:[
    {id:ANA,name:"Ana",active:true,weeklyDaysOff:1},
  ]};
  const out=generateSchedule(data);
  assert.equal(out.status,"invalid");
  assert.equal(total(out.candidateAssignments),2400);
  assert.ok(out.certification.issues.some(i=>
    i.code==="WEEKLY_DAYS_OFF_MISMATCH"));
  assert.ok(out.candidateAssignments.every(a=>civilDayOfWeek(a.date)<5));
});

test("PR83: quando não há configuração nova, os horários antigos continuam iguais",()=>{
  const data=week();
  const old=generateSchedule(data);
  const copy=JSON.stringify(data);
  assert.equal(old.status,"valid");
  assert.equal(old.candidateAssignments.length,5);
  assert.equal(JSON.stringify(data),copy);
  assert.equal(outsideIsNotASetting(data.team),true);
});
function outsideIsNotASetting(team:unknown):boolean {
  return !JSON.stringify(team).includes("weeklyDaysOff");
}

test("PR83: folgas por semana consideram contexto externo sem alterar outros meses",()=>{
  const hours=opening();
  for(const day of hours.days)day.intervals=
    day.day==="sunday"?[]:day.day==="saturday"
      ?[{start:"09:00",end:"13:00"}]
      :[{start:"09:00",end:"19:00"}];
  const roster={members:[
    {id:ANA,name:"Ana",active:true,weeklyDaysOff:2},
  ]};
  const full=generateSchedule({
    period:{mode:"weekly",start:"2026-11-30"},
    team:roster,openingHours:hours,
  });
  assert.equal(full.status,"valid");
  const previous=full.candidateAssignments.filter(a=>a.date==="2026-11-30");
  const data:GenerationInput={
    period:{mode:"monthly",year:2026,month:12},
    team:roster,openingHours:hours,
    externalContext:{
      // A última semana de dezembro exige também o turno histórico
      // de 01/01: dia conhecido vazio NÃO pode ser tratado como folga extra.
      assignments:[...previous,{
        memberId:ANA,date:"2027-01-01",start:"09:00",end:"17:00",
      }],
      completeDates:["2026-11-30","2027-01-01","2027-01-02","2027-01-03"],
    },
  };
  const before=JSON.stringify(data);
  const month=generateSchedule(data);
  assert.equal(month.status,"valid");
  assert.ok(month.certification.weeks.every(w=>w.actualMinutes===2400));
  assert.ok(month.candidateAssignments.every(a=>a.date.startsWith("2026-12-")));
  const expected=full.candidateAssignments.filter(a=>a.date!=="2026-11-30");
  const actual=month.candidateAssignments.filter(a=>
    a.date>="2026-12-01"&&a.date<"2026-12-07");
  assert.deepEqual(actual,expected);
  assert.equal(JSON.stringify(data),before);
});


test("PR83: pessoas da mesma equipa podem ter uma e duas folgas, sem cobertura mínima",()=>{
  const data=week();
  const hours=opening();
  for(const day of hours.days)day.intervals=
    day.day==="sunday"?[]:day.day==="saturday"
      ?[{start:"09:00",end:"13:00"}]
      :[{start:"09:00",end:"19:00"}];
  data.openingHours=hours;
  data.team={members:[
    {id:ANA,name:"Ana",active:true,weeklyDaysOff:1},
    {id:RUI,name:"Rui",active:true,weeklyDaysOff:2},
  ]};
  const result=generateSchedule(data);
  assert.equal(result.status,"valid");
  for(const [memberId,worked] of [[ANA,6],[RUI,5]] as const){
    const shifts=result.candidateAssignments.filter(a=>a.memberId===memberId);
    assert.equal(total(shifts),2400);
    assert.equal(new Set(shifts.map(a=>a.date)).size,worked);
    assert.deepEqual(shifts.filter(a=>a.date==="2026-11-07")
      .map(a=>[a.start,a.end]),[["09:00","13:00"]]);
  }
});

test("PR83: zero folgas é possível com sete dias abertos; seis folgas não cabem em 40h",()=>{
  const data=week();
  const hours=opening();
  for(const day of hours.days)day.intervals=[{start:"09:00",end:"19:00"}];
  data.openingHours=hours;
  data.team={members:[
    {id:ANA,name:"Ana",active:true,weeklyDaysOff:0},
  ]};
  const seven=generateSchedule(data);
  assert.equal(seven.status,"valid");
  assert.equal(new Set(seven.candidateAssignments.map(a=>a.date)).size,7);
  assert.equal(total(seven.candidateAssignments),2400);
  data.team={members:[
    {id:ANA,name:"Ana",active:true,weeklyDaysOff:6},
  ]};
  const impossible=generateSchedule(data);
  assert.equal(impossible.status,"invalid");
  assert.ok(impossible.certification.issues.some(i=>i.code==="WEEKLY_HOURS_MISSING"));
  assert.ok(impossible.candidateAssignments.every(a=>
    a.start>="09:00"&&a.end<="19:00"));
});


test("PR83: as folgas de quatro pessoas não ficam concentradas no mesmo dia longo",()=>{
  const data=input({mode:"28d",start:"2026-11-02"});
  const hours=opening();
  for(const day of hours.days)day.intervals=
    day.day==="saturday"?[]:day.day==="sunday"
      ?[{start:"09:00",end:"13:00"}]
      :[{start:"09:00",end:"19:00"}];
  data.openingHours=hours;
  const ids=[ANA,RUI,
    "1a2b3c4d-3333-4444-8aaa-123456789abe",
    "1a2b3c4d-3333-4444-8aaa-123456789abf",
  ];
  data.team={members:ids.map((id,index)=>({
    id,name:"Teste "+(index+1),active:true,
    weeklyDaysOff:index===0?1:2,
  }))};
  const snapshot=JSON.stringify(data);
  const out=generateSchedule(data);
  assert.equal(out.status,"valid");
  assert.equal(out.certification.status,"valid");
  for(let w=0;w<4;w++){
    const monday=new Date(Date.UTC(2026,10,2+7*w));
    const date=(offset:number)=>{
      const d=new Date(monday);
      d.setUTCDate(d.getUTCDate()+offset);
      return d.toISOString().slice(0,10);
    };
    const short=date(6);
    assert.deepEqual(out.candidateAssignments.filter(a=>a.date===short)
      .map(a=>[a.memberId,a.start,a.end]).sort((a,b)=>
        String(a[0]).localeCompare(String(b[0]))),
      ids.map(id=>[id,"09:00","13:00"]).sort((a,b)=>
        String(a[0]).localeCompare(String(b[0]))));
    const weekdays=Array.from({length:5},(_,i)=>date(i));
    const headcounts=weekdays.map(day=>
      new Set(out.candidateAssignments.filter(a=>a.date===day)
        .map(a=>a.memberId)).size);
    assert.deepEqual([...headcounts].sort((a,b)=>a-b),[3,3,3,4,4],
      "Três ausências por semana devem ficar em três dias longos diferentes");
    assert.equal(out.candidateAssignments.filter(a=>a.date===date(5)).length,0);
    for(let i=0;i<ids.length;i++){
      const weekShifts=out.candidateAssignments.filter(a=>
        a.memberId===ids[i] && a.date>=date(0) && a.date<date(7));
      assert.equal(weekShifts.reduce((sum,a)=>sum+assignmentMinutes(a),0),2400);
      assert.equal(new Set(weekShifts.map(a=>a.date)).size,i===0?6:5);
    }
  }
  assert.deepEqual(out,generateSchedule(data));
  assert.equal(JSON.stringify(data),snapshot);
});

test("PR83: a proteção da janela curta é genérica, sem nome de dia",()=>{
  for(let shortIndex=0;shortIndex<7;shortIndex++){
    const data=week();
    const hours=opening();
    const closedIndex=shortIndex===6?5:6;
    for(let i=0;i<7;i++){
      hours.days[i].intervals=i===closedIndex?[]:
        i===shortIndex?[{start:"09:00",end:"13:00"}]:
          [{start:"09:00",end:"19:00"}];
    }
    data.openingHours=hours;
    data.team={members:Array.from({length:4},(_,i)=>({
      id:"00000000-0000-4000-8000-"+String(i+1).padStart(12,"0"),
      name:"Colaborador "+i,active:true,weeklyDaysOff:2,
    }))};
    const out=generateSchedule(data);
    assert.equal(out.status,"valid","Janela curta "+hours.days[shortIndex].day);
    const dates=enumerateCivilDays({start:"2026-11-02",endExclusive:"2026-11-09"});
    const short=out.candidateAssignments.filter(a=>a.date===dates[shortIndex]);
    assert.equal(short.length,4);
    assert.ok(short.every(a=>a.start==="09:00"&&a.end==="13:00"));
    const counts=dates.filter((_,i)=>i!==shortIndex&&i!==closedIndex)
      .map(day=>new Set(out.candidateAssignments.filter(a=>a.date===day)
        .map(a=>a.memberId)).size);
    assert.equal(counts.length,5);
    assert.ok(Math.max(...counts)-Math.min(...counts)<=1,
      "As ausências devem ficar dispersas pelos cinco dias longos");
    assert.ok(out.certification.weeks.every(w=>w.actualMinutes===2400));
    assert.ok(out.candidateAssignments.every(a=>a.date!==dates[closedIndex]));
  }
});


test("PR94: dados legados não ativam funções; 50% não invalida horário",()=>{
  const baseline=week();
  baseline.team={members:[
    {id:ANA,name:"Ana",active:true},
    {id:RUI,name:"Rui",active:true},
  ]};
  const original=generateSchedule(baseline);
  assert.equal(original.status,"valid");
  assert.equal(original.functionalCoveragePolicy,undefined);
  assert.ok(original.candidateAssignments.every(shift=>shift.role===undefined));

  const incomplete=structuredClone(baseline);
  incomplete.team={members:[
    {id:ANA,name:"Ana",active:true,qualifiedRoles:["checkout"]},
    {id:RUI,name:"Rui",active:true},
  ]};
  incomplete.mealBreakPolicy="v2";
  const refused=generateSchedule(incomplete);
  assert.equal(refused.status,"invalid_input");
  assert.ok(refused.certification.issues.some(i=>
    i.code==="INVALID_FUNCTIONAL_POLICY"));

  const qualified=structuredClone(baseline);
  qualified.team={members:[
    {id:ANA,name:"Ana",active:true,qualifiedRoles:["checkout"]},
    {id:RUI,name:"Rui",active:true,qualifiedRoles:["checkout","sales"]},
  ]};
  qualified.mealBreakPolicy="v2";
  const enabled=generateSchedule(qualified);
  assert.equal(enabled.functionalCoveragePolicy,"qualified50");
  assert.ok(enabled.candidateAssignments.length>0);
  assert.ok(enabled.candidateAssignments.every(shift=>
    shift.role==="checkout"||shift.role==="sales"));
  assert.equal(enabled.certification.status,"valid",
    "a meta SOFT de 50% nunca invalida um horário que cumpre regras HARD");
  assert.ok(!enabled.certification.issues.some(i=>
    i.code==="FUNCTIONAL_COVERAGE_GAP"||
    i.code==="FUNCTIONAL_CAPACITY_SHORTFALL"));
  assert.deepEqual(enabled,generateSchedule(qualified),"determinismo");
});
