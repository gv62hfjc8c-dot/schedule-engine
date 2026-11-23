import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  createSchedulePdf,schedulePdfFilename,
  type PrintableScheduleInput,
} from "../src/printableSchedulePdf";

function fixture():PrintableScheduleInput {
  return {
    year:2026,month:11,
    companyName:"Empresa Açoriana",
    state:"generated",
    certification:"insufficient_context",
    members:[
      {id:"a",name:"Anabela Espínola"},
      {id:"b",name:"Jéssica Nogueira"},
      {id:"c",name:"Lídio Nogueira"},
    ],
    assignments:[
      {memberId:"a",date:"2026-11-02",
        start:"09:00",end:"19:00",role:"sales",
        mealBreak:{start:"12:30",end:"13:30"}},
      {memberId:"c",date:"2026-11-02",
        start:"08:30",end:"18:30",role:"checkout",
        mealBreak:{start:"13:30",end:"14:30"}},
      {memberId:"b",date:"2026-11-08",start:"14:00",end:"19:00",role:"sales"},
      // Outside month: must never appear on monthly printable pages.
      {memberId:"a",date:"2026-12-01",start:"02:00",end:"03:00"},
    ],
    roles:new Map([["sales","Vendas"],["checkout","Caixa"]]),
    plannedRest:[{memberId:"a",weekStart:"2026-11-02",
      daysWithoutWork:["2026-11-03"],fullWeekendOff:false}],
  };
}
function pdfText(bytes:Uint8Array):string {
  const raw=new TextDecoder().decode(bytes);
  const labels=[...raw.matchAll(/<([0-9A-F]+)> Tj/g)].map(match=>{
    const hex=match[1];
    const chars=hex.match(/../g)??[];
    return new TextDecoder("windows-1252").decode(
      Uint8Array.from(chars.map(item=>parseInt(item,16)))
    );
  });
  return labels.join(" | ");
}

test("PR97: PDF real de 6 páginas A4, legível e sem persistência",()=>{
  const input=fixture();
  const original=JSON.stringify({
    ...input,roles:[...input.roles!],
  });
  const bytes=createSchedulePdf(input);
  const raw=new TextDecoder().decode(bytes);
  assert.ok(raw.startsWith("%PDF-1.4\n"));
  assert.match(raw,/\/MediaBox \[0 0 842 595\]/);
  assert.equal((raw.match(/\/Type \/Page \/Parent/g)??[]).length,6);
  assert.match(raw,/\/Count 6\b/);
  assert.match(raw,/startxref\n\d+\n%%EOF\n$/);
  const extracted=pdfText(bytes);
  assert.match(extracted,/Empresa Açoriana/);
  assert.match(extracted,/Horário de trabalho - novembro de 2026/);
  assert.match(extracted,/Proposta não guardada/);
  assert.match(extracted,/Certificação incompleta/);
  assert.match(extracted,/Anabela Espínola/);
  assert.match(extracted,/Jéssica Nogueira/);
  assert.match(extracted,/Lídio Nogueira/);
  assert.match(extracted,/09:00-19:00/);
  assert.match(extracted,/P 12:30-13:30/);
  assert.match(extracted,/Vendas/);
  assert.match(extracted,/Caixa/);
  assert.match(extracted,/Descanso planeado/);
  assert.match(extracted,/Sem turno/);
  assert.match(extracted,/não significa folga/);
  assert.doesNotMatch(extracted,/02:00-03:00/);
  assert.match(extracted,/Não equivale a aprovação/);
  assert.equal(JSON.stringify({...input,roles:[...input.roles!]}),original);
  assert.deepEqual(createSchedulePdf(input),bytes,"exportação determinística");
});

test("PR97: as alterações manuais são identificadas como não guardadas",()=>{
  const content=pdfText(createSchedulePdf({...fixture(),
    state:"edited",certification:"invalid",
  }));
  assert.match(content,/Alterações por guardar/);
  assert.match(content,/Com conflitos: não certificado/);
  assert.doesNotMatch(content,/Regras implementadas verificadas/);
});

test("PR97: um rascunho guardado nunca aparece como aprovado",()=>{
  const content=pdfText(createSchedulePdf({...fixture(),
    state:"saved",certification:"valid",
  }));
  assert.match(content,/Rascunho guardado/);
  assert.match(content,/Regras implementadas verificadas/);
  assert.match(content,/Não equivale a aprovação/);
  assert.doesNotMatch(content,/Proposta não guardada/);
});

test("PR97: equipas grandes geram páginas adicionais sem omitir membros",()=>{
  const input=fixture();
  input.members=Array.from({length:24},(_,i)=>({
    id:"employee-"+i,name:"Colaborador "+String(i+1),
  }));
  const bytes=createSchedulePdf(input);
  const raw=new TextDecoder().decode(bytes);
  assert.equal((raw.match(/\/Type \/Page \/Parent/g)??[]).length,18);
  const extracted=pdfText(bytes);
  assert.match(extracted,/Colaborador 1/);
  assert.match(extracted,/Colaborador 24/);
  assert.match(extracted,/Equipa 3 de 3/);
  assert.match(extracted,/Página 18\/18/);
});

test("PR97: dias sem atribuição não são folgas automáticas",()=>{
  const input=fixture();
  input.plannedRest=[];
  const content=pdfText(createSchedulePdf(input));
  assert.match(content,/Sem turno/);
  assert.doesNotMatch(content,/Descanso planeado/);
});

test("PR97: há indicação de conflitos de turnos em vez de os esconder",()=>{
  const input=fixture();
  input.assignments=[...input.assignments,{
    memberId:"a",date:"2026-11-02",start:"14:00",end:"19:00",role:"sales",
  }];
  const content=pdfText(createSchedulePdf(input));
  assert.match(content,/2 turnos/);
  assert.match(content,/Verificar conflito/);
});

test("PR97: período e nome de ficheiro validados",()=>{
  assert.equal(schedulePdfFilename(2026,11),"horario-2026-11-proposta.pdf");
  assert.throws(()=>schedulePdfFilename(2026,13));
  assert.throws(()=>createSchedulePdf({...fixture(),members:[],assignments:[]}),
    /Não existem colaboradores/);
});

test("PR97: a interface usa os dados visíveis e nunca depende de guardar",()=>{
  const source=readFileSync(new URL("../src/CalendarScheduler.tsx",import.meta.url),"utf8");
  assert.match(source,/manualEdit\?\.assignments\?\?\s*preview\?\.candidateAssignments\?\?saved/);
  assert.match(source,/const bytes=createSchedulePdf/);
  assert.match(source,/Exportar PDF/);
  assert.match(source,/disabled=\{dragCandidate!==null \|\| data\.length===0\}/);
});
