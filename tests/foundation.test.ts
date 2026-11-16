import assert from "node:assert/strict";
import test from "node:test";
import { monthCells, monthLabel } from "../src/calendar";
import { knownFoundationPath, pageForPath } from "../src/routes";

test("A página de entrada é sempre a raiz", () => {
  assert.equal(pageForPath("/"), "welcome");
  assert.equal(pageForPath("/horarios"), "calendar");
  assert.equal(pageForPath("/configuracao"), "settings");
  assert.equal(pageForPath("/configuracao/inicial"), "setup");
  assert.equal(pageForPath("/configuracao/inicial/"), "setup");
  assert.equal(knownFoundationPath("/configuracao/inicial"), true);
  assert.equal(pageForPath("/configuracao/funcionamento"), "operatingHours");
  assert.equal(knownFoundationPath("/configuracao/funcionamento/"), true);
  assert.equal(knownFoundationPath("/horarios/gerar"), false);
  assert.equal(pageForPath("/horarios/gerar"), "welcome");
});

test("Novembro de 2026 começa a domingo; sem inventar folgas", () => {
  const cells = monthCells(2026, 10);
  assert.equal(cells.length, 42);
  assert.equal(cells[6].date, "2026-11-01");
  assert.equal(cells.filter(cell => cell.day !== null).length, 30);
  assert.equal(cells.some(cell => cell.date === "2026-11-31"), false);
  assert.equal(monthLabel(2026, 10), "Novembro de 2026");
});

test("Dezembro de 2026 tem 31 datas e 35 posições na grelha", () => {
  const cells = monthCells(2026, 11);
  assert.equal(cells.length, 35);
  assert.equal(cells.filter(cell => cell.day !== null).length, 31);
  assert.equal(cells[1].date, "2026-12-01");
  assert.equal(cells.at(-1)?.date, null);
});

test("Calendário recusa meses fora dos limites", () => {
  assert.throws(() => monthCells(2026, 12));
  assert.throws(() => monthCells(2026, -1));
});
