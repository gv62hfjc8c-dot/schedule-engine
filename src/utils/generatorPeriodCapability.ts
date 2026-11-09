/**
 * Pure civil-day count used by the UI storage-readiness gate, not by the
 * scheduling engine. Dates are iterated in UTC solely to avoid DST effects.
 */
export function parseCivilDays(start:string,end:string):number|null {
  const valid=(date:string):number|null=>{
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return null;
    const ms=Date.parse(date+"T00:00:00Z");
    return Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,10)===date
      ? ms : null;
  };
  const from=valid(start),to=valid(end);
  if(from===null||to===null||from>to)return null;
  return (to-from)/86_400_000+1;
}
