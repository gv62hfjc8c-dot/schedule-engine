import test from "node:test";
import assert from "node:assert/strict";
import {shortOpeningDays} from "../src/shortOpenings";
import {generateSchedule} from "../src/generateSchedule";
import {certifySchedule} from "../src/certifySchedule";
import {suggestedWeeklyOpeningHours} from "../src/operatingHours";
import {assignmentMinutes,effectiveWorkIntervals} from "../src/workAssignments";
import {saveMonthlyDraft,loadMonthlyDraft} from "../src/monthlyScheduleDraftRepository";
import type {WorkAssignment} from "../src/workAssignments";

const IDS=Array.from({length:4},(_,i)=>
  "00000000-0000-4000-8000-"+String(i+1).padStart(12,"0"));

function weeklyHours() {
  const hours=suggestedWeeklyOpeningHours();
  for(let i=0;i<7;i++)
    hours.days[i].intervals=i===6
      ?[{start:"14:00",end:"19:00"}]
      :[{start:"08:30",end:"19:00"}];
  return hours;
}
function input(weeklyDaysOff=[1,2,2,2]) {
  return {
    period:{mode:"weekly" as const,start:"2026-11-16"},
    team:{members:IDS.map((id,i)=>({
      id,name:"Teste "+(i+1),active:true,weeklyDaysOff:weeklyDaysOff[i],
    }))},
    openingHours:weeklyHours(),
    mealBreakPolicy:"v2" as const,
  };
}
function covered(shifts:readonly WorkAssignment[],date:string,start:number,end:number){
  const work=shifts.filter(s=>s.date===date)
    .flatMap(effectiveWorkIntervals);
  for(let minute=start;minute<end;minute++)
    assert.ok(work.some(s=>s.start<=minute&&minute<s.end),
      "Sem cobertura em "+date+" às "+minute+"min");
}

test("Jornada curta de 5h é inferida da abertura semanal, sem codificar domingo",()=>{
  const hours=weeklyHours();
  assert.deepEqual([...shortOpeningDays(hours)],[6]);
  const swapped=weeklyHours();
  swapped.days[2].intervals=[{start:"14:00",end:"19:00"}];
  swapped.days[6].intervals=[{start:"08:30",end:"19:00"}];
  assert.deepEqual([...shortOpeningDays(swapped)],[2]);
  // 8h de abertura não se confundem com 5h e ainda exigem refeição.
  swapped.days[2].intervals=[{start:"08:30",end:"16:30"}];
  assert.deepEqual([...shortOpeningDays(swapped)],[]);
});

test("Cenário real: todos os quatro escalados domingo fazem 14h-19h, não 14h-18h/15h-19h",()=>{
  const config=input();
  const snapshot=JSON.stringify(config);
  const out=generateSchedule(config);
  assert.equal(out.status,"valid",
    "Conflitos: "+JSON.stringify(out.certification.issues.slice(0,12)));
  const sunday="2026-11-22";
  const work=out.candidateAssignments.filter(a=>a.date===sunday);
  assert.equal(work.length,4);
  assert.deepEqual(work.map(a=>[a.start,a.end]),
    Array.from({length:4},()=>["14:00","19:00"]));
  for(const shift of work){
    assert.equal(assignmentMinutes(shift),300);
    assert.equal(shift.mealBreak,undefined);
  }
  for(const summary of out.certification.weeks)
    assert.equal(summary.actualMinutes,2400);
  covered(out.candidateAssignments,sunday,14*60,19*60);
  for(let i=0;i<6;i++){
    const date="2026-11-"+String(16+i).padStart(2,"0");
    covered(out.candidateAssignments,date,8*60+30,19*60);
  }
  assert.equal(JSON.stringify(config),snapshot);
  assert.deepEqual(out,generateSchedule(config));
});

test("Certificador rejeita autonomamente 14h-18h ou 15h-19h no domingo curto",()=>{
  const config=input();
  const out=generateSchedule(config);
  const sunday="2026-11-22";
  const sundayShift=out.candidateAssignments.find(a=>a.date===sunday)!;
  assert.ok(sundayShift,"Espera-se alguém escalado ao domingo");
  for(const partial of [
    {...sundayShift,start:"15:00"},
    {...sundayShift,end:"18:00"},
    {...sundayShift,start:"14:30",end:"18:30"},
  ]){
    const assignments=out.candidateAssignments.map(a=>
      a===sundayShift?partial:a);
    const result=certifySchedule({...config,candidateAssignments:assignments});
    assert.equal(result.status,"invalid");
    assert.ok(result.issues.some(i=>
      i.code==="SHORT_OPENING_INCOMPLETE" &&
      i.date===sunday && i.memberId===sundayShift.memberId &&
      i.requiredMinutes===300 && i.actualMinutes===240));
  }
});

test("Armazenamento de proposta mensal admite turno completo de 5h sem refeição",()=>{
  const storage=new Map<string,string>();
  const local={
    getItem:(key:string)=>storage.get(key)??null,
    setItem:(key:string,value:string)=>{storage.set(key,value);},
    removeItem:(key:string)=>{storage.delete(key);},
  };
  const assignments:WorkAssignment[]=[
    {memberId:IDS[0],date:"2026-11-22",start:"14:00",end:"19:00"},
  ];
  const saved=saveMonthlyDraft(local,2026,11,assignments,null,undefined,"v2");
  assert.equal(saved.ok,true);
  const restored=loadMonthlyDraft(local,2026,11);
  assert.equal(restored.status,"loaded");
  if(restored.status==="loaded"){
    assert.deepEqual(restored.assignments,assignments);
    assert.equal(restored.mealBreakPolicy,"v2");
  }
});
