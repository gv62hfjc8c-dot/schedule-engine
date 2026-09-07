// constants.ts
// Configuração base da aplicação — equipas, colaboradores de partida, e as regras de cobertura
// mínima que já foram acordadas (dia útil: 3 Vendas + 3 Caixa; domingo/feriado: 2 Vendas + 3 Caixa).

import type { Colaborador, CoverageConfig } from "./types";

export const EQUIPA_CFG: Record<"vendas" | "caixa", { label: string; color: string }> = {
  vendas: { label: "Vendas", color: "#B9762E" },
  caixa: { label: "Caixa", color: "#3C5064" },
};

// Sem colaboradores por omissão — adicionas todos tu próprio em "Colaboradores".
export const DEFAULT_STAFF: Colaborador[] = [];

// Cobertura mínima acordada. Ajusta aqui se as necessidades da loja mudarem.
export const COVERAGE_CONFIG: CoverageConfig = {
  weekday: { vendas: 3, caixa: 3 },
  reduced: { vendas: 2, caixa: 3 },
};

export const STORE_HOURS_WEEKDAY = { open: "08:30", close: "19:00" };
export const STORE_HOURS_REDUCED = { open: "14:00", close: "19:00" };
export const LUNCH = 1;

// Dia útil dividido em 3 blocos para cobertura hora a hora — a loja fecha às 19:00 mas ninguém
// tem de estar lá o dia todo: as pontas (30 min) só exigem 1 pessoa por equipa, o miolo exige o
// mínimo cheio (COVERAGE_CONFIG.weekday). Domingo/feriado não precisa disto — é um turno único
// (14:00-19:00) que já cobre a loja toda de uma vez.
export const EDGE_START = "08:30";
export const EDGE_END = "19:00";
export const CORE_START = "09:00";
export const CORE_END = "18:30";
export const EDGE_MIN = 1; // por equipa, nas pontas de 30 min (08:30-09:00 e 18:30-19:00)

// Duração normal de turno (8h de trabalho + 1h de almoço). O motor pode esticar até este máximo
// quando precisa de tapar uma ponta do dia.
export const SHIFT_HOURS_NORMAL = 8;
export const SHIFT_HOURS_MAX = 9;

// Domingo/feriado: turno único, já cobre a loja toda (14:00-19:00, sem almoço — turnos ≤5h não
// descontam almoço).
export const DEFAULT_SHIFT_REDUCED = { entry: "14:00", exit: "19:00" };

// Meta de horas semanais — regra geral para toda a gente por agora (contrato: compensação de
// domingos/fins de semana trabalhados é feita à volta desta média, por trimestre).
export const WEEKLY_TARGET_HOURS = 40;

export const QUARTER_LABELS = ["Jan–Mar", "Abr–Jun", "Jul–Set", "Out–Dez"];

// Quantas semanas para trás a justiça de folgas ("há quantos dias esta pessoa não tem folga")
// olha, no máximo — nunca antes disto, e nunca antes da data de entrada da pessoa.
export const HISTORY_WINDOW_WEEKS = 8;

export const LS_KEY = "borja-reis-horarios-v2";

// Índice igual a Date.getDay(): 0=Domingo ... 6=Sábado.
export const WEEKDAY_LABELS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

export const CELL_CFG: Record<string, { label: string; color: string; bg: string }> = {
  Trabalho: { label: "Trabalha", color: "#3F7A5C", bg: "#E6F0EA" },
  Folga: { label: "Folga", color: "#6E6659", bg: "#EDEAE2" },
  Férias: { label: "Férias", color: "#2E5FA3", bg: "#E6ECF7" },
  Licença: { label: "Licença", color: "#6B3FA0", bg: "#EFE6F7" },
  Falta: { label: "Falta", color: "#B3402A", bg: "#FBEAE5" },
};
