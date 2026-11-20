import assert from "node:assert/strict";
import test from "node:test";
import {
  monthlyDraftKey,loadMonthlyDraft,saveMonthlyDraft,readExternalMonthlyContext,
} from "../src/monthlyScheduleDraftRepository";
import {generateSchedule} from "../src/generateSchedule";
import {suggestedWeeklyOpeningHours} from "../src/operatingHours";
import {enumerateCivilDays} from "../src/schedulePeriods";
import type {WorkAssignment} from "../src/workAssignments";
import {certifySchedule} from "../src/certifySchedule";

const ANA="1a2b3c4d-3333-4444-8aaa-123456789abc";
function store(){
  const values=new Map<string,string>();
  return {
    values,
    getItem(key:string){return values.get(key)??null;},
    setItem(key:string,value:string){values.set(key,value);},
  };
}
function assignment(date:string,start="09:00",end="17:00"):WorkAssignment {
  return {memberId:ANA,date,start,end};
}
function monthDates(start:string,endExclusive:string):string[]{
  return enumerateCivilDays({start,endExclusive});
}

test("Um mês tem uma chave própria e só guarda atribuições desse mês",()=>{
  const storage=store();
  const november=monthlyDraftKey(2026,11);
  const december=monthlyDraftKey(2026,12);
  assert.notEqual(november,december);
  const saved=saveMonthlyDraft(storage,2026,11,[assignment("2026-11-02")],null);
  assert.equal(saved.ok,true);
  assert.equal(storage.values.size,1);
  assert.equal(storage.values.has(december),false);
  assert.deepEqual(loadMonthlyDraft(storage,2026,11).status,"loaded");
  assert.equal(loadMonthlyDraft(storage,2026,12).status,"empty");
});

test("Gravar novembro nunca toca nos dados já guardados de outubro/dezembro",()=>{
  const storage=store();
  assert.equal(saveMonthlyDraft(storage,2026,10,[assignment("2026-10-26")],null).ok,true);
  assert.equal(saveMonthlyDraft(storage,2026,12,[assignment("2026-12-01")],null).ok,true);
  const october=storage.values.get(monthlyDraftKey(2026,10));
  const december=storage.values.get(monthlyDraftKey(2026,12));
  const nov=saveMonthlyDraft(storage,2026,11,[assignment("2026-11-30")],null);
  assert.equal(nov.ok,true);
  const updated=saveMonthlyDraft(storage,2026,11,[assignment("2026-11-02")],
    nov.ok?nov.revision:null);
  assert.equal(updated.ok,true);
  assert.equal(storage.values.get(monthlyDraftKey(2026,10)),october);
  assert.equal(storage.values.get(monthlyDraftKey(2026,12)),december);
});

test("É proibido guardar turnos de outro mês ou intervalos sobrepostos",()=>{
  const storage=store();
  assert.equal(saveMonthlyDraft(storage,2026,11,[assignment("2026-12-01")],null).ok,false);
  assert.equal(saveMonthlyDraft(storage,2026,11,[
    assignment("2026-11-05","09:00","15:00"),
    assignment("2026-11-05","14:00","18:00"),
  ],null).ok,false);
  assert.equal(storage.values.size,0);
});

test("Protege a proposta existente contra alterações concorrentes/stale",()=>{
  const storage=store();
  const first=saveMonthlyDraft(storage,2026,11,[assignment("2026-11-02")],null);
  assert.equal(first.ok,true);
  const conflicted=saveMonthlyDraft(storage,2026,11,[assignment("2026-11-03")],null);
  assert.equal(conflicted.ok,false);
  if(!conflicted.ok)assert.equal(conflicted.code,"conflict");
  assert.deepEqual(loadMonthlyDraft(storage,2026,11).status,"loaded");
  if(!first.ok)throw Error("setup");
  const second=saveMonthlyDraft(storage,2026,11,[assignment("2026-11-03")],first.revision);
  assert.equal(second.ok,true);
  assert.equal(loadMonthlyDraft(storage,2026,11).status,"loaded");
});

