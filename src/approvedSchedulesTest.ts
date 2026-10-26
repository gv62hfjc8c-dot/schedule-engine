import type {
  DatedWorkShift,
  OperatingCalendarConfiguration,
  Person,
  PersonAvailability,
  PresenceConfiguration,
  PresenceRequirement,
  TimeInterval,
  WeeklyOperatingHours,
} from "./types";
import { WEEKDAYS } from "./utils/operatingCalendar";
import { createEmptyWeeklyAvailability } from "./utils/availability";
import { generateConstrainedPeriodSchedule } from "./utils/constrainedPeriodGenerator";
import { createEmptyWeeklyPresenceRequirements } from "./utils/presence";
import { INITIAL_WORK_CONSTRAINTS } from "./utils/workConstraints";
import {
  approveSchedule,
  cancelApprovedSchedule,
  createApprovedScheduleLedger,
  listApprovedShifts,
  queryApprovedExternalContext,
  replaceApprovedSchedule,
  type ApprovalEnvironment,
  type ApprovalFailureCode,
  type ApprovedScheduleLedger,
  type ScheduleDraft,
} from "./utils/approvedSchedules";

function assert(ok: boolean, message: string): void {
  if (!ok) throw new Error(message);
}

const mon = "2026-10-26";
const tue = "2026-10-27";
const wed = "2026-10-28";
const thu = "2026-10-29";
const fri = "2026-10-30";
const sat = "2026-10-31";
const sun = "2026-11-01";
const nextMon = "2026-11-02";
const now1 = "2026-10-26T12:00:00Z";
const now2 = "2026-10-26T13:00:00Z";
const now3 = "2026-10-26T14:00:00Z";
const zero: PresenceRequirement = {
  minimumAtOpening: 0, minimumDuringOperation: 0,
  minimumAtClosing: 0,
};
const one: PresenceRequirement = {
  minimumAtOpening: 1, minimumDuringOperation: 1,
  minimumAtClosing: 1,
};

function interval(start: string, end: string): TimeInterval[] {
  return [{ start, end }];
}

function shift(
  date: string,
  personId = "a",
  start = "09:00",
  end = "13:00",
  meal: TimeInterval | null = null
): DatedWorkShift {
  return {
    date, personId, interval: { start, end }, mealBreak: meal,
  };
}

function draft(
  id: string,
  date: string,
  shifts: DatedWorkShift[],
  endDate = date
): ScheduleDraft {
  return {
    id, startDate: date, endDate,
    timeZone: "Atlantic/Azores", shifts,
  };
}

function env(
  operations: Record<string, TimeInterval[]>,
  availability: Record<string, Record<string, TimeInterval[]>>,
  minimum: Record<string, PresenceRequirement> = {}
): ApprovalEnvironment {
  const weeklyOperatingHours: WeeklyOperatingHours =
    WEEKDAYS.reduce((week, weekday) => {
      week[weekday] = [];
      return week;
    }, {} as WeeklyOperatingHours);
  const operatingCalendar: OperatingCalendarConfiguration = {
    weeklyOperatingHours,
    exceptions: Object.entries(operations).map(([date, intervals]) => ({
      date, intervals,
    })),
  };
  const people: Person[] = [
    { id: "a", name: "A", active: true },
    { id: "b", name: "B", active: true },
  ];
  const availabilities: PersonAvailability[] = people.map(person => ({
    personId: person.id,
    weeklyAvailability: createEmptyWeeklyAvailability(),
    exceptions: Object.entries(operations).map(([date]) => ({
      date, intervals: availability[date]?.[person.id] ?? [],
    })),
  }));
  const presence: PresenceConfiguration = {
    weeklyPresenceRequirements: createEmptyWeeklyPresenceRequirements(),
    presenceExceptions: Object.entries(operations).map(([date]) => ({
      date, requirements: minimum[date] ?? one,
    })),
  };
  return {
    people, availabilities, operatingCalendar, presence,
    workConstraints: structuredClone(INITIAL_WORK_CONSTRAINTS),
  };
}

function workDayEnvironment(
  days: string[],
  hours: TimeInterval[] = interval("09:00", "13:00"),
  requirement: PresenceRequirement = one
): ApprovalEnvironment {
  const operations: Record<string, TimeInterval[]> = {};
  const availability: Record<string, Record<string, TimeInterval[]>> = {};
  const requirements: Record<string, PresenceRequirement> = {};
  for (const date of days) {
    operations[date] = hours;
    availability[date] = { a: hours, b: hours };
    requirements[date] = requirement;
  }
  return env(operations, availability, requirements);
}

