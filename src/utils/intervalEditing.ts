import type { TimeInterval } from "../types";

/**
 * Safe editing of operating/availability intervals. Returning an error
 * instead of a partially-mutated value prevents invisible data loss.
 * All operations are on one civil day, in 15 minute increments.
 */
const DAY: TimeInterval = {start:"00:00",end:"24:00"};
const TIME=/^(?:[01]\d|2[0-3]):(?:00|15|30|45)$/;

function clock(time:string,isEnd:boolean):number | null {
  if (isEnd && time==="24:00") return 1440;
  if (!TIME.test(time)) return null;
  const [h,m]=time.split(":").map(Number);
  return h*60+m;
}

function format(min:number):string {
  return String(Math.floor(min/60)).padStart(2,"0")+":"+
    String(min%60).padStart(2,"0");
}

export type IntervalEditResult =
  | {valid:true;intervals:TimeInterval[]}
  | {valid:false;issue:string};

export function validateEditedIntervals(
  intervals:TimeInterval[],
  allowed:TimeInterval[]=[DAY],
):IntervalEditResult {
  const ordered=[...intervals].sort((a,b)=>a.start.localeCompare(b.start));
  let lastEnd=0;
  for(const interval of ordered){
    const start=clock(interval.start,false),end=clock(interval.end,true);
    if(start===null || end===null || end<=start)
      return {valid:false,issue:"Cada período precisa de início anterior ao fim, em passos de 15 minutos."};
    if(start<lastEnd)
      return {valid:false,issue:"Os períodos não podem sobrepor-se."};
    const contained=allowed.some(bounds=>{
      const a=clock(bounds.start,false),b=clock(bounds.end,true);
      return a!==null&&b!==null&&start>=a&&end<=b;
    });
    if(!contained)
      return {valid:false,issue:"O período tem de ficar dentro de um único intervalo de funcionamento."};
    lastEnd=end;
  }
  return {valid:true,intervals:ordered};
}

export function editInterval(
  existing:TimeInterval[],
  index:number,
  next:TimeInterval,
  allowed?:TimeInterval[],
):IntervalEditResult {
  if(!Number.isInteger(index)||index<0||index>=existing.length)
    return {valid:false,issue:"Período não encontrado."};
  const updated=existing.map((item,i)=>i===index?next:item);
  return validateEditedIntervals(updated,allowed);
}

export function removeInterval(
  existing:TimeInterval[],
  index:number,
  allowed?:TimeInterval[],
):IntervalEditResult {
  if(!Number.isInteger(index)||index<0||index>=existing.length)
    return {valid:false,issue:"Período não encontrado."};
  return validateEditedIntervals(existing.filter((_,i)=>i!==index),allowed);
}

export function addInterval(
  existing:TimeInterval[],
  allowed:TimeInterval[]=[DAY],
):IntervalEditResult {
  const checked=validateEditedIntervals(existing,allowed);
  if(!checked.valid) return checked;
  const lastEnd=checked.intervals.length?
    clock(checked.intervals[checked.intervals.length-1].end,true)??0:0;
  const preferred=[...allowed].sort((a,b)=>a.start.localeCompare(b.start));
  // Prefer a free slot after the current end; then look earlier.
  for(const afterLast of [true,false]){
    for(const size of [60,30,15]){
      for(const boundary of preferred){
        const start=clock(boundary.start,false),end=clock(boundary.end,true);
        if(start===null||end===null)continue;
        for(let minute=start;minute+size<=end;minute+=15){
          if(afterLast!== (minute>=lastEnd))continue;
          const candidate={start:format(minute),end:format(minute+size)};
          const result=validateEditedIntervals([...existing,candidate],allowed);
          if(result.valid)return result;
        }
      }
    }
  }
  return {valid:false,issue:"Não há espaço livre. Encurta ou remove um período antes de adicionar outro."};
}
