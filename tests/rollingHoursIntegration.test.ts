import test from "node:test";
import assert from "node:assert/strict";
import {rollingWeekGuidance} from "../src/rollingHoursPlan";
import {addCivilDays,enumerateCivilDays} from "../src/schedulePeriods";
import {readPriorRollingHistory,loadMonthlyDraft,saveMonthlyDraft,monthlyDraftKey} from "../src/monthlyScheduleDraftRepository";
import {generateSchedule} from "../src/generateSchedule";
import {certifySchedule} from "../src/certifySchedule";
import {suggestedWeeklyOpeningHours} from "../src/operatingHours";
import {assignmentMinutes,type WorkAssignment} from "../src/workAssignments";

const IDS=Array.from({length:4},(_,i)=>
  "00000000-0000-4000-8000-"+String(i+1).padStart(12,"0"));
const ANCHOR="2026-11-16";
const before21=enumerateCivilDays({
  start:addCivilDays(ANCHOR,-21),endExclusive:ANCHOR,
});
function historyFor(preceding21Minutes:number){
  const completeDates=before21;
  const values=new Map<string,number>();
  let remaining=preceding21Minutes;
  for(const date of completeDates){
    const assigned=Math.min(480,remaining);
    values.set(IDS[0]+"|"+date,assigned);
    remaining-=assigned;
  }
  if(remaining>0)throw Error("scenario exceeds 21 days");
  return {completeDates:new Set(completeDates),values};
}

test("42/38 horas são decisões de equilíbrio, não novos limites semanais",()=>{
  const forty=historyFor(120*60);
  const result=rollingWeekGuidance(ANCHOR,IDS[0],forty.completeDates,forty.values);
  assert.equal(result.targetMinutes,40*60);
  assert.equal(result.contextComplete,true);
  const thirtyEight=historyFor(118*60);
  assert.equal(rollingWeekGuidance(ANCHOR,IDS[0],
    thirtyEight.completeDates,thirtyEight.values).targetMinutes,42*60);
  const fortyTwo=historyFor(122*60);
  assert.equal(rollingWeekGuidance(ANCHOR,IDS[0],
    fortyTwo.completeDates,fortyTwo.values).targetMinutes,38*60);
});

test("sem 21 dias conhecidos o gerador usa 40h, não inventa saldo",()=>{
  const history=historyFor(118*60);
  history.completeDates.delete(before21[0]);
  const out=rollingWeekGuidance(ANCHOR,IDS[0],
    history.completeDates,history.values);
  assert.equal(out.contextComplete,false);
  assert.equal(out.targetMinutes,40*60);
  assert.equal(out.preceding21Minutes,null);
});

test("desvio extremo é suavizado somente na otimização",()=>{
  const few=historyFor(100*60);
  const plenty=historyFor(140*60);
  assert.equal(rollingWeekGuidance(ANCHOR,IDS[0],
    few.completeDates,few.values).targetMinutes,44*60);
  assert.equal(rollingWeekGuidance(ANCHOR,IDS[0],
    plenty.completeDates,plenty.values).targetMinutes,36*60);
});

function configuration(){
  const hours=suggestedWeeklyOpeningHours();
  for(let i=0;i<7;i++)
    hours.days[i].intervals=i===6
      ?[{start:"14:00",end:"19:00"}]
      :[{start:"08:30",end:"19:00"}];
  return {
    period:{mode:"weekly" as const,start:ANCHOR},
    team:{members:IDS.map((id,i)=>({
      id,name:"Teste "+(i+1),active:true,weeklyDaysOff:i===0?1:2,
    }))},
    openingHours:hours,mealBreakPolicy:"v2" as const,
    hoursPolicy:"rolling28" as const,
  };
}
function historyAtWeeklyHours(hoursPerWeek:[number,number,number]){
  const start=addCivilDays(ANCHOR,-21);
  const days=enumerateCivilDays({start,endExclusive:ANCHOR});
  const work:WorkAssignment[]=[];
  for(let week=0;week<3;week++){
    const full=hoursPerWeek[week]*60;
    // Five workdays, each with at least 6h and with meals already internal.
    let remaining=full;
    for(let day=0;day<5;day++){
      const index=week*7+day;
      const baseline=Math.floor(full/5/30)*30;
      const extraBlocks=(full-5*baseline)/30;
      const minutes=baseline+(day<extraBlocks?30:0);
      remaining-=minutes;
      const startHour=8*60+30;
      const end=startHour+minutes+60;
      const fmt=(n:number)=>String(Math.floor(n/60)).padStart(2,"0")+
        ":"+String(n%60).padStart(2,"0");
      for(const memberId of IDS)
        work.push({memberId,date:days[index],
          start:fmt(startHour),end:fmt(end),
          mealBreak:{start:"12:00",end:"13:00"}});
    }
    if(remaining!==0)throw Error("unallocated");
  }
  return {completeDates:days,assignments:work};
}