function ledger(
  complete = true,
  startDate = "2026-10-25",
  endDate = "2026-11-09"
): ApprovedScheduleLedger {
  return createApprovedScheduleLedger({
    startDate, endDate,
  }, "Atlantic/Azores", complete);
}

function assertFailure(
  result: ReturnType<typeof approveSchedule>,
  code: ApprovalFailureCode,
  message: string
): void {
  assert(!result.ok && result.failure.code === code, message);
}

const mondayEnvironment = workDayEnvironment([mon]);
const base = ledger();
const baseBefore = JSON.stringify(base);
const proposal = draft("monday-v1", mon, [shift(mon)]);
const proposalBefore = JSON.stringify(proposal);
const first = approveSchedule({
  ledger: base, expectedVersion: 0, at: now1,
  draft: proposal, environment: mondayEnvironment,
});
assert(first.ok, "Uma proposta válida de 4h pode ser aprovada.");
if (!first.ok) throw new Error("Aprovação inicial falhou.");
assert(first.ledger.version === 1 && first.ledger.records.length === 1 &&
  first.record.status === "approved" &&
  first.record.approvedAt === now1 &&
  first.record.changedAt === null,
  "Aprovação cria um registo ativo, versionado e temporal explícito.");
assert(JSON.stringify(base) === baseBefore &&
  JSON.stringify(proposal) === proposalBefore,
  "Aprovação pura não pode mutar ledger ou proposta.");
assert(listApprovedShifts(first.ledger).length === 1,
  "Uma proposta aprovada passa a compromisso ativo.");
const original = JSON.stringify(first.ledger);

const mondayContext = queryApprovedExternalContext({
  ledger: first.ledger,
  targetPeriod: { startDate: mon, endDate: mon },
  workConstraints: INITIAL_WORK_CONSTRAINTS, timeZone: "Atlantic/Azores",
});
assert(mondayContext.status === "target_occupied" &&
  mondayContext.externalContext === null &&
  mondayContext.occupiedBy[0] === "monday-v1",
  "Gerador deve recusar datas ocupadas por escala aprovada.");

const tuesdayContext = queryApprovedExternalContext({
  ledger: first.ledger,
  targetPeriod: { startDate: tue, endDate: tue },
  workConstraints: INITIAL_WORK_CONSTRAINTS, timeZone: "Atlantic/Azores",
});
assert(tuesdayContext.status === "ready" &&
  tuesdayContext.externalContext?.completeOutsideTarget === true &&
  tuesdayContext.externalContext.shifts.length === 1 &&
  tuesdayContext.externalContext.shifts[0].date === mon &&
  tuesdayContext.requiredContext?.startDate === "2026-10-26" &&
  tuesdayContext.requiredContext.endDate === "2026-11-01",
  "Contexto derivado inclui horários aprovados anteriores.");
assert(JSON.stringify(first.ledger) === original,
  "Consultar turnos externos não pode modificar o ledger.");

const externallyReturned = tuesdayContext.externalContext?.shifts[0];
if (!externallyReturned) throw new Error("Turno externo ausente.");
externallyReturned.interval.start = "00:00";
assert(listApprovedShifts(first.ledger)[0].interval.start === "09:00",
  "Consultas devolvem cópias e não permitem mutar compromissos existentes.");

const occupied = approveSchedule({
  ledger: first.ledger, expectedVersion: 1, at: now2,
  draft: draft("other-id", mon, [shift(mon, "b")]),
  environment: mondayEnvironment,
});
assertFailure(occupied, "period_occupied",
  "Duas escalas ativas não podem ocupar o mesmo dia, mesmo com outras pessoas.");

const duplicateId = approveSchedule({
  ledger: first.ledger, expectedVersion: 1, at: now2,
  draft: draft("monday-v1", tue, [shift(tue)]),
  environment: workDayEnvironment([tue]),
});
assertFailure(duplicateId, "duplicate_id",
  "ID imutável não pode voltar a ser utilizado.");

