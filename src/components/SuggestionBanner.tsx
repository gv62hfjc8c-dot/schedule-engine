// components/SuggestionBanner.tsx
// Aparece depois de editares uma célula, se houver uma alternativa a propor — cobertura em falta
// ou uma folga a compensar. Nunca aplica nada sozinho: só ao carregares em "Aceitar".
import type { SwapSuggestion } from "../utils/suggestions";
import { S, C, FONT } from "../styles";

export function SuggestionBanner({
  suggestion,
  onAceitar,
  onRecusar,
}: {
  suggestion: SwapSuggestion;
  onAceitar: () => void;
  onRecusar: () => void;
}) {
  return (
    <div
      style={{
        ...S.alertRow,
        background: suggestion.tipo === "cobertura" ? C.warnBg : C.okBg,
        color: suggestion.tipo === "cobertura" ? C.warn : C.ok,
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 8,
        padding: "12px 14px",
      }}
    >
      <div style={{ fontFamily: FONT.body, fontWeight: 600 }}>
        {suggestion.tipo === "cobertura" ? "⚠ " : "💡 "}{suggestion.mensagem}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button style={S.primaryBtn} onClick={onAceitar}>Aceitar</button>
        <button style={S.ghostBtn} onClick={onRecusar}>Recusar</button>
      </div>
    </div>
  );
}
