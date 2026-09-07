// utils/autoSchedule.ts
// Motor de geração automática do horário — gera UMA SEMANA de cada vez (Segunda a Domingo).
//
// Ordem de prioridade, do mais para o menos importante (decidido e confirmado):
//   1. Cobertura mínima por equipa (Vendas/Caixa) — hora a hora (blocos abertura/miolo/fecho)
//   2. Dia fixo de cada pessoa (quando definido) + fim de semana completo em rotação
//   3. Distribuição justa de folgas: há quantos dias cada pessoa não tem folga, só nas últimas
//      HISTORY_WINDOW_WEEKS semanas, nunca antes da data de entrada, e NUNCA incluindo a própria
//      semana que está a ser gerada (é isto que torna "gerar de novo" sempre determinístico).
//   4. Continuidade com o padrão do mês anterior      → fica para uma fase seguinte
//   5. Cumprir a meta de horas semanais de cada pessoa → fica para uma fase seguinte
//
// Férias/Falta marcadas manualmente, e dias fora do período de contrato (data de entrada/saída),
// nunca contam para a cobertura — simplesmente não se escreve célula nenhuma nesses dias.
// "resolveCoverage" é o único leitor de "quem conta para onde".

import type {
  Cell, Colaborador, CoverageConfig, CoverageRequirement, Equipa, Schedule, Aviso, WeekendBonus,
} from "../types";
import {
  DEFAULT_SHIFT_REDUCED, STORE_HOURS_REDUCED, EDGE_START, EDGE_END, CORE_START, CORE_END, EDGE_MIN,
  HISTORY_WINDOW_WEEKS,
} from "../constants";
import { addDays, dateKey } from "./dates";
import { holidaySet } from "./holidays";
import { isEmployedOn, effectiveCell } from "./cells";
export { isEmployedOn };

const HISTORY_WINDOW_DAYS = HISTORY_WINDOW_WEEKS * 7;

// Extrai "<nome>" e "YYYY-MM-DD" de uma chave "<nome>-YYYY-MM-DD" (a data são sempre os últimos
// 10 caracteres — é o único sítio de toda a app que faz esta separação, para não se desalinhar).
function splitCellKey(key: string): { nome: string; dateStr: string } {
  return { nome: key.slice(0, key.length - 11), dateStr: key.slice(-10) };
}

// Leitor único de cobertura: dado quem está PRESENTE (num bloco de tempo ou no dia todo), quantas
// pessoas conta cada equipa — incluindo emprestar quem tem função secundária, mas só até onde a
// equipa principal dessa pessoa aguenta ceder sem cair abaixo do PRÓPRIO mínimo.
export function resolveCoverage(
  present: Set<string>, staff: Colaborador[], cfg: CoverageRequirement
): { vendas: number; caixa: number } {
  let vendas = staff.filter((s) => s.equipa === "vendas" && present.has(s.nome)).length;
  let caixa = staff.filter((s) => s.equipa === "caixa" && present.has(s.nome)).length;

  const emprestar = (from: Equipa, to: Equipa, falta: number) => {
    if (falta <= 0) return;
    const fromCount = from === "vendas" ? vendas : caixa;
    const sobra = Math.max(0, fromCount - cfg[from]);
    const candidatos = staff.filter((s) => s.equipa === from && s.equipaSecundaria === to && present.has(s.nome));
    const movidos = Math.min(falta, sobra, candidatos.length);
    if (from === "vendas") { vendas -= movidos; caixa += movidos; } else { caixa -= movidos; vendas += movidos; }
  };

  emprestar("vendas", "caixa", cfg.caixa - caixa);
  emprestar("caixa", "vendas", cfg.vendas - vendas);

  return { vendas, caixa };
}

// Atribui horários de entrada/saída a quem trabalha num dia útil, para cobrir a loja toda
// (08:30-19:00) sem ninguém ter de lá estar o dia inteiro: 1 pessoa "abre" (08:30-18:30, no
// máximo de 9h de trabalho), 1 pessoa "fecha" (09:00-19:00, também no máximo), e o resto fica só
// no miolo (09:00-18:30, ~8h30). Com só 1 pessoa disponível, prioriza cobrir a abertura.
function assignWeekdayShiftTimes(names: string[]): Record<string, { entry: string; exit: string }> {
  const result: Record<string, { entry: string; exit: string }> = {};
  if (names.length === 0) return result;
  if (names.length === 1) {
    result[names[0]] = { entry: EDGE_START, exit: CORE_END };
    return result;
  }
  const [abre, fecha, ...resto] = names;
  result[abre] = { entry: EDGE_START, exit: CORE_END };
  result[fecha] = { entry: CORE_START, exit: EDGE_END };
  resto.forEach((n) => { result[n] = { entry: CORE_START, exit: CORE_END }; });
  return result;
}

