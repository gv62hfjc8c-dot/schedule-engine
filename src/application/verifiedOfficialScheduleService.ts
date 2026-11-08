import {
  executeApprovedScheduleCommand,
  type ApprovedScheduleCommand,
  type TrustedApprovalPorts,
  type CommandExecutionResult,
} from "./executeApprovedScheduleCommand";
import { parseOfficialScheduleRequest } from "./officialScheduleRequest";
import type { ScheduleDraft, ApprovalEnvironment } from "../utils/approvedSchedules";
import {
  prepareHistoricalWorkContext,
  type HistoricalContextRequest,
} from "../utils/historicalWorkContext";
import type { WorkValidationDateRange } from "../utils/workConstraints";

/**
 * Trusted application boundary, independent of HTTP, Supabase and React.
 * Only authenticated server-side ports may provide proposed drafts,
 * operating rules and historical evidence. Client JSON is intent-only.
 */
export interface VerifiedOfficialSchedulePorts extends TrustedApprovalPorts {
  loadSavedCandidate(ownerId:string,candidateId:string):Promise<ScheduleDraft|null>;
  /**
   * The adapter MUST load verified sources from server-owned persistence,
   * never accept evidence, coverage booleans or year anchors from the client.
   */
  loadHistoricalEvidence(
    ownerId:string,target:WorkValidationDateRange,
    environment:ApprovalEnvironment,
  ):Promise<HistoricalContextRequest>;
}
export type VerifiedOfficialScheduleResult =
  | CommandExecutionResult
  | {ok:false;code:"missing_candidate"|"history_incomplete"|"invalid_input";
     issues:string[]};

const fail=(code:"missing_candidate"|"history_incomplete"|"invalid_input",
  message:string):VerifiedOfficialScheduleResult=>
  ({ok:false,code,issues:[message]});

/**
 * Gated commands. A missing imported history NEVER becomes "empty".
 * Cancellation needs no new work certification, but all new schedules or
 * partial revisions require complete, proven historical context.
 */
export async function executeVerifiedOfficialScheduleRequest(
  raw:unknown,ports:VerifiedOfficialSchedulePorts,
):Promise<VerifiedOfficialScheduleResult> {
  const parsed=parseOfficialScheduleRequest(raw);
  if(!parsed)return fail("invalid_input","Pedido de aprovação inválido.");
  try {
    const ownerId=await ports.authenticateOwner();
    if(!ownerId?.trim())return {ok:false,code:"unauthorized",
      issues:["Sessão não confirmada."]};
    const ledger=await ports.loadLedger(ownerId);
    if(!ledger)return {ok:false,code:"unknown_context",issues:[
      "Arquivo oficial ainda não inicializado com histórico verificado.",
    ]};
    if(parsed.expectedVersion!==ledger.version)
      return {ok:false,code:"stale_version",issues:[
        "Outra operação já modificou o horário oficial.",
      ]};

    let candidate:ScheduleDraft|null=null;
    if(parsed.kind==="approve"||parsed.kind==="replace") {
      candidate=await ports.loadSavedCandidate(ownerId,parsed.candidateId);
      if(!candidate)return fail("missing_candidate",
        "Proposta imutável não encontrada na conta autenticada.");
      if(candidate.id!==parsed.candidateId)return fail("invalid_input",
        "A proposta recuperada não corresponde ao pedido.");
    }
    const source=parsed.kind==="revise" ?
      ledger.records.find(r=>r.status==="approved"&&r.id===parsed.sourceId)
      :null;
    if(parsed.kind==="revise"&&!source)return fail("invalid_input",
      "O horário oficial a rever não existe ou deixou de estar vigente.");

    let env:ApprovalEnvironment|null=null;
    if(parsed.kind!=="cancel") {
      const target:WorkValidationDateRange=candidate??source!;
      env=await ports.loadEnvironment(ownerId);
      const evidence=await ports.loadHistoricalEvidence(ownerId,target,env);
      // The scope must match the REAL target and trusted configuration.
      const peopleIds=new Set(env.people.map(p=>p.id));
      if(evidence.targetPeriod.startDate!==target.startDate ||
         evidence.targetPeriod.endDate!==target.endDate ||
         evidence.timeZone!==candidate?.timeZone && candidate!==null ||
         evidence.timeZone!==ledger.timeZone ||
         evidence.personIds.length!==peopleIds.size ||
         evidence.personIds.some(id=>!peopleIds.has(id)))
        return fail("history_incomplete",
          "A evidência histórica não corresponde ao período, pessoas e fuso.");
      const history=prepareHistoricalWorkContext(evidence);
      if(history.status!=="ready"||!history.externalContext)return {
        ok:false,code:"history_incomplete",
        issues:history.issues.length?history.issues:[
          "A importação histórica ou a cobertura dos dias não está completa.",
        ],
      };
      env={...env,historicalShifts:history.externalContext.shifts};
    }

    let command:ApprovedScheduleCommand;
    switch(parsed.kind) {
      case "approve":
        command={kind:"approve",expectedVersion:parsed.expectedVersion,
          draft:candidate!};break;
      case "replace":
        command={kind:"replace",expectedVersion:parsed.expectedVersion,
          replaceId:parsed.replaceId,draft:candidate!};break;
      case "cancel":
        command={kind:"cancel",expectedVersion:parsed.expectedVersion,
          scheduleId:parsed.scheduleId};break;
      case "revise":
        command={kind:"revise",expectedVersion:parsed.expectedVersion,
          sourceId:parsed.sourceId,personId:parsed.personId,
          startDate:parsed.startDate,endDate:parsed.endDate,
          reason:parsed.reason,note:parsed.note,
          replacements:parsed.replacements};
    }
    return await executeApprovedScheduleCommand(command,{
      authenticateOwner:async()=>ownerId,
      loadLedger:async()=>ledger,
      loadEnvironment:async()=>{if(!env)throw Error("No certified context");return env;},
      now:ports.now,newRecordId:ports.newRecordId,
      commit:ports.commit,
    });
  } catch {
    return {ok:false,code:"storage_error",issues:[
      "Não foi possível validar os dados oficiais. Nenhuma aprovação foi confirmada.",
    ]};
  }
}
