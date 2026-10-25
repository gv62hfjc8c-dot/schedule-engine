import type { Person, PersonAvailability } from "../types";
import { createPersonAvailability } from "../utils/availability";
import type { PersistedAppState, StateRepository } from "./stateRepository";
import {
  BACKUP_PEOPLE_STORAGE_KEY,
  LEGACY_LOCAL_STORAGE_KEY_V1,
  isPersistedAppState,
} from "./localStorageStateRepository";
import type { SupabaseAuthClient } from "./supabaseAuth";

interface BrowserStateSource {
  getItem(key: string): string | null;
}

export class SupabaseStateError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = "SupabaseStateError";
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

  async function readRemote(): Promise<{
    revision: number;
    state: PersistedAppState | null;
  }> {
    const user = client.user;
    if (!user) throw new Error("É necessário iniciar sessão.");

    const query = `?select=revision,payload&owner_id=eq.${encodeURIComponent(user.id)}&limit=1`;
    const response = await client.request(
      "/rest/v1/schedule_engine_states" + query
    );
    if (!response.ok) throw await readError(response);

    const rows = await readJson(response);
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
    if (!response.ok) throw await readError(response);

    const result = await readJson(response);
    if (typeof result !== "number" ||
        !Number.isSafeInteger(result) || result <= 0) {
      throw new Error("Confirmação de gravação inválida no Supabase.");
    }
    return result;
  }

  return {
    async load() {
      const remote = await readRemote();
      revision = remote.revision;
      if (remote.state !== null) {
        return remote.state;
      }

      // First import only. Never replace an existing cloud state with local data.
      const old = await oldRepository.load();
      if (!old) return null;
      const migrated = preserveLegacyPeople(old, browser);

      try {
        revision = await saveRemote(migrated, 0);
        return migrated;
      } catch (error) {
        // Concurrency: another tab may have imported first. Re-read only
        // after a known revision conflict, never on arbitrary network errors.
        if (error instanceof SupabaseStateError && error.code === "40001") {
          const current = await readRemote();
          revision = current.revision;
          if (current.state !== null) return current.state;
        }
        throw error;
      }
    },

    async save(state) {
      if (revision === null) {
        throw new Error(
          "É necessário carregar os dados Supabase antes de guardar."
        );
      }
      revision = await saveRemote(state, revision);
    },
  };
}
