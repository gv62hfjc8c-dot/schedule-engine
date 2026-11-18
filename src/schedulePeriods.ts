/**
 * Civil date calculations for the scheduling core. Inclusive start and
 * exclusive end in every range. UTC is used only for arithmetic on dates,
 * never to reinterpret business opening hours as instants in time.
 */
export type PeriodMode="weekly"|"14d"|"21d"|"28d"|"monthly";
export type PeriodRequest=
  | {mode:"weekly"|"14d"|"21d"|"28d";start:string}
  | {mode:"monthly";year:number;month:number};

export interface DateRange {start:string;endExclusive:string}
export interface PlanningPeriod extends DateRange {
  mode:PeriodMode;
  validation:DateRange;
  weeks:DateRange[];
}

const ONE_DAY=86_400_000;
const ISO_DATE=/^([0-9]{4})-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])$/;
function civilDate(year:number,month:number,day:number):Date {
  const result=new Date(0);
  result.setUTCHours(0,0,0,0);
  result.setUTCFullYear(year,month-1,day);
  return result;
}

export function parseCivilDate(value:string):Date {
  const match=ISO_DATE.exec(value);
  if(!match)throw new Error("Data civil inválida. Usa AAAA-MM-DD.");
  const [year,month,day]=match.slice(1).map(Number);
  const result=civilDate(year,month,day);
  if(year<1 || result.getUTCFullYear()!==year ||
    result.getUTCMonth()!==month-1 || result.getUTCDate()!==day)
    throw new Error("Data civil inválida.");
  return result;
}

export function dateString(date:Date):string {
  const year=date.getUTCFullYear();
  if(!Number.isFinite(date.getTime()) || year<1 || year>9999)
    throw new Error("Data fora dos limites suportados.");
  return String(year).padStart(4,"0")+"-"+
    String(date.getUTCMonth()+1).padStart(2,"0")+"-"+
    String(date.getUTCDate()).padStart(2,"0");
}

export function addCivilDays(date:string,days:number):string {
  if(!Number.isInteger(days))throw new Error("Número de dias inválido.");
  return dateString(new Date(parseCivilDate(date).getTime()+days*ONE_DAY));
}

export function civilDayOfWeek(date:string):number {
  return (parseCivilDate(date).getUTCDay()+6)%7; // Monday = 0
}

export function daysBetween(start:string,endExclusive:string):number {
  return (parseCivilDate(endExclusive).getTime()-
    parseCivilDate(start).getTime())/ONE_DAY;
}

export function enumerateCivilDays(range:DateRange):string[] {
  const count=daysBetween(range.start,range.endExclusive);
  if(!Number.isInteger(count) || count<0 || count>366)
    throw new Error("Intervalo de datas inválido.");
  return Array.from({length:count},(_,i)=>addCivilDays(range.start,i));
}

/** A cycle starts on a Monday. A civil month keeps its own date boundaries. */
export function resolvePlanningPeriod(request:PeriodRequest):PlanningPeriod {
  let start:string;
  let endExclusive:string;
  if(request.mode==="monthly"){
    const {year,month}=request;
    if(!Number.isInteger(year) || year<1 || year>9999 ||
      !Number.isInteger(month) || month<1 || month>12)
      throw new Error("Mês inválido.");
    start=String(year).padStart(4,"0")+"-"+String(month).padStart(2,"0")+"-01";
    if(month===12){
      if(year===9999)throw new Error("O mês excede o calendário suportado.");
      endExclusive=String(year+1).padStart(4,"0")+"-01-01";
    }else{
      endExclusive=String(year).padStart(4,"0")+"-"+
        String(month+1).padStart(2,"0")+"-01";
    }
  }else{
    start=request.start;
    parseCivilDate(start);
    if(civilDayOfWeek(start)!==0)
      throw new Error("Períodos de 7, 14, 21 e 28 dias começam à segunda-feira.");
    const length=request.mode==="weekly"?7:
      request.mode==="14d"?14:request.mode==="21d"?21:
      request.mode==="28d"?28:null;
    if(length===null)throw new Error("Modo de cálculo inválido.");
    endExclusive=addCivilDays(start,length);
  }

  const validationStart=addCivilDays(start,-civilDayOfWeek(start));
  const lastDate=addCivilDays(endExclusive,-1);
  const validationEndExclusive=addCivilDays(lastDate,7-civilDayOfWeek(lastDate));
  const weeks:DateRange[]=[];
  for(let date=validationStart;date<validationEndExclusive;date=addCivilDays(date,7)){
    weeks.push({start:date,endExclusive:addCivilDays(date,7)});
  }
  return {
    mode:request.mode,start,endExclusive,
    validation:{start:validationStart,endExclusive:validationEndExclusive},
    weeks,
  };
}

export function inRange(date:string,range:DateRange):boolean {
  parseCivilDate(date);
  return date>=range.start && date<range.endExclusive;
}
