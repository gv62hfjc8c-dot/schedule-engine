import type { SupabaseAuthClient } from "./supabaseAuth";
import {
  validateApprovedScheduleLedger,
  type ApprovedScheduleLedger, type ApprovedScheduleRecord,
} from "../utils/approvedSchedules";

type Client = Pick<SupabaseAuthClient,"request"|"user">;
export type OfficialScheduleAction =
  | {kind:"approve";candidateId:string;expectedVersion:number}
  | {kind:"replace";candidateId:string;replaceId:string;expectedVersion:number}
  | {kind:"cancel";scheduleId:string;expectedVersion:number};
export type OfficialScheduleActionResult =
  | {ok:true;record:ApprovedScheduleRecord;version:number}
  | {ok:false;code:string;issues:string[]};

export interface OfficialScheduleRepository {
  load():Promise<ApprovedScheduleLedger|null>;
  execute(action:OfficialScheduleAction):Promise<OfficialScheduleActionResult>;
}
function confirmedOwner(client:Client):string {
  const id=client.user?.id;
  if (!id) throw new Error("Inicia sessão para consultar os horários oficiais.");
  return id;
}
async function decoded(response:Response):Promise<unknown> {
  try { return await response.json() as unknown; }
  catch { throw new Error("Resposta do servidor de aprovação inválida."); }
}
export function createOfficialScheduleRepository(client:Client):OfficialScheduleRepository {
  return {
    async load() {
      const id=confirmedOwner(client);
      const response=await client.request(
        "/rest/v1/schedule_engine_approved_ledgers" +
        "?select=ledger_version,payload&owner_id=eq." +
        encodeURIComponent(id)+"&limit=1"
      );
      const rows=await decoded(response);
      if(!response.ok || !Array.isArray(rows) || rows.length>1)
        throw new Error("Não foi possível consultar os horários oficiais.");
      if(client.user?.id!==id)throw new Error("A sessão mudou. Atualiza o histórico.");
      if(!rows.length)return null;
      const row=rows[0] as Record<string,unknown>;
      if(!row||typeof row!=="object"||
        !Number.isSafeInteger(row.ledger_version) ||
        validateApprovedScheduleLedger(row.payload).length>0 ||
        (row.payload as ApprovedScheduleLedger).version!==row.ledger_version)
        throw new Error("O arquivo oficial está inconsistente. Operações bloqueadas.");
      return structuredClone(row.payload as ApprovedScheduleLedger);
    },
    async execute(action) {
      confirmedOwner(client);
      if(!Number.isSafeInteger(action.expectedVersion)||action.expectedVersion<0)
        throw new Error("Versão de aprovação inválida.");
      const response=await client.request("/functions/v1/official-schedules",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify(action),
      });
      const payload=await decoded(response);
      if(!payload||typeof payload!=="object"||typeof (payload as {ok?:unknown}).ok!=="boolean")
        throw new Error("O servidor não confirmou o resultado. Reconsulta o histórico.");
      const result=payload as OfficialScheduleActionResult;
      if(result.ok && (!response.ok || !Number.isSafeInteger(result.version) ||
        !result.record || typeof result.record.id!=="string"))
        throw new Error("A aprovação necessita de confirmação. Reconsulta o histórico.");
      if(!result.ok && !Array.isArray(result.issues))
        throw new Error("O servidor devolveu uma recusa inválida.");
      return result;
    },
  };
}
