import type { DatedWorkShift, Person } from "../types";
import { getEffectiveWorkMinutesInTimeZone } from "./workConstraints";

const DAY = 86_400_000;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

/** Strict civil calendar date; do not let JS silently normalise 31 February. */
export function validSchedulingDate(value: string): boolean {
  if (!datePattern.test(value)) return false;
  const instant = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(instant) && new Date(instant).toISOString().slice(0, 10) === value;
}
function monday(date: string): string {
  const stamp = Date.parse(date + "T00:00:00Z");
  const day = (new Date(stamp).getUTCDay() + 6) % 7;
  return new Date(stamp - day * DAY).toISOString().slice(0, 10);
}
function validMinutes(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= 7 * 24 * 60 &&
    value % 15 === 0;
}

/**
 * Missing optional policy fields are interpreted exactly as in PR41:
 * every person uses the company limit as a hard maximum and a soft target.
 */
export function personWeeklyHardMax(person: Person, companyMaximum: number): number {
  return Math.min(person.weeklyContractMinutes ?? companyMaximum, companyMaximum);
}
export function personWeeklyTarget(person: Person, companyMaximum: number): number {
  return Math.min(person.weeklyTargetMinutes ??
    person.weeklyContractMinutes ?? companyMaximum,
    personWeeklyHardMax(person, companyMaximum));
}

export function validatePeopleSchedulingPolicies(people: Person[]): string[] {
  const issues: string[] = [];
  for (const person of people) {
    if (person.weeklyContractMinutes !== undefined &&
      !validMinutes(person.weeklyContractMinutes))
      issues.push("Limite semanal contratual inválido para " + person.id + ".");
    if (person.weeklyTargetMinutes !== undefined &&
      !validMinutes(person.weeklyTargetMinutes))
      issues.push("Objetivo semanal inválido para " + person.id + ".");
    if (person.weeklyContractMinutes !== undefined &&
      person.weeklyTargetMinutes !== undefined &&
      person.weeklyTargetMinutes > person.weeklyContractMinutes)
      issues.push("Objetivo semanal excede o contrato de " + person.id + ".");
    if (person.requiredWorkDates !== undefined) {
      if (!Array.isArray(person.requiredWorkDates) ||
          person.requiredWorkDates.some(date=>typeof date!=="string" || !validSchedulingDate(date)) ||
          new Set(person.requiredWorkDates).size !== person.requiredWorkDates.length)
        issues.push("Datas obrigatórias inválidas ou repetidas para " + person.id + ".");
    }
    if (person.unavailableWorkDates !== undefined) {
      if (!Array.isArray(person.unavailableWorkDates) ||
          person.unavailableWorkDates.some(date=>typeof date!=="string" || !validSchedulingDate(date)) ||
          new Set(person.unavailableWorkDates).size !== person.unavailableWorkDates.length)
        issues.push("Datas de indisponibilidade inválidas ou repetidas para " + person.id + ".");
      if ((person.unavailableWorkDates??[]).some(date=>person.requiredWorkDates?.includes(date)))
        issues.push("Uma data não pode ser simultaneamente obrigatória e indisponível para " + person.id + ".");
    }
    if(person.qualificationTags!==undefined &&
      (!Array.isArray(person.qualificationTags) ||
       person.qualificationTags.some(tag=>typeof tag!=="string"||tag.trim().length===0||
         tag.length>64||!/^[\p{L}\p{N} -]+$/u.test(tag)) ||
       new Set(person.qualificationTags).size!==person.qualificationTags.length))
      issues.push("Etiquetas de qualificação inválidas ou repetidas para "+person.id+".");
  }
  return issues;
}

export interface ContractCapResult {
  valid: boolean;
  issues: string[];
}
/**
 * Independent hard constraint. The workload is counted by Monday–Sunday civil
 * weeks, including the known outside shifts; the target is never a hard cap.
 * Absolute elapsed minutes follow the same IANA/DST conversion as the work
 * validator. Invalid local clock times cannot be declared compliant.
 */
export function validatePersonWeeklyContractCaps(
  people: Person[], shifts: DatedWorkShift[], companyMaximum: number,
  timeZone: string, targetStart: string, targetEnd: string
): ContractCapResult {
  const issues = validatePeopleSchedulingPolicies(people);
  const relevant = new Map(people.map(p=>[p.id,p]));
  const byPersonWeek = new Map<string,{person:Person; week:string; minutes:number}>();
  for (const shift of shifts) {
    const person = relevant.get(shift.personId);
    if (!person) continue; // inactive people with old outside shifts may remain in history
    if (!validSchedulingDate(shift.date)) {
      issues.push("Data de turno inválida ao validar o contrato: " + shift.personId + ".");
      continue;
    }
    if(isPersonUnavailableOnDate(person,shift.date)){
      issues.push("Turno de "+person.id+" atribuído durante indisponibilidade em "+shift.date+".");
      continue;
    }
    const duration = getEffectiveWorkMinutesInTimeZone(shift,timeZone);
    if (duration === null) {
      issues.push("Turno com horário local inválido ao validar contrato: " + shift.personId + ".");
      continue;
    }
    const week = monday(shift.date);
    const key = shift.personId+"|"+week;
    const item=byPersonWeek.get(key) ?? {person,week,minutes:0};
    item.minutes += duration;
    byPersonWeek.set(key,item);
  }
  for(const item of byPersonWeek.values()) {
    if (item.week > targetEnd ||
      new Date(Date.parse(item.week+"T00:00:00Z")+6*DAY).toISOString().slice(0,10) < targetStart)
      continue;
    const maximum = personWeeklyHardMax(item.person,companyMaximum);
    if (item.minutes > maximum)
      issues.push("Limite semanal contratual de "+item.person.id+" excedido na semana "+item.week+
        ": "+item.minutes+" min para máximo de "+maximum+" min.");
  }
  return {valid:issues.length===0,issues};
}

/**
 * Explicit workdays inside the attested external context must already be
 * represented by known shifts. Confirming that the outside context is empty
 * while declaring a mandatory outside workday is contradictory.
 *
 * Only inspect dates within the known external interval. Dates beyond this
 * interval are outside the certification scope and remain untouched.
 */
export function missingRequiredOutsideWorkdays(
  people: Person[],
  externalShifts: DatedWorkShift[],
  targetStart: string,
  targetEnd: string,
  knownStart: string,
  knownEnd: string,
): Array<{personId:string;date:string}> {
  const assigned=new Set(externalShifts.map(s=>s.personId+"|"+s.date));
  return people.filter(p=>p.active).flatMap(person=>
    (person.requiredWorkDates??[])
      .filter(date=>date>=knownStart && date<=knownEnd &&
        (date<targetStart || date>targetEnd) &&
        !assigned.has(person.id+"|"+date))
      .map(date=>({personId:person.id,date}))
  );
}

/** Hard exclusion even if a weekly availability normally permits the shift. */
export function isPersonUnavailableOnDate(person:Person,date:string):boolean{
  return person.unavailableWorkDates?.includes(date)??false;
}

/** Unlike availability, an explicitly required date is a hard assignment obligation. */
export function isExplicitRequiredWorkday(person: Person, date: string): boolean {
  return person.requiredWorkDates?.includes(date) ?? false;
}
