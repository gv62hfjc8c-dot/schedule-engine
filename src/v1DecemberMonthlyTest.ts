import type {DatedWorkShift,Person,PersonAvailability,WeeklyOperatingHours} from "./types";
import {WEEKDAYS} from "./utils/operatingCalendar";
import {INITIAL_WORK_CONSTRAINTS} from "./utils/workConstraints";
import {createEmptyWeeklyPresenceRequirements} from "./utils/presence";
import {generateConstrainedPeriodSchedule,MAX_CONSTRAINED_PERIOD_DAYS,
  type GenerateConstrainedPeriodInput} from "./utils/constrainedPeriodGenerator";
import {certifyFinalGeneratedSchedule} from "./utils/finalScheduleCertification";
import {validateRequiredWeeklyTargets,provenRequiredWeeklyTargetShortage}
  from "./utils/requiredWeeklyTargets";

function assert(condition:unknown,message:string):asserts condition {
  if(!condition)throw Error("V1 DECEMBER: "+message);
}
const openDays=new Set(["monday","tuesday","wednesday","thursday","friday"]);
const hours=Object.fromEntries(WEEKDAYS.map(day=>[
  day,openDays.has(day)?[{start:"09:00",end:"19:00"}]:[],
])) as WeeklyOperatingHours;
const people:Person[]=Array.from({length:8},(_,i)=>({
  id:"worker-"+String(i+1).padStart(2,"0"),name:"Colaborador "+(i+1),
  active:true,weeklyContractMinutes:2400,weeklyTargetMinutes:2400,
}));
const availabilities:PersonAvailability[]=people.map(p=>({
  personId:p.id,weeklyAvailability:structuredClone(hours),exceptions:[],
}));
const shift=(date:string,p:Person,i:number):DatedWorkShift=>({
  date,personId:p.id,
  interval:i<4?{start:"09:00",end:"18:00"}:{start:"10:00",end:"19:00"},
  mealBreak:i<4?{start:"12:00",end:"13:00"}:{start:"13:00",end:"14:00"},
});
const outside=[...people.map((p,i)=>shift("2026-11-30",p,i)),
  ...people.map((p,i)=>shift("2027-01-01",p,i))];
const input:GenerateConstrainedPeriodInput={
  startDate:"2026-12-01",endDate:"2026-12-31",timeZone:"Atlantic/Azores",
  people,availabilities,operatingCalendar:{weeklyOperatingHours:hours,exceptions:[]},
  workRules:{standardShiftDurationMinutes:480,maximumDailyEffectiveMinutes:480,
    requireShiftsOnAvailableDays:true,requireWeeklyTargetsAsMinimum:true},
  workConstraints:structuredClone(INITIAL_WORK_CONSTRAINTS),
  presence:{weeklyPresenceRequirements:createEmptyWeeklyPresenceRequirements(),
    presenceExceptions:[]},
  externalContext:{startDate:"2026-11-30",endDate:"2027-01-03",
    completeOutsideTarget:true,shifts:outside},
  maxSearchNodes:5000,
};
assert(MAX_CONSTRAINED_PERIOD_DAYS===31,"O motor deve permitir 31 dias.");
const original=JSON.stringify(input);
const result=generateConstrainedPeriodSchedule(input);
assert(JSON.stringify(input)===original,"Não mutar as entradas da simulação.");
assert(result.status==="generated",
  "Mês completo viável não pode ficar por gerar: "+result.status+": "+result.issues.join(" "));
assert(result.assignments.length===184,
  "Dezembro tem 23 dias úteis × 8 colaboradores = 184 turnos.");
assert(result.days.length===31,"Os 31 dias civis devem constar do resultado.");
assert(result.exploredNodes===0,"A construção simples deve dispensar pesquisa combinatória.");
assert(certifyFinalGeneratedSchedule(input,result.assignments).valid,
  "O certificador independente tem de aprovar a proposta mensal.");
const minimum=validateRequiredWeeklyTargets(input,result.assignments);
assert(minimum.valid && minimum.deficits.length===0,
  "Todas as semanas civis, incluindo as fronteiras Nov/Jan, exigem 40h.");
for(const person of people){
  assert(result.assignments.filter(s=>s.personId===person.id).length===23,
    "Cada colaborador deve trabalhar todos os 23 dias úteis de dezembro.");
}
console.log("V1 December PASS: 31 civil days, 184 shifts, 8 workers, mandatory 40h with external context.");

// A SOFT preference does not silently become a HARD requirement.
const missing=result.assignments.filter(s=>!(s.personId===people[0].id && s.date==="2026-12-07"));
const softInput={...input,workRules:{...input.workRules,
  requireShiftsOnAvailableDays:false,requireWeeklyTargetsAsMinimum:false}};
assert(certifyFinalGeneratedSchedule(softInput,missing).valid,
  "Um objetivo SOFT não pode ser confundido com o mínimo obrigatório.");
const hardInput={...input,workRules:{...input.workRules,
  requireShiftsOnAvailableDays:false,requireWeeklyTargetsAsMinimum:true}};
const rejected=certifyFinalGeneratedSchedule(hardInput,missing);
assert(!rejected.valid && rejected.issues.some(issue=>issue.includes("Horas semanais obrigatórias")),
  "O certificador independente deve rejeitar horas HARD em falta.");

// A month cannot claim compliance if boundary weeks were attested as empty.
const noOutside={...input,externalContext:{...input.externalContext,shifts:[]}};
assert(provenRequiredWeeklyTargetShortage(noOutside)?.includes("Inviabilidade semanal comprovada")===true,
  "Com 30/11 em falta, quatro dias de dezembro não perfazem as 40 horas.");
const missingBoundary=generateConstrainedPeriodSchedule(noOutside);
assert(missingBoundary.status==="incomplete" &&
  missingBoundary.assignments.length===0 && missingBoundary.exploredNodes===0,
  "Semana parcial inviável deve ser rejeitada antes da pesquisa, sem proposta.");
assert(!certifyFinalGeneratedSchedule(noOutside,result.assignments).valid,
  "O certificador não pode confiar num mês ignorando as horas exteriores.");
const tooLong=generateConstrainedPeriodSchedule({...input,endDate:"2027-01-01"});
assert(tooLong.status==="invalid_input","32 dias são explicitamente rejeitados.");
console.log("V1 December PASS: hard vs soft, independent rejection and boundary safeguards.");
