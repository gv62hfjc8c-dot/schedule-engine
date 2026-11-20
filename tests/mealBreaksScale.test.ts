import test from "node:test";
import assert from "node:assert/strict";
import {performance} from "node:perf_hooks";
import {generateSchedule} from "../src/generateSchedule";
import {WEEKDAYS} from "../src/operatingHours";
import {
  assignmentMinutes,clockMinutes,type WorkAssignment,
} from "../src/workAssignments";
import {addCivilDays,civilDayOfWeek} from "../src/schedulePeriods";

test("Um turno com pausa interna e cobertura em 2, 10, 50 e 200 pessoas",()=>{
  for(const size of [2,10,50,200]){
    const input={
      period:{mode:"28d" as const,start:"2026-11-02"},
      team:{members:Array.from({length:size},(_,i)=>({
        id:"00000000-0000-4000-8000-"+String(i+1).padStart(12,"0"),
        name:"Pessoa "+i,active:true,
        weeklyDaysOff:size===2?1:i%2===0?1:2,
      }))},
      openingHours:{days:WEEKDAYS.map(({id},i)=>({
        day:id,
        intervals:i===6?[]:
          i===5?[{start:"09:00",end:"13:00"}]:
          [{start:"09:00",end:"19:00"}],
      }))},
      mealBreakPolicy:"v2" as const,
    };
    const snapshot=JSON.stringify(input);
    const start=performance.now();
    const out=generateSchedule(input);
    const elapsed=performance.now()-start;
    assert.equal(out.status,"valid",
      size+" pessoas: "+JSON.stringify(out.certification.issues.slice(0,5)));
    assert.equal(out.certification.status,"valid");
    assert.ok(out.certification.weeks.every(w=>
      w.complete && w.actualMinutes===2400));
    const seen=new Set<string>();
    let mealCount=0;
    for(const assignment of out.candidateAssignments){
      const key=assignment.memberId+"|"+assignment.date;
      assert.ok(!seen.has(key),"Um turno por pessoa/dia: "+key);
      seen.add(key);
      const minutes=assignmentMinutes(assignment);
      if(minutes<=240){
        assert.equal(assignment.mealBreak,undefined);
        assert.equal(civilDayOfWeek(assignment.date),5);
        assert.deepEqual([assignment.start,assignment.end],["09:00","13:00"]);
      }else{
        assert.ok(assignment.mealBreak,"Falta pausa interna: "+key);
        mealCount++;
        const meal=assignment.mealBreak!;
        assert.equal(clockMinutes(meal.end)-clockMinutes(meal.start),60);
        assert.ok(clockMinutes(meal.start)>=clockMinutes(assignment.start)+180);
      }
    }
    for(const [i,member] of input.team.members.entries()){
      for(let week=0;week<4;week++){
        const monday=addCivilDays("2026-11-02",7*week);
        const end=addCivilDays(monday,7);
        const shifts=out.candidateAssignments.filter(a=>
          a.memberId===member.id && a.date>=monday && a.date<end);
        assert.equal(shifts.reduce((sum,a)=>sum+assignmentMinutes(a),0),2400);
        assert.equal(new Set(shifts.map(a=>a.date)).size,
          size===2||i%2===0?6:5);
      }
    }
    assert.equal(JSON.stringify(input),snapshot);
    console.log("MEAL_COVERAGE_SCALE_DIAGNOSTIC "+JSON.stringify({
      teamSize:size,days:28,shifts:out.candidateAssignments.length,
      meals:mealCount,elapsedMs:Math.round(elapsed*100)/100,
    }));
  }
});

test("Configuração de folgas que deixa a empresa sem cobertura fica inválida",()=>{
  const input={
    period:{mode:"weekly" as const,start:"2026-11-02"},
    team:{members:Array.from({length:2},(_,i)=>({
      id:"00000000-0000-4000-8000-"+String(i+1).padStart(12,"0"),
      name:"Pessoa "+i,active:true,weeklyDaysOff:2,
    }))},
    openingHours:{days:WEEKDAYS.map(({id},i)=>({
      day:id,intervals:i===6?[]:
        i===5?[{start:"09:00",end:"13:00"}]:
        [{start:"09:00",end:"19:00"}],
    }))},
    mealBreakPolicy:"v2" as const,
  };
  const out=generateSchedule(input);
  assert.equal(out.status,"invalid");
  assert.ok(out.certification.issues.some(i=>
    i.code==="OPENING_UNCOVERED"));
  assert.ok(out.certification.weeks.every(w=>w.actualMinutes===2400),
    "40h não justificam ausência de trabalhadores durante a abertura");
});