test("Dados corrompidos ou de versão desconhecida nunca se tornam rascunho vazio",()=>{
  const storage=store();
  storage.setItem(monthlyDraftKey(2026,11),"corrompido");
  assert.equal(loadMonthlyDraft(storage,2026,11).status,"invalid");
  assert.equal(saveMonthlyDraft(storage,2026,11,[],null).ok,false);
  storage.setItem(monthlyDraftKey(2026,11),JSON.stringify({
    version:2,year:2026,month:11,assignments:[],
  }));
  assert.equal(loadMonthlyDraft(storage,2026,11).status,"invalid");
  storage.setItem(monthlyDraftKey(2026,11),JSON.stringify({
    version:1,year:2026,month:11,
    assignments:[assignment("2026-10-30")],
  }));
  assert.equal(loadMonthlyDraft(storage,2026,11).status,"invalid");
});

test("Falha do armazenamento não cria um horário fictício",()=>{
  const storage={
    getItem(_key:string):string|null{throw Error("blocked");},
    setItem(_key:string,_value:string):void{throw Error("blocked");},
  };
  assert.equal(loadMonthlyDraft(storage,2026,11).status,"unavailable");
  assert.equal(saveMonthlyDraft(storage,2026,11,[],null).ok,false);
  const context=readExternalMonthlyContext(storage,2026,11);
  assert.equal(context.ok,false);
  if(!context.ok)assert.equal(context.status,"unavailable");
});

test("Contexto exterior desconhecido continua desconhecido",()=>{
  const context=readExternalMonthlyContext(store(),2026,11);
  assert.equal(context.ok,true);
  if(!context.ok)throw Error("not expected");
  assert.deepEqual(context.context.completeDates,[]);
  assert.deepEqual(context.context.assignments,[]);
});

test("Contexto contém datas explicitamente conhecidas, mesmo sem turnos",()=>{
  const storage=store();
  assert.equal(saveMonthlyDraft(storage,2026,10,[],null).ok,true);
  assert.equal(saveMonthlyDraft(storage,2026,12,[assignment("2026-12-01")],null).ok,true);
  const before=JSON.stringify([...storage.values.entries()]);
  const context=readExternalMonthlyContext(storage,2026,11);
  assert.equal(context.ok,true);
  if(!context.ok)throw Error("expected");
  assert.deepEqual(context.context.completeDates,
    [...monthDates("2026-10-26","2026-11-01"),
      ...monthDates("2026-12-01","2026-12-07")]);
  assert.deepEqual(context.context.assignments,[assignment("2026-12-01")]);
  assert.equal(JSON.stringify([...storage.values.entries()]),before);
});

test("Um único mês vizinho conhecido não preenche o outro por omissão",()=>{
  const storage=store();
  assert.equal(saveMonthlyDraft(storage,2026,10,[],null).ok,true);
  const context=readExternalMonthlyContext(storage,2026,11);
  assert.equal(context.ok,true);
  if(!context.ok)throw Error("expected");
  assert.equal(context.context.completeDates.length,6);
  assert.ok(context.context.completeDates.every(x=>x.startsWith("2026-10")));
});

test("Um contexto corrompido impede geração e nunca é ignorado silenciosamente",()=>{
  const storage=store();
  storage.setItem(monthlyDraftKey(2026,10),"invalid");
  const context=readExternalMonthlyContext(storage,2026,11);
  assert.equal(context.ok,false);
  if(!context.ok)assert.equal(context.status,"invalid");
});

test("O gerador usa a proposta de outubro guardada como contexto sem editar outubro",()=>{
  const storage=store();
  const october=monthDates("2026-10-26","2026-10-31")
    .filter(date=>!date.endsWith("31")).map(date=>assignment(date));
  assert.equal(saveMonthlyDraft(storage,2026,10,october,null).ok,true);
  const before=storage.values.get(monthlyDraftKey(2026,10));
  const context=readExternalMonthlyContext(storage,2026,11);
  assert.equal(context.ok,true);
  if(!context.ok)throw Error("expected");
  const result=generateSchedule({
    period:{mode:"monthly",year:2026,month:11},
    team:{members:[{id:ANA,name:"Ana",active:true}]},
    openingHours:suggestedWeeklyOpeningHours(),
    externalContext:context.context,
  });
  assert.equal(result.status,"insufficient_context");
  assert.equal(result.candidateAssignments.some(x=>x.date.startsWith("2026-10")),false);
  assert.equal(storage.values.get(monthlyDraftKey(2026,10)),before);
});


