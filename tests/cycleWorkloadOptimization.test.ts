import test from "node:test";
import assert from "node:assert/strict";
import {
  optimize28DayWorkload,measure28DayWorkload,type CycleWorkday,
} from "../src/cycleWorkloadOptimization";
import {addCivilDays} from "../src/schedulePeriods";

const start="2026-11-02";
const weeks=Array.from({length:4},(_,i)=>addCivilDays(start,i*7));

function scenario():CycleWorkday[] {
  const days:CycleWorkday[]=[];
  for(let w=0;w<4;w++){
    if(w%2===0){
      // Four 9h30 days: only 38h in this week, but all four >9h.
      for(let d=0;d<4;d++)days.push({
        weekStart:weeks[w],date:addCivilDays(weeks[w],d),
        minutes:570,capacity:570,locked:false,
      });
    }else{
      // Five normal workdays plus a 5h Sunday, 42h in total.
      const minutes=[450,450,450,450,420,300];
      for(let d=0;d<6;d++)days.push({
        weekStart:weeks[w],date:addCivilDays(weeks[w],d===5?6:d),
        minutes:minutes[d],capacity:d===5?300:570,
        locked:d===5,
      });
    }
  }
  return days;
}

test("28 dias: redistribui 160h entre semanas, sem trabalhar um dia adicional",()=>{
  const original=scenario();
  const snapshot=JSON.stringify(original);
  const oldQuality=measure28DayWorkload(original);
  assert.equal(oldQuality.longDays,8);
  const optimized=optimize28DayWorkload(original);
  const next=measure28DayWorkload(optimized);
  assert.equal(next.longDays,0,
    "a capacidade das outras semanas permite eliminar todas as jornadas >9h");
  assert.ok(next.aboveNineMinutes<=oldQuality.aboveNineMinutes);
  assert.ok(next.aboveEightMinutes<=oldQuality.aboveEightMinutes);
  assert.equal(optimized.reduce((sum,day)=>sum+day.minutes,0),9600);
  assert.deepEqual(optimized.map(day=>day.date),original.map(day=>day.date));
  assert.ok(optimized.every((day,i)=>
    day.capacity===original[i].capacity &&
    day.minutes>0 && day.minutes<=day.capacity));
  assert.deepEqual(optimized.filter(d=>d.locked).map(d=>d.minutes),
    original.filter(d=>d.locked).map(d=>d.minutes));
  const totals=weeks.map(w=>optimized.filter(d=>d.weekStart===w)
    .reduce((sum,d)=>sum+d.minutes,0));
  assert.deepEqual(totals,[2160,2640,2160,2640],
    "sem criar novas regras: permitir 36–44h como guarda de otimização");
  assert.equal(JSON.stringify(original),snapshot,"não muta os inputs");
  assert.deepEqual(optimize28DayWorkload(optimized),optimized,
    "uma segunda execução não altera o ótimo atingido");
});

test("mantém dados intactos quando o ciclo não está completo ou as 160h são inviáveis",()=>{
  const input=scenario();
  assert.deepEqual(optimize28DayWorkload(input.slice(0,4)),input.slice(0,4));
  const shortage=input.map(day=>({...day}));
  shortage[0].minutes-=15;
  assert.deepEqual(optimize28DayWorkload(shortage),shortage);
});

test("nunca reduz a folga de domingo curto nem cria nova jornada",()=>{
  const input=scenario();
  const optimized=optimize28DayWorkload(input);
  assert.ok(optimized.filter(day=>day.locked).every(day=>day.minutes===300));
  assert.ok(optimized.every((day,index)=>day.date===input[index].date));
});

test("com todos os dias no limite de capacidade, não inventa horas nem altera 160h",()=>{
  const all=scenario().map(day=>({...day,capacity:day.minutes}));
  const result=optimize28DayWorkload(all);
  assert.deepEqual(result,all);
});
