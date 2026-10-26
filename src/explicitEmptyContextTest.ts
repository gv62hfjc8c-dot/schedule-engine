import { prepareExplicitEmptyContext } from "./utils/explicitEmptyContext";
import { INITIAL_WORK_CONSTRAINTS } from "./utils/workConstraints";

function assert(value: boolean, message: string): void {
  if (!value) throw new Error(message);
}

const base = {
  startDate: "2026-10-28",
  endDate: "2026-10-29",
  timeZone: "Atlantic/Azores",
  rules: structuredClone(INITIAL_WORK_CONSTRAINTS),
  confirmedNoExternalShifts: false,
};
const before = JSON.stringify(base);
const unknown = prepareExplicitEmptyContext(base);
assert(unknown.status === "requires_confirmation" &&
  unknown.externalContext === null &&
  unknown.requiredContext?.startDate === "2026-10-26" &&
  unknown.requiredContext?.endDate === "2026-11-01",
  "Sem declaração explícita, nunca preencher contexto vazio como confirmado.");
assert(JSON.stringify(base) === before,
  "Preparar cenário não pode modificar o input.");

const confirmed = prepareExplicitEmptyContext({
  ...base,
  confirmedNoExternalShifts: true,
});
assert(confirmed.status === "ready" &&
  confirmed.externalContext?.completeOutsideTarget === true &&
  confirmed.externalContext.shifts.length === 0 &&
  confirmed.externalContext.startDate === "2026-10-26" &&
  confirmed.externalContext.endDate === "2026-11-01",
  "Declaração explícita constrói contexto apenas para toda a semana afetada.");
assert(JSON.stringify(confirmed.externalContext?.shifts) === "[]",
  "Nenhum turno pode ser inventado pelo adaptador.");

const spanning = prepareExplicitEmptyContext({
  ...base,
  startDate: "2026-10-31",
  endDate: "2026-11-02",
  confirmedNoExternalShifts: true,
});
assert(spanning.status === "ready" &&
  spanning.requiredContext?.startDate === "2026-10-26" &&
  spanning.requiredContext?.endDate === "2026-11-08",
  "Declaração deve incluir duas semanas civis inteiras mais a fronteira.");

const monday = prepareExplicitEmptyContext({
  ...base, startDate: "2026-11-02", endDate: "2026-11-02",
  confirmedNoExternalShifts: true,
});
assert(monday.requiredContext?.startDate === "2026-11-01" &&
  monday.requiredContext?.endDate === "2026-11-08",
  "Segunda deve também requerer domingo anterior para descanso.");

const sunday = prepareExplicitEmptyContext({
  ...base, startDate: "2026-11-01", endDate: "2026-11-01",
  confirmedNoExternalShifts: true,
});
assert(sunday.requiredContext?.startDate === "2026-10-26" &&
  sunday.requiredContext?.endDate === "2026-11-02",
  "Domingo deve requerer segunda seguinte para descanso.");

const badDate = prepareExplicitEmptyContext({
  ...base, startDate: "2026-02-30", confirmedNoExternalShifts: true,
});
assert(badDate.status === "invalid_input" &&
  badDate.externalContext === null,
  "Datas inexistentes não podem produzir contexto confirmado.");

const inverted = prepareExplicitEmptyContext({
  ...base, startDate: "2026-11-05", endDate: "2026-10-31",
  confirmedNoExternalShifts: true,
});
assert(inverted.status === "invalid_input" &&
  inverted.externalContext === null,
  "Data final anterior à inicial é inválida.");

const invalidTimeZone = prepareExplicitEmptyContext({
  ...base, timeZone: "invalid-timezone", confirmedNoExternalShifts: true,
});
assert(invalidTimeZone.status === "invalid_input" &&
  invalidTimeZone.externalContext === null,
  "Fuso horário IANA desconhecido impede a simulação.");

const unconfirmedAfterEdit = prepareExplicitEmptyContext({
  ...base, startDate: "2026-11-01", endDate: "2026-11-02",
});
assert(unconfirmedAfterEdit.externalContext === null &&
  unconfirmedAfterEdit.status === "requires_confirmation",
  "Outro período exige declaração própria do respetivo contexto.");

const invalidRules = structuredClone(INITIAL_WORK_CONSTRAINTS);
invalidRules.maximumWeeklyEffectiveMinutes = 0;
const badRules = prepareExplicitEmptyContext({
  ...base, rules: invalidRules, confirmedNoExternalShifts: true,
});
assert(badRules.status === "invalid_input" &&
  badRules.externalContext === null,
  "Regras inválidas não podem ser transformadas em contexto confirmado.");

console.log("Explicit Empty Context V0: todos os testes passaram.");