test("PR84 v2 guarda UM turno com pausa interna e preserva horas efetivas",()=>{
  const storage=store();
  const hours=suggestedWeeklyOpeningHours();
  for(const d of hours.days)if(d.intervals.length)
    d.intervals=[{start:"09:00",end:"19:00"}];
  const generated=generateSchedule({
    period:{mode:"monthly",year:2026,month:11},
    team:{members:[{id:ANA,name:"Ana",active:true}]},
    openingHours:hours,mealBreakPolicy:"v2",
  });
  assert.ok(generated.candidateAssignments.some(a=>a.mealBreak));
  const saved=saveMonthlyDraft(storage,2026,11,
    generated.candidateAssignments,null,undefined,"v2");
  assert.equal(saved.ok,true);
  const raw=storage.values.get(monthlyDraftKey(2026,11));
  assert.ok(raw);
  const restored=loadMonthlyDraft(storage,2026,11);
  assert.equal(restored.status,"loaded");
  if(restored.status!=="loaded")throw Error("missing meal data");
  assert.equal(restored.mealBreakPolicy,"v2");
  assert.deepEqual(restored.mealBreaks,[]);
  assert.deepEqual(restored.assignments,generated.candidateAssignments);
  assert.equal(restored.assignments.filter(a=>
    a.date==="2026-11-02").length,1);
  const firstWeek=restored.assignments.filter(a=>
    a.date>="2026-11-02"&&a.date<"2026-11-09");
  const report=certifySchedule({
    period:{mode:"weekly",start:"2026-11-02"},
    team:{members:[{id:ANA,name:"Ana",active:true}]},
    openingHours:hours,candidateAssignments:firstWeek,
    mealBreakPolicy:"v2",
  });
  // With one person and a 10h opening, 40h are possible but full
  // coverage is impossible while that person takes a one-hour meal.
  assert.equal(report.status,"invalid");
  assert.equal(report.weeks[0].actualMinutes,2400);
  assert.ok(report.issues.some(i=>i.code==="OPENING_UNCOVERED"));
  assert.equal(storage.values.get(monthlyDraftKey(2026,11)),raw);
});

test("Rascunho experimental v1 com refeição separada permanece legível",()=>{
  const storage=store();
  const oldWork=[
    {memberId:ANA,date:"2026-11-02",start:"09:00",end:"12:00"},
    {memberId:ANA,date:"2026-11-02",start:"13:00",end:"18:00"},
  ];
  const oldMeals=[{memberId:ANA,date:"2026-11-02",
    start:"12:00",end:"13:00"}];
  assert.equal(saveMonthlyDraft(storage,2026,11,
    oldWork,null,oldMeals,"v1").ok,true);
  const restored=loadMonthlyDraft(storage,2026,11);
  assert.equal(restored.status,"loaded");
  if(restored.status==="loaded"){
    assert.equal(restored.mealBreakPolicy,"v1");
    assert.deepEqual(restored.assignments,oldWork);
    assert.deepEqual(restored.mealBreaks,oldMeals);
  }
});

test("Rascunhos antigos continuam legíveis sem inventar pausas retroativas",()=>{
  const storage=store();
  assert.equal(saveMonthlyDraft(storage,2026,11,[
    assignment("2026-11-02"),
  ],null).ok,true);
  const old=loadMonthlyDraft(storage,2026,11);
  assert.equal(old.status,"loaded");
  if(old.status!=="loaded")throw Error("legacy unreadable");
  assert.deepEqual(old.mealBreaks,[]);
  assert.equal(old.mealBreakPolicy,undefined);
});

test("Dados de pausas V1 corrompidos nunca são descartados silenciosamente",()=>{
  const storage=store();
  const broken=[{memberId:ANA,date:"2026-11-02",
    start:"12:00",end:"12:45"}];
  assert.equal(saveMonthlyDraft(storage,2026,11,[
    assignment("2026-11-02"),
  ],null,broken,"v1").ok,false);
  storage.setItem(monthlyDraftKey(2026,11),JSON.stringify({
    version:1,year:2026,month:11,
    assignments:[assignment("2026-11-02")],
    mealBreakPolicy:"v1",mealBreaks:broken,
  }));
  assert.equal(loadMonthlyDraft(storage,2026,11).status,"invalid");
});
