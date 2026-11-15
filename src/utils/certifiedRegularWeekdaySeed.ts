import type {DatedWorkShift} from "../types";
import type {GenerateConstrainedPeriodInput} from "./constrainedPeriodGenerator";
import {employedOn} from "./employmentPeriods";
import {getSchedulableIntervalsForDate} from "./availability";
import {getOperatingIntervalsForDate} from "./operatingCalendar";
import {personWeeklyHardMax,personWeeklyTarget,isPersonUnavailableOnDate} from "./personSchedulingPolicies";
import {certifyFinalGeneratedSchedule} from "./finalScheduleCertification";

const DAY=86_400_000;
const mins=(clock:string):number=>Number(clock.slice(0,2))*60+Number(clock.slice(3));
const clock=(m:number):string=>String(Math.floor(m/60)).padStart(2,"0")+":"+
  String(m%60).padStart(2,"0");

/** Safe constructive shortcut for regular FULL-TEAM weeks.
 * It never overrides the solver: either the independent certifier accepts
 * the entire proposal (including boundary weeks), or the caller uses the
 * general search. The fixture with eight 40-hour workers is a valid example. */
export function certifiedRegularWeekdaySeed(
  input:GenerateConstrainedPeriodInput
):DatedWorkShift[]|null {
  if(!input.workRules.requireWeeklyTargetsAsMinimum ||
     !input.workRules.requireShiftsOnAvailableDays)return null;
  const active=input.people.filter(p=>p.active)
    .sort((a,b)=>a.id.localeCompare(b.id));
  if(!active.length)return null;
  const max=input.workConstraints.maximumWeeklyEffectiveMinutes;
  if(active.some(p=>personWeeklyTarget(p,max)!==personWeeklyHardMax(p,max)))
    return null;
  const duration=input.workRules.standardShiftDurationMinutes;
  if(duration===null || !Number.isSafeInteger(duration) ||
     duration<15 || duration>input.workConstraints.maximumDailyEffectiveMinutes)
    return null;
  const meal=input.workConstraints.mealBreak;
  const requireMeal=duration>meal.requiredAboveEffectiveMinutes;
  const span=duration+(requireMeal?meal.durationMinutes:0);
  if(span>1440 || (requireMeal &&
      (meal.earliestStartAfterWorkMinutes<0 ||
       meal.earliestStartAfterWorkMinutes>meal.latestStartAfterWorkMinutes ||
       meal.earliestStartAfterWorkMinutes+meal.durationMinutes>=span)))
    return null;

  const start=Date.parse(input.startDate+"T00:00:00Z");
  const end=Date.parse(input.endDate+"T00:00:00Z");
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)return null;
  const assignments:DatedWorkShift[]=[];
  for(let day=start;day<=end;day+=DAY){
    const date=new Date(day).toISOString().slice(0,10);
    const operation=getOperatingIntervalsForDate(date,
      input.operatingCalendar.weeklyOperatingHours,
      input.operatingCalendar.exceptions);
    if(!operation.length)continue;
    // This shortcut intentionally leaves unusual split shifts to the solver.
    if(operation.length!==1)return null;
    const open=mins(operation[0].start),close=mins(operation[0].end);
    if(close-open<span)return null;
    const eligible=active.filter(p=>employedOn(p,date) &&
      !isPersonUnavailableOnDate(p,date));
    for(let i=0;i<eligible.length;i++){
      const person=eligible[i];
      const availability=input.availabilities.find(a=>a.personId===person.id);
      if(!availability)return null;
      const allowed=getSchedulableIntervalsForDate(date,availability,
        input.operatingCalendar.weeklyOperatingHours,
        input.operatingCalendar.exceptions);
      // Regular full-team attendance must fit a continuous availability window.
      const possible=allowed.filter(range=>mins(range.end)-mins(range.start)>=span);
      if(!possible.length)return null;
      const range=possible[0];
      const earliest=mins(range.start),latest=mins(range.end)-span;
      const shiftStart=i<Math.ceil(eligible.length/2)?earliest:latest;
      const shiftEnd=shiftStart+span;
      if(shiftStart<open||shiftEnd>close)return null;
      const mealStart=shiftStart+meal.earliestStartAfterWorkMinutes;
      const shift:DatedWorkShift={
        date,personId:person.id,
        interval:{start:clock(shiftStart),end:clock(shiftEnd)},
        mealBreak:requireMeal?{
          start:clock(mealStart),end:clock(mealStart+meal.durationMinutes),
        }:null,
      };
      assignments.push(shift);
    }
  }
  // Only this independent gate can declare a complete schedule valid.
  return certifyFinalGeneratedSchedule(input,assignments).valid
    ? assignments : null;
}