const staleApproval = approveSchedule({
  ledger: first.ledger, expectedVersion: 0, at: now2,
  draft: draft("tuesday", tue, [shift(tue)]),
  environment: workDayEnvironment([tue]),
});
assertFailure(staleApproval, "stale_version",
  "Escrita concorrente em versão antiga não pode ser aceite.");

const badZone = approveSchedule({
  ledger: first.ledger, expectedVersion: 1, at: now2,
  draft: {
    ...draft("tuesday", tue, [shift(tue)]),
    timeZone: "Europe/Lisbon",
  },
  environment: workDayEnvironment([tue]),
});
assertFailure(badZone, "invalid_input",
  "Mistura silenciosa de fusos horários deve ser recusada.");

const unavailable = workDayEnvironment([tue]);
unavailable.availabilities[0].exceptions[0].intervals = [];
const outsideAvailability = approveSchedule({
  ledger: first.ledger, expectedVersion: 1, at: now2,
  draft: draft("tuesday", tue, [shift(tue)]),
  environment: unavailable,
});
assertFailure(outsideAvailability, "operational_constraint",
  "A aprovação revalida disponibilidade e não confia apenas no gerador.");

const inactiveEnvironment = workDayEnvironment([tue]);
inactiveEnvironment.people[0].active = false;
assertFailure(approveSchedule({
  ledger: first.ledger, expectedVersion: 1, at: now2,
  draft: draft("tuesday", tue, [shift(tue)]),
  environment: inactiveEnvironment,
}), "operational_constraint",
"Colaboradores arquivados não podem ser aprovados.");

assertFailure(approveSchedule({
  ledger: first.ledger, expectedVersion: 1, at: now2,
  draft: draft("tuesday", tue, []),
  environment: workDayEnvironment([tue]),
}), "operational_constraint",
"Um dia aberto com cobertura 1 não pode ser aprovado vazio.");

const closedEnvironment = workDayEnvironment([tue]);
closedEnvironment.operatingCalendar.exceptions[0].intervals = [];
assertFailure(approveSchedule({
  ledger: first.ledger, expectedVersion: 1, at: now2,
  draft: draft("closed-with-shift", tue, [shift(tue)]),
  environment: closedEnvironment,
}), "operational_constraint",
"Dia fechado não pode ter trabalho aprovado.");

const shortLedger = ledger(true, mon, tue);
assertFailure(approveSchedule({
  ledger: shortLedger, expectedVersion: 0, at: now1,
  draft: proposal, environment: mondayEnvironment,
}), "incomplete_context",
"Aprovação exige semana e dias adjacentes confirmados.");

const missingLedger = ledger(false);
assertFailure(approveSchedule({
  ledger: missingLedger, expectedVersion: 0, at: now1,
  draft: proposal, environment: mondayEnvironment,
}), "incomplete_context",
"Um ledger sem confirmação explícita nunca pode aprovar.");
const missingQuery = queryApprovedExternalContext({
  ledger: missingLedger,
  targetPeriod: { startDate: mon, endDate: mon },
  workConstraints: INITIAL_WORK_CONSTRAINTS,
  timeZone: "Atlantic/Azores",
});
assert(missingQuery.status === "incomplete_context" &&
  missingQuery.externalContext === null,
  "Ledger sem confirmação não permite inferir zero horas.");
const truncatedContext = queryApprovedExternalContext({
  ledger: shortLedger,
  targetPeriod: { startDate: mon, endDate: mon },
  workConstraints: INITIAL_WORK_CONSTRAINTS,
  timeZone: "Atlantic/Azores",
});
assert(truncatedContext.status === "incomplete_context",
  "Consulta exige a semana completa com dias adjacentes.");

const restEnvironment = env(
  { [mon]: interval("16:00", "22:00"),
    [tue]: interval("08:00", "12:00") },
  { [mon]: { a: interval("16:00", "22:00") },
    [tue]: { a: interval("08:00", "12:00") } }
);
const late = approveSchedule({
  ledger: ledger(), expectedVersion: 0, at: now1,
  draft: draft("late", mon, [shift(mon, "a", "16:00", "22:00")]),
  environment: restEnvironment,
});
assert(late.ok, "Turno isolado tardio é válido.");
if (!late.ok) throw new Error("Turno tardio não aprovado.");
const tooEarly = approveSchedule({
  ledger: late.ledger, expectedVersion: 1, at: now2,
  draft: draft("early", tue, [shift(tue, "a", "08:00", "12:00")]),
  environment: restEnvironment,
});
assertFailure(tooEarly, "work_constraint",
  "Descanso de apenas 10h entre duas aprovações tem de falhar.");
