import type { DatedWorkShift, WorkConstraintConfiguration } from "../types";
import type { ConfirmedExternalWorkContext } from "./constrainedPeriodGenerator";
import {
  validateWorkConstraints, type WorkValidationDateRange,
} from "./workConstraints";

/**
 * Trusted import boundary for historical shifts. A file containing only the
 * worked shifts does NOT establish that everyone was off on the other days.
 *
 * The importing service must verify each person's COMPLETE date range
 * against the source, retain its identity/provenance, and set verified=true.
 * No browser-supplied attestation is authoritative on its own.
 */
export interface VerifiedHistoricalCoverage extends WorkValidationDateRange {
  personId: string;
  sourceId: string;
  verified: boolean;
}
export interface HistoricalWorkArchive {
  timeZone: string;
  coverage: VerifiedHistoricalCoverage[];
  shifts: DatedWorkShift[];
}
export interface HistoricalContextRequest {
  targetPeriod: WorkValidationDateRange;
  timeZone: string;
  workConstraints: WorkConstraintConfiguration;
  /** Includes every person whose history may affect the generated period. */
  personIds: string[];
  archive: HistoricalWorkArchive | null;
}
export type HistoricalContextResult = {
  status: "ready" | "incomplete_context" | "target_occupied" | "invalid_input";
  requiredContext: WorkValidationDateRange | null;
  externalContext: ConfirmedExternalWorkContext | null;
  missingCoverage: Array<{date:string;personId:string}>;
  issues: string[];
};
const DAY = 86_400_000;
function civil(date:string):number|null {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return null;
  const stamp=Date.parse(date+"T00:00:00Z");
  return Number.isFinite(stamp)&&new Date(stamp).toISOString().slice(0,10)===date
    ?stamp:null;
}
function ordered(range:WorkValidationDateRange):boolean {
  const a=civil(range.startDate),b=civil(range.endDate);
  return a!==null&&b!==null&&a<=b;
}
function invalid(issues:string[]):HistoricalContextResult {
  return {status:"invalid_input",requiredContext:null,
    externalContext:null,missingCoverage:[],issues};
}

/**
 * Prepare the actual external shifts for the constrained generator.
 *
 * Coverage is verified PER PERSON and PER CIVIL DATE, including explicitly
 * empty days. Missing records never imply days off. This checks the exact
 * adjacent-week/rest horizon; year-to-date fairness/28-day accounting must
 * additionally use the full imported archive, not just this horizon.
 *
 * It is a pure function, NOT an import endpoint or a grant of trust.
 */
export function prepareHistoricalWorkContext(
  input:HistoricalContextRequest,
):HistoricalContextResult {
  if(!input||!ordered(input.targetPeriod)||
     !Array.isArray(input.personIds)||
     input.personIds.some(id=>typeof id!=="string"||!id.trim())||
     new Set(input.personIds).size!==input.personIds.length||
     !input.archive||!Array.isArray(input.archive.coverage)||
     !Array.isArray(input.archive.shifts)||
     input.archive.timeZone!==input.timeZone) {
    return invalid(["Histórico ausente, identidade das pessoas ou fuso incompatível."]);
  }
  const probe=validateWorkConstraints({
    targetPeriod:input.targetPeriod,
    timeZone:input.timeZone,rules:input.workConstraints,
    knownSchedule:{...input.targetPeriod,complete:false,shifts:[]},
  });
  if(probe.status==="invalid_input"||!probe.requiredContext)
    return invalid(probe.issues.length?probe.issues:["Regras ou datas inválidas."]);
  const required=probe.requiredContext;
  const coverage=input.archive.coverage;
  const people=new Set(input.personIds);
  for(const item of coverage) {
    if(!item||!ordered(item)||!people.has(item.personId)||
       typeof item.sourceId!=="string"||!item.sourceId.trim()||
       typeof item.verified!=="boolean")
      return invalid(["Cobertura histórica sem pessoa, fonte ou datas válidas."]);
  }
  const keys=new Set<string>();
  for(const shift of input.archive.shifts) {
    if(!shift||!people.has(shift.personId)||civil(shift.date)===null||
       !shift.interval||typeof shift.interval.start!=="string"||
       typeof shift.interval.end!=="string"||!("mealBreak" in shift))
      return invalid(["Turno histórico sem pessoa, data ou intervalo válido."]);
    const key=shift.date+"|"+shift.personId;
    if(keys.has(key))return invalid(["Turnos históricos duplicados para "+key+"."]);
    keys.add(key);
    if(!coverage.some(c=>c.verified&&c.personId===shift.personId &&
      c.startDate<=shift.date&&c.endDate>=shift.date))
      return invalid(["Turno importado fora de um período histórico verificado."]);
  }
  const missing:Array<{date:string;personId:string}>=[];
  // We must know EVERY person's external days, not only the days with shifts.
  const start=civil(required.startDate)!,end=civil(required.endDate)!;
  for(let stamp=start;stamp<=end;stamp+=DAY) {
    const date=new Date(stamp).toISOString().slice(0,10);
    if(date>=input.targetPeriod.startDate&&date<=input.targetPeriod.endDate)
      continue; // The generator owns target days; do not require past attestations there.
    for(const personId of input.personIds) {
      const proven=coverage.some(c=>c.verified&&c.personId===personId &&
        c.startDate<=date&&c.endDate>=date);
      if(!proven&&missing.length<32)missing.push({date,personId});
    }
  }
  if(missing.length)return {
    status:"incomplete_context",requiredContext:required,
    externalContext:null,missingCoverage:missing,
    issues:["Existem dias/pessoas com histórico por importar ou confirmar; "+
      "não é possível afirmar que não trabalharam."],
  };
  if(input.archive.shifts.some(shift=>
    shift.date>=input.targetPeriod.startDate&&
    shift.date<=input.targetPeriod.endDate))
    return {status:"target_occupied",requiredContext:required,
      externalContext:null,missingCoverage:[],
      issues:["O período pretendido já contém turnos históricos importados. "+
        "É necessária uma revisão, não a geração sobre esses turnos."]};
  return {status:"ready",requiredContext:required,missingCoverage:[],
    externalContext:{
      ...required,completeOutsideTarget:true,
      shifts:input.archive.shifts.filter(s=>
        s.date>=required.startDate&&s.date<=required.endDate)
        .map(s=>({date:s.date,personId:s.personId,
          interval:{...s.interval},
          mealBreak:s.mealBreak?{...s.mealBreak}:null})),
    },
    issues:[],
  };
}
