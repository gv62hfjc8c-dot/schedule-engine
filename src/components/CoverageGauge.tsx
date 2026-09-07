// components/CoverageGauge.tsx
// Elemento de assinatura visual da app: uma régua por dia que mostra, de imediato, se Vendas e
// Caixa batem o mínimo exigido nesse dia — a mesma decisão que o motor está a tomar por baixo,
// tornada visível em vez de escondida numa tabela.
import type { Colaborador, CoverageConfig } from "../types";
import type { Schedule } from "../types";
import { dayCoverage } from "../utils/autoSchedule";
import { holidaySet } from "../utils/holidays";
import { S, C } from "../styles";

const PT_DAYS_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function Bar({ have, need, color }: { have: number; need: number; color: string }) {
  const ok = have >= need;
  const pct = need === 0 ? 100 : Math.min(100, Math.round((have / need) * 100));
  return (
    <div style={S.gaugeStrip} title={`${have} de ${need} mínimo`}>
      <div
        style={{
          height: "100%",
          width: `${pct}%`,
          background: ok ? color : C.error,
          transition: "width .2s",
        }}
      />
    </div>
  );
}

export function CoverageGauge({
  dates,
  schedule,
  staff,
  coverage,
}: {
  dates: Date[];
  schedule: Schedule;
  staff: Colaborador[];
  coverage: CoverageConfig;
}) {
  return (
    <div style={S.gaugeRow}>
      <div />
      {dates.map((date) => {
        const y = date.getFullYear(), m = date.getMonth(), d = date.getDate();
        const dow = date.getDay();
        const isReduced = dow === 0 || holidaySet(y, m).has(d);
        const cfg = isReduced ? coverage.reduced : coverage.weekday;
        const cov = dayCoverage(y, m, d, schedule, staff, cfg);
        return (
          <div key={date.toISOString()} style={S.gaugeCell}>
            <div style={S.gaugeDay}>{PT_DAYS_SHORT[dow]}</div>
            <div style={S.gaugeDate}>{d}</div>
            <div style={S.gaugeBar}>
              <Bar have={cov.vendas} need={cfg.vendas} color={C.timber} />
              <Bar have={cov.caixa} need={cfg.caixa} color={C.steel} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