test("gerador V2 usa histórico 38/40/40 para orientar 42h e certifica folgas e refeições",()=>{
  const config=configuration();
  const history=historyAtWeeklyHours([38,40,40]);
  const result=generateSchedule({...config,hoursHistory:history});
  assert.equal(result.status,"valid",
    JSON.stringify(result.certification.issues.slice(0,8)));
  assert.ok(result.certification.weeks.every(w=>w.actualMinutes===42*60),
    JSON.stringify(result.certification.weeks));
  assert.deepEqual(result.shortfalls,[]);
  assert.ok(result.candidateAssignments.every(s=>s.mealBreak||
    (s.date==="2026-11-22"&&s.start==="14:00"&&s.end==="19:00")));
  assert.equal(JSON.stringify(history),JSON.stringify(historyAtWeeklyHours([38,40,40])));
  const legacy=certifySchedule({
    ...config,hoursPolicy:undefined,
    candidateAssignments:result.candidateAssignments,
  });
  assert.equal(legacy.status,"invalid");
  assert.ok(legacy.issues.some(i=>i.code==="WEEKLY_HOURS_EXCESS"));
});

test("gerador V2 usa histórico 42/40/40 para orientar 38h e não oculta a cobertura",()=>{
  const config=configuration();
  const history=historyAtWeeklyHours([42,40,40]);
  const result=generateSchedule({...config,hoursHistory:history});
  assert.equal(result.status,"valid",
    JSON.stringify(result.certification.issues.slice(0,8)));
  assert.ok(result.certification.weeks.every(w=>w.actualMinutes===38*60),
    JSON.stringify(result.certification.weeks));
});

function store(){
  const values=new Map<string,string>();
  return {
    values,getItem(key:string){return values.get(key)??null;},
    setItem(key:string,value:string){values.set(key,value);},
  };
}
test("histórico por mês: outubro legível, dias em falta desconhecidos, sem escritas",()=>{
  const s=store();
  const october=[{memberId:IDS[0],date:"2026-10-31",
    start:"14:00",end:"19:00"}];
  const saved=saveMonthlyDraft(s,2026,10,october,null,undefined,"v2","rolling28");
  assert.equal(saved.ok,true);
  const before=s.values.get(monthlyDraftKey(2026,10));
  const context=readPriorRollingHistory(s,2026,11);
  assert.equal(context.ok,true);
  if(!context.ok)throw Error("context");
  assert.equal(context.context.completeDates.length,27);
  assert.deepEqual(context.context.assignments,october);
  assert.equal(s.values.get(monthlyDraftKey(2026,10)),before);
  const loaded=loadMonthlyDraft(s,2026,10);
  assert.equal(loaded.status,"loaded");
  if(loaded.status==="loaded")assert.equal(loaded.hoursPolicy,"rolling28");
  const unknown=readPriorRollingHistory(s,2026,12);
  assert.equal(unknown.ok,true);
  if(unknown.ok)assert.deepEqual(unknown.context.completeDates,[]);
});
test("política 28d malformada e meses corrompidos são recusados",()=>{
  const s=store();
  assert.equal(saveMonthlyDraft(s,2026,10,[],null,undefined,"v1","rolling28").ok,false);
  s.setItem(monthlyDraftKey(2026,10),JSON.stringify({
    version:1,year:2026,month:10,assignments:[],hoursPolicy:"rolling28",
  }));
  assert.equal(loadMonthlyDraft(s,2026,10).status,"invalid");
  const context=readPriorRollingHistory(s,2026,11);
  assert.equal(context.ok,false);
  if(!context.ok)assert.equal(context.status,"invalid");
});