// Há quantos dias esta pessoa não tem folga, olhando para trás a partir de "beforeKey" (nunca
// incluído) até ao mais recente entre: início da janela de HISTORY_WINDOW_WEEKS, ou a data de
// entrada da pessoa. Quem nunca teve folga nesse intervalo fica com o valor máximo da janela —
// ou seja, o mais "atrasado" possível, sem precisar de um caso especial à parte.
export function daysSinceLastFolga(nome: string, beforeKey: string, schedule: Schedule, startDate: string | null | undefined): number {
  const before = new Date(beforeKey);
  const windowStart = addDays(before, -HISTORY_WINDOW_DAYS);
  const limitDate = startDate && new Date(startDate) > windowStart ? new Date(startDate) : windowStart;
  for (let d = addDays(before, -1); d >= limitDate; d = addDays(d, -1)) {
    const k = dateKey(d.getFullYear(), d.getMonth(), d.getDate());
    if (schedule[`${nome}-${k}`]?.type === "Folga") {
      return Math.round((before.getTime() - d.getTime()) / 86400000);
    }
  }
  return Math.round((before.getTime() - limitDate.getTime()) / 86400000);
}

// Conta, para uma pessoa, quantos fins de semana completos (Sábado E Domingo de Folga) teve nos
// últimos HISTORY_WINDOW_WEEKS, sem olhar para a própria semana a gerar.
function countRecentWeekendBonuses(nome: string, beforeKey: string, schedule: Schedule): number {
  let count = 0;
  Object.keys(schedule).forEach((key) => {
    if (!key.startsWith(`${nome}-`)) return;
    if (schedule[key].type !== "Folga") return;
    const { dateStr } = splitCellKey(key);
    if (dateStr >= beforeKey) return; // nunca a própria semana (ou o futuro)
    const [y, m, d] = dateStr.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    if (date.getDay() !== 0) return; // só conta a partir do Domingo, olhando para trás
    const daysBack = Math.round((new Date(beforeKey).getTime() - date.getTime()) / 86400000);
    if (daysBack > HISTORY_WINDOW_DAYS) return;
    const sat = addDays(date, -1);
    const satKey = `${nome}-${dateKey(sat.getFullYear(), sat.getMonth(), sat.getDate())}`;
    if (schedule[satKey]?.type === "Folga") count++;
  });
  return count;
}

function pickBonusCandidate(team: Equipa, staff: Colaborador[], beforeKey: string, schedule: Schedule): string | null {
  const pool = staff.filter((s) => s.equipa === team && isEmployedOn(s, beforeKey));
  if (pool.length === 0) return null;
  const ranked = [...pool].sort(
    (a, b) => countRecentWeekendBonuses(a.nome, beforeKey, schedule) - countRecentWeekendBonuses(b.nome, beforeKey, schedule)
  );
  return ranked[0].nome;
}

export interface GenerateResult {
  schedule: Schedule;
  avisos: Aviso[];
  bonus: WeekendBonus;
}

