import {
  isGeneratedSchedulePayload,
  type GeneratedSchedulePayload,
} from "../persistence/generatedScheduleRepository";

/**
 * Durable last-resort proposal outbox. The authenticated owner is part of the
 * storage key and envelope; never import a pending proposal for another user.
 *
 * Saving here is synchronous and happens BEFORE the first network request.
 * The same UUID is reused on retries. This is not an approved schedule and
 * does not replace authoritative server persistence.
 */
export interface PendingGeneratedProposal {
  ownerId: string;
  id: string;
  payload: GeneratedSchedulePayload;
}
export interface ProposalOutboxStore {
  getItem(key: string): string|null;
  setItem(key: string,value: string): void;
  removeItem(key: string): void;
}
const prefix="schedule-engine:proposal-outbox:v1:";
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ownerKey=(ownerId:string):string=>{
  if(!uuid.test(ownerId))throw Error("Identidade de conta inválida no arquivo local.");
  return prefix+ownerId;
};
function parse(value:string,ownerId:string):PendingGeneratedProposal {
  let read:unknown;
  try { read=JSON.parse(value); }
  catch { throw Error("Existe uma proposta pendente com JSON incompatível. Não será substituída."); }
  if(!read || typeof read!=="object" || Array.isArray(read))
    throw Error("A proposta pendente não tem estrutura válida.");
  const o=read as Record<string,unknown>;
  if(o.ownerId!==ownerId || typeof o.id!=="string" ||
      !uuid.test(o.id) || !isGeneratedSchedulePayload(o.payload))
    throw Error("A proposta pendente não pertence à conta ou está danificada.");
  return {ownerId,id:o.id,payload:o.payload};
}
export function loadPendingGeneratedProposal(
  store:ProposalOutboxStore,ownerId:string,
):PendingGeneratedProposal|null{
  const raw=store.getItem(ownerKey(ownerId));
  return raw?parse(raw,ownerId):null;
}
export function stagePendingGeneratedProposal(
  store:ProposalOutboxStore,entry:PendingGeneratedProposal,
):void{
  const key=ownerKey(entry.ownerId);
  if(!uuid.test(entry.id)||!isGeneratedSchedulePayload(entry.payload))
    throw Error("A proposta não pode ser preparada para recuperação.");
  const previous=store.getItem(key);
  if(previous){
    const existing=parse(previous,entry.ownerId);
    if(existing.id!==entry.id ||
      JSON.stringify(existing.payload)!==JSON.stringify(entry.payload))
      throw Error("Existe uma proposta anterior pendente de confirmação. Recupera-a antes de gerar outra.");
    return; // Same request: preserve identical bytes across retries.
  }
  store.setItem(key,JSON.stringify(entry));
}
export function acknowledgePendingGeneratedProposal(
  store:ProposalOutboxStore,ownerId:string,id:string,
):boolean{
  const key=ownerKey(ownerId);
  const pending=loadPendingGeneratedProposal(store,ownerId);
  if(!pending||pending.id!==id)return false;
  store.removeItem(key);
  return true;
}
