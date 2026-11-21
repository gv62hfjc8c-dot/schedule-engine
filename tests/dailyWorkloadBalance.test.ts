import test from "node:test";
import assert from "node:assert/strict";
import {
  balanceLongWorkdays,compareDailyWorkload,dailyWorkloadQuality,
} from "../src/dailyWorkloadBalance";
import {generateSchedule} from "../src/generateSchedule";
import {assignmentMinutes,type WorkAssignment} from "../src/workAssignments";
import {suggestedWeeklyOpeningHours} from "../src/operatingHours";
import {certifySchedule} from "../src/certifySchedule";
import {candidateDayStarts,mealDayOptions} from "../src/mealBreaks";

const IDS=Array.from({length:4},(_,i)=>
  "00000000-0000-4000-8000-"+String(i+1).padStart(12,"0"));

test("oito horas efetivas são preferidas; nove têm penalização e mais de nove têm penalização forte",()=>{
  const desired=dailyWorkloadQuality([480,480,480,480,0]);
  const accepted=dailyWorkloadQuality([540,480,480,420,0]);
  const excessive=dailyWorkloadQuality([570,510,510,510,0]);
  assert.equal(desired.beyondEightMinutes,0);
  assert.equal(accepted.beyondNineMinutes,0);
  assert.equal(accepted.beyondEightMinutes,60);
  assert.equal(excessive.beyondNineMinutes,30);
  assert.ok(compareDailyWorkload(desired,accepted)<0);
  assert.ok(compareDailyWorkload(accepted,excessive)<0);
  assert.equal(compareDailyWorkload(desired,desired),0);
});

test("35 horas em 4 dias longos deixam de produzir 9h30 + 8h30 x 3",()=>{
  const normal=Array.from({length:4},(_,i)=>({
    date:String(i),shortOpening:false,capacity:570,
    allocated:i===0?570:510,
  }));
  const original=JSON.stringify(normal);
  const total=normal.reduce((s,p)=>s+p.allocated,0);
  balanceLongWorkdays(normal);
  assert.equal(total,2100);
  assert.deepEqual(normal.map(p=>p.allocated),[525,525,525,525]);
  assert.equal(normal.reduce((s,p)=>s+p.allocated,0),total);
  assert.notEqual(JSON.stringify(normal),original);
  balanceLongWorkdays(normal);
  assert.deepEqual(normal.map(p=>p.allocated),[525,525,525,525],
    "a otimização é idempotente");
});

test("uma jornada curta completa e duas folgas mantêm-se intactas",()=>{
  const plans=[
    {shortOpening:true,capacity:300,allocated:300},
    {shortOpening:false,capacity:570,allocated:570},
    {shortOpening:false,capacity:570,allocated:510},
    {shortOpening:false,capacity:570,allocated:510},
    {shortOpening:false,capacity:570,allocated:510},
    {shortOpening:false,capacity:570,allocated:0},
    {shortOpening:false,capacity:570,allocated:0},
  ];
  balanceLongWorkdays(plans);
  assert.deepEqual(plans.map(p=>p.allocated),
    [300,525,525,525,525,0,0]);
  assert.equal(plans.reduce((sum,p)=>sum+p.allocated,0),2400);
  assert.equal(plans.filter(p=>p.allocated===0).length,2);
});

test("não redistribui quando todos os dias já estão abaixo do objetivo de 8h",()=>{
  const plans=[
    {shortOpening:false,capacity:570,allocated:480},
    {shortOpening:false,capacity:570,allocated:420},
    {shortOpening:false,capacity:570,allocated:420},
    {shortOpening:false,capacity:570,allocated:420},
    {shortOpening:false,capacity:570,allocated:420},
  ];
  const before=JSON.stringify(plans);
  balanceLongWorkdays(plans);
  assert.equal(JSON.stringify(plans),before);
});

test("sem capacidade ou sem trabalho nesse dia, não inventa jornadas",()=>{
  const plans=[
    {shortOpening:false,capacity:570,allocated:570},
    {shortOpening:false,capacity:510,allocated:510},
    {shortOpening:false,capacity:480,allocated:480},
    {shortOpening:false,capacity:570,allocated:0},
  ];
  balanceLongWorkdays(plans);
  assert.equal(plans[0].allocated,570);
  assert.equal(plans[1].allocated,510);
  assert.equal(plans[2].allocated,480);
  assert.equal(plans[3].allocated,0);
});

