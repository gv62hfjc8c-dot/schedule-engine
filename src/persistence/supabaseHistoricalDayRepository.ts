import type { DatedWorkShift } from "../types";
import type { SupabaseAuthClient } from "./supabaseAuth";

export type HistoricalOccurrenceType = "worked" | "day_off" | "vacation" | "holiday";
export interface HistoricalDayOccurrence {
  personId: string;
  date: string;
  type: HistoricalOccurrenceType;
  shifts: DatedWorkShift[];
  sourceId: string;
  sourceLabel: string;
}
type AuthenticatedClient = Pick<SupabaseAuthClient,"request"|"user">;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS=new Set<HistoricalOccurrenceType>(["worked","day_off","vacation","holiday"]);

function dateOk(value: unknown): value is string {
  if(typeof value!=="string" || !DATE.test(value))return false;
  const time=Date.parse(value+"T00:00:00Z");
  return Number.isFinite(time) && new Date(time).toISOString().slice(0,10)===value;
}
function record(value:unknown):Record<string,unknown> {
  if(!value || typeof value!=="object" || Array.isArray(value))
    throw Error("O histórico devolveu um registo incompatível.");
  return value as Record<string,unknown>;
}
async function receive(client:AuthenticatedClient,path:string,ownerId:string):Promise<unknown[]> {
  const response=await client.request(path);
  if(!response.ok)throw Error("Não foi possível consultar o histórico factual (HTTP "+response.status+").");
  const result:unknown=await response.json();
  if(client.user?.id!==ownerId)throw Error("A sessão mudou durante a consulta histórica.");
  if(!Array.isArray(result))throw Error("Resposta histórica incompatível.");
  return result;
}
function parseShift(value:unknown,personId:string,date:string):DatedWorkShift {
  const item=record(value);
  const interval=record(item.interval);
  const start=interval.start,end=interval.end;
  const meal=item.mealBreak===null?null:record(item.mealBreak);
  const CLOCK=/^([01]\d|2[0-3]):[0-5]\d$/;
  const clock=(v:unknown):v is string=>typeof v==="string"&&CLOCK.test(v);
  if(item.personId!==personId||item.date!==date||
    !clock(start)||!clock(end)||start>=end||
    (meal!==null&&(!clock(meal.start)||!clock(meal.end)||
      meal.start<=start||meal.end>=end||meal.start>=meal.end)))
    throw Error("Horário histórico incompatível para "+date+".");
  return {personId,date,interval:{start,end},
    mealBreak:meal?{start:meal.start as string,end:meal.end as string}:null};
}

/** Read-only, per-owner, source-labelled history; never convert facts into generated proposals. */
export function createHistoricalDayRepository(client:AuthenticatedClient){
  return {
    async listBetween(start:string,end:string):Promise<HistoricalDayOccurrence[]> {
      if(!dateOk(start)||!dateOk(end)||start>end)throw Error("Período histórico inválido.");
      const ownerId=client.user?.id;
      if(!ownerId||!UUID.test(ownerId))throw Error("É necessário iniciar sessão para consultar o histórico.");
      const sourceRows=await receive(client,
        "/rest/v1/schedule_engine_history_sources?select=source_id,source_label,source_kind,time_zone"+
        "&owner_id=eq."+encodeURIComponent(ownerId)+"&limit=100",ownerId);
      const sources=new Map<string,string>();
      for(const raw of sourceRows){
        const row=record(raw);
        if(typeof row.source_id!=="string"||!UUID.test(row.source_id)||
          typeof row.source_label!=="string"||
          !["worked","externally_approved","planned"].includes(String(row.source_kind)))
          throw Error("Fonte histórica incompatível.");
        sources.set(row.source_id,row.source_label);
      }
      const result:HistoricalDayOccurrence[]=[];
      const seen=new Set<string>();
      for(let offset=0;offset<10000;offset+=500){
        const path="/rest/v1/schedule_engine_history_day_facts"+
          "?select=source_id,person_id,work_date,occurrence_type,shifts"+
          "&owner_id=eq."+encodeURIComponent(ownerId)+
          "&work_date=gte."+encodeURIComponent(start)+
          "&work_date=lte."+encodeURIComponent(end)+
          "&order=work_date.asc,person_id.asc,source_id.asc"+
          "&limit=500&offset="+offset;
        const rows=await receive(client,path,ownerId);
        if(rows.length>500)throw Error("Página histórica excessiva.");
        for(const raw of rows){
          const row=record(raw);
          const sourceId=row.source_id,personId=row.person_id,date=row.work_date,type=row.occurrence_type;
          if(typeof sourceId!=="string"||!sources.has(sourceId)||
            typeof personId!=="string"||!personId.trim()||
            !dateOk(date)||date<start||date>end||
            typeof type!=="string"||!KINDS.has(type as HistoricalOccurrenceType)||
            !Array.isArray(row.shifts))
            throw Error("Ocorrência histórica incompatível.");
          const key=personId+"|"+date;
          if(seen.has(key))throw Error("Fontes históricas sobrepostas em "+date+".");
          seen.add(key);
          const shifts=(row.shifts as unknown[]).map(x=>parseShift(x,personId,date));
          if((type==="worked" && shifts.length!==1)||
             (type!=="worked"&&shifts.length!==0))
            throw Error("Classificação histórica sem correspondência ao turno.");
          result.push({personId,date,type:type as HistoricalOccurrenceType,
            shifts,sourceId,sourceLabel:sources.get(sourceId)!});
        }
        if(rows.length<500)return result;
      }
      throw Error("Limite de paginação histórica atingido; nenhuma ausência pode ser inferida.");
    },
  };
}

export function historicalFactsForDate(rows:HistoricalDayOccurrence[],date:string){
  return rows.filter(row=>row.date===date);
}
export function historicalDayTotals(rows:HistoricalDayOccurrence[],date:string){
  const day=historicalFactsForDate(rows,date);
  return {
    total:day.length,
    worked:day.filter(x=>x.type==="worked").length,
    dayOff:day.filter(x=>x.type==="day_off").length,
    vacation:day.filter(x=>x.type==="vacation").length,
    holiday:day.filter(x=>x.type==="holiday").length,
  };
}
