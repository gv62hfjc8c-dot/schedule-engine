import assert from "node:assert/strict";
import test from "node:test";
import {
  SETUP_SECTIONS, decideEntryAfterLogin,
  type OrganizationSetupSnapshot,
} from "../src/entryRouting";

const complete: OrganizationSetupSnapshot = {
  checks: Object.fromEntries(SETUP_SECTIONS.map(section => [section, "valid"])),
};

test("Acesso sem autenticação regressa sempre ao login, mesmo com dados antigos", () => {
  assert.deepEqual(decideEntryAfterLogin({ authenticated: false, setup: complete }), {
    kind: "sign_in", destination: "/", nextSection: null,
  });
});

test("Conta autenticada sem dados de configuração inicia onboarding", () => {
  assert.deepEqual(decideEntryAfterLogin({ authenticated: true, setup: {checks: {}} }), {
    kind: "first_access",
    destination: "/configuracao/inicial",
    nextSection: "company",
  });
});

test("Configuração parcial retoma o primeiro ponto ainda não validado", () => {
  assert.deepEqual(decideEntryAfterLogin({
    authenticated: true,
    setup: {checks: {company: "valid", operatingHours: "valid", team: "invalid"}},
  }), {
    kind: "resume_setup",
    destination: "/configuracao/equipa",
    nextSection: "team",
  });
});

test("Visitar uma etapa não comprova configuração completa", () => {
  const justSomeValid: OrganizationSetupSnapshot = {
    checks: {company: "valid", operatingHours: "valid", team: "valid",
      rules: "valid"},
  };
  assert.deepEqual(decideEntryAfterLogin({
    authenticated: true, setup: justSomeValid,
  }), {
    kind: "resume_setup",
    destination: "/configuracao",
    nextSection: "coverage",
  });
});

test("Onboarding obrigatório não inclui disponibilidades por colaborador", () => {
  assert.deepEqual(SETUP_SECTIONS, [
    "company", "operatingHours", "team", "rules", "coverage"
  ]);
});

test("Depois da equipa, a próxima etapa é Regras e não Disponibilidades", () => {
  const result=decideEntryAfterLogin({
    authenticated:true,
    setup:{checks:{company:"valid",operatingHours:"valid",team:"valid"}},
  });
  assert.deepEqual(result,{
    kind:"resume_setup",destination:"/configuracao",nextSection:"rules",
  });
});

test("Uma chave antiga de disponibilidades não valida a configuração", () => {
  const result=decideEntryAfterLogin({
    authenticated:true,
    setup:{checks:{company:"valid",operatingHours:"valid",team:"valid",
      rules:"valid",coverage:"valid",availability:"valid"}} as unknown as OrganizationSetupSnapshot,
  });
  assert.deepEqual(result,{
    kind:"setup_unavailable",destination:null,nextSection:null,
  });
});

test("Configuração totalmente validada entra diretamente no calendário", () => {
  assert.deepEqual(decideEntryAfterLogin({ authenticated: true, setup: complete }), {
    kind: "calendar", destination: "/horarios", nextSection: null,
  });
});

test("Dados de configuração ainda não carregados nunca são tratados como primeira visita", () => {
  assert.deepEqual(decideEntryAfterLogin({ authenticated: true, setup: null }), {
    kind: "setup_unavailable", destination: null, nextSection: null,
  });
});

test("Dados adulterados ou desconhecidos não libertam o calendário", () => {
  const invalid = [
    {checks: {company: "complete"}},
    {checks: {company: "valid", unexpected: "valid"}},
    {checks: null},
  ] as unknown as OrganizationSetupSnapshot[];
  for (const setup of invalid) {
    assert.deepEqual(decideEntryAfterLogin({ authenticated: true, setup }), {
      kind: "setup_unavailable", destination: null, nextSection: null,
    });
  }
});

test("Se houver dados noutra secção, a conta não é considerada nova", () => {
  const result=decideEntryAfterLogin({
    authenticated:true,setup:{checks:{team:"invalid"}},
  });
  assert.equal(result.kind,"resume_setup");
  assert.equal(result.nextSection,"company");
});
