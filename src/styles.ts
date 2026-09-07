// styles.ts
import type { CSSProperties } from "react";

// Tokens de design e objeto de estilos. Linguagem visual: painel de obra/oficina — a app existe
// para gerir uma loja de materiais de construção, por isso o vocabulário visual vem daí (aço
// galvanizado, madeira, tinta de aviso) em vez de um dashboard SaaS genérico. O elemento de
// assinatura é a "régua de cobertura": uma barra por dia que mostra Vendas/Caixa vs. o mínimo
// exigido — a mesma informação que o motor está a decidir, tornada visível.

export const C = {
  stone: "#EDEAE2",     // fundo — papel de embalagem / poeira de cimento
  stoneDeep: "#E1DCCE",
  ink: "#211D19",        // texto principal
  inkMuted: "#6E6659",
  card: "#FFFFFF",
  border: "#DCD5C9",
  steel: "#3C5064",      // ação primária / Caixa
  steelDeep: "#232F3B",  // cabeçalho / nav
  timber: "#B9762E",     // Vendas
  timberLight: "#F3E4CC",
  ok: "#3F7A5C",
  okBg: "#E6F0EA",
  warn: "#B9761A",
  warnBg: "#FBEEDA",
  error: "#B3402A",
  errorBg: "#FBEAE5",
};

export const FONT = {
  display: '"Oswald", "Arial Narrow", sans-serif',
  body: '"Inter", -apple-system, sans-serif',
  mono: '"IBM Plex Mono", ui-monospace, monospace',
};

export const S: Record<string, CSSProperties> = {
  app: {
    minHeight: "100vh",
    background: C.stone,
    color: C.ink,
    fontFamily: FONT.body,
  },
  header: {
    background: C.steelDeep,
    color: "#FFF",
    padding: "18px 20px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 12,
  },
  headerTitle: {
    fontFamily: FONT.display,
    fontWeight: 600,
    fontSize: 22,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    margin: 0,
  },
  headerSub: {
    fontFamily: FONT.body,
    fontSize: 13,
    color: "#B7C2CC",
    marginTop: 2,
  },
  weekNav: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  navBtn: {
    background: "rgba(255,255,255,.08)",
    border: "1px solid rgba(255,255,255,.18)",
    color: "#FFF",
    borderRadius: 6,
    padding: "8px 12px",
    cursor: "pointer",
    fontFamily: FONT.body,
    fontSize: 14,
    fontWeight: 600,
  },
  weekLabel: {
    fontFamily: FONT.mono,
    fontSize: 14,
    fontWeight: 600,
    minWidth: 150,
    textAlign: "center",
  },
  primaryBtn: {
    background: C.timber,
    color: "#FFF",
    border: "none",
    borderRadius: 6,
    padding: "10px 16px",
    cursor: "pointer",
    fontFamily: FONT.display,
    fontWeight: 600,
    fontSize: 14,
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  ghostBtn: {
    background: "transparent",
    color: C.steel,
    border: `1.5px solid ${C.border}`,
    borderRadius: 6,
    padding: "9px 14px",
    cursor: "pointer",
    fontFamily: FONT.body,
    fontWeight: 600,
    fontSize: 13,
  },
  main: {
    padding: "20px",
    maxWidth: 1100,
    margin: "0 auto",
  },
  gaugeRow: {
    display: "grid",
    gridTemplateColumns: "140px repeat(7, 1fr)",
    gap: 6,
    marginBottom: 10,
  },
  gaugeCell: {
    background: C.card,
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    padding: "8px 6px",
    textAlign: "center",
  },
  gaugeDay: {
    fontFamily: FONT.display,
    fontSize: 11,
    textTransform: "uppercase",
    color: C.inkMuted,
    letterSpacing: 0.5,
  },
  gaugeDate: {
    fontFamily: FONT.mono,
    fontSize: 13,
    fontWeight: 600,
    marginBottom: 6,
  },
  gaugeBar: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  gaugeStrip: {
    height: 5,
    borderRadius: 3,
    background: C.stoneDeep,
    overflow: "hidden",
  },
  grid: {
    background: C.card,
    border: `1px solid ${C.border}`,
    borderRadius: 10,
    overflow: "hidden",
  },
  gridRow: {
    display: "grid",
    gridTemplateColumns: "140px repeat(7, 1fr)",
    borderTop: `1px solid ${C.border}`,
  },
  gridRowHead: {
    borderTop: "none",
  },
  gridNameCell: {
    padding: "10px 12px",
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontWeight: 600,
    fontSize: 13,
    borderRight: `1px solid ${C.border}`,
  },
  teamDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    flexShrink: 0,
  },
  cell: {
    padding: "8px 4px",
    borderRight: `1px solid ${C.border}`,
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    minHeight: 52,
  },
  cellType: {
    fontFamily: FONT.display,
    fontSize: 10,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  cellHours: {
    fontFamily: FONT.mono,
    fontSize: 11,
    color: C.inkMuted,
  },
  alertBanner: {
    marginBottom: 14,
  },
  alertRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 12px",
    borderRadius: 6,
    fontSize: 13,
    marginBottom: 6,
  },
  panel: {
    background: C.card,
    border: `1px solid ${C.border}`,
    borderRadius: 10,
    padding: 16,
    marginTop: 16,
  },
  panelTitle: {
    fontFamily: FONT.display,
    fontSize: 15,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 12,
  },
  staffRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 0",
    borderBottom: `1px solid ${C.border}`,
  },
  input: {
    border: `1.5px solid ${C.border}`,
    borderRadius: 6,
    padding: "8px 10px",
    fontFamily: FONT.body,
    fontSize: 13,
    background: "#FFF",
  },
  select: {
    border: `1.5px solid ${C.border}`,
    borderRadius: 6,
    padding: "8px 10px",
    fontFamily: FONT.body,
    fontSize: 13,
    background: "#FFF",
    cursor: "pointer",
  },
  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(33,29,25,.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
    padding: 16,
  },
  modalCard: {
    background: C.card,
    borderRadius: 12,
    padding: 20,
    width: "100%",
    maxWidth: 340,
  },
};
