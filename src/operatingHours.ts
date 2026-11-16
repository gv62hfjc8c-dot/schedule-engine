/**
 * Weekly operating hours belong to the organisation, not to an employee.
 * A closed day is represented by zero opening intervals; never by a rest day.
 * All times are local wall-clock times; overnight periods are unsupported.
 */
export const WEEKDAYS = [
  {id:"monday",label:"Segunda-feira"},
  {id:"tuesday",label:"Terça-feira"},
  {id:"wednesday",label:"Quarta-feira"},
  {id:"thursday",label:"Quinta-feira"},
  {id:"friday",label:"Sexta-feira"},
  {id:"saturday",label:"Sábado"},
  {id:"sunday",label:"Domingo"},
] as const;

export type Weekday = (typeof WEEKDAYS)[number]["id"];
export interface TimeInterval { start:string; end:string }
export interface DayOpeningHours {
  day: Weekday;
  intervals:TimeInterval[];
}
export interface WeeklyOpeningHours {
  days:DayOpeningHours[];
}
export type OpeningHoursValidation =
  | {valid:true; value:WeeklyOpeningHours; issues:[]}
  | {valid:false; value:null; issues:string[]};

const DAY_IDS = new Set<string>(WEEKDAYS.map(d=>d.id));
const HHMM=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
function minutes(time:string):number {
  const [hour,minute]=time.split(":").map(Number);
  return hour*60+minute;
}

export function validateWeeklyOpeningHours(input:unknown):OpeningHoursValidation {
  const errors:string[]=[];
  if (!input || typeof input!=="object" || Array.isArray(input))
    return {valid:false,value:null,issues:["Indica os dias de funcionamento."]};
  const days=(input as {days?:unknown}).days;
  if (!Array.isArray(days) || days.length!==WEEKDAYS.length)
    return {valid:false,value:null,issues:["É necessário indicar os sete dias da semana."]};

  const values=new Map<Weekday,DayOpeningHours>();
  for (const rawDay of days) {
    if (!rawDay || typeof rawDay!=="object" || Array.isArray(rawDay)) {
      errors.push("Foi encontrado um dia de funcionamento inválido.");
      continue;
    }
    const day=(rawDay as {day?:unknown}).day;
    const intervals=(rawDay as {intervals?:unknown}).intervals;
    if (typeof day!=="string" || !DAY_IDS.has(day) || values.has(day as Weekday)) {
      errors.push("Existem dias repetidos ou desconhecidos.");
      continue;
    }
    if (!Array.isArray(intervals) || intervals.length>8) {
      errors.push("Os períodos de funcionamento são inválidos.");
      continue;
    }
    const checked:TimeInterval[]=[];
    for (const interval of intervals) {
      if (!interval || typeof interval!=="object" || Array.isArray(interval)) {
        errors.push("Os períodos de funcionamento são inválidos.");
        continue;
      }
      const {start,end}=interval as {start?:unknown;end?:unknown};
      if (typeof start!=="string" || typeof end!=="string" ||
          !HHMM.test(start) || !HHMM.test(end)) {
        errors.push("Usa horas válidas no formato HH:MM.");
        continue;
      }
      if (minutes(end)<=minutes(start)) {
        errors.push("A hora de encerramento deve ser posterior à abertura no mesmo dia.");
        continue;
      }
      checked.push({start,end});
    }
    const sorted=[...checked].sort((a,b)=>minutes(a.start)-minutes(b.start));
    for (let i=1;i<sorted.length;i++) {
      if (minutes(sorted[i].start)<minutes(sorted[i-1].end)) {
        errors.push("Os períodos de funcionamento do mesmo dia não podem sobrepor-se.");
        break;
      }
    }
    values.set(day as Weekday,{day:day as Weekday,intervals:sorted});
  }
  if (values.size!==WEEKDAYS.length)
    errors.push("Todos os dias da semana devem estar representados.");
  if ([...values.values()].every(d=>d.intervals.length===0))
    errors.push("Seleciona pelo menos um dia de funcionamento.");
  if (errors.length>0)return {valid:false,value:null,issues:[...new Set(errors)]};

  return {valid:true,value:{days:WEEKDAYS.map(d=>values.get(d.id)!)},issues:[]};
}

/** Values shown in a new form are suggestions, never a saved configuration. */
export function suggestedWeeklyOpeningHours():WeeklyOpeningHours {
  return {days:WEEKDAYS.map(({id},i)=>({
    day:id,
    intervals:i<5?[{start:"09:00",end:"18:00"}]:[],
  }))};
}
