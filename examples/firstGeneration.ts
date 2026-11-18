/**
 * Exercício autónomo do motor (dados fictícios).
 * Executar: npm run example:generator
 * Não grava nem aprova horários.
 */
import {generateSchedule} from "../src/generateSchedule";
import {suggestedWeeklyOpeningHours} from "../src/operatingHours";
import type {GenerationInput} from "../src/generateSchedule";

const team={members:[
  {id:"1a2b3c4d-3333-4444-8aaa-123456789abc",name:"Ana Exemplo",active:true},
  {id:"1a2b3c4d-3333-4444-8aaa-123456789abd",name:"Bruno Exemplo",active:true},
  {id:"1a2b3c4d-3333-4444-8aaa-123456789abe",name:"Pessoa Inativa",active:false},
]};

function inspect(label:string,input:GenerationInput):void {
  const result=generateSchedule(input);
  console.log("\n"+label);
  console.log("Estado:",result.status);
  console.log("Atribuições propostas:",result.candidateAssignments.length);
  console.table(result.certification.weeks.map(week=>({
    pessoa:team.members.find(member=>member.id===week.memberId)?.name,
    semana:week.weekStart,
    horas:week.actualMinutes/60,
    obrigatórias:week.requiredMinutes/60,
    completo:week.complete,
  })));
  if(result.certification.issues.length){
    console.log("Problemas:");
    console.table(result.certification.issues.map(problem=>({
      código:problem.code,
      semana:problem.weekStart??"-",
      pessoa:team.members.find(member=>member.id===problem.memberId)?.name??"-",
      mensagem:problem.message,
    })));
  }
  console.log("Primeiros turnos propostos:");
  console.table(result.candidateAssignments.slice(0,10));
}

const common={team,openingHours:suggestedWeeklyOpeningHours()};
inspect("1 — Semana completa de 2 a 8 de novembro de 2026",{
  ...common,period:{mode:"weekly",start:"2026-11-02"},
});
inspect("2 — Novembro de 2026 sem dados certificados dos meses vizinhos",{
  ...common,period:{mode:"monthly",year:2026,month:11},
});
