import test from "node:test";
import assert from "node:assert/strict";
import {
  countActiveMembers,teamIsReady,validateTeamName,validateTeamRoster,
  type TeamMember,type TeamRoster,
} from "../src/team";
import {
  TEAM_DRAFT_KEY,loadTeamDraft,saveTeamDraft,
} from "../src/teamDraftRepository";

const ID_A="1a2b3c4d-3333-4444-8aaa-123456789abc";
const ID_B="1a2b3c4d-3333-4444-8aaa-123456789abd";
function person(id:string,name:string,active=true):TeamMember {
  return {id,name,active};
}
function store(){
  const map=new Map<string,string>();
  return {
    getItem:(key:string)=>map.get(key)??null,
    setItem:(key:string,value:string)=>{map.set(key,value);},
    inject:(value:string)=>{map.set(TEAM_DRAFT_KEY,value);},
  };
}
test("Nomes normalizados e textos incorretos rejeitados",()=>{
  assert.equal(validateTeamName("  Ana   Silva  "),"Ana Silva");
  assert.equal(validateTeamName("José Ávila"),"José Ávila");
  for(const invalid of [""," ","A","A".repeat(121),"\u200BAb","A\u0000B",34,null]){
    assert.equal(validateTeamName(invalid),null,String(invalid));
  }
});
test("Aceita duas pessoas com o mesmo nome e IDs diferentes",()=>{
  const result=validateTeamRoster({members:[
    person(ID_A,"Ana Silva"),person(ID_B,"Ana Silva"),
  ]});
  assert.equal(result.valid,true);
  if(result.valid)assert.equal(result.value.members.length,2);
});
test("Não aceita identificadores repetidos nem dados adulterados",()=>{
  const duplicate:TeamRoster={members:[
    person(ID_A,"Ana Silva"),person(ID_A,"Outra Pessoa"),
  ]};
  assert.equal(validateTeamRoster(duplicate).valid,false);
  assert.equal(validateTeamRoster({members:[person("ID", "Ana Silva")]}).valid,false);
  assert.equal(validateTeamRoster({members:[{id:ID_A,name:"Ana Silva",active:"yes"}]}).valid,false);
  assert.equal(validateTeamRoster({members:null}).valid,false);
  assert.equal(validateTeamRoster({members:[null]}).valid,false);
  assert.equal(validateTeamRoster({members:Array.from({length:501},(_,i)=>
    person(ID_A,"Pessoa "+i))}).valid,false);
});
test("A elegibilidade depende de pelo menos uma pessoa ativa",()=>{
  assert.equal(teamIsReady({members:[]}),false);
  assert.equal(teamIsReady({members:[person(ID_A,"Ana Silva",false)]}),false);
  assert.equal(teamIsReady({members:[person(ID_A,"Ana Silva")]}),true);
  assert.equal(teamIsReady({members:[
    person(ID_A,"Ana Silva",false),person(ID_B,"Rui Silva"),
  ]}),true);
  assert.equal(countActiveMembers({members:[
    person(ID_A,"Ana Silva",false),person(ID_B,"Rui Silva"),
  ]}),1);
});
test("Criar, editar e inativar mantém IDs e estado após leitura",()=>{
  const s=store();
  assert.deepEqual(loadTeamDraft(s),{status:"empty",value:null});
  assert.equal(saveTeamDraft(s,{members:[person(ID_A,"Ana Silva")]}).ok,true);
  assert.equal(saveTeamDraft(s,{members:[person(ID_A,"Ana C. Silva")]}).ok,true);
  const loaded=loadTeamDraft(s);
  assert.equal(loaded.status,"loaded");
  if(loaded.status==="loaded"){
    assert.deepEqual(loaded.value.members,[person(ID_A,"Ana C. Silva")]);
    assert.equal(saveTeamDraft(s,{members:[{...loaded.value.members[0],active:false}]}).ok,true);
  }
  const inactive=loadTeamDraft(s);
  assert.equal(inactive.status,"loaded");
  if(inactive.status==="loaded"){
    assert.equal(inactive.value.members[0].id,ID_A);
    assert.equal(inactive.value.members[0].active,false);
    assert.equal(teamIsReady(inactive.value),false);
  }
});
test("Rascunho com todos inativos pode ser guardado, mas nunca fica completo",()=>{
  const s=store();
  assert.equal(saveTeamDraft(s,{members:[person(ID_A,"Ana Silva",false)]}).ok,true);
  const loaded=loadTeamDraft(s);
  assert.equal(loaded.status,"loaded");
  if(loaded.status==="loaded")assert.equal(teamIsReady(loaded.value),false);
});
test("Gravação rejeitada não substitui o rascunho anterior",()=>{
  const s=store();
  saveTeamDraft(s,{members:[person(ID_A,"Ana Silva")]});
  assert.equal(saveTeamDraft(s,{members:[person(ID_A,"A")]}).ok,false);
  const loaded=loadTeamDraft(s);
  assert.equal(loaded.status,"loaded");
  if(loaded.status==="loaded")assert.equal(loaded.value.members[0].name,"Ana Silva");
});
test("Corrupção e versão desconhecida não viram equipa nova",()=>{
  const s=store();
  s.inject("{");
  assert.equal(loadTeamDraft(s).status,"invalid");
  s.inject('{"version":2,"team":{"members":[]}}');
  assert.equal(loadTeamDraft(s).status,"invalid");
  s.inject('{"version":1,"team":{"members":[{"id":"bad"}]}}');
  assert.equal(loadTeamDraft(s).status,"invalid");
});
test("Armazenamento indisponível é distinto de equipa vazia",()=>{
  const failed={
    getItem:(_key:string):string|null=>{throw new Error("blocked");},
    setItem:(_key:string,_value:string):void=>{throw new Error("blocked");},
  };
  assert.equal(loadTeamDraft(failed).status,"unavailable");
  assert.equal(saveTeamDraft(failed,{members:[]}).ok,false);
});
