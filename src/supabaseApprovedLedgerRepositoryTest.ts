import {
  createApprovedScheduleLedger,
  type ApprovedScheduleLedger,
} from "./utils/approvedSchedules";
import {
  ApprovedLedgerStoreError,
  createSupabaseApprovedLedgerRepository,
} from "./persistence/supabaseApprovedLedgerRepository";
import type { AuthIdentity } from "./persistence/supabaseAuth";

function ensure(value: boolean, message: string): void {
  if (!value) throw new Error(message);
}

const coverage = {
  startDate: "2026-10-25",
  endDate: "2026-11-09",
};
const userOne: AuthIdentity = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  email: "owner1@example.test",
};
const userTwo: AuthIdentity = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  email: "owner2@example.test",
};

interface Stored {
  ledger: ApprovedScheduleLedger;
  history: ApprovedScheduleLedger[];
}

function mockCloud() {
  const records = new Map<string, Stored>();
  const seen: { user: string; path: string; method: string }[] = [];
  function client(user: AuthIdentity | null) {
    return {
      user,
      async request(path: string, init?: RequestInit): Promise<Response> {
        const owner = user?.id ?? "none";
        seen.push({ user: owner, path, method: init?.method ?? "GET" });
        if (!user) return Response.json(
          { code: "28000", message: "Não autenticado." },
          { status: 401 }
        );
        if (path.startsWith("/rest/v1/schedule_engine_approved_ledgers") &&
            !init?.method) {
          if (!path.includes(`owner_id=eq.${encodeURIComponent(owner)}`)) {
            return Response.json({ message: "Owner filter missing." }, { status: 400 });
          }
          const stored = records.get(owner);
          return Response.json(stored
            ? [{ ledger_version: stored.ledger.version,
                payload: structuredClone(stored.ledger) }]
            : []);
        }
        if (path === "/rest/v1/rpc/save_schedule_engine_approved_ledger" &&
            init?.method === "POST") {
          const args = JSON.parse(String(init.body)) as {
            p_expected_version: number;
            p_payload: ApprovedScheduleLedger;
            p_attest_complete: boolean;
          };
          const previous = records.get(owner);
          const value = structuredClone(args.p_payload);
          if (!previous) {
            if (args.p_expected_version !== -1 ||
                value.version !== 0 || value.complete ||
                value.records.length !== 0) {
              return Response.json(
                { code: "40001", message: "Inicialização inválida." },
                { status: 409 }
              );
            }
            records.set(owner, {
              ledger: value,
              history: [structuredClone(value)],
            });
            return Response.json(0);
          }
          if (previous.ledger.version !== args.p_expected_version ||
              value.version !== previous.ledger.version + 1) {
            return Response.json(
              { code: "40001", message: "Conflito de versão." },
              { status: 409 }
            );
          }
          if (JSON.stringify(value.coverage) !==
              JSON.stringify(previous.ledger.coverage) ||
              value.timeZone !== previous.ledger.timeZone) {
            return Response.json(
              { code: "22023", message: "Escopo imutável." },
              { status: 400 }
            );
          }
          if (!previous.ledger.complete && value.complete &&
              !args.p_attest_complete) {
            return Response.json(
              { code: "22023", message: "Falta atestação." },
              { status: 400 }
            );
          }
          previous.ledger = value;
          previous.history.push(structuredClone(value));
          return Response.json(value.version);
        }
        return Response.json({ error: "Rota inesperada." }, { status: 404 });
      },
    };
  }
  return {
    client,
    current: (id: string): Stored | undefined =>
      records.get(id) ? structuredClone(records.get(id)) : undefined,
    tamper(id: string, value: ApprovedScheduleLedger) {
      records.set(id, {
        ledger: structuredClone(value),
        history: [structuredClone(value)],
      });
    },
    seen: () => [...seen],
  };
}

const cloud = mockCloud();
const firstRepository = createSupabaseApprovedLedgerRepository(
  cloud.client(userOne)
);
ensure((await firstRepository.load()) === null,
  "Ausência de linha significa contexto desconhecido, nunca zero turnos.");
ensure(cloud.current(userOne.id) === undefined,
  "Uma consulta não pode inicializar automaticamente a base.");

const bootstrap = createApprovedScheduleLedger(
  coverage, "Atlantic/Azores", false
);
const before = JSON.stringify(bootstrap);
const initialized = await firstRepository.save(bootstrap, null);
ensure(initialized === 0, "O primeiro snapshot é guardado como versão zero.");
ensure(JSON.stringify(bootstrap) === before,
  "O adaptador não pode mutar objetos recebidos.");
ensure(cloud.current(userOne.id)?.ledger.complete === false,
  "A inicialização não declara contexto completo.");

