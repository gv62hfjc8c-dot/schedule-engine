import test from "node:test";
import assert from "node:assert/strict";
import {
  restRecordsFromRotation,validatePlannedRest,
  type PlannedRestWeekMember,
} from "../src/plannedRest";
import {
  loadMonthlyDraft,saveMonthlyDraft,monthlyDraftKey,
  readPriorRollingHistory,readExternalMonthlyContext,
} from "../src/monthlyScheduleDraftRepository";
import {generateSchedule} from "../src/generateSchedule";
import {suggestedWeeklyOpeningHours} from "../src/operatingHours";

const IDS=Array.from({length:4},(_,i)=>
  "00000000-0000-4000-8000-"+String(i+1).padStart(12,"0"));
function scenario(){
  const openingHours=suggestedWeeklyOpeningHours();
  openingHours.days.forEach((day,index)=>day.intervals=
    index===6?[{start:"14:00",end:"19:00"}]:
      [{start:"08:30",end:"19:00"}]);
  return {
    period:{mode:"monthly" as const,year:2026,month:11},
    team:{members:IDS.map((id,i)=>({
      id,name:"Pessoa "+i,active:true,weeklyDaysOff:2,
      weekendRest:{minimumWeekdayDaysOffOnFullWeekend:1},
    }))},
    openingHours,mealBreakPolicy:"v2" as const,
    hoursPolicy:"rolling28" as const,
  };
}
function storage(){
  const map=new Map<string,string>();
  return {map,getItem(key:string){return map.get(key)??null;},
    setItem(key:string,value:string){map.set(key,value);}};
}

test("descanso explícito sobrevive à gravação e ao reload sem recriar folgas",()=>{
  const data=scenario();
  const generated=generateSchedule(data);
  assert.equal(generated.status,"insufficient_context",
    JSON.stringify(generated.certification.issues.slice(0,6)));
  assert.equal(generated.rotation?.status,"planned");
  const rest=restRecordsFromRotation(generated.rotation!);
  assert.equal(rest.length,16);
  const s=storage();
  const result=saveMonthlyDraft(s,2026,11,
    generated.candidateAssignments,null,undefined,"v2","rolling28",rest);
  assert.equal(result.ok,true);
  const loaded=loadMonthlyDraft(s,2026,11);
  assert.equal(loaded.status,"loaded");
  if(loaded.status!=="loaded")return;
  assert.deepEqual(loaded.rotationRest,rest);
  assert.deepEqual(loaded.assignments,generated.candidateAssignments);
  const raw=s.map.get(monthlyDraftKey(2026,11));
  assert.ok(raw?.includes('"rotationRest"'));
});

test("um dia com turno não pode simultaneamente ser guardado como descanso",()=>{
  const data=scenario();
  const generated=generateSchedule(data);
  const rest=restRecordsFromRotation(generated.rotation!);
  const item=rest[0];
  const shift=generated.candidateAssignments.find(
    x=>x.memberId===item.memberId&&x.date.startsWith("2026-11"))!;
  const conflicting=rest.map(row=>row===item
    ?{...row,daysWithoutWork:[...row.daysWithoutWork,shift.date]}:row);
  assert.equal(validatePlannedRest(conflicting,2026,11,
    generated.candidateAssignments),null);
  const s=storage();
  const bad=saveMonthlyDraft(s,2026,11,
    generated.candidateAssignments,null,undefined,"v2","rolling28",conflicting);
  assert.equal(bad.ok,false);
  assert.equal(s.map.size,0,"não pode persistir metadados inconsistentes");
});

test("metadados guardados adulterados bloqueiam leitura sem apagar o horário",()=>{
  const data=scenario();
  const generated=generateSchedule(data);
  const s=storage();
  const rest=restRecordsFromRotation(generated.rotation!);
  const saved=saveMonthlyDraft(s,2026,11,
    generated.candidateAssignments,null,undefined,"v2","rolling28",rest);
  assert.equal(saved.ok,true);
  const key=monthlyDraftKey(2026,11);
  const before=s.map.get(key)!;
  const tampered=JSON.parse(before) as {
    rotationRest:PlannedRestWeekMember[];
  };
  tampered.rotationRest[0].daysWithoutWork.push("2026-12-01");
  s.setItem(key,JSON.stringify(tampered));
  assert.equal(loadMonthlyDraft(s,2026,11).status,"invalid");
  assert.ok(s.map.get(key)?.includes("2026-12-01"),
    "a leitura inválida nunca apaga automaticamente os dados");
});

test("um rascunho v2 antigo sem descanso explícito continua legível",()=>{
  const s=storage();
  const saved=saveMonthlyDraft(s,2026,11,[],null,
    undefined,"v2","rolling28");
  assert.equal(saved.ok,true);
  const loaded=loadMonthlyDraft(s,2026,11);
  assert.equal(loaded.status,"loaded");
  if(loaded.status==="loaded")
    assert.equal(loaded.rotationRest,undefined);
});

test("o descanso de um mês não cria alterações nos meses vizinhos",()=>{
  const s=storage();
  const generated=generateSchedule(scenario());
  const rest=restRecordsFromRotation(generated.rotation!);
  const saved=saveMonthlyDraft(s,2026,11,
    generated.candidateAssignments,null,undefined,"v2","rolling28",rest);
  assert.equal(saved.ok,true);
  assert.equal(s.getItem(monthlyDraftKey(2026,10)),null);
  assert.equal(s.getItem(monthlyDraftKey(2026,12)),null);
});

test("dezembro continua a equidade com fins de semana EXPLICITAMENTE guardados em novembro",()=>{
  const source=scenario();
  const november=generateSchedule(source);
  assert.equal(november.rotation?.status,"planned");
  const s=storage();
  const records=restRecordsFromRotation(november.rotation!);
  assert.equal(saveMonthlyDraft(s,2026,11,november.candidateAssignments,
    null,undefined,"v2","rolling28",records).ok,true);
  const prior=readPriorRollingHistory(s,2026,12);
  assert.equal(prior.ok,true);
  if(!prior.ok)return;
  const fromRest=records.filter(r=>r.fullWeekendOff).map(r=>({
    memberId:r.memberId,weekStart:r.weekStart,
  }));
  assert.deepEqual(prior.context.plannedFullWeekends,fromRest);
  const external=readExternalMonthlyContext(s,2026,12);
  assert.equal(external.ok,true);
  if(!external.ok)return;
  const next=generateSchedule({
    ...source,period:{mode:"monthly",year:2026,month:12},
    hoursHistory:prior.context,externalContext:external.context,
  });
  assert.equal(next.rotation?.historyProvided,true);
  assert.ok(next.rotation!.weekendCounts.some(c=>c.prior>0));
  assert.ok(next.candidateAssignments.every(s=>s.date.startsWith("2026-12-")));
  const restored=loadMonthlyDraft(s,2026,11);
  assert.equal(restored.status,"loaded",
    "o planeamento de dezembro nunca altera a proposta de novembro");
});

test("um mês antigo sem registos explícitos não cria fins de semana fictícios no histórico",()=>{
  const s=storage();
  assert.equal(saveMonthlyDraft(s,2026,11,[],null,
    undefined,"v2","rolling28").ok,true);
  const prior=readPriorRollingHistory(s,2026,12);
  assert.equal(prior.ok,true);
  if(prior.ok)assert.equal(prior.context.plannedFullWeekends,undefined);
});
