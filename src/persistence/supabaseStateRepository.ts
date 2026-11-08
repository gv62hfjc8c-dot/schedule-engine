import type { Person, PersonAvailability } from "../types";
import { createPersonAvailability } from "../utils/availability";
import type { PersistedAppState, StateRepository } from "./stateRepository";
import {
  BACKUP_PEOPLE_STORAGE_KEY,
  LEGACY_LOCAL_STORAGE_KEY_V1,
  isPersistedAppState,
} from "./localStorageStateRepository";
import type { SupabaseAuthClient } from "./supabaseAuth";
import { mergePersistedStates } from "../utils/threeWayStateMerge";

interface BrowserStateSource {
  getItem(key: string): string | null;
}

/**
 * Legacy browser data is not owner-scoped. A new cloud identity must explicitly
 * claim it before any first import. Existing cloud state is never affected.
 */
export const LEGACY_IMPORT_CONSENT_PREFIX = "schedule-engine:legacy-import:owner:";
export class LegacyImportConsentRequiredError extends Error {
  constructor() {
    super("Existem dados antigos neste navegador sem associação confirmada à conta atual. A importação requer consentimento explícito.");
    this.name = "LegacyImportConsentRequiredError";
  }
}
export function authorizeLegacyImportForOwner(
  storage: Pick<Storage, "setItem">, ownerId: string,
): void {
  if (!ownerId.trim()) throw new Error("Conta não autenticada.");
  storage.setItem(LEGACY_IMPORT_CONSENT_PREFIX + ownerId, "confirmed");
}

export class SupabaseStateError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = "SupabaseStateError";
  }
}
export class SupabaseStateConflictError extends Error {
  constructor(readonly fields:string[]) {
    super("Edições simultâneas incompatíveis em: "+
      fields.slice(0,8).join(", ")+
      (fields.length>8?" …":"")+
      ". Exporta as alterações locais antes de recarregar.");
    this.name="SupabaseStateConflictError";
  }
}

async function readError(response: Response): Promise<SupabaseStateError> {
  let message = `A base de dados respondeu HTTP ${response.status}.`;
  let code: string | undefined;
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object") {
      const fields = body as Record<string, unknown>;
      if (typeof fields.message === "string") message = fields.message;
      if (typeof fields.code === "string") code = fields.code;
      if (typeof fields.error === "string") message = fields.error;
    }
  } catch {
    // Preserve the HTTP status if the remote response was not JSON.
  }
  return new SupabaseStateError(message, response.status, code);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    throw new Error("A base de dados devolveu uma resposta inválida.");
  }
}

function historicalPeople(browser: BrowserStateSource): {
  people: Person[];
  availabilities: PersonAvailability[];
} | null {
  for (const key of [BACKUP_PEOPLE_STORAGE_KEY, LEGACY_LOCAL_STORAGE_KEY_V1]) {
    const raw = browser.getItem(key);
    if (!raw) continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") continue;
      const fields = parsed as Record<string, unknown>;
      if (!Array.isArray(fields.people) || fields.people.length === 0) continue;

      const people: Person[] = [];
      for (const candidate of fields.people) {
        if (!candidate || typeof candidate !== "object" ||
            typeof candidate.id !== "string" || !candidate.id ||
            typeof candidate.name !== "string" ||
            typeof candidate.active !== "boolean") {
          people.length = 0;
          break;
        }
        people.push(candidate as Person);
      }

      if (people.length === 0 ||
          new Set(people.map((person) => person.id)).size !== people.length) {
        continue;
      }

      const candidates = Array.isArray(fields.availabilities)
        ? fields.availabilities
        : [];
      const availabilities: PersonAvailability[] = people.map((person) => {
        const existing = candidates.find(
          (candidate) => candidate &&
            typeof candidate === "object" &&
            (candidate as Record<string, unknown>).personId === person.id &&
            typeof (candidate as Record<string, unknown>).weeklyAvailability === "object" &&
            Array.isArray((candidate as Record<string, unknown>).exceptions)
        );
        return existing
          ? existing as PersonAvailability
          : createPersonAvailability(person.id);
      });
      return { people, availabilities };
    } catch {
      // A damaged historical snapshot should not hide another valid backup.
    }
  }
  return null;
}

