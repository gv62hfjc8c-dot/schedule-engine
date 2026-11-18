import assert from "node:assert/strict";
import test from "node:test";
import {
  monthlyDraftKey,loadMonthlyDraft,saveMonthlyDraft,readExternalMonthlyContext,
} from "../src/monthlyScheduleDraftRepository";
import {generateSchedule} from "../src/generateSchedule";
import {suggestedWeeklyOpeningHours} from "../src/operatingHours";
import {enumerateCivilDays} from "../src/schedulePeriods";
import type {WorkAssignment} from "../src/workAssignments";

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
