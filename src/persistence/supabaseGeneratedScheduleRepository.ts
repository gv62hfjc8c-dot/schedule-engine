import type { SupabaseAuthClient } from "./supabaseAuth";
import {
  isGeneratedSchedulePayload,
  certifyGeneratedSchedulePayload,
  type GeneratedSchedulePayload,
  type GeneratedScheduleRepository,
  type StoredGeneratedSchedule,
  type GeneratedScheduleArchiveResult,
  type UnreadableGeneratedSchedule,
} from "./generatedScheduleRepository";

type AuthenticatedClient = Pick<SupabaseAuthClient, "request" | "user">;

export class GeneratedScheduleStoreError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "GeneratedScheduleStoreError";
  }
}

async function jsonResponse(response: Response): Promise<unknown> {
  try { return await response.json() as unknown; }
  catch { throw new GeneratedScheduleStoreError(
    "A base de dados devolveu dados inválidos.", response.status); }
}

async function checked(response: Response): Promise<unknown> {
  const data = await jsonResponse(response);
  if (response.ok) return data;
  const details = data && typeof data === "object"
    ? data as Record<string, unknown> : {};
  throw new GeneratedScheduleStoreError(
    typeof details.message === "string" ? details.message :
      "Não foi possível guardar ou consultar as propostas.", response.status);
}

function readRow(value: unknown): StoredGeneratedSchedule {
  if (!value || typeof value !== "object")
    throw new GeneratedScheduleStoreError("Registo de horário incompatível.");
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || !uuidPattern.test(row.id) ||
    typeof row.created_at !== "string" ||
    (!timestampPattern.test(row.created_at) ||
      !Number.isFinite(Date.parse(row.created_at))) ||
    typeof row.start_date !== "string" ||
    typeof row.end_date !== "string" ||
    typeof row.time_zone !== "string" ||
    !isGeneratedSchedulePayload(row.payload) ||
    row.start_date !== row.payload.startDate ||
    row.end_date !== row.payload.endDate ||
    row.time_zone !== row.payload.timeZone)
    throw new GeneratedScheduleStoreError(
      "Existe uma proposta guardada com estrutura incompatível.");
  const certified=certifyGeneratedSchedulePayload(row.payload);
  if(!certified.valid)
    throw new GeneratedScheduleStoreError(
      "Uma proposta arquivada não cumpre todas as regras do seu próprio snapshot: "+
      certified.issues.slice(0,3).join(" "));
  return {
    id: row.id,
    createdAt: row.created_at,
    startDate: row.start_date,
    endDate: row.end_date,
    timeZone: row.time_zone,
    payload: row.payload,
  };
}

const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const civilPattern=/^\d{4}-\d{2}-\d{2}$/;
const timestampPattern=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const SELECT_COLUMNS="id,created_at,start_date,end_date,time_zone,payload";
const TABLE="/rest/v1/schedule_engine_generated_schedules";
const MAX_PAGES=200;
const PAGE_SIZE=100;

