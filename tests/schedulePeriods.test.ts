import test from "node:test";
import assert from "node:assert/strict";
import {
  addCivilDays,daysBetween,enumerateCivilDays,parseCivilDate,
  resolvePlanningPeriod,
} from "../src/schedulePeriods";

test("7, 14, 21 e 28 dias são semanas completas de segunda a domingo",()=>{
  for(const [mode,length,count] of [
    ["weekly",7,1],["14d",14,2],["21d",21,3],["28d",28,4],
  ] as const){
    const p=resolvePlanningPeriod({mode,start:"2026-11-02"});
    assert.equal(daysBetween(p.start,p.endExclusive),length);
    assert.equal(p.weeks.length,count);
    assert.equal(p.validation.start,p.start);
    assert.equal(p.validation.endExclusive,p.endExclusive);
    assert.equal(p.weeks[0].start,"2026-11-02");
    assert.equal(p.weeks.at(-1)?.endExclusive,p.endExclusive);
  }
});

test("Períodos de duração fixa não começam a meio da semana",()=>{
  assert.throws(()=>resolvePlanningPeriod({mode:"14d",start:"2026-11-01"}));
  assert.throws(()=>resolvePlanningPeriod({mode:"weekly",start:"2026-11-03"}));
});

test("Novembro 2026 só edita novembro, mas observa outubro e dezembro",()=>{
  const p=resolvePlanningPeriod({mode:"monthly",year:2026,month:11});
  assert.deepEqual([p.start,p.endExclusive],["2026-11-01","2026-12-01"]);
  assert.deepEqual([p.validation.start,p.validation.endExclusive],
    ["2026-10-26","2026-12-07"]);
  assert.equal(p.weeks.length,6);
  assert.deepEqual(p.weeks[0],{start:"2026-10-26",endExclusive:"2026-11-02"});
  assert.deepEqual(p.weeks[5],{start:"2026-11-30",endExclusive:"2026-12-07"});
});

test("Fevereiro bissexto e mês alinhado mantêm limites civis corretos",()=>{
  const leap=resolvePlanningPeriod({mode:"monthly",year:2028,month:2});
  assert.equal(daysBetween(leap.start,leap.endExclusive),29);
  assert.equal(leap.validation.start,"2028-01-31");
  const feb=resolvePlanningPeriod({mode:"monthly",year:2021,month:2});
  assert.equal(feb.start,"2021-02-01");
  assert.equal(feb.endExclusive,"2021-03-01");
  assert.equal(feb.validation.start,feb.start);
  assert.equal(feb.validation.endExclusive,feb.endExclusive);
  assert.equal(feb.weeks.length,4);
});

test("Datas civis são estritas e independentes do relógio local",()=>{
  for(const invalid of ["2026-02-29","2026-13-01","2026-00-20",
    "2026-11-31","2026-1-01","2026-11-1","0000-01-01"]){
    assert.throws(()=>parseCivilDate(invalid),invalid);
  }
  assert.equal(addCivilDays("2026-12-31",1),"2027-01-01");
  assert.equal(addCivilDays("2026-03-01",-1),"2026-02-28");
  assert.equal(enumerateCivilDays({start:"2026-11-29",endExclusive:"2026-12-02"}).join(","),
    "2026-11-29,2026-11-30,2026-12-01");
});

test("Um modo de período desconhecido falha explicitamente",()=>{
  assert.throws(()=>resolvePlanningPeriod({
    mode:"45d",start:"2026-11-02",
  } as unknown as Parameters<typeof resolvePlanningPeriod>[0]),/Modo de cálculo inválido/);
});
