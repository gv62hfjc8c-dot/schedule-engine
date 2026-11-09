/**
 * Notify OTHER browser tabs after a successfully acknowledged state write.
 * This is only an advisory local signal, never an authorization or a source
 * of persisted truth. Real conflict prevention remains PostgreSQL CAS/RLS.
 *
 * No personnel data, payloads, credentials or session tokens are broadcast.
 */
const prefix="schedule-engine:state-commit:v1:";
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function crossTabCommitKey(ownerId:string):string {
  if(!uuid.test(ownerId))
    throw Error("Identificador da conta inválido para sincronização entre abas.");
  return prefix+ownerId;
}

/** A new random value is required so every successful commit emits an event. */
export function notifyOtherTabsOfStateCommit(
  storage:Pick<Storage,"setItem">,ownerId:string,nonce:string,
):void {
  if(!uuid.test(nonce))
    throw Error("Identificador de evento inválido.");
  storage.setItem(crossTabCommitKey(ownerId),nonce);
}

/** Only react to a commit made for the currently signed-in owner. */
export function isOtherTabStateCommit(
  key:string|null,newValue:string|null,ownerId:string,
):boolean {
  if(!key||!newValue||!uuid.test(newValue)||!uuid.test(ownerId))
    return false;
  return key===prefix+ownerId;
}