function validCivilDate(value:string):boolean {
  if (!civilPattern.test(value)) return false;
  const date=Date.parse(value+"T00:00:00Z");
  return Number.isFinite(date) && new Date(date).toISOString().slice(0,10)===value;
}
function stableJson(value:unknown):string {
  return JSON.stringify(value,(_key,current:unknown)=>{
    if (!current || Array.isArray(current) || typeof current!=="object")
      return current;
    const object=current as Record<string,unknown>;
    return Object.keys(object).sort().reduce((acc,key)=>{
      acc[key]=object[key];
      return acc;
    },{} as Record<string,unknown>);
  });
}
function samePayload(a:GeneratedSchedulePayload,b:GeneratedSchedulePayload):boolean {
  return stableJson(a)===stableJson(b);
}
function rowMetadata(value:unknown):UnreadableGeneratedSchedule {
  if (!value || typeof value!=="object")
    return {id:null,startDate:null,endDate:null};
  const row=value as Record<string,unknown>;
  return {
    id:typeof row.id==="string" ? row.id : null,
    startDate:typeof row.start_date==="string" && validCivilDate(row.start_date)
      ? row.start_date : null,
    endDate:typeof row.end_date==="string" && validCivilDate(row.end_date)
      ? row.end_date : null,
  };
}
function cursorFrom(value:unknown):{timestamp:string;id:string}|null {
  if (!value || typeof value!=="object") return null;
  const row=value as Record<string,unknown>;
  return typeof row.created_at==="string" && timestampPattern.test(row.created_at) &&
    Number.isFinite(Date.parse(row.created_at)) &&
    typeof row.id==="string" && uuidPattern.test(row.id)
    ? {timestamp:row.created_at,id:row.id} : null;
}
function fractionalMicroseconds(timestamp:string):number {
  const matched=timestamp.match(/\.(\d{1,6})(?:Z|[+-]\d{2}:\d{2})$/);
  const digits=(matched?.[1]??"").padEnd(6,"0");
  // Date.parse already accounts for the first three digits (milliseconds).
  return Number(digits.slice(3,6));
}
function earlierThan(
  left:{timestamp:string;id:string},
  right:{timestamp:string;id:string}
):boolean {
  const a=Date.parse(left.timestamp),b=Date.parse(right.timestamp);
  if(a!==b) return a<b;
  const aMicro=fractionalMicroseconds(left.timestamp);
  const bMicro=fractionalMicroseconds(right.timestamp);
  return aMicro!==bMicro ? aMicro<bMicro : left.id < right.id;
}

/**
 * Proposals remain immutable and owner-scoped under RLS. Pagination uses a
 * descending (created_at,id) cursor instead of offset, preventing duplicates
 * and omissions when new proposals are inserted while loading a month.
 * A malformed snapshot is never silently treated as a valid plan.
 */
