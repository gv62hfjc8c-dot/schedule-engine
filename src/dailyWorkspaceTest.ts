const assert={
  match:(text:string,pattern:RegExp)=>{if(!pattern.test(text))throw Error("Expected "+pattern+" in "+text);},
  equal:(actual:unknown,expected:unknown,message="Values differ")=>{if(actual!==expected)throw Error(message+": "+actual+" != "+expected);},
  notEqual:(actual:unknown,expected:unknown)=>{if(actual===expected)throw Error("Values unexpectedly equal");},
};
import {renderToStaticMarkup} from "react-dom/server";
import {createElement} from "react";
import DailyShiftDetails from "./components/DailyShiftDetails";
import {addCivilDays,monthStart} from "./utils/monthlyScheduleView";

const continuous=createElement(DailyShiftDetails,{
  shift:{date:"2026-01-06",personId:"p1",
    interval:{start:"09:30",end:"19:15"},
    mealBreak:{start:"13:00",end:"14:00"}},
  effectiveHours:"8,75h efetivas",
});
const markup=renderToStaticMarkup(continuous);
assert.match(markup,/09:30–19:15/);
assert.match(markup,/13:00–14:00/);
assert.match(markup,/8,75h efetivas/);
assert.equal((markup.match(/class="daily-shift-time"/g)??[]).length,2,
  "A refeição pertence ao mesmo turno, não cria novo turno.");
const noMeal=renderToStaticMarkup(createElement(DailyShiftDetails,{
  shift:{date:"2026-01-06",personId:"p1",
    interval:{start:"14:00",end:"19:15"},mealBreak:null},
}));
assert.match(noMeal,/Sem pausa registada/);
const unknown=renderToStaticMarkup(createElement(DailyShiftDetails,{
  shift:null,emptyLabel:"Sem horário",
}));
assert.match(unknown,/Sem horário/);
assert(!unknown.includes("Folga"),"Um turno desconhecido não é folga.");
assert.equal(addCivilDays("2026-01-31",1),"2026-02-01");
assert.notEqual(monthStart(addCivilDays("2026-01-31",1)),monthStart("2026-01-31"));
console.log("Daily workspace: meal-window breakdown, no invented days off, and civil-day boundary PASS.");
