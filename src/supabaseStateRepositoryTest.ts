import {
  createSupabaseStateRepository,
  preserveLegacyPeople,
  SupabaseStateError,
  SupabaseStateConflictError,
  LEGACY_IMPORT_CONSENT_PREFIX,
  LegacyImportConsentRequiredError,
  authorizeLegacyImportForOwner,
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
const ownerConsent = { getItem: (key: string): string | null =>
  key === LEGACY_IMPORT_CONSENT_PREFIX + "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    ? "confirmed" : null };

{
  const cloud = createMockCloud();
  const repo = createSupabaseStateRepository(cloud.client, legacy(fixture()).repo, emptyStorage);
  let blocked = false;
  try { await repo.load(); }
  catch (error) { blocked = error instanceof LegacyImportConsentRequiredError; }
  ensure(blocked, "Never import browser data to an unconfirmed owner.");
  ensure(cloud.current().writes === 0, "A rejected legacy import must never write.");
  let storedKey = "", storedValue = "";
  authorizeLegacyImportForOwner({setItem: (key,value) => {
    storedKey = key; storedValue = value;
  }},cloud.client.user.id);
  ensure(storedKey === LEGACY_IMPORT_CONSENT_PREFIX + cloud.client.user.id &&
    storedValue === "confirmed", "Consent is explicitly owner-scoped.");
}


{
  const cloud = createMockCloud();
  const prior = legacy(fixture());
  const repo = createSupabaseStateRepository(
    cloud.client, prior.repo, ownerConsent
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
    conflict = error instanceof SupabaseStateConflictError &&
      error.fields.includes("workRules.standardShiftDurationMinutes");
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
      return key === "schedule-engine:app-state:v1" ? history :
        key === LEGACY_IMPORT_CONSENT_PREFIX + "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
          ? "confirmed" : null;
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


// PR47-F: a revision loaded for one authenticated owner must never be
// reusable for another account, even if both accounts have revision 1.
{
  const cloud=createMockCloud();
  cloud.setState(fixture());
  let currentUser:AuthIdentity | null={...cloud.client.user};
  let writes=0;
  const client={
    get user(){return currentUser;},
    request:async(path:string,init?:RequestInit)=>{
      if(init?.method==="POST") writes++;
      return cloud.client.request(path,init);
    },
  };
  const repository=createSupabaseStateRepository(client,legacy(null).repo,emptyStorage);
  await repository.load();
  currentUser={id:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",email:"other@example.test"};
  let switched=false;
  try {await repository.save(fixture());}
  catch(error){switched=error instanceof Error && error.message.includes("desta conta");}
  ensure(switched && writes===0,
    "An old account revision must not authorize a write in a new account.");
}
// Changing owner while waiting for a remote read must not hydrate data
// belonging to the prior identity.
{
  const cloud=createMockCloud();
  cloud.setState(fixture());
  let currentUser:AuthIdentity | null={...cloud.client.user};
  const client={
    get user(){return currentUser;},
    request:async(path:string,init?:RequestInit)=>{
      const response=await cloud.client.request(path,init);
      currentUser={id:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",email:"new@example.test"};
      return response;
    },
  };
  const repository=createSupabaseStateRepository(client,legacy(null).repo,emptyStorage);
  let rejected=false;
  try {await repository.load();} catch(error) {
    rejected=error instanceof Error && error.message.includes("sessão mudou");
  }
  ensure(rejected,"A stale cloud read after session change must be rejected.");
}
// The server may already have committed when the session changes; never
// acknowledge an in-flight save as a successful write for another account.
{
  const cloud=createMockCloud();
  cloud.setState(fixture());
  let currentUser:AuthIdentity | null={...cloud.client.user};
  const client={
    get user(){return currentUser;},
    request:async(path:string,init?:RequestInit)=>{
      const response=await cloud.client.request(path,init);
      if(init?.method==="POST")
        currentUser={id:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",email:"new@example.test"};
      return response;
    },
  };
  const repository=createSupabaseStateRepository(client,legacy(null).repo,emptyStorage);
  await repository.load();
  let rejected=false;
  try {await repository.save({...fixture(),workRules:{standardShiftDurationMinutes:420}});}
  catch(error){rejected=error instanceof Error && error.message.includes("sessão mudou");}
  ensure(rejected,"A save with a changed authenticated owner must never report success.");
}


// PR47-F: two rapid saves in one tab cannot race on the same revision.
// The first RPC is held while the second is queued; both must eventually
// commit in invocation order with distinct expected CAS revision numbers.
{
  const cloud=createMockCloud();
  cloud.setState(fixture());
  let releaseFirst=()=>{};
  const gate=new Promise<void>(resolve=>{releaseFirst=()=>resolve();});
  let postCount=0;
  const client={
    user:cloud.client.user,
    request:async(path:string,init?:RequestInit)=>{
      if(init?.method==="POST"){
        postCount++;
        if(postCount===1)await gate;
      }
      return cloud.client.request(path,init);
    },
  };
  const repository=createSupabaseStateRepository(client,legacy(null).repo,emptyStorage);
  await repository.load();
  const earlier=repository.save({
    ...fixture(),workRules:{standardShiftDurationMinutes:420},
  });
  const latest=repository.save({
    ...fixture(),workRules:{standardShiftDurationMinutes:360},
  });
  await Promise.resolve();
  await Promise.resolve();
  ensure(postCount===1,
    "Two edits in the same tab must never issue concurrent RPC writes.");
  releaseFirst();
  await Promise.all([earlier,latest]);
  ensure(postCount===2 && cloud.current().revision===3 &&
    cloud.current().state?.workRules.standardShiftDurationMinutes===360,
    "Writes must commit serially and preserve the latest user configuration.");
}


// PR47: two authenticated tabs editing disjoint fields are reconciled with
// a three-way CAS retry. The second tab must receive merged data for hydration.
{
  const cloud=createMockCloud();
  cloud.setState(fixture());
  const first=createSupabaseStateRepository(cloud.client,legacy(null).repo,emptyStorage);
  const second=createSupabaseStateRepository(cloud.client,legacy(null).repo,emptyStorage);
  const left=await first.load();
  const right=await second.load();
  ensure(Boolean(left&&right),"Both tabs must load the same baseline.");
  await first.save({...left!,people:left!.people.map((p,i)=>
    i===0?{...p,name:"Nome após edição na aba A"}:p)});
  const reconciled=await second.save({...right!,
    workRules:{standardShiftDurationMinutes:360}});
  ensure(Boolean(reconciled)&&
    reconciled!.people[0].name==="Nome após edição na aba A" &&
    reconciled!.workRules.standardShiftDurationMinutes===360 &&
    cloud.current().revision===3,
    "Two disjoint edits from distinct tabs must survive one automatic safe merge.");
  await second.save({...reconciled!,operationTimeZone:"Europe/Lisbon"});
  ensure(cloud.current().state?.people[0].name==="Nome após edição na aba A" &&
    cloud.current().state?.workRules.standardShiftDurationMinutes===360,
    "A subsequent edit from merged tab must not revert other-tab fields.");
}
// Even on the same object, distinct person fields can be merged safely.
{
  const cloud=createMockCloud();
  cloud.setState(fixture());
  const a=createSupabaseStateRepository(cloud.client,legacy(null).repo,emptyStorage);
  const b=createSupabaseStateRepository(cloud.client,legacy(null).repo,emptyStorage);
  const sa=(await a.load())!;
  const sb=(await b.load())!;
  await a.save({...sa,people:sa.people.map((p,i)=>
    i===0?{...p,name:"Nova identificação"}:p)});
  const merged=await b.save({...sb,people:sb.people.map((p,i)=>
    i===0?{...p,weeklyContractMinutes:1200}:p)});
  ensure(Boolean(merged) && merged!.people[0].name==="Nova identificação" &&
    merged!.people[0].weeklyContractMinutes===1200,
    "Disjoint fields of the same person must survive.");
}
// Concurrent edits of the SAME field fail closed; no last-write-wins.
{
  const cloud=createMockCloud();
  cloud.setState(fixture());
  const a=createSupabaseStateRepository(cloud.client,legacy(null).repo,emptyStorage);
  const b=createSupabaseStateRepository(cloud.client,legacy(null).repo,emptyStorage);
  const sa=(await a.load())!;
  const sb=(await b.load())!;
  await a.save({...sa,workRules:{standardShiftDurationMinutes:420}});
  let conflict:unknown=null;
  try {await b.save({...sb,workRules:{standardShiftDurationMinutes:300}});}
  catch(error){conflict=error;}
  ensure(conflict instanceof SupabaseStateConflictError &&
    conflict.fields.includes("workRules.standardShiftDurationMinutes"),
    "Conflicting same-field edits must display a recoverable field-level conflict.");
  ensure(cloud.current().state?.workRules.standardShiftDurationMinutes===420,
    "A conflicting edit must never overwrite the previous tab.");
}

console.log("Supabase repository: todos os testes passaram.");
