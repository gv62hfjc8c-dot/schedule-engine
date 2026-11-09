import { validSchedulingDate } from "./personSchedulingPolicies";

/** Civil-day accounting only. This does not approve or merge schedules. */
const DAY=86_400_000;
export const ACCOUNTING_CYCLE_DAYS=28 as const;
const parse = (date:string) => {
  if (!validSchedulingDate(date)) throw Error("Data civil inválida para ciclo: "+date);
  return Date.parse(date+"T00:00:00Z");
};
const civil = (stamp:number) => new Date(stamp).toISOString().slice(0,10);
export interface AccountingCycle28 {
  startDate: string;
  endDate: string;
  /** 1-based number of the 7-day accounting week within the 28-day cycle. */
  week: 1|2|3|4;
  cycleIndex: number;
  weeks: Array<{startDate:string;endDate:string}>;
}

/**
 * Fixed 28-day boundaries, independent of calendar months or ISO Monday.
 * Negative indices correctly cover dates earlier than the anchor; a 5-week
 * month does not introduce an artificial fifth week into the cycle.
 */
export function accountingCycleForDate(date:string, anchor:string):AccountingCycle28 {
  const stamp=parse(date);
  const startAnchor=parse(anchor);
  const offset=Math.floor((stamp-startAnchor)/DAY);
  const cycleIndex=Math.floor(offset/ACCOUNTING_CYCLE_DAYS);
  const begin=startAnchor+cycleIndex*ACCOUNTING_CYCLE_DAYS*DAY;
  const week=Math.floor((stamp-begin)/(7*DAY))+1;
  return {
    startDate:civil(begin),endDate:civil(begin+27*DAY),
    cycleIndex,week:week as 1|2|3|4,
    weeks:Array.from({length:4},(_,index)=>({
      startDate:civil(begin+index*7*DAY),
      endDate:civil(begin+(index*7+6)*DAY),
    })),
  };
}

/** Enumerates contiguous cycles that intersect an inclusive civil range. */
export function cyclesIntersectingRange(startDate:string,endDate:string,anchor:string):AccountingCycle28[] {
  const start=parse(startDate),end=parse(endDate);
  if(end<start)throw Error("Intervalo de ciclos inválido.");
  const first=accountingCycleForDate(startDate,anchor);
  const last=accountingCycleForDate(endDate,anchor);
  const cycles:AccountingCycle28[]=[];
  for(let index=first.cycleIndex;index<=last.cycleIndex;index++){
    const startStamp=parse(anchor)+index*ACCOUNTING_CYCLE_DAYS*DAY;
    cycles.push(accountingCycleForDate(civil(startStamp),anchor));
    if(cycles.length>2000)throw Error("Intervalo de ciclos demasiado grande.");
  }
  return cycles;
}
