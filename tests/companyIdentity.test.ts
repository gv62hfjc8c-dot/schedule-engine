import test from "node:test";
import assert from "node:assert/strict";
import { validateCompanyIdentity } from "../src/companyIdentity";
import {
  COMPANY_DRAFT_KEY,companyDraftSetupSnapshot,loadCompanyDraft,saveCompanyDraft,
} from "../src/companyDraftRepository";
import {decideEntryAfterLogin} from "../src/entryRouting";

function createStore() {
  const values = new Map<string,string>();
  return {
    getItem: (key:string) => values.get(key) ?? null,
    setItem: (key:string,value:string) => {values.set(key,value);},
    inject: (value:string) => {values.set(COMPANY_DRAFT_KEY,value);},
  };
}
test("Nome de empresa é normalizado e validado sem depender de UI",()=>{
  assert.deepEqual(validateCompanyIdentity({name:"  Oficina    do Mar  "}),{
    valid:true,company:{name:"Oficina do Mar"},issues:[],
  });
  assert.equal(validateCompanyIdentity({name:" "}).valid,false);
  assert.equal(validateCompanyIdentity({name:"A"}).valid,false);
  assert.equal(validateCompanyIdentity({name:"A".repeat(121)}).valid,false);
  assert.equal(validateCompanyIdentity({name:"Empresa\u0000"}).valid,false);
  assert.equal(validateCompanyIdentity({name:45}).valid,false);
  assert.equal(validateCompanyIdentity({name:"Empresa Açores"}).valid,true);
});
test("Guardar empresa resulta numa leitura real depois de recarregar",()=>{
  const store=createStore();
  assert.deepEqual(loadCompanyDraft(store),{status:"empty",company:null});
  const saved=saveCompanyDraft(store,{name:"  Equipa Atlântica "});
  assert.deepEqual(saved,{ok:true,company:{name:"Equipa Atlântica"}});
  assert.deepEqual(loadCompanyDraft(store),
    {status:"loaded",company:{name:"Equipa Atlântica"}});
});
test("Dados inválidos não são aceites nem gravados",()=>{
  const store=createStore();
  assert.equal(saveCompanyDraft(store,{name:""}).ok,false);
  assert.deepEqual(loadCompanyDraft(store),{status:"empty",company:null});
  store.inject('{"version":5,"company":{"name":"Empresa"}}');
  assert.equal(loadCompanyDraft(store).status,"invalid");
  store.inject('{"version":1,"company":{"name":"X"}}');
  assert.equal(loadCompanyDraft(store).status,"invalid");
  store.inject("not-json");
  assert.equal(loadCompanyDraft(store).status,"invalid");
});
test("Falha do armazenamento é distinta de primeira visita",()=>{
  const throwing={
    getItem: (_key:string):string|null => {throw new Error("blocked");},
    setItem: (_key:string,_value:string):void => {throw new Error("blocked");},
  };
  const loaded=loadCompanyDraft(throwing);
  assert.equal(loaded.status,"unavailable");
  assert.equal(companyDraftSetupSnapshot(loaded),null);
  assert.equal(saveCompanyDraft(throwing,{name:"Empresa"}).ok,false);
});
test("Guardar nome não marca as outras cinco secções como concluídas",()=>{
  const store=createStore();
  assert.equal(saveCompanyDraft(store,{name:"Empresa"}).ok,true);
  const result=decideEntryAfterLogin({
    authenticated:true,
    setup:companyDraftSetupSnapshot(loadCompanyDraft(store)),
  });
  assert.deepEqual(result,{
    kind:"resume_setup",
    destination:"/configuracao/funcionamento",
    nextSection:"operatingHours",
  });
});
test("Empresa não registada encaminha para primeiro acesso (quando autenticado)",()=>{
  const store=createStore();
  assert.deepEqual(decideEntryAfterLogin({
    authenticated:true,setup:companyDraftSetupSnapshot(loadCompanyDraft(store)),
  }),{
    kind:"first_access",destination:"/configuracao/inicial",nextSection:"company",
  });
});
test("Estado corrupto bloqueia decisão em vez de assumir que é empresa nova",()=>{
  const store=createStore();
  store.inject("{");
  const decision=decideEntryAfterLogin({
    authenticated:true,setup:companyDraftSetupSnapshot(loadCompanyDraft(store)),
  });
  assert.equal(decision.kind,"setup_unavailable");
});
