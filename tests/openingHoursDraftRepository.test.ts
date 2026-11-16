import test from "node:test";
import assert from "node:assert/strict";
import {suggestedWeeklyOpeningHours} from "../src/operatingHours";
import {OPENING_HOURS_DRAFT_KEY,loadOpeningHoursDraft,saveOpeningHoursDraft} from "../src/openingHoursDraftRepository";
const makeStore=()=>{
  const data=new Map<string,string>();
  return {
    getItem:(key:string)=>data.get(key)??null,
    setItem:(key:string,val:string)=>{data.set(key,val);},
    inject:(raw:string)=>{data.set(OPENING_HOURS_DRAFT_KEY,raw);},
  };
};
test("Horários são persistidos e lidos sem inventar dias",()=>{
  const store=makeStore();
  assert.equal(loadOpeningHoursDraft(store).status,"empty");
  const input=suggestedWeeklyOpeningHours();
  const saved=saveOpeningHoursDraft(store,input);
  assert.equal(saved.ok,true);
  const loaded=loadOpeningHoursDraft(store);
  assert.equal(loaded.status,"loaded");
  if(loaded.status==="loaded"){
    assert.equal(loaded.value.days.length,7);
    assert.deepEqual(loaded.value.days[6].intervals,[]);
  }
});
test("Não guarda horas inválidas nem substitui o horário anterior",()=>{
  const store=makeStore();
  const good=suggestedWeeklyOpeningHours();
  assert.equal(saveOpeningHoursDraft(store,good).ok,true);
  const bad=suggestedWeeklyOpeningHours();
  bad.days[0].intervals=[{start:"19:00",end:"10:00"}];
  assert.equal(saveOpeningHoursDraft(store,bad).ok,false);
  assert.equal(loadOpeningHoursDraft(store).status,"loaded");
});
test("Versão desconhecida e dados corrompidos não são tratados como conta nova",()=>{
  const store=makeStore();
  store.inject("{");assert.equal(loadOpeningHoursDraft(store).status,"invalid");
  store.inject('{"version":2,"weeklyHours":{}}');
  assert.equal(loadOpeningHoursDraft(store).status,"invalid");
  store.inject('{"version":1,"weeklyHours":null}');
  assert.equal(loadOpeningHoursDraft(store).status,"invalid");
});
test("Armazenamento indisponível distingue-se de horário não configurado",()=>{
  const failed={
    getItem:(_key:string):string|null=>{throw new Error("no storage");},
    setItem:(_key:string,_val:string):void=>{throw new Error("no storage");},
  };
  assert.equal(loadOpeningHoursDraft(failed).status,"unavailable");
  assert.equal(saveOpeningHoursDraft(failed,suggestedWeeklyOpeningHours()).ok,false);
});
