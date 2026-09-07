// components/ResumoView.tsx
// Vista de estatísticas: horas por semana, domingos/fins de semana gozados, e média trimestral
// contra a meta de horas (a cláusula do contrato — ver conversa: 41h15/semana normal para
// compensar 1 domingo de folga a cada 4 semanas; esta vista existe para confirmar que a rotação
// está mesmo a aproximar a média de cada pessoa dessa meta).
import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { Colaborador, Schedule } from "../types";
import { CELL_CFG, QUARTER_LABELS, WEEKLY_TARGET_HOURS } from "../constants";
import { mondaysInQuarter } from "../utils/dates";
import { quarterStatsFor } from "../utils/stats";
import { S, C, FONT } from "../styles";

export function ResumoView({ staff, schedule }: { staff: Colaborador[]; schedule: Schedule }) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [quarter, setQuarter] = useState(Math.floor(today.getMonth() / 3));

  const mondays = useMemo(() => mondaysInQuarter(year, quarter), [year, quarter]);
  const stats = useMemo(
    () => staff.map((s) => quarterStatsFor(s, mondays, schedule)),
    [staff, mondays, schedule]
  );

  const changeQuarter = (delta: number) => {
    let q = quarter + delta, y = year;
    if (q < 0) { q = 3; y -= 1; }
    if (q > 3) { q = 0; y += 1; }
    setQuarter(q); setYear(y);
  };

  if (staff.length === 0) {
    return (
      <div style={S.panel}>
        <div style={{ fontSize: 13, color: C.inkMuted }}>Ainda não há colaboradores para mostrar estatísticas.</div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <button style={S.ghostBtn} onClick={() => changeQuarter(-1)}>‹</button>
        <div style={{ fontFamily: FONT.display, fontSize: 16, textTransform: "uppercase", letterSpacing: 0.4 }}>
          {QUARTER_LABELS[quarter]} {year}
        </div>
        <button style={S.ghostBtn} onClick={() => changeQuarter(1)}>›</button>
        <div style={{ fontSize: 12, color: C.inkMuted, marginLeft: 8 }}>
          {mondays.length} semana(s) neste trimestre · meta {WEEKLY_TARGET_HOURS}h/semana
        </div>
      </div>

      <div style={{ ...S.grid, overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontFamily: FONT.body, fontSize: 12 }}>
          <thead>
            <tr style={{ background: C.stone }}>
              <th style={thStyle}>Colaborador</th>
              {mondays.map((mon) => (
                <th key={mon.toISOString()} style={{ ...thStyle, fontFamily: FONT.mono, minWidth: 44 }}>
                  {mon.getDate()}/{mon.getMonth() + 1}
                </th>
              ))}
              <th style={{ ...thStyle, minWidth: 70 }}>Média</th>
              <th style={{ ...thStyle, minWidth: 60 }}>Domingos</th>
              <th style={{ ...thStyle, minWidth: 70 }}>F. semana</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((row) => {
              const hoursByMonday = new Map(row.weeklyHours.map((w) => [w.monday.toISOString(), w]));
              const abaixo = row.mediaSemanal > 0 && row.mediaSemanal < WEEKLY_TARGET_HOURS - 0.5;
              const acima = row.mediaSemanal > WEEKLY_TARGET_HOURS + 0.5;
              return (
                <tr key={row.nome} style={{ borderTop: `1px solid ${C.border}` }}>
                  <td style={{ ...tdStyle, fontWeight: 600, textAlign: "left" }}>{row.nome}</td>
                  {mondays.map((mon) => {
                    const w = hoursByMonday.get(mon.toISOString());
                    if (w === undefined) return <td key={mon.toISOString()} style={{ ...tdStyle, fontFamily: FONT.mono, color: C.inkMuted }}>—</td>;
                    if (w.excluidaDaMedia) {
                      return (
                        <td
                          key={mon.toISOString()}
                          style={{ ...tdStyle, fontFamily: FONT.body, fontSize: 10, fontWeight: 700, color: CELL_CFG.Férias.color }}
                          title="Férias/Licença nesta semana — não entra na média"
                        >
                          Férias/Lic.
                        </td>
                      );
                    }
                    return (
                      <td key={mon.toISOString()} style={{ ...tdStyle, fontFamily: FONT.mono }}>
                        {w.hours}
                      </td>
                    );
                  })}
                  <td style={{ ...tdStyle, fontFamily: FONT.mono, fontWeight: 700, color: abaixo ? C.error : acima ? C.warn : C.ok }}>
                    {row.mediaSemanal || "—"}
                  </td>
                  <td style={{ ...tdStyle, fontFamily: FONT.mono }}>{row.domingos}</td>
                  <td style={{ ...tdStyle, fontFamily: FONT.mono }}>{row.finsDeSemanaCompletos}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: 11, color: C.inkMuted, marginTop: 10, fontFamily: FONT.body }}>
        Média a <span style={{ color: C.error, fontWeight: 700 }}>vermelho</span> = abaixo da meta;{" "}
        <span style={{ color: C.warn, fontWeight: 700 }}>laranja</span> = acima. "—" numa semana quer dizer
        que ainda não foi gerada; <span style={{ color: CELL_CFG.Férias.color, fontWeight: 700 }}>"Férias/Lic."</span>{" "}
        quer dizer que essa semana teve Férias ou Licença — nenhuma das duas entra na média (Folga e
        Falta continuam a entrar normalmente).
      </div>
    </div>
  );
}

const thStyle: CSSProperties = { padding: "8px 10px", textAlign: "center", fontFamily: FONT.display, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.3, color: "#6E6659" };
const tdStyle: CSSProperties = { padding: "7px 10px", textAlign: "center" };