// Gera uma semana (Segunda a Domingo) inteira. "monday" é a segunda-feira dessa semana.
// "forcedBonus" permite substituir a escolha automática de quem fica com o fim de semana.
export function generateWeekSchedule(
  monday: Date,
  staff: Colaborador[],
  coverage: CoverageConfig,
  fullSchedule: Schedule,
  forcedBonus?: Partial<WeekendBonus>
): GenerateResult {
  const mondayKey = dateKey(monday.getFullYear(), monday.getMonth(), monday.getDate());
  const sundayKey = dateKey(addDays(monday, 6).getFullYear(), addDays(monday, 6).getMonth(), addDays(monday, 6).getDate());

  // Base de histórico: o schedule recebido, mas SEM nenhuma célula desta mesma semana (se já
  // tinha sido gerada antes) — nunca usar uma versão antiga desta semana como se fosse passado.
  // À medida que os dias desta semana vão sendo decididos (mais abaixo), entram neste mesmo
  // objeto, por isso Terça já vê o que Segunda decidiu, Quarta já vê Segunda+Terça, etc. — só a
  // PRÓPRIA semana, antes de começar, é que fica de fora.
  const schedule: Schedule = {};
  Object.keys(fullSchedule).forEach((key) => {
    const { dateStr } = splitCellKey(key);
    if (dateStr < mondayKey || dateStr > sundayKey) schedule[key] = fullSchedule[key];
  });

  const avisos: Aviso[] = [];

  const bonus: WeekendBonus = {
    vendas: forcedBonus && "vendas" in forcedBonus ? forcedBonus.vendas! : pickBonusCandidate("vendas", staff, mondayKey, schedule),
    caixa: forcedBonus && "caixa" in forcedBonus ? forcedBonus.caixa! : pickBonusCandidate("caixa", staff, mondayKey, schedule),
  };

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(monday, i)); // Seg..Dom

  weekDays.forEach((date) => {
    const y = date.getFullYear(), m = date.getMonth(), d = date.getDate();
    const dow = date.getDay();
    const isHol = holidaySet(y, m).has(d);
    const isReduced = dow === 0 || isHol;
    const k = dateKey(y, m, d);
    const isWeekendDay = dow === 0 || dow === 6; // Sáb ou Dom
    const cfg = isReduced ? coverage.reduced : coverage.weekday; // mínimo do MIOLO / do dia todo (domingo)

    // Fora do período de contrato, ou Férias/Licença/Falta já marcadas: fora da decisão de hoje,
    // sem célula nenhuma escrita para essas pessoas.
    const indisponiveis = new Set(
      staff.filter((s) => {
        if (!isEmployedOn(s, k)) return true;
        const c = fullSchedule[`${s.nome}-${k}`];
        return c && (c.type === "Férias" || c.type === "Licença" || c.type === "Falta");
      }).map((s) => s.nome)
    );

    // Quem tem o fim de semana completo esta semana fica de folga automática ao Sáb/Dom — não
    // entra na disputa normal do dia.
    const bonusHoje = new Set(
      isWeekendDay
        ? (["vendas", "caixa"] as Equipa[]).map((t) => bonus[t]).filter((n): n is string => !!n && !indisponiveis.has(n))
        : []
    );

    const byTeam: Record<Equipa, string[]> = { vendas: [], caixa: [] };
    staff.forEach((s) => {
      if (!indisponiveis.has(s.nome) && !bonusHoje.has(s.nome)) byTeam[s.equipa].push(s.nome);
    });

    const folgaToday = new Set<string>(bonusHoje);
    const workToday = new Set<string>();

    // Passo 1 — cada equipa decide as suas folgas: primeiro quem tem hoje como dia fixo, depois
    // desempate por há quantos dias não tem folga (mais dias primeiro — está mais atrasado). O
    // histórico usado aqui é "schedule", que já inclui os dias anteriores DESTA MESMA semana.
    (["vendas", "caixa"] as Equipa[]).forEach((team) => {
      const pool = byTeam[team];
      const min = cfg[team];
      const slack = Math.max(0, pool.length - min);
      const ranked = [...pool].sort((a, b) => {
        const aFixa = staff.find((s) => s.nome === a)?.folgaFixa === dow ? 0 : 1;
        const bFixa = staff.find((s) => s.nome === b)?.folgaFixa === dow ? 0 : 1;
        if (aFixa !== bFixa) return aFixa - bFixa;
        const aStart = staff.find((s) => s.nome === a)?.startDate;
        const bStart = staff.find((s) => s.nome === b)?.startDate;
        const aDias = daysSinceLastFolga(a, k, schedule, aStart);
        const bDias = daysSinceLastFolga(b, k, schedule, bStart);
        return bDias - aDias; // mais dias sem folga primeiro
      });
      ranked.slice(0, slack).forEach((n) => folgaToday.add(n));
      ranked.slice(slack).forEach((n) => workToday.add(n));
    });

    // Passo 2 — reforço por função secundária, se mesmo assim uma equipa ficar curta no miolo.
    (["vendas", "caixa"] as Equipa[]).forEach((team) => {
      const otherTeam: Equipa = team === "vendas" ? "caixa" : "vendas";
      let cov = resolveCoverage(workToday, staff, cfg);
      let falta = cfg[team] - cov[team];
      if (falta <= 0) return;

      const candidatos = staff.filter(
        (s) => s.equipa === otherTeam && s.equipaSecundaria === team && folgaToday.has(s.nome) && !bonusHoje.has(s.nome)
      );
      for (const cand of candidatos) {
        if (falta <= 0) break;
        folgaToday.delete(cand.nome);
        workToday.add(cand.nome);
        cov = resolveCoverage(workToday, staff, cfg);
        falta = cfg[team] - cov[team];
      }
      if (falta > 0) avisos.push({ day: d, team, falta });
    });

    // Passo 3 — horários: domingo/feriado é um turno único (já cobre a loja toda); dia útil
    // escalona por equipa para cobrir 08:30-19:00 sem ninguém lá o dia inteiro.
    const shiftTimes: Record<string, { entry: string; exit: string }> = {};
    if (!isReduced) {
      const workingVendas = staff.filter((s) => s.equipa === "vendas" && workToday.has(s.nome)).map((s) => s.nome);
      const workingCaixa = staff.filter((s) => s.equipa === "caixa" && workToday.has(s.nome)).map((s) => s.nome);
      Object.assign(shiftTimes, assignWeekdayShiftTimes(workingVendas), assignWeekdayShiftTimes(workingCaixa));
    }

    staff.forEach((s) => {
      if (indisponiveis.has(s.nome)) return; // fora do contrato, ou Férias/Falta já gravadas
      const isFolga = folgaToday.has(s.nome);
      const times = isReduced ? DEFAULT_SHIFT_REDUCED : (shiftTimes[s.nome] ?? { entry: EDGE_START, exit: CORE_END });
      const cell: Cell = isFolga
        ? { type: "Folga", entry: "", exit: "", note: "" }
        : { type: "Trabalho", entry: times.entry, exit: times.exit, note: "" };
      schedule[`${s.nome}-${k}`] = cell;
    });
  });

  return { schedule, avisos, bonus };
}

