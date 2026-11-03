import type {
  DatedWorkShift, OperatingCalendarConfiguration, PersonAvailability,
  PresenceConfiguration, TimeInterval, WeeklyOperatingHours,
} from "./types";
import { WEEKDAYS } from "./utils/operatingCalendar";
import { createEmptyWeeklyAvailability } from "./utils/availability";
import { createEmptyWeeklyPresenceRequirements } from "./utils/presence";
import { INITIAL_WORK_CONSTRAINTS } from "./utils/workConstraints";
import {
  approveSchedule,createApprovedScheduleLedger,replaceApprovedSchedule,
  validateApprovedScheduleLedger, type ApprovalEnvironment,
} from "./utils/approvedSchedules";
import { reviseApprovedScheduleForAbsence } from "./utils/partialScheduleRevision";

function assert(ok:boolean,message:string){
  if(!ok)throw new Error(message);
}
const mon="2027-01-04",tue="2027-01-05",at="2027-01-01T10:00:00Z";
const slot:TimeInterval={start:"09:00",end:"13:00"};
const dates=[mon,tue];
const shifts:DatedWorkShift[]=dates.flatMap(date=>["a","b"].map(personId=>({
  date,personId,interval:{...slot},mealBreak:null,
})));
const zero=WEEKDAYS.reduce((week,day)=>{week[day]=[];return week;},
  {} as WeeklyOperatingHours);
const calendar:OperatingCalendarConfiguration={
  weeklyOperatingHours:zero,
  exceptions:dates.map(date=>({date,intervals:[slot]})),
};
const availabilities:PersonAvailability[]=["a","b"].map(personId=>({
  personId,weeklyAvailability:createEmptyWeeklyAvailability(),
  exceptions:dates.map(date=>({date,intervals:[slot]})),
}));
const presence:PresenceConfiguration={
  weeklyPresenceRequirements:createEmptyWeeklyPresenceRequirements(),
  presenceExceptions:dates.map(date=>({date,requirements:{
    minimumAtOpening:1,minimumDuringOperation:1,minimumAtClosing:1,
  }})),
};
const environment:ApprovalEnvironment={
  people:[{id:"a",name:"Anabela",active:true},
    {id:"b",name:"Bruno",active:true}],
  availabilities,operatingCalendar:calendar,presence,
  workConstraints:structuredClone(INITIAL_WORK_CONSTRAINTS),
  workRules:{standardShiftDurationMinutes:480,
    requireShiftsOnAvailableDays:true},
};
const ledger=createApprovedScheduleLedger({
  startDate:"2026-12-28",endDate:"2027-01-11",
},"Atlantic/Azores",true);
const first=approveSchedule({
  ledger,environment,at,expectedVersion:0,
  draft:{id:"initial",startDate:mon,endDate:tue,
    timeZone:"Atlantic/Azores",shifts},
});
assert(first.ok,"O horário inicial deve ser válido.");
if(!first.ok)throw Error("unexpected");
const request={
  sourceId:"initial",revisionId:"revision-2",expectedVersion:1,at,
  personId:"a",startDate:tue,endDate:tue,
  reason:"sick_leave" as const,replacements:[],
};
const outcome=reviseApprovedScheduleForAbsence({
  ledger:first.ledger,environment,request,
});
assert(outcome.ok,"A ausência com cobertura restante é uma revisão válida.");
if(!outcome.ok)throw Error("unexpected");
assert(outcome.record.replacesId==="initial"&&
  outcome.ledger.records.find(r=>r.id==="initial")?.status==="superseded",
  "A revisão substitui a versão anterior, sem apagá-la.");
assert(outcome.record.shifts.length===3 &&
  outcome.record.shifts.some(s=>s.date===mon&&s.personId==="a") &&
  !outcome.record.shifts.some(s=>s.date===tue&&s.personId==="a"),
  "Só o turno afetado é removido; todos os restantes são conservados.");
assert(outcome.record.absences?.length===1 &&
  outcome.record.revision?.reason==="sick_leave" &&
  outcome.record.revision?.changedDates.join(",")===tue &&
  !validateApprovedScheduleLedger(outcome.ledger).length,
  "Motivo, datas e indisponibilidade ficam no snapshot imutável.");

