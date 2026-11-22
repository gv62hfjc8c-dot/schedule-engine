import test from "node:test";
import assert from "node:assert/strict";
import {
  allocateFunctionalCoverage,certifyFunctionalCoverage,
  type FunctionalCoverageInput,
} from "../src/functionalCoverage";

const date="2026-11-23";
const START="09:00",END="17:00";
function scenario(checkout:number,sales:number,dual:number):FunctionalCoverageInput {
  const members=[
    ...Array.from({length:checkout},(_,i)=>({
      id:"caixa-"+i,active:true,qualifiedRoles:["checkout"],
    })),
    ...Array.from({length:sales},(_,i)=>({
      id:"vendas-"+i,active:true,qualifiedRoles:["sales"],
    })),
    ...Array.from({length:dual},(_,i)=>({
      id:"polivalente-"+i,active:true,
      qualifiedRoles:["checkout","sales"],
    })),
  ];
  return {
    date,members,
    assignments:members.map(m=>({memberId:m.id,date,start:START,end:END})),
    opening:[{start:START,end:END}],
    roles:["checkout","sales"],
    minimumPercent:50,
  };
}
function roleCount(allocations:readonly {role:string}[],role:string):number{
  return allocations.filter(a=>a.role===role).length;
}

test("PR94: 1 Caixa + 3 Vendas + 2 polivalentes coloca AMBOS na Caixa",()=>{
  const input=scenario(1,3,2);
  const before=JSON.stringify(input);
  const first=allocateFunctionalCoverage(input);
  assert.equal(first.certification.status,"covered");
  assert.deepEqual(first.certification.qualified,{checkout:3,sales:5});
  assert.deepEqual(first.certification.targets,{checkout:2,sales:3});
  assert.equal(roleCount(first.allocations,"checkout"),3);
  assert.equal(roleCount(first.allocations,"sales"),3);
  assert.equal(first.allocations.filter(a=>
    a.memberId.startsWith("polivalente-")&&a.role==="checkout").length,2);
  assert.equal(first.allocations.length,6);
  assert.equal(new Set(first.allocations.map(a=>a.memberId)).size,6);
  assert.equal(JSON.stringify(input),before,"não altera a configuração");
  assert.deepEqual(allocateFunctionalCoverage(input),first,"resultado determinístico");
  assert.deepEqual(certifyFunctionalCoverage(input,first.allocations),
    first.certification,"validador independente");
});

test("PR94: 3 Caixas + 1 Vendas + 2 polivalentes coloca AMBOS nas Vendas",()=>{
  const input=scenario(3,1,2);
  const result=allocateFunctionalCoverage(input);
  assert.equal(result.certification.status,"covered");
  assert.deepEqual(result.certification.targets,{checkout:3,sales:2});
  assert.equal(roleCount(result.allocations,"checkout"),3);
  assert.equal(roleCount(result.allocations,"sales"),3);
  assert.ok(result.allocations.filter(a=>a.memberId.startsWith("polivalente-"))
    .every(a=>a.role==="sales"));
});

test("PR94: equilíbrio divide polivalentes entre equipas quando ambas precisam",()=>{
  const result=allocateFunctionalCoverage(scenario(1,1,2));
  assert.equal(result.certification.status,"covered");
  assert.deepEqual(result.certification.targets,{checkout:2,sales:2});
  assert.equal(roleCount(result.allocations,"checkout"),2);
  assert.equal(roleCount(result.allocations,"sales"),2);
});

test("PR94: 50% arredonda para cima, conta polivalentes em ambas as populações",()=>{
  const input=scenario(1,2,2);
  const result=allocateFunctionalCoverage(input);
  assert.deepEqual(result.certification.qualified,{checkout:3,sales:4});
  assert.deepEqual(result.certification.targets,{checkout:2,sales:2});
  assert.ok(result.allocations.every(a=>
    input.members.find(p=>p.id===a.memberId)!.qualifiedRoles.includes(a.role)));
});

test("PR94: não inventa uma solução válida quando há pessoas insuficientes",()=>{
  const input=scenario(1,3,2);
  input.assignments=input.assignments.filter(a=>
    !a.memberId.startsWith("polivalente-"));
  const out=allocateFunctionalCoverage(input);
  assert.equal(out.certification.status,"uncovered");
  assert.ok(out.certification.issues.some(i=>
    i.code==="ROLE_COVERAGE_GAP"&&i.role==="checkout"&&i.missing===1));
  assert.equal(roleCount(out.allocations,"checkout"),1);
  assert.equal(roleCount(out.allocations,"sales"),3);
});

