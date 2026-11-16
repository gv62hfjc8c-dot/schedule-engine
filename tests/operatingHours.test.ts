import test from "node:test";
import assert from "node:assert/strict";
import {WEEKDAYS,suggestedWeeklyOpeningHours,validateWeeklyOpeningHours} from "../src/operatingHours";

const initial=()=>suggestedWeeklyOpeningHours();
test("Semana sugerida é válida mas não implica configuração guardada",()=>{
  const week=initial();
  assert.equal(week.days.length,7);
  assert.equal(week.days.filter(d=>d.intervals.length>0).length,5);
  assert.equal(validateWeeklyOpeningHours(week).valid,true);
});
test("Uma semana aberta todos os dias é válida e distinta dos turnos de pessoas",()=>{
  const week=initial();
  for(const d of week.days)d.intervals=[{start:"08:00",end:"20:00"}];
  const result=validateWeeklyOpeningHours(week);
  assert.equal(result.valid,true);
  if(result.valid)assert.equal(result.value.days.length,WEEKDAYS.length);
});
test("Um dia fechado não gera por si só uma folga ou turno",()=>{
  const week=initial();
  const result=validateWeeklyOpeningHours(week);
  assert.equal(result.valid,true);
  if(result.valid)assert.deepEqual(result.value.days[6].intervals,[]);
});
test("Abertura e encerramento devem ser válidos e no mesmo dia",()=>{
  for(const pair of [
    {start:"19:00",end:"08:00"},
    {start:"08:00",end:"08:00"},
    {start:"25:00",end:"09:00"},
    {start:"09:00",end:"24:00"},
    {start:"10:60",end:"12:00"},
    {start:"9:00",end:"18:00"},
  ]){
    const week=initial();week.days[0].intervals=[pair];
    assert.equal(validateWeeklyOpeningHours(week).valid,false,JSON.stringify(pair));
  }
});
test("É obrigatório existir pelo menos um dia aberto",()=>{
  const week=initial();
  week.days.forEach(d=>{d.intervals=[]});
  const result=validateWeeklyOpeningHours(week);
  assert.equal(result.valid,false);
});
test("Sete dias exatos e sem duplicados, independentemente da ordem",()=>{
  const week=initial();
  week.days.reverse();
  const valid=validateWeeklyOpeningHours(week);
  assert.equal(valid.valid,true);
  if(valid.valid)assert.equal(valid.value.days[0].day,"monday");
  week.days[0].day="monday";
  assert.equal(validateWeeklyOpeningHours(week).valid,false);
  assert.equal(validateWeeklyOpeningHours({days:week.days.slice(1)}).valid,false);
});
test("Períodos adicionais não se podem sobrepor",()=>{
  const week=initial();
  week.days[0].intervals=[
    {start:"09:00",end:"13:00"},{start:"12:00",end:"18:00"},
  ];
  assert.equal(validateWeeklyOpeningHours(week).valid,false);
  week.days[0].intervals=[
    {start:"09:00",end:"13:00"},{start:"13:00",end:"18:00"},
  ];
  assert.equal(validateWeeklyOpeningHours(week).valid,true);
});
test("Dados arbitrários ou inválidos são rejeitados",()=>{
  assert.equal(validateWeeklyOpeningHours(null).valid,false);
  assert.equal(validateWeeklyOpeningHours({}).valid,false);
  const week=initial();
  (week.days[0] as any).intervals="09:00-18:00";
  assert.equal(validateWeeklyOpeningHours(week).valid,false);
  const invalid=initial();
  (invalid.days[0].intervals as unknown[]).push(null);
  assert.equal(validateWeeklyOpeningHours(invalid).valid,false);
});
