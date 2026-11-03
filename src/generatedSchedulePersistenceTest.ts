import { createSupabaseGeneratedScheduleRepository } from "./persistence/supabaseGeneratedScheduleRepository";
import {
  isGeneratedSchedulePayload,
  type GeneratedSchedulePayload,
} from "./persistence/generatedScheduleRepository";
import { INITIAL_WORK_CONSTRAINTS } from "./utils/workConstraints";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const owner = "11111111-1111-4111-8111-111111111111";
const payload: GeneratedSchedulePayload = {
  schemaVersion: 1,
  validationScope: "user_attested_no_external_shifts",
  startDate: "2026-11-02",
  endDate: "2026-11-08",
  timeZone: "Atlantic/Azores",
  people: [{ id: "a", name: "Pessoa A", active: true }],
  shifts: [{
    date: "2026-11-02", personId: "a",
    interval: { start: "09:00", end: "17:00" },
    mealBreak: { start: "12:00", end: "13:00" },
  }],
  configuration: {
    availabilities: [],
    operatingCalendar: { weeklyOperatingHours: {
      monday: [], tuesday: [], wednesday: [], thursday: [],
      friday: [], saturday: [], sunday: [],
    }, exceptions: [] },
    workRules: { standardShiftDurationMinutes: 480 },
    presence: { weeklyPresenceRequirements: {
      monday: null, tuesday: null, wednesday: null, thursday: null,
      friday: null, saturday: null, sunday: null,
    }, presenceExceptions: [] },
    workConstraints: structuredClone(INITIAL_WORK_CONSTRAINTS),
  },
};
assert(isGeneratedSchedulePayload(payload), "A proposta válida deve ser aceite.");
assert(!isGeneratedSchedulePayload({...payload, shifts: [
  {...payload.shifts[0], personId: "desconhecido"},
]}), "Uma proposta com pessoa desconhecida deve ser rejeitada.");
assert(!isGeneratedSchedulePayload({...payload, shifts: [
  payload.shifts[0], payload.shifts[0],
]}), "Turnos duplicados na mesma data não podem ser guardados.");
assert(isGeneratedSchedulePayload({...payload,
  validationScope:"official_approved_context",approvedContextVersion:3}),
  "PR43: histórico de propostas distingue contexto oficial versionado.");
assert(!isGeneratedSchedulePayload({...payload,
  validationScope:"official_approved_context"}),
  "PR43: não aceitar contexto oficial sem versão.");
assert(!isGeneratedSchedulePayload({...payload,
  approvedContextVersion:3}),
  "PR43: contexto explicitamente vazio não pode alegar versão oficial.");
assert(!isGeneratedSchedulePayload({...payload, validationScope: "approved"}),
  "Um browser não pode identificar a proposta como aprovada.");

const records: Record<string, unknown>[] = [];
const seen: { method: string; path: string }[] = [];
const client = {
  user: {id: owner, email: "test@example.invalid"},
  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const method = (init.method ?? "GET").toUpperCase();
    seen.push({path,method});
    if (method === "POST") {
      const request = JSON.parse(String(init.body)) as Record<string, unknown>;
      assert(request.owner_id === owner, "Owner explícito do utilizador autenticado.");
      assert(!("created_at" in request), "O browser não pode escolher created_at.");
      assert(!("status" in request), "Propostas nunca podem ter estado aprovado.");
      const row = {
        id: request.id, start_date: request.start_date,
        end_date: request.end_date, time_zone: request.time_zone,
        payload: request.payload, created_at: "2026-11-02T12:00:00Z",
      };
      records.unshift(row);
      return Response.json([row], {status:201});
    }
    assert(method === "GET", "O repositório só pode ler ou acrescentar.");
    return Response.json(records);
  },
};
const repository = createSupabaseGeneratedScheduleRepository(client);
const saved = await repository.save(payload);
assert(saved.payload.shifts.length === 1 && saved.id.length > 0,
  "Proposta guardada com turno completo.");
const listed = await repository.list();
assert(listed.length === 1 && listed[0].id === saved.id,
  "Histórico recupera proposta após gravação.");
assert(seen.map(x => x.method).join(",") === "POST,GET",
  "O repositório não envia alterações ou remoções.");
assert(!Object.prototype.hasOwnProperty.call(repository, "approve"),
  "A aprovação nunca pode ser executada pelo repositório do browser.");

const invalidClient = {
  user: client.user,
  request: async () => Response.json([{
    ...records[0], payload: {...payload, shifts: [{date:"2026-11-09"}]},
  }]),
};
let rejectedCorruption = false;
try { await createSupabaseGeneratedScheduleRepository(invalidClient).list(); }
catch { rejectedCorruption = true; }
assert(rejectedCorruption, "Histórico incompatível não pode ser exibido como válido.");

const anonymousClient = { user: null, request: async () => {
  throw new Error("O browser nunca deve tentar consultar sem sessão.");
}};
let rejectedAnonymous = false;
try { await createSupabaseGeneratedScheduleRepository(anonymousClient).list(); }
catch { rejectedAnonymous = true; }
assert(rejectedAnonymous, "Sem sessão não se permite consultar propostas.");

console.log("PR42: testes de propostas persistidas e histórico passaram.");