test("PR94: as pausas retiram disponibilidade à cobertura por função",()=>{
  const input=scenario(1,3,2);
  input.assignments=input.assignments.map(a=>
    a.memberId.startsWith("polivalente-")?{
      ...a,mealBreak:{start:"12:00",end:"13:00"},
    }:a);
  const result=allocateFunctionalCoverage(input);
  assert.equal(result.certification.status,"uncovered",
    "os polivalentes atribuídos à Caixa não a cobrem enquanto almoçam");
  assert.ok(result.certification.issues.some(i=>
    i.code==="ROLE_COVERAGE_GAP"&&i.role==="checkout"&&
    i.start==="12:00"&&i.end==="13:00"));
  assert.ok(result.certification.slots.some(s=>
    s.start==="12:00"&&s.end==="13:00"&&s.counts.checkout===1));
});

test("PR94: validador rejeita dupla função, posto não qualificado e ausência",()=>{
  const input=scenario(1,1,2);
  const correct=allocateFunctionalCoverage(input);
  assert.equal(correct.certification.status,"covered");
  const dual=[
    ...correct.allocations,
    {memberId:"polivalente-0",role:"sales"},
  ];
  assert.equal(certifyFunctionalCoverage(input,dual).status,"invalid_input");
  assert.ok(certifyFunctionalCoverage(input,dual).issues.some(i=>
    i.code==="DUPLICATE_ROLE_ASSIGNMENT"));
  const impossible=correct.allocations.map(a=>
    a.memberId==="caixa-0"?{...a,role:"sales"}:a);
  assert.ok(certifyFunctionalCoverage(input,impossible).issues.some(i=>
    i.code==="UNQUALIFIED_MEMBER"));
  assert.ok(certifyFunctionalCoverage(input,[]).issues.some(i=>
    i.code==="UNASSIGNED_MEMBER"));
});

test("PR94: o legado sem função não passa a polivalente por omissão",()=>{
  const input=scenario(1,1,1);
  input.members=[...input.members,{
    id:"antigo",active:true,
  }];
  input.assignments=[...input.assignments,{
    memberId:"antigo",date,start:START,end:END,
  }];
  const out=allocateFunctionalCoverage(input);
  assert.equal(out.certification.status,"invalid_input");
  assert.ok(out.certification.issues.some(i=>
    i.code==="UNASSIGNED_MEMBER"&&i.memberId==="antigo"));
  assert.ok(!out.allocations.some(a=>a.memberId==="antigo"));
});

test("PR94: mesmas regras funcionam com três funções em vez de duas",()=>{
  const input=scenario(1,1,1);
  input.roles=["checkout","sales","warehouse"];
  input.members=[...input.members,{
    id:"armazem",active:true,qualifiedRoles:["warehouse"],
  }];
  input.assignments=[...input.assignments,{
    memberId:"armazem",date,start:START,end:END,
  }];
  const out=allocateFunctionalCoverage(input);
  assert.equal(out.certification.status,"covered");
  assert.equal(out.certification.targets.warehouse,1);
  assert.ok(out.allocations.some(a=>a.memberId==="armazem"&&
    a.role==="warehouse"));
});

test("PR94: sem pessoas habilitadas para uma equipa não certifica falsamente",()=>{
  const input=scenario(1,1,0);
  input.roles=["checkout","sales","warehouse"];
  const out=allocateFunctionalCoverage(input);
  assert.equal(out.certification.status,"uncovered");
  assert.ok(out.certification.issues.some(i=>
    i.code==="NO_QUALIFIED_MEMBERS"&&i.role==="warehouse"));
});

test("PR94: configuração inválida não é aceite como cobertura válida",()=>{
  const input=scenario(1,3,2);
  for(const minimumPercent of [-1,101,Infinity,NaN]){
    const out=allocateFunctionalCoverage({...input,minimumPercent});
    assert.equal(out.certification.status,"invalid_input");
  }
  const duplicate={
    ...input,assignments:[input.assignments[0],...input.assignments],
  };
  assert.equal(allocateFunctionalCoverage(duplicate).certification.status,
    "invalid_input");
});
