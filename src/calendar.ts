export interface DayCell {
  day: number | null;
  date: string | null;
}

/** Grelha civil de segunda a domingo, apenas para apresentação (sem horários). */
export function monthCells(year: number, monthIndex: number): DayCell[] {
  if (!Number.isInteger(year) || !Number.isInteger(monthIndex) ||
      year < 1 || year > 9999 || monthIndex < 0 || monthIndex > 11) {
    throw new Error("Mês civil inválido.");
  }
  const firstWeekday = (new Date(year, monthIndex, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  return Array.from({ length: cells }, (_, i) => {
    const day = i - firstWeekday + 1;
    if (day < 1 || day > daysInMonth) return { day: null, date: null };
    const date = String(year).padStart(4, "0") + "-" +
      String(monthIndex + 1).padStart(2, "0") + "-" +
      String(day).padStart(2, "0");
    return { day, date };
  });
}

export function monthLabel(year: number, monthIndex: number): string {
  const label = new Intl.DateTimeFormat("pt-PT", {
    year: "numeric", month: "long"
  }).format(new Date(year, monthIndex, 1));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function selectedDayLabel(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-PT", {
    weekday: "long", day: "numeric", month: "long", year: "numeric"
  }).format(new Date(year, month - 1, day));
}
