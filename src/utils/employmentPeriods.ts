import type { Person } from "../types";

export interface EmploymentPeriod {
  startDate: string;
  /** Inclusive; null means the employment relationship is ongoing. */
  endDate: string | null;
}

function stamp(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(date) &&
    new Date(date).toISOString().slice(0, 10) === value ? date : null;
}

/** Missing periods are a legacy unbounded employment assumption, not proof of historical employment. */
export function validateEmploymentPeriods(periods: EmploymentPeriod[] | undefined): string[] {
  if (periods === undefined) return [];
  if (!Array.isArray(periods)) return ["Os períodos de vínculo devem formar uma lista."];
  const issues: string[] = [];
  const sorted = [...periods].sort((a,b) => String(a?.startDate ?? "").localeCompare(String(b?.startDate ?? "")));
  for (let i=0;i<sorted.length;i++) {
    const period = sorted[i];
    if (!period || typeof period.startDate !== "string" ||
        stamp(period.startDate) === null ||
        (period.endDate !== null && (typeof period.endDate !== "string" ||
          stamp(period.endDate) === null)) ||
        (period.endDate !== null && period.endDate < period.startDate)) {
      issues.push("Existe um vínculo com datas inválidas.");
      continue;
    }
    if (i>0 && sorted[i-1]?.endDate !== undefined &&
        (sorted[i-1].endDate === null || sorted[i-1].endDate! >= period.startDate)) {
      issues.push("Os períodos de vínculo não podem sobrepor-se.");
    }
  }
  return issues;
}

export function employedOn(person: Pick<Person,"employmentPeriods">, date: string): boolean {
  if (stamp(date) === null) return false;
  if (person.employmentPeriods === undefined) return true; // preserve existing setups
  if (validateEmploymentPeriods(person.employmentPeriods).length) return false;
  return person.employmentPeriods.some(p =>
    p.startDate <= date && (p.endDate === null || date <= p.endDate));
}

export function employedInPeriod(person: Pick<Person,"employmentPeriods">,
  startDate: string, endDate: string): boolean {
  if (stamp(startDate) === null || stamp(endDate) === null || startDate > endDate) return false;
  if (person.employmentPeriods === undefined) return true;
  if (validateEmploymentPeriods(person.employmentPeriods).length) return false;
  return person.employmentPeriods.some(p =>
    p.startDate <= endDate && (p.endDate === null || p.endDate >= startDate));
}