assert(!tooEarly.ok &&
  tooEarly.failure.workViolations.some(v => v.code === "minimum_rest"),
  "A rejeição identifica a regra de 11h efetivas.");

const nextB = approveSchedule({
  ledger: late.ledger, expectedVersion: 1, at: now2,
  draft: draft("early-b", tue, [shift(tue, "b", "08:00", "12:00")]),
  environment: env(
    { [mon]: interval("16:00", "22:00"),
      [tue]: interval("08:00", "12:00") },
    { [mon]: { a: interval("16:00", "22:00") },
      [tue]: { b: interval("08:00", "12:00") } }
  ),
});
assert(nextB.ok && nextB.ledger.version === 2,
  "Outra pessoa sem conflito de descanso pode ser aprovada.");

// End-to-end core integration: approved Monday work is automatically
// supplied as outside context to the P6.3 period search for Tuesday.
// A lacks 11h of rest; the period generator must select B instead.
const approvedContext = queryApprovedExternalContext({
  ledger: late.ledger,
  targetPeriod: { startDate: tue, endDate: tue },
  workConstraints: INITIAL_WORK_CONSTRAINTS,
  timeZone: "Atlantic/Azores",
});
assert(approvedContext.status === "ready" &&
  approvedContext.externalContext?.shifts.length === 1,
  "A fonte aprovada substitui a declaração manual de zero turnos exteriores.");
if (!approvedContext.externalContext) {
  throw new Error("Contexto aprovado necessário.");
}
const generatedFromLedgerEnv = env(
  { [tue]: interval("08:00", "12:00") },
  { [tue]: {
    a: interval("08:00", "12:00"),
    b: interval("08:00", "12:00"),
  } }
);
const generatedFromLedger = generateConstrainedPeriodSchedule({
  startDate: tue,
  endDate: tue,
  ...generatedFromLedgerEnv,
  timeZone: "Atlantic/Azores",
  workRules: { standardShiftDurationMinutes: 480 },
  externalContext: approvedContext.externalContext,
  maxSearchNodes: 5000,
});
assert(generatedFromLedger.status === "generated" &&
  generatedFromLedger.assignments.length === 1 &&
  generatedFromLedger.assignments[0].personId === "b",
  "Geração multi-dia escolhe B porque A tem só 10h de descanso após aprovação.");
const approvedGenerated = approveSchedule({
  ledger: late.ledger,
  expectedVersion: 1,
  at: now2,
  draft: draft("generated-from-ledger", tue, generatedFromLedger.assignments),
  environment: generatedFromLedgerEnv,
});
assert(approvedGenerated.ok && approvedGenerated.ledger.version === 2,
  "Resultado com contexto certificado pode ser aprovado após revalidação total.");

const fullWeek = [mon, tue, wed, thu, fri];
const allDays = [...fullWeek, sat];
const longEnvironment = workDayEnvironment(
  allDays, interval("09:00", "18:00"), zero
);
const meal = { start: "13:00", end: "14:00" };
const longShifts = fullWeek.map(date =>
  shift(date, "a", "09:00", "18:00", meal)
);
const five = approveSchedule({
  ledger: ledger(), expectedVersion: 0, at: now1,
  draft: draft("five-days", mon, longShifts, fri),
  environment: longEnvironment,
});
assert(five.ok, "40h efetivas de segunda a sexta podem ser aprovadas.");
if (!five.ok) throw new Error("40h não aprovaram.");
const sixty = approveSchedule({
  ledger: five.ledger, expectedVersion: 1, at: now2,
  draft: draft("sixth", sat, [shift(sat, "a")]),
  environment: longEnvironment,
});
assertFailure(sixty, "work_constraint",
  "Sábado deve ser recusado após 40h aprovadas na mesma semana.");
assert(!sixty.ok && sixty.failure.workViolations.some(v =>
  v.code === "weekly_limit"
), "Rejeição explica limite de 40h semanais.");

const sixthOther = approveSchedule({
  ledger: five.ledger, expectedVersion: 1, at: now2,
  draft: draft("sixth-b", sat, [shift(sat, "b")]),
  environment: longEnvironment,
});
assert(sixthOther.ok, "Sábado pode ser atribuído a outra pessoa.");

