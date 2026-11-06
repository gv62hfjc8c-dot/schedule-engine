import type { GenerateConstrainedPeriodInput } from "./utils/constrainedPeriodGenerator";
import type { DatedWorkShift, WeeklyOperatingHours } from "./types";
import { certifyFinalGeneratedSchedule } from "./utils/finalScheduleCertification";
import { INITIAL_WORK_CONSTRAINTS } from "./utils/workConstraints";
import { WEEKDAYS } from "./utils/operatingCalendar";
import { createEmptyWeeklyAvailability } from "./utils/availability";
import { createEmptyWeeklyPresenceRequirements } from "./utils/presence";
import { isGeneratedSchedulePayload, type GeneratedSchedulePayload } from "./persistence/generatedScheduleRepository";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error("PR47: " + message);
}
const op: WeeklyOperatingHours = Object.fromEntries(WEEKDAYS.map(day=>[
  day,day==="monday" ? [{start:"09:00",end:"18:00"}] : [],
])) as WeeklyOperatingHours;
const shift: DatedWorkShift = {date:"2026-11-02",personId:"one",
  interval:{start:"09:00",end:"18:00"},
  mealBreak:{start:"13:00",end:"14:00"}};
const availability = {
  personId:"one",
  weeklyAvailability:{
    ...createEmptyWeeklyAvailability(),
    monday:[{start:"09:00",end:"18:00"}],
  },
  exceptions:[],
};
const presence = {
  weeklyPresenceRequirements:{
    ...createEmptyWeeklyPresenceRequirements(),
    monday:{minimumAtOpening:1,minimumDuringOperation:0,minimumAtClosing:1},
  },
  presenceExceptions:[],
};
const input: GenerateConstrainedPeriodInput = {
  startDate:"2026-11-02",endDate:"2026-11-02",
  timeZone:"Europe/Lisbon",
  people:[{id:"one",name:"Trabalhador",active:true}],
  availabilities:[availability],
  operatingCalendar:{weeklyOperatingHours:op,exceptions:[]},
  workRules:{standardShiftDurationMinutes:480,fullShortDayMaximumMinutes:540},
  presence,
  workConstraints:structuredClone(INITIAL_WORK_CONSTRAINTS),
  externalContext:{
    startDate:"2026-11-01",endDate:"2026-11-08",
    completeOutsideTarget:true,shifts:[],
  },
};
assert(certifyFinalGeneratedSchedule(input,[shift]).valid,
  "Full attendance can legally include the mandatory meal break.");
assert(!certifyFinalGeneratedSchedule(input,[]).valid,
  "The final gate checks unfilled operation dates.");
assert(!certifyFinalGeneratedSchedule(input,[{...shift,mealBreak:null}]).valid,
  "The final gate checks daily limits and mandatory meals.");
assert(!certifyFinalGeneratedSchedule(input,[shift,shift]).valid,
  "The final gate rejects duplicate person/day assignments.");
assert(!certifyFinalGeneratedSchedule(input,[{...shift,interval:{start:"09:00",end:"17:00"}}]).valid,
  "Full short day must retain the complete operating span.");
assert(!certifyFinalGeneratedSchedule({...input,availabilities:[{
  ...availability,weeklyAvailability:{...availability.weeklyAvailability,
    monday:[{start:"09:00",end:"12:00"}]},
}]},[shift]).valid,"The final gate checks shift eligibility.");
assert(!certifyFinalGeneratedSchedule({...input,externalContext:{
  ...input.externalContext,completeOutsideTarget:false,
}},[shift]).valid,"Unknown external context never certifies a schedule.");
assert(!certifyFinalGeneratedSchedule({...input,workRules:{
  ...input.workRules,requireShiftsOnAvailableDays:true,
}},[]).valid,"Mandatory workdays must not vanish after optimization.");

const saved: GeneratedSchedulePayload = {
  schemaVersion:1,validationScope:"user_attested_no_external_shifts",
  startDate:input.startDate,endDate:input.endDate,timeZone:input.timeZone,
  people:input.people,shifts:[shift],
  configuration:{
    availabilities:input.availabilities,
    operatingCalendar:input.operatingCalendar,
    workRules:input.workRules,presence:input.presence,
    workConstraints:input.workConstraints,
  },
};
assert(isGeneratedSchedulePayload(saved),"Full archived snapshot is valid.");
assert(!isGeneratedSchedulePayload({...saved,timeZone:"Invalid/Unknown"}),
  "Archive rejects invalid time zones.");
assert(!isGeneratedSchedulePayload({...saved,configuration:{
  ...saved.configuration,
  operatingCalendar:{weeklyOperatingHours:{monday:op.monday},exceptions:[]},
}}),"Archive rejects incomplete weekly operation.");
assert(!isGeneratedSchedulePayload({...saved,configuration:{
  ...saved.configuration,
  workConstraints:{...INITIAL_WORK_CONSTRAINTS,maximumWeeklyEffectiveMinutes:-1},
}}),"Archive rejects invalid work rules.");
assert(!isGeneratedSchedulePayload({...saved,configuration:{
  ...saved.configuration,
  availabilities:[{...availability,
    weeklyAvailability:{...availability.weeklyAvailability,
      monday:[{start:"18:00",end:"09:00"}]}}],
}}),"Archive rejects invalid availability intervals.");
console.log("PR47: final certification and archived snapshot regression checks passed.");
