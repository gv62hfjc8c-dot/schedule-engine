// components/WeekendPanel.tsx
// Mostra quem tem o fim de semana completo (Sáb+Dom) esta semana, por equipa, e deixa trocar.
// Nota: trocar volta a gerar a semana INTEIRA (não só a pessoa trocada) — se já tinhas editado
// células à mão essa semana, pede confirmação antes de continuar, tal como o "Gerar de novo".
import type { ChangeEvent } from "react";
import type { Colaborador, Equipa, WeekendBonus } from "../types";
import { EQUIPA_CFG } from "../constants";
import { S, C, FONT } from "../styles";

export function WeekendPanel({
  bonus,
  staff,
  onChange,
}: {
  bonus: WeekendBonus;
  staff: Colaborador[];
  onChange: (team: Equipa, nome: string | null) => void;
}) {
  return (
    <div style={{ ...S.panel, marginTop: 0, marginBottom: 14 }}>
      <div style={S.panelTitle}>Fim de semana completo</div>
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
        {(["vendas", "caixa"] as Equipa[]).map((team) => {
          const pool = staff.filter((s) => s.equipa === team);
          return (
            <div key={team} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ ...S.teamDot, background: EQUIPA_CFG[team].color }} />
              <span style={{ fontSize: 13, fontFamily: FONT.body, color: C.inkMuted, minWidth: 50 }}>
                {EQUIPA_CFG[team].label}:
              </span>
              <select
                style={S.select}
                value={bonus[team] ?? ""}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange(team, e.target.value || null)}
              >
                <option value="">— ninguém —</option>
                {pool.map((s) => (
                  <option key={s.id} value={s.nome}>{s.nome}</option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
    </div>
  );
}
