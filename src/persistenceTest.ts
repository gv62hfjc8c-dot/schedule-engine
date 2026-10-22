import type {
  KeyValueStorage,
} from "./persistence/localStorageStateRepository";
import {
  createLocalStorageStateRepository,
  LEGACY_LOCAL_STORAGE_KEY_V1,
  LOCAL_STORAGE_KEY,
} from "./persistence/localStorageStateRepository";
import {
  APP_STATE_VERSION,
} from "./persistence/stateRepository";

class MemoryStorage implements KeyValueStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const storage = new MemoryStorage();
const repository = createLocalStorageStateRepository(storage);

if ((await repository.load()) !== null) {
  throw new Error("Repositório vazio deveria devolver null");
}

await repository.save({
  version: APP_STATE_VERSION,
  weeklyOperatingHours: {
    monday: [{ start: "09:00", end: "18:00" }],
    tuesday: [{ start: "09:00", end: "18:00" }],
    wednesday: [{ start: "09:00", end: "18:00" }],
    thursday: [{ start: "09:00", end: "18:00" }],
    friday: [{ start: "09:00", end: "18:00" }],
    saturday: [],
    sunday: [],
  },
  exceptions: [
    {
      date: "2026-12-25",
      intervals: [],
    },
  ],
  people: [
    {
      id: "p1",
      name: "Ana Silva",
      active: true,
    },
  ],
  availabilities: [
    {
      personId: "p1",
      weeklyAvailability: {
        monday: [{ start: "09:00", end: "18:00" }],
        tuesday: [],
        wednesday: [],
        thursday: [],
        friday: [],
        saturday: [],
        sunday: [],
      },
      exceptions: [],
    },
  ],
});

const loaded = await repository.load();

if (
  !loaded ||
  loaded.version !== APP_STATE_VERSION ||
  loaded.people[0]?.name !== "Ana Silva" ||
  loaded.availabilities[0]?.personId !== "p1"
) {
  throw new Error("Estado v2 não foi recuperado corretamente");
}

const migrationStorage = new MemoryStorage();

migrationStorage.setItem(
  LEGACY_LOCAL_STORAGE_KEY_V1,
  JSON.stringify({
    version: 1,
    weeklyOperatingHours: {
      monday: [{ start: "09:00", end: "18:00" }],
      tuesday: [],
      wednesday: [],
      thursday: [],
      friday: [],
      saturday: [],
      sunday: [],
    },
    exceptions: [],
    people: [
      {
        id: "legacy-person",
        name: "Pessoa Existente",
        active: true,
      },
    ],
  })
);

const migrationRepository =
  createLocalStorageStateRepository(migrationStorage);

const migrated = await migrationRepository.load();

if (
  !migrated ||
  migrated.version !== APP_STATE_VERSION ||
  migrated.people[0]?.id !== "legacy-person" ||
  migrated.availabilities[0]?.personId !== "legacy-person" ||
  Object.values(
    migrated.availabilities[0].weeklyAvailability
  ).some((intervals) => intervals.length > 0)
) {
  throw new Error("Migração v1 para v2 falhou");
}

if (!migrationStorage.getItem(LOCAL_STORAGE_KEY)) {
  throw new Error("Migração deveria gravar o estado v2");
}

const invalidStorage = new MemoryStorage();
invalidStorage.setItem(LOCAL_STORAGE_KEY, "{invalid json");

if (
  (await createLocalStorageStateRepository(
    invalidStorage
  ).load()) !== null
) {
  throw new Error("JSON inválido deveria ser ignorado");
}

console.log("Persistence V0: todos os testes passaram.");