// Quem tem o fim de semana completo numa semana já gravada — lido pelo leitor único, nunca conta
// dados fora do período de contrato da pessoa.
export function readWeekendBonus(monday: Date, staff: Colaborador[], schedule: Schedule): WeekendBonus {
  const sat = addDays(monday, 5), sun = addDays(monday, 6);
  const satKey = dateKey(sat.getFullYear(), sat.getMonth(), sat.getDate());
  const sunKey = dateKey(sun.getFullYear(), sun.getMonth(), sun.getDate());
  const result: WeekendBonus = { vendas: null, caixa: null };
  (["vendas", "caixa"] as Equipa[]).forEach((team) => {
    const found = staff.find(
      (s) => s.equipa === team
        && effectiveCell(s, satKey, schedule)?.type === "Folga"
        && effectiveCell(s, sunKey, schedule)?.type === "Folga"
    );
    result[team] = found ? found.nome : null;
  });
  return result;
}

// Cobertura "principal" de um dia — o pior instante observado dentro do miolo em dias úteis
// (09:00-18:30), ou do turno único ao domingo/feriado. Usado pela régua visual. Olha para os
// horários REAIS de cada célula, instante a instante — não presume que alguém tem de cobrir o
// bloco inteiro sozinho, por isso funciona tanto com os turnos que o motor gera como com
// horários escritos à mão (ex: ao transcrever dias antigos).
export function dayCoverage(
  y: number, m: number, d: number, schedule: Schedule, staff: Colaborador[], cfg: CoverageRequirement
): { vendas: number; caixa: number } {
  const k = dateKey(y, m, d);
  const isReduced = new Date(y, m, d).getDay() === 0 || holidaySet(y, m).has(d);
  const [start, end] = isReduced ? [STORE_HOURS_REDUCED.open, STORE_HOURS_REDUCED.close] : [CORE_START, CORE_END];

  const bounds = new Set([start, end]);
  staff.forEach((s) => {
    const cell = effectiveCell(s, k, schedule);
    if (cell?.type === "Trabalho" && cell.entry && cell.exit) {
      if (cell.entry > start && cell.entry < end) bounds.add(cell.entry);
      if (cell.exit > start && cell.exit < end) bounds.add(cell.exit);
    }
  });
  const sorted = Array.from(bounds).sort();
  let minVendas = Infinity, minCaixa = Infinity;
  for (let i = 0; i < sorted.length - 1; i++) {
    const t0 = sorted[i];
    if (t0 < start || t0 >= end) continue;
    const present = new Set(
      staff.filter((s) => {
        const cell = effectiveCell(s, k, schedule);
        return cell?.type === "Trabalho" && !!cell.entry && !!cell.exit && cell.entry <= t0 && cell.exit > t0;
      }).map((s) => s.nome)
    );
    const cov = resolveCoverage(present, staff, cfg);
    minVendas = Math.min(minVendas, cov.vendas);
    minCaixa = Math.min(minCaixa, cov.caixa);
  }
  if (minVendas === Infinity) return { vendas: 0, caixa: 0 }; // ninguém a trabalhar nesse intervalo
  return { vendas: minVendas, caixa: minCaixa };
}