export function preserveLegacyPeople(
  state: PersistedAppState,
  browser: BrowserStateSource
): PersistedAppState {
  if (state.people.length > 0) return state;
  const older = historicalPeople(browser);
  if (!older) return state;

  const existingIds = new Set(state.availabilities.map((a) => a.personId));
  return {
    ...state,
    people: older.people,
    availabilities: [
      ...state.availabilities,
      ...older.availabilities.filter((a) => !existingIds.has(a.personId)),
    ],
  };
}

/**
 * The cloud is authoritative once its first revision exists.
 * Browser storage is read solely for the very first user-scoped import.
 */
export function createSupabaseStateRepository(
  client: Pick<SupabaseAuthClient, "request" | "user">,
  oldRepository: StateRepository,
  browser: BrowserStateSource
): StateRepository {
  let revision: number | null = null;
  let revisionOwnerId: string | null = null;
  let baseline: PersistedAppState | null = null;
  // The latest UI request can be older than a merged server revision when
  // multiple autosaves are queued. Track UI deltas independently from the
  // server snapshot so a later request cannot silently revert remote edits.
  let lastUiState: PersistedAppState | null = null;
  let conflictLocked=false;
  // Changes from a single browser session are serialized so each RPC sees
  // the revision returned by the previous write. Multi-tab conflicts still
  // fail closed under the PostgreSQL compare-and-swap contract.
  let saveQueue: Promise<void> = Promise.resolve();
  const requireOwner = ():string => {
    const id=client.user?.id;
    if (!id) throw new Error("É necessário iniciar sessão.");
    return id;
  };
  const verifyOwner=(expected:string):void => {
    if (client.user?.id !== expected) {
      revision = null;
      revisionOwnerId = null;
      baseline = null;
      lastUiState=null;
      conflictLocked=true;
      throw new Error("A sessão mudou durante a operação. Recarrega os dados da conta.");
    }
  };

  async function readRemote(): Promise<{
    revision: number;
    state: PersistedAppState | null;
  }> {
    const ownerId=requireOwner();
    const query = `?select=revision,payload&owner_id=eq.${encodeURIComponent(ownerId)}&limit=1`;
    const response = await client.request(
      "/rest/v1/schedule_engine_states" + query
    );
    verifyOwner(ownerId);
    if (!response.ok) throw await readError(response);

    const rows = await readJson(response);
    verifyOwner(ownerId);
    if (!Array.isArray(rows)) throw new Error("Resposta Supabase inválida.");
    if (rows.length === 0) return { revision: 0, state: null };
    if (rows.length !== 1) throw new Error("Estado Supabase ambíguo.");

    const item = rows[0] as Record<string, unknown>;
    if (typeof item.revision !== "number" ||
        !Number.isSafeInteger(item.revision) || item.revision < 1 ||
        !isPersistedAppState(item.payload)) {
      throw new Error(
        "Existe um estado incompatível na base de dados. Gravação bloqueada."
      );
    }
    return { revision: item.revision, state: item.payload };
  }

  async function saveRemote(
    state: PersistedAppState,
    expectedRevision: number
  ): Promise<number> {
    if (!isPersistedAppState(state)) {
      throw new Error("O estado local é incompatível. Gravação bloqueada.");
    }

    const ownerId=requireOwner();
    const response = await client.request(
      "/rest/v1/rpc/save_schedule_engine_state",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          p_expected_revision: expectedRevision,
          p_payload: state,
        }),
      }
    );
    verifyOwner(ownerId);
    if (!response.ok) throw await readError(response);

    const result = await readJson(response);
    verifyOwner(ownerId);
    if (typeof result !== "number" ||
        !Number.isSafeInteger(result) || result <= 0) {
      throw new Error("Confirmação de gravação inválida no Supabase.");
    }
    return result;
  }

  return {
    async load() {
      const ownerId=requireOwner();
      const remote = await readRemote();
      verifyOwner(ownerId);
      revision = remote.revision;
      revisionOwnerId = ownerId;
      baseline = remote.state===null?null:structuredClone(remote.state);
      lastUiState=remote.state===null?null:structuredClone(remote.state);
      conflictLocked=false;
      if (remote.state !== null) {
        return remote.state;
      }

      // First import only. Never replace an existing cloud state with local data.
      const old = await oldRepository.load();
      verifyOwner(ownerId);
      if (!old) return null;
      if (browser.getItem(LEGACY_IMPORT_CONSENT_PREFIX + ownerId) !== "confirmed")
        throw new LegacyImportConsentRequiredError();
      const migrated = preserveLegacyPeople(old, browser);

      try {
        const nextRevision=await saveRemote(migrated, 0);
        verifyOwner(ownerId);
        revision=nextRevision;
        baseline=structuredClone(migrated);
        lastUiState=structuredClone(migrated);
        return migrated;
      } catch (error) {
        // Concurrency: another tab may have imported first. Re-read only
        // after a known revision conflict, never on arbitrary network errors.
        if (error instanceof SupabaseStateError && error.code === "40001") {
          const current = await readRemote();
          verifyOwner(ownerId);
          revision = current.revision;
          baseline=current.state===null?null:structuredClone(current.state);
          lastUiState=current.state===null?null:structuredClone(current.state);
          if (current.state !== null) return current.state;
        }
        throw error;
      }
    },

    async save(state) {
      const ownerId=requireOwner();
      if (revisionOwnerId !== ownerId || revision === null || conflictLocked) {
        throw new Error("É necessário recarregar os dados desta conta antes de guardar.");
      }
      // Snapshot caller state at invocation time, NOT after waiting for the
      // queue. A newer UI event may already have edited the same objects.
      const original=structuredClone(state);
      const uiBaseline=lastUiState===null?null:structuredClone(lastUiState);
      lastUiState=structuredClone(original);
      const operation=saveQueue.then(async():Promise<PersistedAppState|void>=>{
        verifyOwner(ownerId);
        if(conflictLocked || revisionOwnerId!==ownerId || revision===null)
          throw new Error("Gravação bloqueada após conflito. Exporta os dados e recarrega a conta.");
        const startBaseline=baseline===null?null:structuredClone(baseline);
        let candidate=original;
        let reconciled=false;
        if(uiBaseline && startBaseline) {
          const queued=mergePersistedStates(uiBaseline,original,startBaseline);
          if(!queued.ok)throw new SupabaseStateConflictError(queued.conflicts);
          candidate=queued.state;
          if(!isPersistedAppState(candidate))
            throw new Error("A conciliação dos pedidos em fila produziu dados inválidos.");
          reconciled=JSON.stringify(candidate)!==JSON.stringify(original);
        }
        let expected=revision;
        for(let attempt=0;attempt<3;attempt++){
          verifyOwner(ownerId);
          try {
            const nextRevision=await saveRemote(candidate,expected);
            verifyOwner(ownerId);
            revision=nextRevision;
            baseline=structuredClone(candidate);
            // If server changes were merged, the caller must hydrate them.
            return reconciled?candidate:undefined;
          }catch(error){
            if(!(error instanceof SupabaseStateError)||
              error.code!=="40001"||attempt===2) throw error;
            const current=await readRemote();
            verifyOwner(ownerId);
            if(!current.state||!startBaseline) throw error;
            const result=mergePersistedStates(startBaseline,candidate,current.state);
            if(!result.ok)throw new SupabaseStateConflictError(result.conflicts);
            if(!isPersistedAppState(result.state))
              throw new Error("A conciliação gerou dados inválidos; gravação cancelada.");
            candidate=result.state;
            expected=current.revision;
            reconciled=true;
          }
        }
      }).catch(error=>{
        // Any uncertain/failed write locks all queued writes. Otherwise a
        // later queued snapshot could overwrite a conflicting server edit.
        conflictLocked=true;
        throw error;
      });
      saveQueue=operation.then(()=>undefined,()=>undefined);
      return operation;
    },
  };
}
