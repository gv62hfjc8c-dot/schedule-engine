import {
  createSupabaseStateRepository,
  preserveLegacyPeople,
  SupabaseStateError,
} from "./persistence/supabaseStateRepository";
import type { StateRepository, PersistedAppState } from "./persistence/stateRepository";
import type { AuthIdentity } from "./persistence/supabaseAuth";

function ensure(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const weekdays = [
  "monday", "tuesday", "wednesday", "thursday",
  "friday", "saturday", "sunday",
] as const;

function fixture(peopleCount = 3): PersistedAppState {
  return {
    version: 4,
    weeklyOperatingHours: {
      monday: [{ start: "08:00", end: "20:00" }],
      tuesday: [], wednesday: [], thursday: [],
      friday: [], saturday: [], sunday: [],
    },
    exceptions: [],
    people: Array.from({ length: peopleCount }, (_, i) => ({
      id: `colab-${i + 1}`,
      name: `Colaborador ${i + 1}`,
      active: true,
    })),
    availabilities: [],
    workRules: { standardShiftDurationMinutes: 480 },
    weeklyPresenceRequirements: Object.fromEntries(
      weekdays.map((day) => [day, null])
    ) as PersistedAppState["weeklyPresenceRequirements"],
    presenceExceptions: [],
  };
}

function createMockCloud() {
  let revision = 0;
  let state: PersistedAppState | null = null;
  let writes = 0;
  const user: AuthIdentity = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    email: "test@example.com",
  };

  return {
    client: {
      user,
      async request(path: string, init?: RequestInit): Promise<Response> {
        if (path.startsWith("/rest/v1/schedule_engine_states") &&
            !init?.method) {
          return Response.json(state ? [{ revision, payload: state }] : []);
        }
        if (path === "/rest/v1/rpc/save_schedule_engine_state" &&
            init?.method === "POST") {
          const body = JSON.parse(String(init.body)) as {
            p_expected_revision: number;
            p_payload: PersistedAppState;
          };
          if (revision !== body.p_expected_revision) {
            return Response.json(
              { code: "40001", message: "Conflito de revisão." },
              { status: 409 }
            );
          }
          if (state?.people.length && body.p_payload.people.length === 0) {
            return Response.json(
              { code: "22023", message: "Não pode apagar todos os colaboradores." },
              { status: 400 }
            );
          }
          if (state && JSON.stringify(state) === JSON.stringify(body.p_payload)) {
            return Response.json(revision);
          }
          writes++;
          revision++;
          state = body.p_payload;
          return Response.json(revision);
        }
        return Response.json({ error: "Rota inválida" }, { status: 404 });
      },
    },
    setState(value: PersistedAppState) {
      state = value;
      revision++;
    },
    current: () => ({ revision, state, writes }),
  };
}

function legacy(value: PersistedAppState | null) {
  let loads = 0;
  const repo: StateRepository = {
    async load() { loads++; return value; },
    async save() { throw new Error("O browser não deve ser utilizado para gravar."); },
  };
  return { repo, loads: () => loads };
}

const emptyStorage = { getItem: (_key: string): string | null => null };

{
  const cloud = createMockCloud();
  const prior = legacy(fixture());
  const repo = createSupabaseStateRepository(
    cloud.client, prior.repo, emptyStorage
  );

  const imported = await repo.load();
  ensure(imported?.people.length === 3, "Importação inicial deve preservar pessoas.");
  ensure(cloud.current().revision === 1, "Primeiro save cria revisão 1.");
  ensure(prior.loads() === 1, "Lê o browser apenas uma vez.");

  const reloaded = await repo.load();
  ensure(reloaded?.people.length === 3, "Recarregar deve preservar pessoas.");
  ensure(prior.loads() === 1, "Recarregar não volta a importar o browser.");

  await repo.save({ ...imported!, workRules: { standardShiftDurationMinutes: 360 } });
  ensure(cloud.current().revision === 2, "Gravar deve avançar a revisão.");
  ensure(cloud.current().state?.people.length === 3, "Gravar preserva colaboradores.");

  const staleTab = createSupabaseStateRepository(
    cloud.client, legacy(fixture()).repo, emptyStorage
  );
  await staleTab.load();
  cloud.setState({
    ...fixture(),
    workRules: { standardShiftDurationMinutes: 300 },
  });

  let conflict = false;
  try {
    await staleTab.save({ ...fixture(), workRules: { standardShiftDurationMinutes: 240 } });
  } catch (error) {
    conflict = error instanceof SupabaseStateError && error.code === "40001";
  }
  ensure(conflict, "Conflitos de duas abas devem ser rejeitados.");
  ensure(
    cloud.current().state?.workRules.standardShiftDurationMinutes === 300,
    "Conflito não pode alterar a base de dados."
  );
}

{
  const cloud = createMockCloud();
  cloud.setState(fixture());
  const old = legacy({ ...fixture(), people: [] });
  const repo = createSupabaseStateRepository(cloud.client, old.repo, emptyStorage);
  const loaded = await repo.load();
  ensure(loaded?.people.length === 3, "O estado cloud prevalece sobre o browser.");
  ensure(old.loads() === 0, "Com dados na cloud, nunca consulta o browser.");
}

{
  const cloud = createMockCloud();
  const previous = legacy(null);
  const repo = createSupabaseStateRepository(cloud.client, previous.repo, emptyStorage);
  ensure((await repo.load()) === null, "Cloud e browser vazios não criam dados.");
  ensure(cloud.current().revision === 0, "Não deve gravar um estado vazio ao montar.");
  await repo.save(fixture());
  ensure(cloud.current().state?.people.length === 3, "A primeira edição cria dados.");
}

{
  const history = JSON.stringify({
    version: 1,
    people: [
      { id: "old-1", name: "Pessoa Antiga", active: true },
      { id: "old-2", name: "Pessoa Dois", active: true },
      { id: "old-3", name: "Pessoa Três", active: true },
    ],
  });
  const browser = {
    getItem(key: string) {
      return key === "schedule-engine:app-state:v1" ? history : null;
    },
  };
  const restored = preserveLegacyPeople({ ...fixture(), people: [] }, browser);
  ensure(restored.people.length === 3, "Recupera colaboradores do histórico v1.");
  ensure(restored.availabilities.length === 3, "Disponibilidades em falta ficam vazias.");
  ensure(restored.availabilities[0].personId === "old-1", "Mantém IDs antigos.");

  const cloud = createMockCloud();
  const repo = createSupabaseStateRepository(
    cloud.client,
    legacy({ ...fixture(), people: [] }).repo,
    browser
  );
  await repo.load();
  ensure(cloud.current().state?.people.length === 3, "Importação recupera pessoas v1.");
}

console.log("Supabase repository: todos os testes passaram.");
