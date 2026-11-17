import test from "node:test";
import assert from "node:assert/strict";
import {localSetupSnapshot} from "../src/localSetupSnapshot";
import {suggestedWeeklyOpeningHours} from "../src/operatingHours";
import {decideEntryAfterLogin} from "../src/entryRouting";

const companyEmpty={status:"empty" as const,company:null};
const companyLoaded={status:"loaded" as const,company:{name:"Empresa"}};
const hoursEmpty={status:"empty" as const,value:null};
const hoursLoaded={status:"loaded" as const,value:suggestedWeeklyOpeningHours()};
const teamEmpty={status:"empty" as const,value:null};
const activePerson={
  id:"1a2b3c4d-3333-4444-8aaa-123456789abc",
  name:"Ana Silva",
  active:true,
};
const teamLoaded={status:"loaded" as const,value:{members:[activePerson]}};
const teamAllInactive={
  status:"loaded" as const,
  value:{members:[{...activePerson,active:false}]},
};

test("Conta nova começa na identificação",()=>{
  assert.deepEqual(decideEntryAfterLogin({
    authenticated:true,setup:localSetupSnapshot(companyEmpty,hoursEmpty,teamEmpty),
  }),{kind:"first_access",destination:"/configuracao/inicial",nextSection:"company"});
});

test("Após identificar empresa encaminha para funcionamento",()=>{
  assert.deepEqual(decideEntryAfterLogin({
    authenticated:true,setup:localSetupSnapshot(companyLoaded,hoursEmpty,teamEmpty),
  }),{kind:"resume_setup",destination:"/configuracao/funcionamento",nextSection:"operatingHours"});
});

test("Após funcionamento válido encaminha para equipa",()=>{
  assert.deepEqual(decideEntryAfterLogin({
    authenticated:true,setup:localSetupSnapshot(companyLoaded,hoursLoaded,teamEmpty),
  }),{kind:"resume_setup",destination:"/configuracao/equipa",nextSection:"team"});
});

test("Equipa com pessoa ativa avança diretamente para regras gerais",()=>{
  const next=decideEntryAfterLogin({
    authenticated:true,setup:localSetupSnapshot(companyLoaded,hoursLoaded,teamLoaded),
  });
  assert.deepEqual(next,{
    kind:"resume_setup",destination:"/configuracao",nextSection:"rules",
  });
  assert.notEqual(next.kind,"calendar");
});

test("Lista guardada sem ninguém ativo não completa a equipa",()=>{
  const snapshot=localSetupSnapshot(companyLoaded,hoursLoaded,teamAllInactive);
  assert.equal(snapshot?.checks.team,"invalid");
  const next=decideEntryAfterLogin({authenticated:true,setup:snapshot});
  assert.equal(next.destination,"/configuracao/equipa");
  assert.equal(next.nextSection,"team");
});

test("Sem empresa configurada, dados posteriores não dão acesso ao calendário",()=>{
  const next=decideEntryAfterLogin({
    authenticated:true,setup:localSetupSnapshot(companyEmpty,hoursLoaded,teamLoaded),
  });
  assert.equal(next.nextSection,"company");
});

test("Falha ou corrupção de qualquer etapa bloqueia encaminhamento",()=>{
  assert.equal(localSetupSnapshot({status:"invalid",company:null},hoursLoaded,teamEmpty),null);
  assert.equal(localSetupSnapshot(companyLoaded,{status:"unavailable",value:null},teamEmpty),null);
  assert.equal(localSetupSnapshot(companyLoaded,hoursLoaded,{status:"invalid",value:null}),null);
  assert.equal(localSetupSnapshot(companyLoaded,hoursLoaded,{status:"unavailable",value:null}),null);
});
