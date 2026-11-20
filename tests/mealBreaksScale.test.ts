import test from "node:test";
import assert from "node:assert/strict";
import {performance} from "node:perf_hooks";
import {generateSchedule} from "../src/generateSchedule";
import {WEEKDAYS} from "../src/operatingHours";
import {assignmentMinutes,clockMinutes} from "../src/workAssignments";
import {addCivilDays,civilDayOfWeek} from "../src/schedulePeriods";

test("Pausas de refeição e 40h com 2, 10, 50 e 200 colaboradores",()=>{
  for(const size of [2,10,50,200]){
    const input={
      period:{mode:"28d" as const,start:"2026-11-02"},
      team:{members:Array.from({length:size},(_,i)=>({
        id:"00000000-0000-4000-8000-"+String(i+1).padStart(12,"0"),
        name:"Pessoa "+i,active:true,weeklyDaysOff:i%2===0?1:2,
      }))},
      openingHours:{days:WEEKDAYS.map(({id},i)=>({
        day:id,
        intervals:i===6?[]:
          i===5?[{start:"09:00",end:"13:00"}]:
          [{start:"09:00",end:"19:00"}],
      }))},
      mealBreakPolicy:"v1" as const,
    };
    const snapshot=JSON.stringify(input);
    const started=performance.now();
    const result=generateSchedule(input);
    const elapsedMs=performance.now()-started;
    assert.equal(result.status,"valid",size+" pessoas");
    assert.ok(result.certification.weeks.every(w=>
      w.complete&&w.actualMinutes===2400));
    const intervalsByDay=new Map<string,typeof result.candidateAssignments>();
    for(const a of result.candidateAssignments){
      const key=a.memberId+"|"+a.date;
      intervalsByDay.set(key,[...(intervalsByDay.get(key)??[]),a]);
    }
    const mealsByDay=new Map<string,typeof result.mealBreaks>();
    for(const meal of result.mealBreaks){
      const key=meal.memberId+"|"+meal.date;
      mealsByDay.set(key,[...(mealsByDay.get(key)??[]),meal]);
    }
    for(const [key,work] of intervalsByDay){
      const minutes=work.reduce((sum,a)=>sum+assignmentMinutes(a),0);
      const meals=mealsByDay.get(key)??[];
      const date=work[0].date;
      if(minutes<=240){
        assert.equal(meals.length,0);
        assert.equal(civilDayOfWeek(date),5);
        assert.deepEqual(work.map(a=>[a.start,a.end]),[["09:00","13:00"]]);
      }else{
        assert.equal(meals.length,1,key);
        const earliest=Math.min(...work.map(a=>clockMinutes(a.start)));
        assert.ok(clockMinutes(meals[0].start)>=earliest+180);
        assert.equal(clockMinutes(meals[0].end)-
          clockMinutes(meals[0].start),60);
      }
    }
    for(const [i,member] of input.team.members.entries()){
      for(let week=0;week<4;week++){
        const monday=addCivilDays("2026-11-02",7*week);
        const end=addCivilDays(monday,7);
        const work=result.candidateAssignments.filter(a=>
          a.memberId===member.id&&a.date>=monday&&a.date<end);
        assert.equal(work.reduce((sum,a)=>sum+assignmentMinutes(a),0),2400);
        assert.equal(new Set(work.map(a=>a.date)).size,i%2===0?6:5);
      }
    }
    assert.equal(JSON.stringify(input),snapshot);
    console.log("MEAL_BREAKS_SCALE_DIAGNOSTIC "+JSON.stringify({
      people:size,days:28,workSegments:result.candidateAssignments.length,
      mealBreaks:result.mealBreaks.length,
      milliseconds:Math.round(elapsedMs*100)/100,
    }));
  }
});
