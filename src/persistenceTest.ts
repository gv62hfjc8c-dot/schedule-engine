import type {
  KeyValueStorage,
} from "./persistence/localStorageStateRepository";
import {
  createLocalStorageStateRepository,
  BACKUP_LATEST_STORAGE_KEY,
  BACKUP_PEOPLE_STORAGE_KEY,
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
});

const loaded = await repository.load();

if (
  !loaded ||
  loaded.version !== APP_STATE_VERSION ||
  loaded.people[0]?.name !== "Ana Silva" ||
  loaded.workRules.standardShiftDurationMinutes !== 480
) {
  throw new Error(
    "Estado v3 não foi recuperado corretamente"
  );
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
  migratedV2.workRules.standardShiftDurationMinutes !== null
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
  migratedV1.workRules.standardShiftDurationMinutes !== null
) {
  throw new Error(
    "Migração v1 para v3 falhou"
  );
}

const invalidStorage = new MemoryStorage();
invalidStorage.setItem(LOCAL_STORAGE_KEY, "{invalid json");
let invalidWasBlocked = false;
try {
  await createLocalStorageStateRepository(invalidStorage).load();
} catch {
  invalidWasBlocked = true;
}
if (!invalidWasBlocked ||
    invalidStorage.getItem(LOCAL_STORAGE_KEY) !== "{invalid json") {
  throw new Error(
    "JSON inválido tem de bloquear carregamento e preservar conteúdo."
  );
}

const newerStorage = new MemoryStorage();
const newerState = JSON.stringify({
  ...loaded,
  version: APP_STATE_VERSION + 1,
});
newerStorage.setItem(LOCAL_STORAGE_KEY, newerState);
const newerRepository = createLocalStorageStateRepository(newerStorage);
let newerBlocked = false;
try {
  await newerRepository.load();
} catch {
  newerBlocked = true;
}
if (!newerBlocked) {
  throw new Error("Versão futura deve bloquear carregamento.");
}

let newerWriteBlocked = false;
try {
  await newerRepository.save(loaded!);
} catch {
  newerWriteBlocked = true;
}
if (!newerWriteBlocked ||
    newerStorage.getItem(LOCAL_STORAGE_KEY) !== newerState) {
  throw new Error("Versão futura não pode ser sobrescrita.");
}

const protectionStorage = new MemoryStorage();
const protectedRepo = createLocalStorageStateRepository(protectionStorage);
await protectedRepo.load();
await protectedRepo.save(loaded!);
const populatedRaw = protectionStorage.getItem(LOCAL_STORAGE_KEY);
if (!populatedRaw) {
  throw new Error("É necessário ter um estado inicial persistido.");
}

let emptyPeopleRejected = false;
try {
  await protectedRepo.save({ ...loaded!, people: [] });
} catch {
  emptyPeopleRejected = true;
}
if (!emptyPeopleRejected ||
    protectionStorage.getItem(LOCAL_STORAGE_KEY) !== populatedRaw) {
  throw new Error("Não pode apagar todos os colaboradores por acidente.");
}

await protectedRepo.save({
  ...loaded!,
  workRules: { standardShiftDurationMinutes: 360 },
});
if (
  protectionStorage.getItem(BACKUP_LATEST_STORAGE_KEY) !== populatedRaw ||
  protectionStorage.getItem(BACKUP_PEOPLE_STORAGE_KEY) !== populatedRaw
) {
  throw new Error("A versão anterior com colaboradores deve ficar em backup.");
}

const concurrentStorage = new MemoryStorage();
const firstTab = createLocalStorageStateRepository(concurrentStorage);
const secondTab = createLocalStorageStateRepository(concurrentStorage);
await firstTab.load();
await secondTab.load();
await firstTab.save(loaded!);
let concurrentWriteRejected = false;
try {
  await secondTab.save(loaded!);
} catch {
  concurrentWriteRejected = true;
}
if (!concurrentWriteRejected) {
  throw new Error("Alteração noutra janela deve impedir gravação concorrente.");
}

const backupFailureStorage = new MemoryStorage();
const backupFailureRepo = createLocalStorageStateRepository(backupFailureStorage);
await backupFailureRepo.load();
await backupFailureRepo.save(loaded!);
const failingStorage = {
  getItem: (key: string) => backupFailureStorage.getItem(key),
  setItem: (key: string, value: string) => {
    if (key === BACKUP_LATEST_STORAGE_KEY) {
      throw new Error("Falha de armazenamento");
    }
    backupFailureStorage.setItem(key, value);
  },
};
const failingRepo = createLocalStorageStateRepository(failingStorage);
await failingRepo.load();
let backupFailureBlocked = false;
try {
  await failingRepo.save({
    ...loaded!,
    workRules: { standardShiftDurationMinutes: 360 },
  });
} catch {
  backupFailureBlocked = true;
}
if (
  !backupFailureBlocked ||
  backupFailureStorage.getItem(LOCAL_STORAGE_KEY) !== JSON.stringify(loaded)
) {
  throw new Error("Falha no backup deve impedir substituição do estado.");
}

console.log("Persistence V0: todos os testes passaram.");
