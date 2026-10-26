/** UI preferences only. Never persist generated schedules as preferences. */
const PREFIX = "schedule-engine:generator-ui:v1:";
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export function readGeneratorDate(key: string, fallback: () => string): string {
  try {
    const saved = window.localStorage.getItem(PREFIX + key);
    if (saved && DATE.test(saved) && !Number.isNaN(Date.parse(saved + "T12:00:00Z")) &&
        new Date(saved + "T12:00:00Z").toISOString().slice(0, 10) === saved) return saved;
  } catch { /* Private mode / storage unavailable. */ }
  return fallback();
}
export function saveGeneratorDate(key: string, value: string): void {
  try {
    if (DATE.test(value)) window.localStorage.setItem(PREFIX + key, value);
  } catch { /* UI remains usable without storage. */ }
}
export type GeneratorMode = "day" | "period" | "constrained";
export function readGeneratorMode(): GeneratorMode {
  try {
    const saved = window.localStorage.getItem(PREFIX + "mode");
    if (saved === "day" || saved === "period" || saved === "constrained") return saved;
  } catch { /* Storage unavailable. */ }
  return "day";
}
export function saveGeneratorMode(mode: GeneratorMode): void {
  try { window.localStorage.setItem(PREFIX + "mode", mode); } catch { /* Optional. */ }
}
