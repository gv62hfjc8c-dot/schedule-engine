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

const emptyWeek = () => ({
  monday: [],
  tuesday: [],
  wednesday: [],
  thursday: [],
  friday: [],
  saturday: [],
  sunday: [],
});

const storage = new MemoryStorage();
const repository = createLocalStorageStateRepository(storage);

if ((await repository.load()) !== null) {
  throw new Error("Repositório vazio deveria devolver null");
}

await repository.save({
  version: APP_STATE_VERSION,
  weeklyOperatingHours: {
    ...emptyWeek(),
    monday: [{ start: "09:00", end: "18:00" }],
  },
  exceptions: [],
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
        ...emptyWeek(),
        monday: [{ start: "09:00", end: "18:00" }],
      },
      exceptions: [],
    },
  ],
  weeklyCoverage: {
    ...emptyWeek(),
    monday: [
      {
        start: "09:00",
        end: "18:00",
        minimumPeople: 2,
      },
    ],
  },
  coverageExceptions: [],
});

const loaded = await repository.load();

if (
  !loaded ||
  loaded.version !== APP_STATE_VERSION ||
  loaded.people[0]?.name !== "Ana Silva" ||
  loaded.weeklyCoverage.monday[0]?.minimumPeople !== 2
) {
  throw new Error("Estado v3 não foi recuperado corretamente");
}

const v2Storage = new MemoryStorage();

v2Storage.setItem(
  LOCAL_STORAGE_KEY,
  JSON.stringify({
    version: 2,
    weeklyOperatingHours: {
      ...emptyWeek(),
      monday: [{ start: "09:00", end: "18:00" }],
    },
    exceptions: [],
    people: [
      {
        id: "existing-person",
        name: "Pessoa Existente",
        active: true,
      },
    ],
    availabilities: [
      {
        personId: "existing-person",
        weeklyAvailability: emptyWeek(),
        exceptions: [],
      },
    ],
  })
);

const migratedV2 = await createLocalStorageStateRepository(
  v2Storage
).load();

if (
  !migratedV2 ||
  migratedV2.version !== APP_STATE_VERSION ||
  migratedV2.people[0]?.id !== "existing-person" ||
  migratedV2.weeklyCoverage.monday.length !== 0 ||
  migratedV2.coverageExceptions.length !== 0
) {
  throw new Error("Migração v2 para v3 falhou");
}

const v1Storage = new MemoryStorage();

v1Storage.setItem(
  LEGACY_LOCAL_STORAGE_KEY_V1,
  JSON.stringify({
    version: 1,
    weeklyOperatingHours: {
      ...emptyWeek(),
      monday: [{ start: "09:00", end: "18:00" }],
    },
    exceptions: [],
    people: [
      {
        id: "legacy-person",
        name: "Pessoa Antiga",
        active: true,
      },
    ],
  })
);

const migratedV1 = await createLocalStorageStateRepository(
  v1Storage
).load();

if (
  !migratedV1 ||
  migratedV1.version !== APP_STATE_VERSION ||
  migratedV1.people[0]?.id !== "legacy-person" ||
  migratedV1.availabilities[0]?.personId !== "legacy-person" ||
  migratedV1.weeklyCoverage.monday.length !== 0
) {
  throw new Error("Migração v1 para v3 falhou");
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
