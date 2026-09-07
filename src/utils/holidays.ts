// utils/holidays.ts
// Cálculo de feriados dos Açores (Páscoa via algoritmo de Gauss). Sem feriados locais/municipais
// nesta fase — fica para quando a vista de Definições existir.
import { addDays } from "./dates";

export function computeEaster(y: number): Date {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const mn = Math.floor((a + 11 * h + 22 * l) / 451);
  const mo = Math.floor((h + l - 7 * mn + 114) / 31) - 1;
  const dy = ((h + l - 7 * mn + 114) % 31) + 1;
  return new Date(y, mo, dy);
}

// "Dia da Região Autónoma dos Açores" é MÓVEL — segunda-feira a seguir ao Domingo de Pentecostes
// (Páscoa + 50 dias), não uma data fixa a 25 de maio.
export function azoresHolidays(y: number): { date: Date; name: string }[] {
  const fixed = [
    { m: 0, d: 1, n: "Ano Novo" }, { m: 3, d: 25, n: "Liberdade" }, { m: 4, d: 1, n: "Trabalhador" },
    { m: 5, d: 10, n: "Portugal" }, { m: 7, d: 15, n: "Assunção" }, { m: 9, d: 5, n: "República" },
    { m: 10, d: 1, n: "Todos os Santos" }, { m: 11, d: 1, n: "Independência" },
    { m: 11, d: 8, n: "Imac. Conceição" }, { m: 11, d: 25, n: "Natal" },
  ];
  const easter = computeEaster(y);
  return [
    ...fixed.map((h) => ({ date: new Date(y, h.m, h.d), name: h.n })),
    { date: addDays(easter, -2), name: "Sexta-feira Santa" },
    { date: addDays(easter, 50), name: "Dia da Região Autónoma dos Açores" },
    { date: addDays(easter, 60), name: "Corpo de Deus" },
  ];
}

export function holidaySet(y: number, m: number): Set<number> {
  return new Set(
    azoresHolidays(y)
      .filter((h) => h.date.getFullYear() === y && h.date.getMonth() === m)
      .map((h) => h.date.getDate())
  );
}

export function holidayName(y: number, m: number, d: number): string | null {
  const h = azoresHolidays(y).find(
    (h) => h.date.getFullYear() === y && h.date.getMonth() === m && h.date.getDate() === d
  );
  return h ? h.name : null;
}
