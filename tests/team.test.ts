import test from "node:test";
import assert from "node:assert/strict";
import {
  countActiveMembers,teamIsReady,validateTeamName,validateTeamRoster,
  isQualifiedForRole,
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

test("A ficha guarda apenas ID, nome e estado, sem preferências ou restrições",()=>{
  const s=store();
  const supplied={
    members:[{...person(ID_A,"Ana Silva"),
      preferences:["manhã"],
      restrictions:[{day:"monday",start:"10:00",end:"13:00"}],
      availability:{monday:[]},
    }],
  };
  const saved=saveTeamDraft(s,supplied);
  assert.equal(saved.ok,true);
  assert.deepEqual(loadTeamDraft(s),{
    status:"loaded",value:{members:[person(ID_A,"Ana Silva")]},
  });
});


test("Número de dias de folga é opcional para registos antigos e persistente quando definido",()=>{
  const s=store();
  const a={...person(ID_A,"Ana"),weeklyDaysOff:2};
  const b={...person(ID_B,"Rui"),weeklyDaysOff:1};
  assert.equal(saveTeamDraft(s,{members:[a,b]}).ok,true);
  const restored=loadTeamDraft(s);
  assert.equal(restored.status,"loaded");
  if(restored.status==="loaded"){
    assert.deepEqual(restored.value.members,[a,b]);
    assert.equal(saveTeamDraft(s,{members:[
      {...restored.value.members[0],weeklyDaysOff:3},
      restored.value.members[1],
    ]}).ok,true);
  }
  const changed=loadTeamDraft(s);
  assert.equal(changed.status,"loaded");
  if(changed.status==="loaded")
    assert.deepEqual(changed.value.members.map(m=>m.weeklyDaysOff),[3,1]);
  assert.equal(validateTeamRoster({members:[person(ID_A,"Ana")]}).valid,true);
  assert.deepEqual(validateTeamRoster({members:[person(ID_A,"Ana")]}),{
    valid:true,value:{members:[person(ID_A,"Ana")]},issues:[],
  });
});

test("Folgas semanais têm de ser inteiros entre zero e seis, sem dias pré-definidos",()=>{
  for(const value of [-1,7,1.5,"2",null,NaN,Infinity]){
    assert.equal(validateTeamRoster({members:[{
      ...person(ID_A,"Ana"),weeklyDaysOff:value,
    }]}).valid,false,String(value));
  }
  for(const value of [0,1,2,3,4,5,6]){
    const checked=validateTeamRoster({members:[{
      ...person(ID_A,"Ana"),weeklyDaysOff:value,
    }]});
    assert.equal(checked.valid,true,String(value));
    if(checked.valid)assert.equal(checked.value.members[0].weeklyDaysOff,value);
  }
});

test("Folgas inválidas não substituem uma equipa guardada",()=>{
  const s=store();
  assert.equal(saveTeamDraft(s,{members:[
    {...person(ID_A,"Ana"),weeklyDaysOff:2},
  ]}).ok,true);
  assert.equal(saveTeamDraft(s,{members:[
    {...person(ID_A,"Ana"),weeklyDaysOff:9},
  ]}).ok,false);
  const loaded=loadTeamDraft(s);
  assert.equal(loaded.status,"loaded");
  if(loaded.status==="loaded")assert.equal(loaded.value.members[0].weeklyDaysOff,2);
});


test("PR94: funções qualificadas distinguem Caixa, Vendas e ambas",()=>{
  const inputs=[
    {qualifiedRoles:["checkout"]},
    {qualifiedRoles:["sales"]},
    {qualifiedRoles:["sales","checkout"]},
  ];
  const expected=[["checkout"],["sales"],["checkout","sales"]];
  inputs.forEach((input,index)=>{
    const checked=validateTeamRoster({members:[{
      ...person(ID_A,"Ana Silva"),...input,
    }]});
    assert.equal(checked.valid,true,JSON.stringify(input));
    if(!checked.valid)return;
    const member=checked.value.members[0];
    assert.deepEqual(member.qualifiedRoles,expected[index]);
    assert.equal(isQualifiedForRole(member,"checkout"),
      expected[index].includes("checkout"));
    assert.equal(isQualifiedForRole(member,"sales"),
      expected[index].includes("sales"));
  });
});

test("PR94: função ausente em equipa antiga é desconhecida, não polivalente",()=>{
  const legacy=validateTeamRoster({members:[person(ID_A,"Ana Silva")]});
  assert.equal(legacy.valid,true);
  if(!legacy.valid)return;
  const member=legacy.value.members[0];
  assert.equal(member.qualifiedRoles,undefined);
  assert.equal(isQualifiedForRole(member,"checkout"),false);
  assert.equal(isQualifiedForRole(member,"sales"),false);
  const storage=store();
  assert.equal(saveTeamDraft(storage,{members:[member]}).ok,true);
  assert.deepEqual(loadTeamDraft(storage),{
    status:"loaded",value:{members:[person(ID_A,"Ana Silva")]},
  });
});

test("PR94: funções são persistentes com ID e folgas inalterados",()=>{
  const storage=store();
  const member={...person(ID_A,"Ana Silva"),weeklyDaysOff:2,
    fixedDaysOff:["monday"],qualifiedRoles:["checkout","sales"]};
  const result=saveTeamDraft(storage,{members:[member]});
  assert.equal(result.ok,true);
  const loaded=loadTeamDraft(storage);
  assert.equal(loaded.status,"loaded");
  if(loaded.status!=="loaded")return;
  assert.deepEqual(loaded.value.members[0],member);
  const change={...loaded.value.members[0],qualifiedRoles:["sales"]};
  assert.equal(saveTeamDraft(storage,{members:[change]}).ok,true);
  const updated=loadTeamDraft(storage);
  assert.equal(updated.status,"loaded");
  if(updated.status==="loaded"){
    assert.deepEqual(updated.value.members[0],change);
    assert.equal(updated.value.members[0].id,ID_A);
  }
});

test("PR94: funções desconhecidas, vazias e duplicadas não corrompem a equipa",()=>{
  const storage=store();
  const original={...person(ID_A,"Ana Silva"),qualifiedRoles:["checkout"]};
  assert.equal(saveTeamDraft(storage,{members:[original]}).ok,true);
  for(const invalid of [
    [],["checkout","checkout"],["sales","sales"],
    ["checkout","service"],["both"],"checkout",null,42,
    ["checkout",null],
  ]){
    const supplied={members:[{...original,qualifiedRoles:invalid}]};
    assert.equal(validateTeamRoster(supplied).valid,false,
      JSON.stringify(invalid));
    assert.equal(saveTeamDraft(storage,supplied).ok,false,
      JSON.stringify(invalid));
  }
  const loaded=loadTeamDraft(storage);
  assert.equal(loaded.status,"loaded");
  if(loaded.status==="loaded")assert.deepEqual(loaded.value.members[0],original);
});


test("PR94: catálogo personalizado mantém o engine independente de Caixa e Vendas",()=>{
  const team={
    roles:[
      {id:"kitchen",label:"Cozinha"},
      {id:"frontdesk",label:"Receção"},
      {id:"maintenance",label:"Manutenção"},
    ],
    members:[
      {...person(ID_A,"Ana"),qualifiedRoles:["kitchen","frontdesk"]},
      {...person(ID_B,"Rui"),qualifiedRoles:["maintenance"]},
    ],
  };
  const validated=validateTeamRoster(team);
  assert.equal(validated.valid,true,JSON.stringify(validated));
  if(!validated.valid)return;
  assert.deepEqual(validated.value,team);
  assert.equal(isQualifiedForRole(validated.value.members[0],"frontdesk"),true);
  assert.equal(isQualifiedForRole(validated.value.members[0],"maintenance"),false);
  const storage=store();
  assert.equal(saveTeamDraft(storage,team).ok,true);
  assert.deepEqual(loadTeamDraft(storage),{status:"loaded",value:team});
});

test("PR94: funções desconhecidas e catálogo inválido não substituem a equipa",()=>{
  const storage=store();
  const valid={roles:[{id:"kitchen",label:"Cozinha"}],
    members:[{...person(ID_A,"Ana"),qualifiedRoles:["kitchen"]}]};
  assert.equal(saveTeamDraft(storage,valid).ok,true);
  const attacks=[
    {roles:[],members:valid.members},
    {roles:[{id:"kitchen",label:"Cozinha"},{id:"kitchen",label:"Duplicado"}],
      members:valid.members},
    {roles:[{id:"__proto__",label:"Insegura"}],members:valid.members},
    {roles:[{id:"room service",label:"Serviço"}],members:valid.members},
    {roles:valid.roles,members:[{...person(ID_A,"Ana"),
      qualifiedRoles:["checkout"]}]},
    {roles:valid.roles,members:[{...person(ID_A,"Ana"),
      qualifiedRoles:["kitchen","kitchen"]}]},
  ];
  for(const attack of attacks)
    assert.equal(saveTeamDraft(storage,attack).ok,false,JSON.stringify(attack));
  assert.deepEqual(loadTeamDraft(storage),{status:"loaded",value:valid});
});