export interface CoverageAlert {
  date: Date;
  team: Equipa;
  have: number;
  need: number;
  inicio: string; // "HH:MM" — início do intervalo em que a falta acontece
  fim: string;
}

// Recalcula, ao vivo, se em algum INSTANTE de um dia da semana a cobertura ficou abaixo do
// mínimo — junta as fronteiras reais da loja/blocos com os horários reais de cada célula, e
// verifica cada intervalo entre elas (é aí, e só aí, que a cobertura pode mudar). Intervalos
// consecutivos com exatamente a mesma falta juntam-se num único aviso com um intervalo de tempo.
export function weekAlerts(
  dates: Date[], schedule: Schedule, staff: Colaborador[], coverage: CoverageConfig
): CoverageAlert[] {
  const alerts: CoverageAlert[] = [];
  dates.forEach((date) => alerts.push(...dayAlerts(date, schedule, staff, coverage)));
  return alerts;
}

function dayAlerts(date: Date, schedule: Schedule, staff: Colaborador[], coverage: CoverageConfig): CoverageAlert[] {
  const y = date.getFullYear(), m = date.getMonth(), d = date.getDate();
  const dow = date.getDay();
  const isReduced = dow === 0 || holidaySet(y, m).has(d);
  const k = dateKey(y, m, d);
  const storeOpen = isReduced ? STORE_HOURS_REDUCED.open : EDGE_START;
  const storeClose = isReduced ? STORE_HOURS_REDUCED.close : EDGE_END;

  const bounds = new Set([storeOpen, storeClose]);
  if (!isReduced) { bounds.add(CORE_START); bounds.add(CORE_END); }
  staff.forEach((s) => {
    const cell = effectiveCell(s, k, schedule);
    if (cell?.type === "Trabalho" && cell.entry && cell.exit) {
      if (cell.entry > storeOpen && cell.entry < storeClose) bounds.add(cell.entry);
      if (cell.exit > storeOpen && cell.exit < storeClose) bounds.add(cell.exit);
    }
  });
  const sorted = Array.from(bounds).sort();

  const alerts: CoverageAlert[] = [];
  const active = new Map<Equipa, CoverageAlert>();

  for (let i = 0; i < sorted.length - 1; i++) {
    const t0 = sorted[i], t1 = sorted[i + 1];
    if (t0 < storeOpen || t0 >= storeClose) continue;

    const min = isReduced
      ? coverage.reduced
      : (t0 < CORE_START || t0 >= CORE_END ? { vendas: EDGE_MIN, caixa: EDGE_MIN } : coverage.weekday);

    const present = new Set(
      staff.filter((s) => {
        const cell = effectiveCell(s, k, schedule);
        return cell?.type === "Trabalho" && !!cell.entry && !!cell.exit && cell.entry <= t0 && cell.exit > t0;
      }).map((s) => s.nome)
    );
    const cov = resolveCoverage(present, staff, min);

    (["vendas", "caixa"] as Equipa[]).forEach((team) => {
      const falta = cov[team] < min[team];
      const running = active.get(team);
      if (falta) {
        if (running && running.have === cov[team] && running.need === min[team] && running.fim === t0) {
          running.fim = t1; // continua a mesma falta — só estica o intervalo
        } else {
          if (running) alerts.push(running);
          active.set(team, { date, team, have: cov[team], need: min[team], inicio: t0, fim: t1 });
        }
      } else if (running) {
        alerts.push(running);
        active.delete(team);
      }
    });
  }
  active.forEach((a) => alerts.push(a));
  return alerts;
}
