// types.ts
// Tipos centrais partilhados por toda a aplicação.

export type Equipa = "vendas" | "caixa";

export type CellType = "Trabalho" | "Folga" | "Férias" | "Licença" | "Falta";

export interface Cell {
  type: CellType;
  entry: string; // "HH:MM" ou "" se não aplicável
  exit: string;
  note?: string;
}

// Chave de célula: "<nome>-<YYYY-MM-DD>"
export type Schedule = Record<string, Cell>;

export interface Colaborador {
  id: string;
  nome: string;
  equipa: Equipa;
  // Função secundária: pode ser "emprestado" à outra equipa nos dias em que essa equipa
  // não bate o mínimo sozinha. Não move a pessoa de equipa — só conta para a cobertura.
  equipaSecundaria?: Equipa | null;
  // Dia da semana fixo de folga (1=Segunda ... 6=Sábado; null = sem dia fixo, decide só pela
  // justiça de folgas como antes). Domingo não é escolhível aqui — é sempre decidido pela
  // rotação (normal ou fim de semana completo).
  folgaFixa?: number | null;
  // Data de entrada ("YYYY-MM-DD", inclusive — primeiro dia contado). Data de saída
  // ("YYYY-MM-DD", exclusive — primeiro dia JÁ NÃO contado; null = ainda ativo/a). "Marcar
  // inativo" define esta data; o histórico gravado antes dela nunca é apagado.
  startDate?: string | null;
  endDate?: string | null;
}

export interface CoverageRequirement {
  vendas: number;
  caixa: number;
}

export interface CoverageConfig {
  weekday: CoverageRequirement; // dias úteis (seg-sáb), horário completo
  reduced: CoverageRequirement; // domingos e feriados, horário reduzido 14:00-19:00
}

export interface Aviso {
  day: number;
  team: Equipa;
  falta: number; // quantas pessoas a menos, depois de tentar tudo (incl. função secundária)
}

// Quem tem o fim de semana completo (Sáb+Dom) numa semana, por equipa — null = ninguém.
export type WeekendBonus = Record<Equipa, string | null>;
