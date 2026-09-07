// utils/suggestions.ts
// Depois de gravares uma célula à mão, verifica se há algo a resolver e propõe uma alternativa
// concreta para aceitares ou recusares — nunca aplica nada sozinho.
//
// Dois casos:
//   A) Tiraste alguém do trabalho (Trabalho → Folga/Férias/Licença/Falta) e isso deixou a
//      cobertura curta nesse dia → sugere quem, estando de folga nesse dia na mesma equipa (ou
//      com função secundária), foi quem teve folga mais recentemente — é quem menos "perde" ao
//      ser chamado a trabalhar.
//   B) Puseste alguém a trabalhar num dia que era folga (Folga → Trabalho) e isso NÃO partiu a
//      cobertura → sugere compensar dando-lhe folga noutro dia da mesma semana em que ainda
//      estava a trabalhar, escolhendo o primeiro dia em que isso não abre um buraco novo.
import type { Cell, CellType, Colaborador, CoverageConfig, Equipa, Schedule } from "../types";
import { CORE_START, CORE_END, EDGE_START, EDGE_END, DEFAULT_SHIFT_REDUCED } from "../constants";
import { addDays, dateKey, mondayOf } from "./dates";
import { effectiveCell } from "./cells";
import { weekAlerts, daysSinceLastFolga, type CoverageAlert } from "./autoSchedule";

export interface SwapSuggestion {
  tipo: "cobertura" | "compensacao";
  mensagem: string;
  aplicar: { nome: string; dateStr: string; cell: Cell }[];
}

function neededShiftFor(alerts: CoverageAlert[], team: Equipa): { entry: string; exit: string } {
  let entry = CORE_START, exit = CORE_END;
  alerts.filter((a) => a.team === team).forEach((a) => {
    if (a.inicio < entry) entry = a.inicio;
    if (a.fim > exit) exit = a.fim;
  });
  if (entry < EDGE_START) entry = EDGE_START;
  if (exit > EDGE_END) exit = EDGE_END;
  return { entry, exit };
}

export function suggestAfterEdit(
  nome: string,
  dateStr: string,
  oldType: CellType | undefined,
  newType: CellType,
  staff: Colaborador[],
  schedule: Schedule,
  coverage: CoverageConfig
): SwapSuggestion | null {
  const editedPerson = staff.find((s) => s.nome === nome);
  if (!editedPerson) return null;
  const [yy, mm, dd] = dateStr.split("-").map(Number);
  const date = new Date(yy, mm - 1, dd);
  const dow = date.getDay();
  const isReduced = dow === 0; // feriados à parte — o caso comum já cobre o essencial

  // Caso A — deixou de trabalhar e pode ter aberto um buraco.
  if (oldType === "Trabalho" && newType !== "Trabalho") {
    const alerts = weekAlerts([date], schedule, staff, coverage);
    if (alerts.length === 0) return null;
    const team = editedPerson.equipa;
    const relevant = alerts.filter((a) => a.team === team);
    if (relevant.length === 0) return null; // o buraco é na outra equipa, não relacionado com esta troca

    const candidatos = staff.filter((s) =>
      s.nome !== nome &&
      (s.equipa === team || s.equipaSecundaria === team) &&
      effectiveCell(s, dateStr, schedule)?.type === "Folga"
    );
    if (candidatos.length === 0) return null;

    const ranked = [...candidatos].sort(
      (a, b) => daysSinceLastFolga(a.nome, dateStr, schedule, a.startDate) - daysSinceLastFolga(b.nome, dateStr, schedule, b.startDate)
    );
    const sugerido = ranked[0];
    const shift = isReduced ? DEFAULT_SHIFT_REDUCED : neededShiftFor(relevant, sugerido.equipaSecundaria === team ? sugerido.equipaSecundaria : team);

    return {
      tipo: "cobertura",
      mensagem: `Isto deixa a ${team === "vendas" ? "Vendas" : "Caixa"} sem cobertura suficiente. Pôr ${sugerido.nome} a trabalhar esse dia (estava de folga) para tapar o buraco?`,
      aplicar: [{ nome: sugerido.nome, dateStr, cell: { type: "Trabalho", entry: shift.entry, exit: shift.exit, note: "" } }],
    };
  }

  // Caso B — passou a trabalhar num dia que era folga; sugerir compensar noutro dia da semana.
  if (oldType === "Folga" && newType === "Trabalho") {
    const monday = mondayOf(yy, mm - 1, dd);
    for (let i = 0; i < 7; i++) {
      const d = addDays(monday, i);
      const dk = dateKey(d.getFullYear(), d.getMonth(), d.getDate());
      if (dk === dateStr) continue;
      const cell = effectiveCell(editedPerson, dk, schedule);
      if (cell?.type !== "Trabalho") continue;

      // "seguro" não exige um dia perfeito (pode já ter um problema à parte, nada a ver com esta
      // troca) — só exige que a troca não piore o défice de cobertura total desse dia.
      const antes = deficitSum(weekAlerts([d], schedule, staff, coverage));
      const scheduleTeste: Schedule = { ...schedule, [`${nome}-${dk}`]: { type: "Folga", entry: "", exit: "", note: "" } };
      const depois = deficitSum(weekAlerts([d], scheduleTeste, staff, coverage));
      if (depois <= antes) {
        const diaLabel = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"][d.getDay()];
        return {
          tipo: "compensacao",
          mensagem: `${nome} passa a ter menos uma folga esta semana. Compensar dando folga a ${diaLabel} (${d.getDate()}/${d.getMonth() + 1}), sem piorar a cobertura?`,
          aplicar: [{ nome, dateStr: dk, cell: { type: "Folga", entry: "", exit: "", note: "" } }],
        };
      }
    }
    return null; // não há nenhum dia esta semana em que compensar não piore a cobertura
  }

  return null;
}

function deficitSum(alerts: CoverageAlert[]): number {
  return alerts.reduce((sum, a) => sum + (a.need - a.have), 0);
}
