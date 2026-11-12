import {validSchedulingDate} from "./personSchedulingPolicies";

/** The engine uses ISO civil dates. Presentation is always dd/mm/yyyy. */
export function formatCivilDate(value:string):string {
  if(!validSchedulingDate(value))return value;
  return value.slice(8,10)+"/"+value.slice(5,7)+"/"+value.slice(0,4);
}

export function parseCivilDateInput(value:string):string|null {
  const trimmed=value.trim();
  if(validSchedulingDate(trimmed))return trimmed;
  const match=/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if(!match)return null;
  const iso=match[3]+"-"+match[2].padStart(2,"0")+"-"+match[1].padStart(2,"0");
  return validSchedulingDate(iso)?iso:null;
}

export const PORTUGUESE_MONTHS=[
  "janeiro","fevereiro","março","abril","maio","junho",
  "julho","agosto","setembro","outubro","novembro","dezembro",
] as const;
export const PORTUGUESE_WEEKDAYS=["Seg","Ter","Qua","Qui","Sex","Sáb","Dom"] as const;

export function isoCivilDate(year:number,month:number,day:number):string {
  return String(year).padStart(4,"0")+"-"+
    String(month).padStart(2,"0")+"-"+
    String(day).padStart(2,"0");
}

export function calendarMonth(year:number,month:number):{
  offset:number;days:number;rows:number;
} {
  if(!Number.isInteger(year)||year<1||year>9999||
    !Number.isInteger(month)||month<1||month>12)
    throw Error("Mês de calendário inválido.");
  // setUTCFullYear correctly handles years 0001–0099 (Date.UTC does not).
  const first=new Date(0);
  first.setUTCFullYear(year,month-1,1);
  first.setUTCHours(0,0,0,0);
  const last=new Date(0);
  last.setUTCFullYear(year,month,0);
  last.setUTCHours(0,0,0,0);
  const offset=(first.getUTCDay()+6)%7;
  const days=last.getUTCDate();
  return {offset,days,rows:Math.ceil((offset+days)/7)};
}

export function shiftCalendarMonth(year:number,month:number,delta:number):{
  year:number;month:number;
} {
  const absolute=(year-1)*12+(month-1)+delta;
  const newYear=Math.floor(absolute/12)+1;
  if(newYear<1||newYear>9999)return {year,month};
  return {year:newYear,month:((absolute%12)+12)%12+1};
}