const returned = await firstRepository.load();
ensure(returned?.version === 0 && returned.complete === false &&
  returned.records.length === 0,
  "Recarregar um ledger vazio não o marca como confirmado.");
if (!returned) throw new Error("Ledger inicial não encontrado.");
returned.coverage.startDate = "2040-01-01";
ensure(cloud.current(userOne.id)?.ledger.coverage.startDate === "2026-10-25",
  "Resultados de load devem ser cópias isoladas.");

async function rejected(
  operation: () => Promise<unknown>,
  label: string,
  expectedCode?: string
) {
  let didReject = false;
  try {
    await operation();
  } catch (error) {
    didReject = expectedCode
      ? error instanceof ApprovedLedgerStoreError && error.code === expectedCode
      : error instanceof Error;
  }
  ensure(didReject, label);
}

await rejected(() =>
  firstRepository.save({
    ...bootstrap, version: 0, complete: true,
  }, null),
  "Um bootstrap com contexto implicitamente confirmado deve ser recusado."
);
await rejected(() =>
  firstRepository.save({
    ...bootstrap, version: 5,
  }, 0),
  "Versão saltada deve falhar antes de chamar a rede.");

await rejected(() =>
  firstRepository.save({
    ...bootstrap, version: 1, complete: true,
  }, 0),
  "Completar o contexto sem atestação deve ser recusado pela RPC.",
  "22023"
);
ensure(cloud.current(userOne.id)?.ledger.version === 0,
  "Uma atestação recusada não modifica dados nem histórico.");

const attested = {
  ...bootstrap,
  version: 1,
  complete: true,
};
ensure(await firstRepository.save(attested, 0, {
  attestComplete: true,
}) === 1,
"Atestação explícita permite completar o contexto para cenário conhecido.");

const secondTab = createSupabaseApprovedLedgerRepository(
  cloud.client(userOne)
);
const fromOtherTab = await secondTab.load();
ensure(fromOtherTab?.version === 1 && fromOtherTab.complete,
  "Outra aba observa a versão certificada do contexto.");

const next = { ...attested, version: 2 };
ensure(await firstRepository.save(next, 1) === 2,
  "Avanço de versão linear é aceite.");
await rejected(() =>
  secondTab.save({ ...fromOtherTab!, version: 2 }, 1),
  "Uma segunda aba com versão obsoleta recebe conflito SQL, sem sobrescrita.",
  "40001"
);
ensure(cloud.current(userOne.id)?.ledger.version === 2 &&
  cloud.current(userOne.id)?.history.length === 3,
  "Histórico preserva versões 0, 1, 2 e conflito não cria versão adicional.");
ensure(cloud.current(userOne.id)?.history.map(h => h.version).join(",") ===
  "0,1,2", "Histórico é linear, versionado e imutável.");

const invalidZone = {
  ...next, version: 3, timeZone: "Invalid/Other",
};
await rejected(() => firstRepository.save(invalidZone, 2),
  "O cliente recusa ledger com IANA inválido antes da RPC.");

const changedScope = {
  ...next, version: 3,
  coverage: { ...coverage, endDate: "2026-11-10" },
};
await rejected(() => firstRepository.save(changedScope, 2),
  "Fuso/cobertura não podem ser estendidos silenciosamente pela RPC.",
  "22023"
);

const secondOwnerRepository = createSupabaseApprovedLedgerRepository(
  cloud.client(userTwo)
);
ensure((await secondOwnerRepository.load()) === null,
  "As escalas de um utilizador não podem aparecer noutro.");
await secondOwnerRepository.save(bootstrap, null);
ensure(cloud.current(userTwo.id)?.ledger.version === 0 &&
  cloud.current(userOne.id)?.ledger.version === 2,
  "O CAS e o histórico são isolados por utilizador.");

const anonymousRepository = createSupabaseApprovedLedgerRepository(
  cloud.client(null)
);
await rejected(() => anonymousRepository.load(),
  "Consulta sem sessão é bloqueada.");
await rejected(() => anonymousRepository.save(bootstrap, null),
  "Gravação sem sessão é bloqueada.");

const damaged = structuredClone(next);
(damaged.records as unknown) = "not-an-array";
cloud.tamper(userOne.id, damaged);
await rejected(() => firstRepository.load(),
  "Os snapshots malformados são rejeitados sem ser declarados completos.");
ensure(!cloud.seen().some(x =>
  x.path === "/rest/v1/rpc/save_schedule_engine_state"
), "O estado de configuração v4 não pode ser escrito pelo ledger.");

console.log("Supabase Approved Ledger V0: todos os testes passaram.");
