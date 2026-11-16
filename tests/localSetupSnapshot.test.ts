import test from "node:test";
import assert from "node:assert/strict";
import {localSetupSnapshot} from "../src/localSetupSnapshot";
import {suggestedWeeklyOpeningHours} from "../src/operatingHours";
import {decideEntryAfterLogin} from "../src/entryRouting";
const companyEmpty={status:"empty" as const,company:null};
const companyLoaded={status:"loaded" as const,company:{name:"Empresa"}};
const hoursEmpty={status:"empty" as const,value:null};
const hoursLoaded={status:"loaded" as const,value:suggestedWeeklyOpeningHours()};
test("Conta nova começa na identificação",()=>{
  assert.deepEqual(decideEntryAfterLogin({
    authenticated:true,setup:localSetupSnapshot(companyEmpty,hoursEmpty),
  }),{kind:"first_access",destination:"/configuracao/inicial",nextSection:"company"});
});
test("Após identificar empresa encaminha para funcionamento",()=>{
  assert.deepEqual(decideEntryAfterLogin({
    authenticated:true,setup:localSetupSnapshot(companyLoaded,hoursEmpty),
  }),{kind:"resume_setup",destination:"/configuracao/funcionamento",nextSection:"operatingHours"});
});
test("Após guardar dias e horas não inventa restante onboarding",()=>{
  const next=decideEntryAfterLogin({
    authenticated:true,setup:localSetupSnapshot(companyLoaded,hoursLoaded),
  });
  assert.deepEqual(next,{
    kind:"resume_setup",destination:"/configuracao/inicial",nextSection:"team",
  });
  assert.notEqual(next.kind,"calendar");
});
test("Horário sem empresa é insuficiente para terminar configuração",()=>{
  const next=decideEntryAfterLogin({
    authenticated:true,setup:localSetupSnapshot(companyEmpty,hoursLoaded),
  });
  assert.equal(next.nextSection,"company");
});
test("Falha ou corrupção de qualquer parte interrompe encaminhamento",()=>{
  assert.equal(localSetupSnapshot({status:"invalid",company:null},hoursLoaded),null);
  assert.equal(localSetupSnapshot(companyLoaded,{status:"unavailable",value:null}),null);
});