function retailScenario(){
  const openingHours=suggestedWeeklyOpeningHours();
  for(const [weekday,day] of openingHours.days.entries()){
    day.intervals=weekday===6
      ?[{start:"14:00",end:"19:00"}]
      :[{start:"08:30",end:"19:00"}];
  }
  return {
    period:{mode:"weekly" as const,start:"2026-11-16"},
    team:{members:IDS.map((id,index)=>({
      id,name:"Pessoa "+(index+1),active:true,weeklyDaysOff:2,
    }))},
    openingHours,mealBreakPolicy:"v2" as const,
    hoursPolicy:"rolling28" as const,
  };
}

test("loja 08h30–19h + domingo 14h–19h: minimizar jornadas longas sem perder cobertura",()=>{
  const data=retailScenario();
  const snapshot=JSON.stringify(data);
  const result=generateSchedule(data);
  assert.equal(result.status,"valid",JSON.stringify(result.certification.issues));
  assert.ok(result.candidateAssignments.length>=20);
  const sunday=result.candidateAssignments.filter(a=>a.date==="2026-11-22");
  assert.ok(sunday.length>0,"pelo menos um colaborador deve cobrir o domingo");
  assert.ok(sunday.every(s=>s.start==="14:00"&&s.end==="19:00"&&!s.mealBreak));
  for(const id of IDS){
    const shifts=result.candidateAssignments.filter(s=>s.memberId===id);
    assert.equal(shifts.length,5,"duas folgas numa semana completa");
    assert.equal(shifts.reduce((sum,a)=>sum+assignmentMinutes(a),0),2400);
    if(shifts.some(s=>s.date==="2026-11-22")){
      const normal=shifts.filter(s=>s.date!=="2026-11-22");
      assert.ok(normal.every(s=>assignmentMinutes(s)<=540),
        "domingo de 5h não deve provocar jornadas de 9h30 evitáveis");
      assert.equal(normal.reduce((sum,a)=>sum+assignmentMinutes(a),0),2100);
    }
  }
  assert.equal(JSON.stringify(data),snapshot,"sem mutação das entradas");
  assert.deepEqual(result,generateSchedule(data),"geração determinística");
  assert.equal(certifySchedule({
    ...data,candidateAssignments:result.candidateAssignments,
  }).status,"valid","o certificador independente continua a ser autoridade");
});

test("jornadas acima de 8h continuam possíveis se o total necessário o exigir",()=>{
  const data=retailScenario();
  const result=generateSchedule(data);
  assert.equal(result.status,"valid");
  const sundayMembers=new Set(result.candidateAssignments
    .filter(s=>s.date==="2026-11-22").map(s=>s.memberId));
  assert.ok(sundayMembers.size>0);
  const mustHaveOver8=result.candidateAssignments.some(s=>
    sundayMembers.has(s.memberId)&&s.date!=="2026-11-22"&&
    assignmentMinutes(s)>480);
  assert.equal(mustHaveOver8,true,
    "o objetivo é negociável, não uma restrição inflexível");
});

test("8h45 efetivas podem acabar exatamente às 19h com entrada 09h15",()=>{
  const opening=[{start:510,end:1140}];
  const defaultStarts=candidateDayStarts(opening);
  assert.ok(!defaultStarts.includes(555),
    "os horários de duração normal continuam a usar posições de meia hora");
  assert.ok(candidateDayStarts(opening,15).includes(555));
  const options=mealDayOptions(IDS[0],"2026-11-16",opening,525);
  const closing=options.filter(shift=>shift.start==="09:15"&&shift.end==="19:00");
  assert.ok(closing.length>0,
    "um dia de 8h45 deve poder cobrir o fecho da loja");
  assert.ok(closing.every(shift=>assignmentMinutes(shift)===525));
});
test("quando a carga de trabalho exige 9h30, o soft objective não elimina o turno",()=>{
  const one=[{shortOpening:false,capacity:570,allocated:570}];
  balanceLongWorkdays(one);
  assert.equal(one[0].allocated,570);
  const quality=dailyWorkloadQuality([570]);
  assert.equal(quality.beyondNineMinutes,30);
  assert.equal(quality.beyondEightMinutes,90);
});
