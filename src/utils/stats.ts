// utils/stats.ts
// Cálculos para a vista "Resumo". Lê tudo através do leitor único (effectiveCell), por isso uma
// célula gravada antes de uma saída, ou antes de uma entrada, nunca conta — mesmo que o horário
// já tivesse sido gerado com a pessoa ainda ativa nessa altura.
import type { Colaborador, Schedule } from "../types";
import { addDays, calcHours, dateKey } from "./dates";
import { effectiveCell } from "./cells";

// Horas trabalhadas por uma pessoa numa semana (soma dos 7 dias, a partir de entry/exit reais).
export function hoursInWeek(colaborador: Colaborador, monday: Date, schedule: Schedule): number {
  let total = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i);
    const cell = effectiveCell(colaborador, dateKey(d.getFullYear(), d.getMonth(), d.getDate()), schedule);
    if (cell?.type === "Trabalho") total += calcHours(cell.entry, cell.exit);
  }
  return Math.round(total * 100) / 100;
}

// Uma semana "tem dados" para uma pessoa se houver pelo menos uma célula gravada (dentro do
// período de contrato) nesse intervalo — semanas nunca geradas, ou inteiramente antes/depois do
// contrato, não contam para a média.
export function weekHasData(colaborador: Colaborador, monday: Date, schedule: Schedule): boolean {
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i);
    if (effectiveCell(colaborador, dateKey(d.getFullYear(), d.getMonth(), d.getDate()), schedule)) return true;
  }
  return false;
}

// Férias ou Licença nalgum dia desta semana? Essas semanas não entram na média de horas (mas
// Folga e Falta continuam a contar normalmente — fazem parte de uma semana de trabalho normal).
export function weekHasFeriasOuLicenca(colaborador: Colaborador, monday: Date, schedule: Schedule): boolean {
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i);
    const cell = effectiveCell(colaborador, dateKey(d.getFullYear(), d.getMonth(), d.getDate()), schedule);
    if (cell?.type === "Férias" || cell?.type === "Licença") return true;
  }
  return false;
}

// Domingos de folga de uma pessoa, numa lista de semanas (segundas-feiras).
export function sundaysOff(colaborador: Colaborador, mondays: Date[], schedule: Schedule): number {
  return mondays.filter((mon) => {
    const sun = addDays(mon, 6);
    return effectiveCell(colaborador, dateKey(sun.getFullYear(), sun.getMonth(), sun.getDate()), schedule)?.type === "Folga";
  }).length;
}

// Fins de semana completos (Sábado E Domingo de folga) de uma pessoa, numa lista de semanas.
export function fullWeekendsOff(colaborador: Colaborador, mondays: Date[], schedule: Schedule): number {
  return mondays.filter((mon) => {
    const sat = addDays(mon, 5), sun = addDays(mon, 6);
    const satOff = effectiveCell(colaborador, dateKey(sat.getFullYear(), sat.getMonth(), sat.getDate()), schedule)?.type === "Folga";
    const sunOff = effectiveCell(colaborador, dateKey(sun.getFullYear(), sun.getMonth(), sun.getDate()), schedule)?.type === "Folga";
    return satOff && sunOff;
  }).length;
}

export interface PersonQuarterStats {
  nome: string;
  weeklyHours: { monday: Date; hours: number; excluidaDaMedia: boolean }[]; // só as semanas com dados
  mediaSemanal: number; // média das horas/semana, excluindo semanas com Férias/Licença
  domingos: number;
  finsDeSemanaCompletos: number;
}

export function quarterStatsFor(
  colaborador: Colaborador, mondays: Date[], schedule: Schedule
): PersonQuarterStats {
  const comDados = mondays.filter((mon) => weekHasData(colaborador, mon, schedule));
  const weeklyHours = comDados.map((monday) => ({
    monday,
    hours: hoursInWeek(colaborador, monday, schedule),
    excluidaDaMedia: weekHasFeriasOuLicenca(colaborador, monday, schedule),
  }));

  // A média só conta semanas SEM Férias/Licença — essas ficam de fora da conta, não entram nem a
  // puxar para baixo nem para cima. Folga e Falta continuam dentro da conta normalmente.
  const paraMedia = weeklyHours.filter((w) => !w.excluidaDaMedia).map((w) => w.hours);
  const mediaSemanal = paraMedia.length === 0
    ? 0
    : Math.round((paraMedia.reduce((sum, h) => sum + h, 0) / paraMedia.length) * 100) / 100;

  return {
    nome: colaborador.nome,
    weeklyHours,
    mediaSemanal,
    domingos: sundaysOff(colaborador, comDados, schedule),
    finsDeSemanaCompletos: fullWeekendsOff(colaborador, comDados, schedule),
  };
}
