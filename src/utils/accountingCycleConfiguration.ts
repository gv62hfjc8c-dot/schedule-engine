import type {WeeklyOperatingHours} from "../types";
import {validSchedulingDate} from "./personSchedulingPolicies";
import {WEEKDAYS} from "./operatingCalendar";

export const ACCOUNTING_CYCLE_CHOICES=[7,14,28] as const;
export type AccountingCycleDays=typeof ACCOUNTING_CYCLE_CHOICES[number];

export interface OnboardingConfiguration {
  /** True only after an explicit choice, including "no fixed cycle". */
  cycleDecisionConfirmed?:boolean;
  /** Deterministic snapshot of explicitly confirmed operational settings. */
  operationConfirmedFingerprint?:string;
  /** Explicit acceptance of effective coverage (including inherited default). */
  coverageConfirmedFingerprint?:string;
  /** Team reviewed explicitly; invalidated when staff or eligibility changes. */
  teamConfirmedFingerprint?:string;
  /** Explicit step-4 acceptance of availability decisions and work rules. */
  availabilityRulesConfirmedFingerprint?:string;
}

export function isAccountingCycleDays(value:unknown):value is AccountingCycleDays {
  return value===7 || value===14 || value===28;
}

export function operationFingerprint(
  weeklyHours:WeeklyOperatingHours,
  timeZone:string,
  cycleAnchorDate?:string,
  cycleDays?:AccountingCycleDays,
):string {
  return JSON.stringify([
    timeZone,cycleAnchorDate??null,cycleAnchorDate?(cycleDays??28):null,
    ...WEEKDAYS.map(day=>[
      day,...weeklyHours[day].map(({start,end})=>[start,end])
    ]),
  ]);
}

export function isOperationConfirmed(
  onboarding:OnboardingConfiguration|undefined,
  weeklyHours:WeeklyOperatingHours,
  timeZone:string,
  cycleAnchorDate?:string,
  cycleDays?:AccountingCycleDays,
):boolean {
  return onboarding?.cycleDecisionConfirmed===true &&
    onboarding.operationConfirmedFingerprint===
      operationFingerprint(weeklyHours,timeZone,cycleAnchorDate,cycleDays);
}

export function selectedCycleLength(
  anchorDate?:string,
  cycleDays?:AccountingCycleDays,
):AccountingCycleDays|null {
  if(!anchorDate)return null;
  // PR43-62 records with an anchor, but no length, used 28 days.
  return cycleDays??28;
}

export interface WorkAccountingCycle {
  startDate:string;
  endDate:string;
  week:number;
  totalWeeks:number;
  cycleIndex:number;
  days:AccountingCycleDays;
  weeks:Array<{startDate:string;endDate:string}>;
}

const DAY=86_400_000;
const stamp=(date:string):number=>{
  if(!validSchedulingDate(date))throw Error("Data civil inválida: "+date);
  return Date.parse(date+"T00:00:00Z");
};
const civil=(value:number):string=>new Date(value).toISOString().slice(0,10);

/**
 * Accounting reference only. It never limits the dates that a schedule
 * generator may accept, and does not change scheduling hard constraints.
 */
export function workAccountingCycleForDate(
  date:string,anchorDate:string,days:AccountingCycleDays,
):WorkAccountingCycle {
  if(!isAccountingCycleDays(days))throw Error("Duração de ciclo inválida.");
  const dateMs=stamp(date),anchorMs=stamp(anchorDate);
  const cycleIndex=Math.floor((dateMs-anchorMs)/(DAY*days));
  const startMs=anchorMs+cycleIndex*DAY*days;
  const totalWeeks=days/7;
  return {
    startDate:civil(startMs),
    endDate:civil(startMs+(days-1)*DAY),
    week:Math.floor((dateMs-startMs)/(DAY*7))+1,
    totalWeeks,
    cycleIndex,days,
    weeks:Array.from({length:totalWeeks},(_,i)=>({
      startDate:civil(startMs+i*7*DAY),
      endDate:civil(startMs+(i*7+6)*DAY),
    })),
  };
}
