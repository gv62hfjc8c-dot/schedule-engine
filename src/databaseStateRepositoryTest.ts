import { createDatabaseStateRepository } from "./persistence/databaseStateRepository";
import type { PersistedAppState, StateRepository } from "./persistence/stateRepository";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const weekdays = [
  "monday","tuesday","wednesday","thursday",
  "friday","saturday","sunday",
] as const;

function fixture(): PersistedAppState {
  return {
    version: 4,
    weeklyOperatingHours: {
      monday: [{ start: "08:00", end: "20:00" }],
      tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: [],
    },
    exceptions: [],
    people: [
      { id: "p1", name: "Colaborador 1", active: true },
      { id: "p2", name: "Colaborador 2", active: true },
      { id: "p3", name: "Colaborador 3", active: true },
    ],
    availabilities: [],
    workRules: { standardShiftDurationMinutes: 480 },
    weeklyPresenceRequirements: Object.fromEntries(
      weekdays.map((day) => [day, null])
    ) as PersistedAppState["weeklyPresenceRequirements"],
    presenceExceptions: [],
  };
}

function fakeServer() {
  let revision = 0;
  let state: PersistedAppState | null = null;

  const fetcher: typeof fetch = async (_input, init) => {
    if (init?.method === "GET") {
      return Response.json({ revision, state });
    }
    if (init?.method === "PUT") {
      const request = JSON.parse(String(init.body)) as {
        expectedRevision: number;
        state: PersistedAppState;
      };
      if (request.expectedRevision !== revision) {
        return Response.json({ error: "Conflito de revisão." }, { status: 409 });
      }
      revision++;
      state = request.state;
      return Response.json({ revision });
    }
    return Response.json({ error: "Método inválido." }, { status: 405 });
  };

  return {
    fetcher,
    current: () => ({ revision, state }),
    externalUpdate: (newState: PersistedAppState) => {
      revision++;
      state = newState;
    },
  };
}

function browser(previous: PersistedAppState | null) {
  let loads = 0;
  const legacy: StateRepository = {
    async load() { loads++; return previous; },
    async save() { throw new Error("Browser não deve ser usado para guardar."); },
  };
  const storage: Pick<Storage, "getItem"> = {
    getItem() { return null; },
  };
  return {
    legacy, storage,
    loads: () => loads,
  };
}

const server = fakeServer();
const original = browser(fixture());
const repository = createDatabaseStateRepository(
  server.fetcher, original.legacy, original.storage
);

const imported = await repository.load();
assert(imported?.people.length === 3, "A primeira carga tem de importar colaboradores.");
assert(server.current().revision === 1, "Importação automática tem de criar revisão inicial.");
assert(original.loads() === 1, "O navegador só deve ser consultado para primeira importação.");

const repeated = await repository.load();
assert(repeated?.people.length === 3, "A carga seguinte tem de vir da SQLite.");
assert(original.loads() === 1, "Uma base já preenchida não deve voltar ao localStorage.");

await repository.save({
  ...imported!,
  workRules: { standardShiftDurationMinutes: 360 },
});
assert(server.current().revision === 2, "Guardar deve avançar a revisão.");
assert(server.current().state?.people.length === 3, "A gravação não pode remover colaboradores.");

const otherTab = createDatabaseStateRepository(
  server.fetcher, browser(fixture()).legacy, original.storage
);
await otherTab.load();

server.externalUpdate({
  ...fixture(),
  workRules: { standardShiftDurationMinutes: 300 },
});
let conflict = false;
try {
  await otherTab.save({
    ...fixture(),
    workRules: { standardShiftDurationMinutes: 240 },
  });
} catch {
  conflict = true;
}
assert(conflict, "Gravação de uma revisão antiga deve ser rejeitada.");
assert(
  server.current().state?.workRules.standardShiftDurationMinutes === 300,
  "Conflito não pode alterar o estado existente."
);

const emptyServer = fakeServer();
const emptyLegacy = browser(null);
const emptyRepository = createDatabaseStateRepository(
  emptyServer.fetcher, emptyLegacy.legacy, emptyLegacy.storage
);
assert((await emptyRepository.load()) === null, "Instalação nova começa sem dados.");
assert(emptyServer.current().revision === 0, "Não se deve gravar ao iniciar sem dados.");

await emptyRepository.save(fixture());
assert(emptyServer.current().state?.people.length === 3, "Primeira edição deve criar o estado.");

const browserWithMissingPeople = browser({ ...fixture(), people: [] });
const oldV1 = JSON.stringify({
  version: 1,
  people: [{ id: "p-old", name: "Pessoa V1", active: true }],
});
const storageWithV1: Pick<Storage, "getItem"> = {
  getItem(key) {
    return key === "schedule-engine:app-state:v1" ? oldV1 : null;
  },
};
const migratedServer = fakeServer();
const importedWithRecovery = await createDatabaseStateRepository(
  migratedServer.fetcher,
  browserWithMissingPeople.legacy,
  storageWithV1
).load();
assert(
  importedWithRecovery?.people[0]?.id === "p-old",
  "Os dados históricos não devem ser ignorados na primeira importação."
);
assert(
  importedWithRecovery?.availabilities[0]?.personId === "p-old",
  "Disponibilidade em falta deve ficar vazia e associada à pessoa restaurada."
);

console.log("Database Repository V0: todos os testes passaram.");
