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
const repository =
  createLocalStorageStateRepository(storage);

if ((await repository.load()) !== null) {
  throw new Error(
    "Repositório vazio deveria devolver null"
  );
}

await repository.save({
  version: APP_STATE_VERSION,
  weeklyOperatingHours: {
    ...emptyWeek(),
    monday: [
      {
        start: "08:00",
        end: "20:00",
      },
    ],
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
        monday: [
          {
            start: "08:00",
            end: "16:00",
          },
        ],
      },
      exceptions: [],
    },
  ],
  workRules: {
    standardShiftDurationMinutes: 480,
  },
  weeklyPresenceRequirements: {
    monday: {
      minimumAtOpening: 2,
      minimumDuringOperation: 1,
      minimumAtClosing: 2,
    },
    tuesday: null,
    wednesday: null,
    thursday: null,
    friday: null,
    saturday: null,
    sunday: null,
  },
  presenceExceptions: [
    {
      date: "2026-12-25",
      requirements: {
        minimumAtOpening: 0,
        minimumDuringOperation: 0,
        minimumAtClosing: 0,
      },
    },
  ],
});

const loaded = await repository.load();

if (
  !loaded ||
  loaded.version !== APP_STATE_VERSION ||
  loaded.people[0]?.name !== "Ana Silva" ||
  loaded.workRules.standardShiftDurationMinutes !== 480 ||
  loaded.weeklyPresenceRequirements.monday?.minimumAtOpening !== 2 ||
  loaded.presenceExceptions[0]?.date !== "2026-12-25"
) {
  throw new Error(
    "Estado v3 não foi recuperado corretamente"
  );
}

const v3Storage = new MemoryStorage();

v3Storage.setItem(
  LOCAL_STORAGE_KEY,
  JSON.stringify({
    version: 3,
    weeklyOperatingHours: {
      ...emptyWeek(),
      monday: [{ start: "09:00", end: "18:00" }],
    },
    exceptions: [],
    people: [{ id: "existing-v3", name: "Pessoa V3", active: true }],
    availabilities: [{
      personId: "existing-v3",
      weeklyAvailability: emptyWeek(),
      exceptions: [],
    }],
    workRules: { standardShiftDurationMinutes: 480 },
  })
);

const migratedV3 = await createLocalStorageStateRepository(v3Storage).load();

if (
  !migratedV3 ||
  migratedV3.version !== APP_STATE_VERSION ||
  migratedV3.people[0]?.id !== "existing-v3" ||
  migratedV3.workRules.standardShiftDurationMinutes !== 480 ||
  migratedV3.weeklyPresenceRequirements.monday !== null ||
  migratedV3.presenceExceptions.length !== 0
) {
  throw new Error("Migração v3 para v4 não preservou os dados ou criou mínimos fictícios.");
}

const v2Storage = new MemoryStorage();

v2Storage.setItem(
  LOCAL_STORAGE_KEY,
  JSON.stringify({
    version: 2,
    weeklyOperatingHours: {
      ...emptyWeek(),
      monday: [
        {
          start: "09:00",
          end: "18:00",
        },
      ],
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

const migratedV2 =
  await createLocalStorageStateRepository(
    v2Storage
  ).load();

if (
  !migratedV2 ||
  migratedV2.version !== APP_STATE_VERSION ||
  migratedV2.people[0]?.id !== "existing-person" ||
  migratedV2.workRules.standardShiftDurationMinutes !== null ||
  migratedV2.weeklyPresenceRequirements.monday !== null
) {
  throw new Error(
    "Migração v2 para v3 falhou"
  );
}

const v1Storage = new MemoryStorage();

v1Storage.setItem(
  LEGACY_LOCAL_STORAGE_KEY_V1,
  JSON.stringify({
    version: 1,
    weeklyOperatingHours: {
      ...emptyWeek(),
      monday: [
        {
          start: "09:00",
          end: "18:00",
        },
      ],
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

const migratedV1 =
  await createLocalStorageStateRepository(
    v1Storage
  ).load();

if (
  !migratedV1 ||
  migratedV1.version !== APP_STATE_VERSION ||
  migratedV1.people[0]?.id !== "legacy-person" ||
  migratedV1.availabilities[0]?.personId !==
    "legacy-person" ||
  migratedV1.workRules.standardShiftDurationMinutes !== null ||
  migratedV1.weeklyPresenceRequirements.monday !== null
) {
  throw new Error(
    "Migração v1 para v3 falhou"
  );
}

const zeroStorage = new MemoryStorage();
zeroStorage.setItem(
  LOCAL_STORAGE_KEY,
  JSON.stringify({
    ...loaded,
    weeklyPresenceRequirements: {
      ...loaded!.weeklyPresenceRequirements,
      monday: { minimumAtOpening: 0, minimumDuringOperation: 0, minimumAtClosing: 0 },
    },
  })
);
const zeroLoaded = await createLocalStorageStateRepository(zeroStorage).load();
if (!zeroLoaded || zeroLoaded.weeklyPresenceRequirements.monday?.minimumDuringOperation !== 0) {
  throw new Error("Mínimo zero explícito deve sobreviver à persistência.");
}

const invalidStorage = new MemoryStorage();
invalidStorage.setItem(
  LOCAL_STORAGE_KEY,
  "{invalid json"
);

if (
  (
    await createLocalStorageStateRepository(
      invalidStorage
    ).load()
  ) !== null
) {
  throw new Error(
    "JSON inválido deveria ser ignorado"
  );
}

console.log(
  "Persistence V0: todos os testes passaram."
);