const withoutMandatoryMeal = approveSchedule({
  ledger: ledger(), expectedVersion: 0, at: now1,
  draft: draft("nine-hours-no-meal", mon,
    [shift(mon, "a", "09:00", "18:00")]),
  environment: workDayEnvironment([mon], interval("09:00", "18:00"), zero),
});
assertFailure(withoutMandatoryMeal, "work_constraint",
  "Aprovação recusa turnos com mais de 6h sem refeição.");
assert(!withoutMandatoryMeal.ok &&
  withoutMandatoryMeal.failure.workViolations.some(v =>
    v.code === "meal_required"
  ), "Erro identifica refeição obrigatória.");

const cancel = cancelApprovedSchedule({
  ledger: first.ledger, expectedVersion: 1,
  scheduleId: "monday-v1", at: now2,
});
assert(cancel.ok && cancel.record.status === "cancelled" &&
  cancel.ledger.version === 2 &&
  cancel.ledger.records[0].shifts.length === 1 &&
  listApprovedShifts(cancel.ledger).length === 0,
  "Cancelar preserva histórico mas elimina compromisso ativo.");
assert(JSON.stringify(first.ledger) === original,
  "Cancelar não muta os registos aprovados anteriores.");
if (!cancel.ok) throw new Error("Cancelamento falhou.");
assertFailure(cancelApprovedSchedule({
  ledger: cancel.ledger, expectedVersion: 2,
  scheduleId: "monday-v1", at: now3,
}), "schedule_not_approved",
"Cancelamento repetido não é idempotente silencioso.");
assertFailure(approveSchedule({
  ledger: cancel.ledger, expectedVersion: 2, at: now3,
  draft: proposal, environment: mondayEnvironment,
}), "duplicate_id",
"Registos cancelados continuam a reservar o seu identificador.");

const afterCancelContext = queryApprovedExternalContext({
  ledger: cancel.ledger,
  targetPeriod: { startDate: mon, endDate: mon },
  workConstraints: INITIAL_WORK_CONSTRAINTS,
  timeZone: "Atlantic/Azores",
});
assert(afterCancelContext.status === "ready" &&
  afterCancelContext.externalContext?.shifts.length === 0,
  "Cancelado não condiciona futuras escalas, mas deixa cobertura a replanear.");

const invalidReplacement = replaceApprovedSchedule({
  ledger: first.ledger, expectedVersion: 1, at: now2,
  replaceId: "monday-v1",
  draft: draft("new-bad", mon, []),
  environment: mondayEnvironment,
});
assertFailure(invalidReplacement, "operational_constraint",
  "Substituição inválida não pode revogar o horário anterior.");
assert(JSON.stringify(first.ledger) === original,
  "Uma substituição rejeitada deixa o ledger totalmente intacto.");

const wrongReplacementPeriod = replaceApprovedSchedule({
  ledger: first.ledger, expectedVersion: 1, at: now2,
  replaceId: "monday-v1",
  draft: draft("other-range", mon, [shift(mon)], tue),
  environment: mondayEnvironment,
});
assertFailure(wrongReplacementPeriod, "period_mismatch",
  "Substituição V0 exige exatas datas de origem.");

const replace = replaceApprovedSchedule({
  ledger: first.ledger, expectedVersion: 1, at: now2,
  replaceId: "monday-v1",
  draft: draft("monday-v2", mon, [shift(mon, "b")]),
  environment: mondayEnvironment,
});
assert(replace.ok && replace.ledger.version === 2 &&
  replace.ledger.records.length === 2 &&
  replace.ledger.records[0].status === "superseded" &&
  replace.ledger.records[0].replacementId === "monday-v2" &&
  replace.ledger.records[1].replacesId === "monday-v1" &&
  replace.ledger.records[1].status === "approved" &&
  listApprovedShifts(replace.ledger).length === 1 &&
  listApprovedShifts(replace.ledger)[0].personId === "b",
  "Substituição atómica preserva histórico e aprova só o novo horário.");
assert(JSON.stringify(first.ledger) === original,
  "O ledger anterior não sofre mutações durante a substituição.");
