import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

test("A interface não apresenta linguagem de desenvolvimento", () => {
  for (const forbidden of [
    "Fundação V2", "Base visual", "Fechar demonstração",
    "Abrir demonstração", "Explorar a nova base",
    "Primeiro conceito", "Próxima etapa",
    "Ainda não implementado", "Não introduzas credenciais reais",
  ]) {
    assert.equal(app.includes(forbidden), false,
      "Texto interno não pode aparecer na interface: " + forbidden);
  }
});

test("A autenticação não simula uma sessão nem armazena credenciais", () => {
  assert.match(app, /onSubmit=\{handleSignIn\}/);
  assert.match(app, /event\.preventDefault\(\)/);
  assert.match(app, /setSignInError\(true\)/);
  assert.equal(app.includes("localStorage"), false);
  assert.equal(app.includes("sessionStorage"), false);
  assert.equal(app.includes("document.cookie"), false);
  assert.equal(app.includes("fetch("), false);
});

test("Layout adapta-se a desktop, tablet e telemóvel sem largura fixa da página", () => {
  assert.match(styles, /grid-template-columns:\s*minmax\(0,\s*1\.08fr\)/);
  assert.match(styles, /@media\s*\(max-width:\s*1020px\)/);
  assert.match(styles, /@media\s*\(max-width:\s*880px\)/);
  assert.match(styles, /@media\s*\(max-width:\s*620px\)/);
  assert.match(styles, /@media\s*\(max-width:\s*460px\)/);
  assert.match(styles, /grid-template-columns:\s*repeat\(7,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(styles, /min-width:\s*320px/);
  assert.match(styles, /prefers-reduced-motion:\s*reduce/);
});

test("A interface distingue ausência de horário e folga", () => {
  assert.match(app, /sem turnos registados não corresponde automaticamente a uma folga/);
});
