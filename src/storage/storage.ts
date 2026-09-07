import { LS_KEY } from "../constants";

export function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);

    if (raw) {
      return JSON.parse(raw);
    }
  } catch {
    // Ignora dados inválidos
  }

  return null;
}

export function saveState(state: unknown) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch {
    // Ignora erros de escrita
  }
}