const notAdjusted=replaceApprovedSchedule({
  ledger:first.ledger,environment,at,expectedVersion:1,
  replaceId:"initial",draft:{id:"bad",startDate:mon,endDate:tue,
    timeZone:"Atlantic/Azores",
    shifts:shifts.filter(s=>!(s.personId==="a"&&s.date===tue))},
});
assert(!notAdjusted.ok && notAdjusted.failure.code==="operational_constraint",
  "Sem ocorrência formal, um dia disponível obrigatório não pode ficar vazio.");

const second=reviseApprovedScheduleForAbsence({
  ledger:outcome.ledger,environment,
  request:{...request,sourceId:"revision-2",revisionId:"revision-3",
    expectedVersion:2,personId:"b",startDate:mon,endDate:mon,
    reason:"vacation" as const},
});
assert(second.ok,"Uma segunda revisão independente deve continuar válida.");
if(!second.ok)throw Error("unexpected");
assert(second.record.absences?.length===2 &&
  second.record.shifts.length===2 &&
  second.ledger.records.length===3 &&
  second.ledger.version===3,
  "Revisões sucessivas preservam ausências e todas as versões anteriores.");

for(const [testName,change] of [
  ["stale",{expectedVersion:0}],
  ["past",{startDate:"2027-01-03",endDate:"2027-01-04"}],
  ["outside",{startDate:"2027-01-06",endDate:"2027-01-06"}],
  ["same replacement",{replacements:[{date:tue,personId:"a"}]}],
  ["already scheduled replacement",{replacements:[{date:tue,personId:"b"}]}],
  ["invalid reason",{reason:"unknown"}],
  ["duplicate date",{replacements:[{date:tue,personId:"b"},{date:tue,personId:"b"}]}],
] as const){
  const refused=reviseApprovedScheduleForAbsence({
    ledger:first.ledger,environment,
    request:{...request,...change} as typeof request,
  });
  assert(!refused.ok,"Deve recusar: "+testName);
}

const withStandby:ApprovalEnvironment={
  ...environment,
  people:[...environment.people,{id:"c",name:"Carla",active:true}],
  availabilities:[...environment.availabilities,{
    personId:"c",weeklyAvailability:createEmptyWeeklyAvailability(),
    exceptions:dates.map(date=>({date,intervals:[slot]})),
  }],
  workRules:{standardShiftDurationMinutes:480,
    requireShiftsOnAvailableDays:false},
};
const reassigned=reviseApprovedScheduleForAbsence({
  ledger:first.ledger,environment:withStandby,
  request:{...request,revisionId:"revision-standby",
    replacements:[{date:tue,personId:"c"}]},
});
assert(reassigned.ok,"Substituir um turno por pessoa disponível deve funcionar.");
if(!reassigned.ok)throw Error("unexpected");
assert(reassigned.record.shifts.length===shifts.length &&
  reassigned.record.shifts.some(s=>s.date===tue&&s.personId==="c") &&
  reassigned.record.people?.some(p=>p.id==="c"&&p.name==="Carla")===true &&
  reassigned.record.people?.some(p=>p.id==="a"&&p.name==="Anabela")===true &&
  reassigned.record.shifts.filter(s=>s.date===mon).length===2,
  "Substituição preserva horários não afetados e nomes originais.");
const standbyUnavailable:ApprovalEnvironment={
  ...withStandby,
  availabilities:withStandby.availabilities.map(a=>a.personId==="c"
    ?{...a,exceptions:[]}:a),
};
const unavailableSwap=reviseApprovedScheduleForAbsence({
  ledger:first.ledger,environment:standbyUnavailable,
  request:{...request,revisionId:"revision-unavailable",
    replacements:[{date:tue,personId:"c"}]},
});
assert(!unavailableSwap.ok,
  "Substituto sem disponibilidade não pode receber turno.");

const backwards=reviseApprovedScheduleForAbsence({
  ledger:first.ledger,environment,
  request:{...request,at:"2027-01-06T10:00:00Z"},
});
assert(!backwards.ok,"Não são permitidas revisões retroativas.");
const missingCoverage=reviseApprovedScheduleForAbsence({
  ledger:first.ledger,environment:{
    ...environment,presence:{
      ...presence,presenceExceptions:presence.presenceExceptions.map(e=>
        e.date===tue?{...e,requirements:{
          minimumAtOpening:2,minimumDuringOperation:2,
          minimumAtClosing:2,
        }}:e),
    },
  },request,
});
assert(!missingCoverage.ok,
  "Uma revisão que reduz a cobertura obrigatória não é aprovada.");

console.log("PR43: revisões parciais, histórico e validações de ocorrências passaram.");