if (!replace.ok) throw new Error("Substituição não aprovada.");
assertFailure(replaceApprovedSchedule({
  ledger: replace.ledger, expectedVersion: 2, at: now3,
  replaceId: "monday-v1",
  draft: draft("monday-v3", mon, [shift(mon)]),
  environment: mondayEnvironment,
}), "schedule_not_approved",
"Um horário substituído não pode voltar a ser substituído como ativo.");
assertFailure(cancelApprovedSchedule({
  ledger: replace.ledger, expectedVersion: 2, at: now3,
  scheduleId: "monday-v1",
}), "schedule_not_approved",
"Não cancelar retroativamente horário já substituído.");

const badLedger = structuredClone(first.ledger);
badLedger.records.push({
  ...structuredClone(badLedger.records[0]),
  id: "second-approved", shifts: [shift(mon, "b")],
});
assertFailure(approveSchedule({
  ledger: badLedger, expectedVersion: 1, at: now2,
  draft: draft("third", tue, [shift(tue)]),
  environment: workDayEnvironment([tue]),
}), "invalid_ledger",
"Um ledger externamente corrompido com períodos ativos sobrepostos não é aceite.");

const pastDate = approveSchedule({
  ledger: first.ledger, expectedVersion: 1,
  at: "2026-10-26T11:00:00Z",
  draft: draft("tue-earlier", tue, [shift(tue)]),
  environment: workDayEnvironment([tue]),
});
assert(pastDate.ok,
  "Aprovar outro horário não exige monotonia temporal entre registos independentes.");

assertFailure(cancelApprovedSchedule({
  ledger: first.ledger, expectedVersion: 1,
  scheduleId: "monday-v1",
  at: "2026-10-26T11:00:00Z",
}), "invalid_input",
"Cancelamento não pode anteceder o instante original de aprovação.");

assertFailure(approveSchedule({
  ledger: first.ledger, expectedVersion: 1,
  at: "yesterday",
  draft: draft("bad-event", tue, [shift(tue)]),
  environment: workDayEnvironment([tue]),
}), "invalid_input",
"Sem instante ISO válido não se pode criar evento histórico.");

assertFailure(approveSchedule({
  ledger: first.ledger,
  expectedVersion: 1,
  at: "2026-02-30T12:00:00Z",
  draft: draft("bad-iso-day", tue, [shift(tue)]),
  environment: workDayEnvironment([tue]),
}), "invalid_input",
"A data civil impossível em carimbo temporal não pode ser normalizada.");

const corruptEnvironment = structuredClone(mondayEnvironment);
(corruptEnvironment.availabilities[0] as unknown as { exceptions: unknown })
  .exceptions = null;
assertFailure(approveSchedule({
  ledger: ledger(), expectedVersion: 0,
  at: now1, draft: proposal, environment: corruptEnvironment,
}), "invalid_input",
"Persistência de disponibilidade malformada deve falhar sem lançar exceção.");

const malformed = { ...proposal, startDate: "2026-02-30" };
assertFailure(approveSchedule({
  ledger: base, expectedVersion: 0, at: now1,
  draft: malformed, environment: mondayEnvironment,
}), "invalid_input",
"Datas civis impossíveis são rejeitadas.");

const futureAdjacent = queryApprovedExternalContext({
  ledger: ledger(),
  targetPeriod: { startDate: sun, endDate: nextMon },
  workConstraints: INITIAL_WORK_CONSTRAINTS,
  timeZone: "Atlantic/Azores",
});
assert(futureAdjacent.status === "ready" &&
  futureAdjacent.requiredContext?.startDate === "2026-10-26" &&
  futureAdjacent.requiredContext.endDate === "2026-11-08",
  "Contexto de domingo/segunda atravessa duas semanas completas.");

const wrongQueryZone = queryApprovedExternalContext({
  ledger: ledger(),
  targetPeriod: { startDate: mon, endDate: mon },
  workConstraints: INITIAL_WORK_CONSTRAINTS,
  timeZone: "Europe/Lisbon",
});
assert(wrongQueryZone.status === "invalid_input",
  "Não consultar compromissos com fuso diferente do repositório.");

const queryCorrupted = queryApprovedExternalContext({
  ledger: badLedger,
  targetPeriod: { startDate: tue, endDate: tue },
  workConstraints: INITIAL_WORK_CONSTRAINTS,
  timeZone: "Atlantic/Azores",
});
assert(queryCorrupted.status === "invalid_input" &&
  queryCorrupted.externalContext === null,
  "Consulta com registos incoerentes nunca declara contexto completo.");

console.log("Approved Schedules Core V0: todos os testes passaram.");
