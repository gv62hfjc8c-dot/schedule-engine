// components/StaffManager.tsx
// Adicionar, editar e desativar colaboradores. "Marcar inativo" preserva todo o histórico
// gravado (continua a aparecer no Resumo) e só deixa de aparecer nas semanas atuais/futuras.
// "Remover definitivamente" apaga tudo — ação separada, com confirmação, pouco usada.
import { useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";
import type { Colaborador, Equipa } from "../types";
import { EQUIPA_CFG, WEEKDAY_LABELS } from "../constants";
import { todayKey } from "../utils/dates";
import { S, C, FONT } from "../styles";

const DIAS_FIXOS = [1, 2, 3, 4, 5, 6]; // Segunda..Sábado (Domingo não é escolhível aqui)

export function StaffManager({
  staff,
  onChange,
}: {
  staff: Colaborador[];
  onChange: (staff: Colaborador[]) => void;
}) {
  const [nome, setNome] = useState("");
  const [equipa, setEquipa] = useState<Equipa>("vendas");
  const [equipaSecundaria, setEquipaSecundaria] = useState<Equipa | "">("");
  const [folgaFixa, setFolgaFixa] = useState<string>("");

  const add = () => {
    const trimmed = nome.trim();
    if (!trimmed) return;
    const id = `${trimmed.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`;
    onChange([...staff, {
      id, nome: trimmed, equipa,
      equipaSecundaria: equipaSecundaria || null,
      folgaFixa: folgaFixa ? Number(folgaFixa) : null,
      startDate: todayKey(),
      endDate: null,
    }]);
    setNome("");
    setEquipaSecundaria("");
    setFolgaFixa("");
  };

  const update = (id: string, patch: Partial<Colaborador>) =>
    onChange(staff.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const removeDefinitivo = (id: string, nomePessoa: string) => {
    if (!window.confirm(`Remover "${nomePessoa}" definitivamente apaga também todo o histórico gravado dela/e. Não dá para desfazer. Continuar?`)) return;
    onChange(staff.filter((s) => s.id !== id));
  };

  const toggleAtivo = (s: Colaborador) => {
    if (s.endDate) update(s.id, { endDate: null }); // reativar
    else update(s.id, { endDate: todayKey() }); // marcar inativo, preserva histórico
  };

  return (
    <div style={S.panel}>
      <div style={S.panelTitle}>Colaboradores</div>

      {staff.map((s) => {
        const inativo = !!s.endDate;
        return (
          <div key={s.id} style={{ ...S.staffRow, opacity: inativo ? 0.55 : 1, flexWrap: "wrap" }}>
            <span style={{ ...S.teamDot, background: EQUIPA_CFG[s.equipa].color }} />
            <span style={{ flex: 1, fontSize: 13, fontWeight: 600, minWidth: 90 }}>{s.nome}</span>
            <span style={{ fontSize: 12, color: C.inkMuted }}>{EQUIPA_CFG[s.equipa].label}</span>
            {s.equipaSecundaria && (
              <span style={{ fontSize: 11, color: C.inkMuted, background: C.stone, padding: "2px 8px", borderRadius: 10 }}>
                + {EQUIPA_CFG[s.equipaSecundaria].label}
              </span>
            )}
            <select
              value={s.folgaFixa ?? ""}
              onChange={(e: ChangeEvent<HTMLSelectElement>) => update(s.id, { folgaFixa: e.target.value ? Number(e.target.value) : null })}
              style={{ ...S.select, padding: "5px 8px", fontSize: 12 }}
              title="Dia fixo de folga"
            >
              <option value="">Sem dia fixo</option>
              {DIAS_FIXOS.map((d) => (
                <option key={d} value={d}>{WEEKDAY_LABELS[d]}</option>
              ))}
            </select>
            <label style={{ fontSize: 11, color: C.inkMuted, display: "flex", alignItems: "center", gap: 4 }}>
              Entrada
              <input
                type="date"
                value={s.startDate ?? ""}
                onChange={(e: ChangeEvent<HTMLInputElement>) => update(s.id, { startDate: e.target.value || null })}
                style={{ ...S.input, padding: "4px 6px", fontSize: 12 }}
              />
            </label>
            <label style={{ fontSize: 11, color: C.inkMuted, display: "flex", alignItems: "center", gap: 4 }}>
              Saída
              <input
                type="date"
                value={s.endDate ?? ""}
                onChange={(e: ChangeEvent<HTMLInputElement>) => update(s.id, { endDate: e.target.value || null })}
                style={{ ...S.input, padding: "4px 6px", fontSize: 12 }}
                title="Primeiro dia em que a pessoa já não trabalha (deixa em branco enquanto ativa/o)"
              />
            </label>
            {inativo ? (
              <span style={{ fontSize: 11, color: C.error, fontWeight: 600 }}>Inativo desde {s.endDate}</span>
            ) : null}
            <button
              onClick={() => toggleAtivo(s)}
              style={{ ...S.ghostBtn, padding: "5px 10px", fontSize: 12 }}
            >
              {inativo ? "Reativar" : "Marcar inativo (hoje)"}
            </button>
            <button
              onClick={() => removeDefinitivo(s.id, s.nome)}
              style={{ background: C.errorBg, color: C.error, border: "none", borderRadius: 6, padding: "5px 10px", fontSize: 12, cursor: "pointer" }}
              title="Apaga a pessoa E todo o histórico — não dá para desfazer"
            >
              Remover definitivamente
            </button>
          </div>
        );
      })}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
        <input
          value={nome}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setNome(e.target.value)}
          placeholder="Nome do colaborador"
          style={{ ...S.input, flex: "1 1 160px" }}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") add(); }}
        />
        <select value={equipa} onChange={(e: ChangeEvent<HTMLSelectElement>) => setEquipa(e.target.value as Equipa)} style={S.select}>
          <option value="vendas">Vendas</option>
          <option value="caixa">Caixa</option>
        </select>
        <select
          value={equipaSecundaria}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => setEquipaSecundaria(e.target.value as Equipa | "")}
          style={S.select}
          title="Função secundária (opcional) — usada para reforçar a outra equipa quando precisa"
        >
          <option value="">Sem função secundária</option>
          {(["vendas", "caixa"] as Equipa[]).filter((eq) => eq !== equipa).map((eq) => (
            <option key={eq} value={eq}>+ {EQUIPA_CFG[eq].label}</option>
          ))}
        </select>
        <select
          value={folgaFixa}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => setFolgaFixa(e.target.value)}
          style={S.select}
          title="Dia fixo de folga (opcional)"
        >
          <option value="">Sem dia fixo</option>
          {DIAS_FIXOS.map((d) => (
            <option key={d} value={d}>{WEEKDAY_LABELS[d]}</option>
          ))}
        </select>
        <button style={S.primaryBtn} onClick={add}>Adicionar</button>
      </div>
      <div style={{ fontSize: 11, color: C.inkMuted, marginTop: 8, fontFamily: FONT.body }}>
        A função secundária só entra em ação nos dias em que a outra equipa não bate o mínimo sozinha.
        O dia fixo é respeitado sempre que a cobertura mínima o permitir. O campo "Saída" aceita
        qualquer data (passada ou futura) — "Marcar inativo" é só um atalho para hoje. Enquanto
        estiver em branco, a pessoa continua ativa. O histórico antes da saída fica sempre gravado,
        visível no Resumo.
      </div>
    </div>
  );
}
