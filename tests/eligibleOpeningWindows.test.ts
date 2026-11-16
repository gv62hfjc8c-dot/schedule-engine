import test from "node:test";
import assert from "node:assert/strict";
import {eligibleOpeningWindows} from "../src/eligibleOpeningWindows";
import {suggestedWeeklyOpeningHours} from "../src/operatingHours";

const person={
  id:"1a2b3c4d-3333-4444-8aaa-123456789abc",
  name:"Ana Silva",
  active:true,
};

test("Pessoa ativa herda integralmente o horário de funcionamento real",()=>{
  const business=suggestedWeeklyOpeningHours();
  business.days[0].intervals=[{start:"07:00",end:"13:00"}];
  business.days[5].intervals=[{start:"12:00",end:"23:00"}];
  business.days[6].intervals=[{start:"08:00",end:"10:00"}];
  const windows=eligibleOpeningWindows(person,business);
  assert.deepEqual(windows,business);
  assert.equal(windows?.days[5].intervals[0].end,"23:00");
  assert.equal(windows?.days[6].intervals[0].start,"08:00");
});

test("Pessoa inativa não pode receber novos turnos em nenhum dia",()=>{
  const business=suggestedWeeklyOpeningHours();
  const windows=eligibleOpeningWindows({...person,active:false},business);
  assert.equal(windows?.days.length,7);
  assert.equal(windows?.days.every(day=>day.intervals.length===0),true);
});

test("Dia encerrado da empresa não cria disponibilidade nem folga atribuída",()=>{
  const business=suggestedWeeklyOpeningHours();
  const windows=eligibleOpeningWindows(person,business);
  assert.deepEqual(windows?.days[6].intervals,[]);
  assert.equal("shifts" in (windows ?? {}),false);
});

test("Dados de empresa ou pessoa inválidos não geram janelas fictícias",()=>{
  const business=suggestedWeeklyOpeningHours();
  assert.equal(eligibleOpeningWindows(person,null),null);
  assert.equal(eligibleOpeningWindows({...person,active:"true"},business),null);
  assert.equal(eligibleOpeningWindows({...person,id:"invalid"},business),null);
  business.days[0].intervals=[{start:"23:00",end:"09:00"}];
  assert.equal(eligibleOpeningWindows(person,business),null);
});

test("A derivação não modifica as horas registadas na empresa",()=>{
  const business=suggestedWeeklyOpeningHours();
  const windows=eligibleOpeningWindows(person,business);
  assert.ok(windows);
  windows.days[0].intervals[0].start="12:00";
  assert.equal(business.days[0].intervals[0].start,"09:00");
});
