import { parseOfficialScheduleRequest } from "./application/officialScheduleRequest";
import { createOfficialScheduleRepository } from "./persistence/officialScheduleRepository";
import { createApprovedScheduleLedger } from "./utils/approvedSchedules";

function assert(ok:boolean,label:string){if(!ok)throw Error(label);}
const id="123e4567-e89b-42d3-a456-426614174000";
const normal={kind:"approve",candidateId:id,expectedVersion:0};
assert(parseOfficialScheduleRequest(normal)?.kind==="approve",
  "Uma aprovação só aceita identificador persistido e versão.");
for(const wrong of [
  {...normal,ownerId:"victim"},
  {...normal,environment:{}},
  {...normal,at:"2026-11-03T00:00:00Z"},
  {...normal,draft:{shifts:[]}},
  {...normal,expectedVersion:-1},
  {...normal,expectedVersion:1.1},
  {...normal,candidateId:"fake"},
  {kind:"cancel",expectedVersion:0},
  {kind:"replace",candidateId:id,expectedVersion:0},
])assert(parseOfficialScheduleRequest(wrong)===null,
  "Não aceitar dados de autorização, rascunhos ou pedidos incompletos.");
assert(parseOfficialScheduleRequest({
  kind:"replace",candidateId:id,replaceId:"old",expectedVersion:2,
})?.kind==="replace","Substituição requer versão e horário a substituir.");
assert(parseOfficialScheduleRequest({
  kind:"cancel",scheduleId:"old",expectedVersion:2,
})?.kind==="cancel","Cancelamento requer ID e versão.");

const owner="11111111-1111-4111-8111-111111111111";
const ledger=createApprovedScheduleLedger({
  startDate:"2020-01-01",endDate:"2100-12-31",
},"Atlantic/Azores",true);
const requests:{path:string,method:string,body:unknown}[]=[];
const client={
  user:{id:owner,email:"test@example.invalid"},
  async request(path:string,init:RequestInit={}):Promise<Response>{
    const method=init.method??"GET";
    requests.push({path,method,body:init.body?JSON.parse(String(init.body)):null});
    if(method==="GET")return Response.json([{
      ledger_version:0,payload:ledger,
    }]);
    return Response.json({ok:true,version:1,record:{
      id,startDate:"2026-11-02",endDate:"2026-11-08",
      status:"approved",timeZone:"Atlantic/Azores",
      shifts:[],approvedAt:"2026-11-03T10:00:00Z",
      changedAt:null,replacementId:null,replacesId:null,
    }});
  },
};
const adapter=createOfficialScheduleRepository(client);
const loaded=await adapter.load();
assert(loaded?.version===0,"Leitura oficial autenticada.");
const result=await adapter.execute(normal as {
  kind:"approve",candidateId:string,expectedVersion:number,
});
assert(result.ok && result.version===1,
  "A confirmação do servidor é necessária para mostrar aprovação.");
assert(requests.length===2&&requests[1].path==="/functions/v1/official-schedules"&&
  JSON.stringify(requests[1].body)===JSON.stringify(normal),
  "Navegador envia só ID e versão para endpoint confiável.");

const noSession={user:null,request:async()=>{throw Error("No access should occur");}};
let denied=false;
try{await createOfficialScheduleRepository(noSession).load();}
catch{denied=true;}
assert(denied,"Sem sessão, falha fechada.");

const conflict={
  user:client.user,
  request:async()=>Response.json({ok:false,code:"stale_version",
    issues:["A versão foi alterada."]},{status:409}),
};
const stale=await createOfficialScheduleRepository(conflict).execute(
  normal as {kind:"approve",candidateId:string,expectedVersion:number});
assert(!stale.ok&&stale.code==="stale_version",
  "Conflitos de versão não são tratados como aprovação.");

console.log("PR43: teste de API e adaptador oficial passou.");
