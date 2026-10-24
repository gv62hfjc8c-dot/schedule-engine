import type { Person, PersonAvailability } from "../types";
import {
  isPersistedAppState,
  LOCAL_STORAGE_KEY,
  LEGACY_LOCAL_STORAGE_KEY_V1,
  BACKUP_PEOPLE_STORAGE_KEY,
} from "./localStorageStateRepository";
import type { PersistedAppState, StateRepository } from "./stateRepository";
import { createPersonAvailability } from "../utils/availability";

type Fetcher = typeof fetch;
type ReadOnlyStorage = Pick<Storage, "getItem">;

interface DatabaseEnvelope {
  revision: number;
  state: PersistedAppState | null;
}

function isEnvelope(value: unknown): value is DatabaseEnvelope {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;

  return Number.isSafeInteger(payload.revision) &&
    (payload.revision as number) >= 0 &&
    (payload.state === null || isPersistedAppState(payload.state));
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    throw new Error(
      "A API SQLite não respondeu com JSON. Confirma que a versão atual do Vite suporta a base de dados."
    );
  }
}

async function errorForResponse(response: Response): Promise<Error> {
  let message = `Falha na base de dados (HTTP ${response.status}).`;
  try {
    const error = await response.json() as { error?: unknown };
    if (typeof error?.error === "string") message = error.error;
  } catch {
    // Keep the HTTP status diagnostic if the server response isn't JSON.
  }
  return new Error(message);
}

function readLegacyPeople(storage: ReadOnlyStorage): {
  people: Person[];
  availabilities: PersonAvailability[];
} | null {
  const candidates = [
    BACKUP_PEOPLE_STORAGE_KEY,
    LEGACY_LOCAL_STORAGE_KEY_V1,
  ];
  for (const key of candidates) {
    const raw = storage.getItem(key);
    if (!raw) continue;

    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const people = parsed.people;

      if (!Array.isArray(people) || people.length === 0) continue;
      if (!people.every(
        (person): person is Person =>
          person && typeof person === "object" &&
          typeof person.id === "string" && person.id.length > 0 &&
          typeof person.name === "string" &&
          typeof person.active === "boolean"
      )) continue;
      if (new Set(people.map((person: Person) => person.id)).size !== people.length) {
        continue;
      }

      // Historical availability is optional. Never invent availability.
      const rawAvailabilities = Array.isArray(parsed.availabilities)
        ? parsed.availabilities
        : [];

      const availabilities = people.map((person: Person) => {
        const candidate = rawAvailabilities.find(
          (item) => item && typeof item === "object" &&
            (item as { personId?: unknown }).personId === person.id
        ) as PersonAvailability | undefined;

        return candidate && candidate.weeklyAvailability && candidate.exceptions
          ? candidate
          : createPersonAvailability(person.id);
      });

      return { people, availabilities };
    } catch {
      // A malformed historical snapshot must not block other candidates.
    }
  }
  return null;
}

function preserveHistoricalPeople(
  state: PersistedAppState,
  storage: ReadOnlyStorage
): PersistedAppState {
  if (state.people.length > 0) return state;

  const legacy = readLegacyPeople(storage);
  if (!legacy) return state;

  const currentAvailabilities = new Map(
    state.availabilities.map((availability) => [
      availability.personId,
      availability,
    ])
  );
  return {
    ...state,
    people: legacy.people,
    availabilities: [
      ...state.availabilities,
      ...legacy.availabilities.filter(
        (candidate) => !currentAvailabilities.has(candidate.personId)
      ),
    ],
  };
}

/**
 * SQLite is the sole source of truth after first import. Browser storage is
 * read only if the database is empty, never after the database has data.
 */
export function createDatabaseStateRepository(
  fetcher: Fetcher,
  legacyRepository: StateRepository,
  browserStorage: ReadOnlyStorage
): StateRepository {
  let revision: number | null = null;

  async function read(): Promise<DatabaseEnvelope> {
    const response = await fetcher("/api/state", {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw await errorForResponse(response);

    const payload = await parseJsonResponse(response);
    if (!isEnvelope(payload)) {
      throw new Error(
        "Formato de dados incompatível na SQLite. A gravação foi bloqueada para proteger os dados."
      );
    }
    return payload;
  }

  async function put(
    state: PersistedAppState,
    expectedRevision: number
  ): Promise<number> {
    const response = await fetcher("/api/state", {
      method: "PUT",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state, expectedRevision }),
    });
    if (!response.ok) throw await errorForResponse(response);

    const payload = await parseJsonResponse(response);
    if (!payload || typeof payload !== "object" ||
        !Number.isSafeInteger((payload as {revision?:unknown}).revision)) {
      throw new Error("Confirmação inválida de gravação na SQLite.");
    }
    return (payload as { revision: number }).revision;
  }

  return {
    async load() {
      const existing = await read();
      revision = existing.revision;

      if (existing.state !== null) {
        return existing.state;
      }

      // First launch only: automatically import saved browser state.
      // Historical snapshots are not removed or mutated.
      const previous = await legacyRepository.load();
      if (!previous) return null;

      const migrated = preserveHistoricalPeople(previous, browserStorage);

      try {
        revision = await put(migrated, existing.revision);
        return migrated;
      } catch (error) {
        // Another tab could have imported the same browser state first.
        // Never replace that newer database value with stale browser data.
        const current = await read();
        if (current.state !== null) {
          revision = current.revision;
          return current.state;
        }
        throw error;
      }
    },

    async save(state) {
      if (revision === null) {
        throw new Error(
          "Ainda não foram carregados os dados SQLite. Gravação bloqueada."
        );
      }

      const previousRevision = revision;
      revision = await put(state, previousRevision);
    },
  };
}
