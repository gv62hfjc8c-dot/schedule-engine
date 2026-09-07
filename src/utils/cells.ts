// utils/cells.ts
// Leitor único de células. Uma célula gravada NUNCA vale nada fora do período real em que a
// pessoa esteve empregada — mesmo que os dados ainda lá estejam (ex: um horário gerado antes de
// uma saída ser registada). Usado por todo o lado que lê o schedule: motor, vista semanal,
// estatísticas — para nunca poder haver dois sítios da app a discordar sobre isto.
import type { Cell, Colaborador, Schedule } from "../types";

// Está empregada/o nessa data? startDate inclusive, endDate exclusive (primeiro dia já fora).
export function isEmployedOn(s: Colaborador, dateStr: string): boolean {
  if (s.startDate && dateStr < s.startDate) return false;
  if (s.endDate && dateStr >= s.endDate) return false;
  return true;
}

// A célula "efetiva" de uma pessoa numa data: undefined se a data cair fora do período de
// contrato, mesmo que exista algo gravado — caso contrário, o que estiver no schedule.
export function effectiveCell(colaborador: Colaborador, dateStr: string, schedule: Schedule): Cell | undefined {
  if (!isEmployedOn(colaborador, dateStr)) return undefined;
  return schedule[`${colaborador.nome}-${dateStr}`];
}
