// components/CellModal.tsx
// Edição de uma célula: tipo de dia + horário. "Tens sempre o poder de alterar qualquer coisa" —
// esta é essa porta de entrada; o aviso de cobertura reage sozinho depois de gravares.
import { useState } from "react";
import type { MouseEvent, ChangeEvent } from "react";
import type { Cell, CellType } from "../types";
import { CELL_CFG } from "../constants";
import { S, C, FONT } from "../styles";

const TYPES: CellType[] = ["Trabalho", "Folga", "Férias", "Licença", "Falta"];

export function CellModal({
  nome,
  dateLabel,
  cell,
  onSave,
  onClose,
}: {
  nome: string;
  dateLabel: string;
  cell: Cell;
  onSave: (cell: Cell) => void;
  onClose: () => void;
}) {
  const [type, setType] = useState<CellType>(cell.type);
  const [entry, setEntry] = useState(cell.entry);
  const [exit, setExit] = useState(cell.exit);

  return (
    <div style={S.modalOverlay} onClick={onClose}>
      <div style={S.modalCard} onClick={(e: MouseEvent) => e.stopPropagation()}>
        <div style={{ fontFamily: FONT.display, fontSize: 15, textTransform: "uppercase", marginBottom: 2 }}>
          {nome}
        </div>
        <div style={{ fontSize: 13, color: C.inkMuted, marginBottom: 14 }}>{dateLabel}</div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
          {TYPES.map((t) => (
            <button
              key={t}
              onClick={() => {
                setType(t);
                if (t !== "Trabalho") { setEntry(""); setExit(""); }
                else if (!entry) { setEntry("09:00"); setExit("18:30"); }
              }}
              style={{
                border: `1.5px solid ${type === t ? CELL_CFG[t].color : C.border}`,
                background: type === t ? CELL_CFG[t].bg : "#FFF",
                color: type === t ? CELL_CFG[t].color : C.ink,
                borderRadius: 6,
                padding: "7px 12px",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {CELL_CFG[t].label}
            </button>
          ))}
        </div>

        {type === "Trabalho" && (
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, color: C.inkMuted, display: "block", marginBottom: 4 }}>Entrada</label>
              <input type="time" value={entry} onChange={(e: ChangeEvent<HTMLInputElement>) => setEntry(e.target.value)} style={{ ...S.input, width: "100%" }} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, color: C.inkMuted, display: "block", marginBottom: 4 }}>Saída</label>
              <input type="time" value={exit} onChange={(e: ChangeEvent<HTMLInputElement>) => setExit(e.target.value)} style={{ ...S.input, width: "100%" }} />
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <button style={{ ...S.ghostBtn, flex: 1 }} onClick={onClose}>Cancelar</button>
          <button
            style={{ ...S.primaryBtn, flex: 1 }}
            onClick={() => { onSave({ type, entry, exit, note: "" }); onClose(); }}
          >
            Gravar
          </button>
        </div>
      </div>
    </div>
  );
}
