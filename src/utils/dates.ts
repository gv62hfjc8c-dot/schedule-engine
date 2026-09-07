// utils/dates.ts
// Funções puras de datas.
import { LUNCH } from "../constants";

export const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();

export const dateKey = (y: number, m: number, d: number) =>
  `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

export const todayKey = (): string => {
  const t = new Date();
  return dateKey(t.getFullYear(), t.getMonth(), t.getDate());
};

export const addDays = (date: Date, n: number) => {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
};

// Segunda-feira da semana que contém (y,m,d).
export const mondayOf = (y: number, m: number, d: number) => {
  const date = new Date(y, m, d);
  const dow = date.getDay();
  return addDays(date, dow === 0 ? -6 : 1 - dow);
};

// As 7 datas (Seg→Dom) da semana que contém (y,m,d).
export const weekDates = (y: number, m: number, d: number): Date[] => {
  const mon = mondayOf(y, m, d);
  return Array.from({ length: 7 }, (_, i) => addDays(mon, i));
};

export const calcHours = (entry: string, exit: string): number => {
  if (!entry || !exit) return 0;
  const [eh, em] = entry.split(":").map(Number);
  const [xh, xm] = exit.split(":").map(Number);
  const raw = (xh + xm / 60) - (eh + em / 60);
  // Turnos até 5h são um bloco único sem interrupção (ex: domingo/feriado) — só se desconta a
  // hora de almoço em turnos mais longos que isso.
  const comAlmoco = raw > 5 ? raw - LUNCH : raw;
  return Math.max(0, Math.round(comAlmoco * 100) / 100);
};

// Todas as segundas-feiras cujo trimestre (0-3, atribuído pelo mês da própria segunda-feira) é
// o pedido. Uma semana a cavalo de dois trimestres conta para o trimestre em que a sua Segunda
// cai — convenção simples e única, para nunca haver dúvida de que lado uma semana fica.
export const mondaysInQuarter = (year: number, quarter: number): Date[] => {
  const mondays: Date[] = [];
  let d = mondayOf(year, 0, 1);
  // recua até à primeira Segunda que ainda pode tocar o ano (evita perder a 1ª semana do ano)
  while (d.getFullYear() === year - 1) d = addDays(d, 7);
  while (d.getFullYear() <= year) {
    if (d.getFullYear() === year && Math.floor(d.getMonth() / 3) === quarter) mondays.push(d);
    if (d.getFullYear() > year) break;
    d = addDays(d, 7);
  }
  return mondays;
};
