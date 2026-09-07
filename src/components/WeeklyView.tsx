// components/WeeklyView.tsx
// A vista semanal — por agora, é a aplicação toda. Uma linha por colaborador, uma coluna por dia.
import { useState } from "react";
import type { Cell, Colaborador, Schedule } from "../types";
import { CELL_CFG, EQUIPA_CFG } from "../constants";
import { dateKey } from "../utils/dates";
import { effectiveCell } from "../utils/cells";
import { S, C } from "../styles";
import { CellModal } from "./CellModal";

const PT_DAYS_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export function WeeklyView({
  dates,
  staff,
  schedule,
  onCellChange,
}: {
  dates: Date[];
  staff: Colaborador[];
  schedule: Schedule;
  onCellChange: (nome: string, key: string, cell: Cell) => void;
}) {
  const [modal, setModal] = useState<{ nome: string; key: string; label: string; cell: Cell } | null>(null);

  return (
    <div style={S.grid}>
      <div style={{ ...S.gridRow, ...S.gridRowHead, background: C.stone }}>
        <div style={{ ...S.gridNameCell, borderRight: `1px solid ${C.border}`, fontFamily: "inherit" }}>
          Colaborador
        </div>
        {dates.map((date) => (
          <div key={date.toISOString()} style={{ ...S.cell, cursor: "default" }}>
            <div style={S.cellType}>{PT_DAYS_SHORT[date.getDay()]}</div>
            <div style={S.cellHours}>{date.getDate()}</div>
          </div>
        ))}
      </div>

      {staff.length === 0 && (
        <div style={{ padding: 20, textAlign: "center", color: C.inkMuted, fontSize: 13 }}>
          Ainda não há colaboradores — adiciona em baixo.
        </div>
      )}

      {staff.map((s) => (
        <div key={s.id} style={S.gridRow}>
          <div style={S.gridNameCell}>
            <span style={{ ...S.teamDot, background: EQUIPA_CFG[s.equipa].color }} />
            {s.nome}
          </div>
          {dates.map((date) => {
            const k = dateKey(date.getFullYear(), date.getMonth(), date.getDate());
            const cellKey = `${s.nome}-${k}`;
            const cell = effectiveCell(s, k, schedule);
            const cfg = cell ? CELL_CFG[cell.type] : null;
            return (
              <div
                key={cellKey}
                style={{ ...S.cell, background: cfg?.bg ?? "#FAFAF8" }}
                onClick={() =>
                  setModal({
                    nome: s.nome,
                    key: k,
                    label: `${PT_DAYS_SHORT[date.getDay()]} ${date.getDate()}/${date.getMonth() + 1}`,
                    cell: cell ?? { type: "Folga", entry: "", exit: "", note: "" },
                  })
                }
              >
                {cell ? (
                  <>
                    <div style={{ ...S.cellType, color: cfg!.color }}>{cfg!.label}</div>
                    {cell.type === "Trabalho" && (
                      <div style={S.cellHours}>{cell.entry}–{cell.exit}</div>
                    )}
                  </>
                ) : (
                  <div style={{ ...S.cellHours, color: C.inkMuted }}>—</div>
                )}
              </div>
            );
          })}
        </div>
      ))}

      {modal && (
        <CellModal
          nome={modal.nome}
          dateLabel={modal.label}
          cell={modal.cell}
          onClose={() => setModal(null)}
          onSave={(cell) => onCellChange(modal.nome, modal.key, cell)}
        />
      )}
    </div>
  );
}
