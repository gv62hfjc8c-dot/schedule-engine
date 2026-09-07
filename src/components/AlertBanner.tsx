// components/AlertBanner.tsx
// Mostra, em tempo real, qualquer dia da semana visível que esteja abaixo da cobertura mínima —
// seja por decisão do gerador automático ou por uma edição manual feita depois.
import { EQUIPA_CFG } from "../constants";
import type { CoverageAlert } from "../utils/autoSchedule";
import { S, C } from "../styles";

const PT_DAYS_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export function AlertBanner({ alerts }: { alerts: CoverageAlert[] }) {
  if (alerts.length === 0) return null;
  return (
    <div style={S.alertBanner}>
      {alerts.map((a, i) => (
        <div
          key={i}
          style={{ ...S.alertRow, background: C.errorBg, color: C.error, fontWeight: 600 }}
        >
          ⚠ {PT_DAYS_SHORT[a.date.getDay()]} {a.date.getDate()}/{a.date.getMonth() + 1} ({a.inicio}–{a.fim}):{" "}
          {EQUIPA_CFG[a.team].label} com {a.have} de {a.need} mínimo
        </div>
      ))}
    </div>
  );
}
