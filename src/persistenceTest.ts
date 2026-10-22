import type { KeyValueStorage } from "./persistence/localStorageStateRepository";
import {
  createLocalStorageStateRepository,
  LOCAL_STORAGE_KEY,
} from "./persistence/localStorageStateRepository";
import { APP_STATE_VERSION } from "./persistence/stateRepository";

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

const initialLoad = await repository.load();

if (initialLoad !== null) {
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
});

const loaded = await repository.load();

if (
  !loaded ||
  loaded.version !== APP_STATE_VERSION ||
  loaded.people[0]?.name !== "Ana Silva" ||
  loaded.exceptions[0]?.date !== "2026-12-25"
) {
  throw new Error("Estado persistido não foi recuperado corretamente");
}

storage.setItem(LOCAL_STORAGE_KEY, "{invalid json");

if ((await repository.load()) !== null) {
  throw new Error("JSON inválido deveria ser ignorado");
}

storage.setItem(
  LOCAL_STORAGE_KEY,
  JSON.stringify({
    version: 999,
    weeklyOperatingHours: {},
    exceptions: [],
    people: [],
  })
);

if ((await repository.load()) !== null) {
  throw new Error("Versão incompatível deveria ser ignorada");
}

console.log("Persistence V0: todos os testes passaram.");