export function createSupabaseGeneratedScheduleRepository(
  client: AuthenticatedClient
): GeneratedScheduleRepository {
  const owner=()=>{
    const user=client.user;
    if (!user) throw new GeneratedScheduleStoreError(
      "É necessário iniciar sessão para guardar horários.");
    return user.id;
  };
  const stillOwner=(ownerId:string)=>{
    if (client.user?.id!==ownerId)
      throw new GeneratedScheduleStoreError(
        "A sessão mudou durante a operação. Reconsulta os horários.");
  };
  const readExact=async(id:string,ownerId:string):Promise<StoredGeneratedSchedule|null>=>{
    const response=await client.request(
      TABLE+"?select="+SELECT_COLUMNS+"&id=eq."+encodeURIComponent(id)+"&limit=1");
    const rows=await checked(response);
    stillOwner(ownerId);
    if (!Array.isArray(rows) || rows.length>1)
      throw new GeneratedScheduleStoreError("Consulta de proposta individual incompatível.");
    return rows.length===1?readRow(rows[0]):null;
  };
  const archiveBetween=async(startDate:string,endDate:string):Promise<GeneratedScheduleArchiveResult>=>{
    const ownerId=owner();
    if (!validCivilDate(startDate) || !validCivilDate(endDate) || startDate>endDate)
      throw new GeneratedScheduleStoreError("Intervalo de consulta inválido.");
    const records:StoredGeneratedSchedule[]=[];
    const unreadable:UnreadableGeneratedSchedule[]=[];
    const seen=new Set<string>();
    let lastCursor:{timestamp:string;id:string}|null=null;
    for(let page=0;page<MAX_PAGES;page++){
      let path=TABLE+"?select="+SELECT_COLUMNS+
        "&start_date=lte."+encodeURIComponent(endDate)+
        "&end_date=gte."+encodeURIComponent(startDate)+
        "&order=created_at.desc,id.desc&limit="+PAGE_SIZE;
      if(lastCursor){
        const condition="(created_at.lt."+lastCursor.timestamp+
          ",and(created_at.eq."+lastCursor.timestamp+",id.lt."+lastCursor.id+"))";
        path+="&or="+encodeURIComponent(condition);
      }
      const response=await client.request(path);
      const rows=await checked(response);
      stillOwner(ownerId);
      if(!Array.isArray(rows) || rows.length>PAGE_SIZE)
        throw new GeneratedScheduleStoreError("O arquivo devolveu uma página incompatível.");
      for(const row of rows){
        const cursor=cursorFrom(row);
        // Unreadable metadata on a short terminal page can be reported.
        // On a full page we need valid cursor keys to advance safely.
        if(!cursor && rows.length===PAGE_SIZE)
          throw new GeneratedScheduleStoreError(
            "O arquivo contém registos sem identificador ou data de criação; não é possível paginar de forma segura.");
        if(cursor){
          if(lastCursor && !earlierThan(cursor,lastCursor))
            throw new GeneratedScheduleStoreError(
              "A sequência do histórico não respeita a ordenação esperada.");
          if(seen.has(cursor.id))
            throw new GeneratedScheduleStoreError("O arquivo devolveu uma proposta repetida.");
          seen.add(cursor.id);
          lastCursor=cursor;
        }
        try { records.push(readRow(row)); }
        catch { unreadable.push(rowMetadata(row)); }
      }
      if(rows.length<PAGE_SIZE) return {records,unreadable};
      if(!lastCursor)
        throw new GeneratedScheduleStoreError("Não é possível continuar o histórico de forma segura.");
    }
    throw new GeneratedScheduleStoreError(
      "O arquivo ultrapassou o limite de consulta. Não será apresentado como completo.");
  };
  return {
    async save(payload,proposalId) {
      const ownerId=owner();
      if(!isGeneratedSchedulePayload(payload))
        throw new GeneratedScheduleStoreError(
          "A proposta não está completa. Não foi guardada.");
      const certified=certifyGeneratedSchedulePayload(payload);
      if(!certified.valid)
        throw new GeneratedScheduleStoreError(
          "A certificação independente recusou a proposta: "+
          certified.issues.slice(0,3).join(" "));
      const id=proposalId??crypto.randomUUID();
      if(!uuidPattern.test(id))
        throw new GeneratedScheduleStoreError("Identificador de proposta inválido.");
      const response=await client.request(
        TABLE+"?select="+SELECT_COLUMNS,
        {method:"POST",headers:{
          "Content-Type":"application/json","Prefer":"return=representation",
        },body:JSON.stringify({
          id,owner_id:ownerId,
          start_date:payload.startDate,end_date:payload.endDate,
          time_zone:payload.timeZone,payload,
        })}
      );
      stillOwner(ownerId);
      if(response.status===409){
        // An earlier POST may have committed before the client lost its reply.
        // Retry is safe ONLY for the same owner, UUID and identical snapshot.
        const existing=await readExact(id,ownerId);
        if(!existing || !samePayload(existing.payload,payload))
          throw new GeneratedScheduleStoreError(
            "Conflito de gravação: a proposta existente não corresponde à tentativa atual.",409);
        return existing;
      }
      const rows=await checked(response);
      if(!Array.isArray(rows) || rows.length!==1)
        throw new GeneratedScheduleStoreError(
          "O servidor não confirmou o registo do horário.");
      const stored=readRow(rows[0]);
      if(stored.id!==id || !samePayload(stored.payload,payload))
        throw new GeneratedScheduleStoreError(
          "O registo devolvido não corresponde à proposta enviada.");
      return stored;
    },
    async latest() {
      const ownerId=owner();
      const response=await client.request(
        TABLE+"?select="+SELECT_COLUMNS+
        "&order=created_at.desc,id.desc&limit=1"
      );
      const rows=await checked(response);
      stillOwner(ownerId);
      if(!Array.isArray(rows) || rows.length>1)
        throw new GeneratedScheduleStoreError("Última proposta incompatível.");
      return rows.length===1?readRow(rows[0]):null;
    },
    async listBetweenDetailed(startDate,endDate) {
      return archiveBetween(startDate,endDate);
    },
    async listBetween(startDate,endDate) {
      const result=await archiveBetween(startDate,endDate);
      if(result.unreadable.length)
        throw new GeneratedScheduleStoreError(
          result.unreadable.length+" proposta(s) guardada(s) com estrutura incompatível. A consulta integral foi recusada.");
      return result.records;
    },
  };
}
