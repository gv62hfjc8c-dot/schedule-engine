import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  improveMealBreakStaggering,
} from "../src/mealStaggerOptimization";
import {
  evaluateRestDayExchangeCandidates,
} from "../src/restDayExchangeEvaluation";
import {resolvePlanningPeriod} from "../src/schedulePeriods";
import {certifySchedule} from "../src/certifySchedule";
import {analyzeFunctionalCapacity} from "../src/functionalCapacityAnalysis";
import {assignmentMinutes,clockMinutes,
  type WorkAssignment} from "../src/workAssignments";
import type {TeamRoster} from "../src/team";
import type {WeeklyOpeningHours} from "../src/operatingHours";
import type {WeekendRotationResult} from "../src/weekendRotation";

interface Sample{
  cycleStart:string;
  team:TeamRoster;
  openingHours:WeeklyOpeningHours;
  assignments:WorkAssignment[];
  rotation:WeekendRotationResult;
}
function sample():Sample{
  return JSON.parse(readFileSync(
    new URL("./fixtures/pr96-november-anonymized.json",import.meta.url),
    "utf8",
  )) as Sample;
}
const period=resolvePlanningPeriod({mode:"28d",start:"2026-11-02"});
const roles=["checkout","sales"];

test("PR96: reordenar refeições no ciclo certificado preserva seis jornadas longas",()=>{
  const source=sample();
  const study=evaluateRestDayExchangeCandidates(source);
  assert.ok(study?.best,"a regressão PR96 deve produzir seis jornadas");
  const assignments=study.best.candidateAssignments;
  const original=JSON.stringify(assignments);
  const first=certifySchedule({
    period:{mode:"28d",start:"2026-11-02"},
    team:source.team,openingHours:source.openingHours,
    mealBreakPolicy:"v2",hoursPolicy:"rolling28",
    functionalCoveragePolicy:"qualified50",
    candidateAssignments:assignments,
  });
  assert.equal(first.status,"valid");
  assert.equal(assignments.filter(s=>assignmentMinutes(s)>540).length,6);
  const result=improveMealBreakStaggering({
    assignments,period,openingHours:source.openingHours,
    members:source.team.members,roles,
  });
  assert.ok(result.summary,"há pausas que podem ser distribuídas");
  assert.ok(result.summary.changedBreaks>0);
  assert.equal(result.summary.before.uncoveredMinutes,0);
  assert.equal(result.summary.before.soloMinutes,0);
  assert.equal(result.summary.after.uncoveredMinutes,0);
  assert.equal(result.summary.after.soloMinutes,
    result.summary.before.soloMinutes);
  assert.equal(result.summary.after.emptyRoleMinutes,0,
    "nenhuma função operacional deve ficar vazia durante as refeições");
  assert.ok(result.summary.after.roleGapMinutes<=
    result.summary.before.roleGapMinutes);
  assert.ok(result.summary.after.minutesWithThreeOrMoreBreaks<=
    result.summary.before.minutesWithThreeOrMoreBreaks);
  assert.ok(result.summary.after.minutesWithFourOrMoreBreaks<=
    result.summary.before.minutesWithFourOrMoreBreaks);
  assert.ok(result.summary.after.peakSimultaneousBreaks<=
    result.summary.before.peakSimultaneousBreaks);
  for(let index=0;index<assignments.length;index++){
    const before=assignments[index],after=result.assignments[index];
    assert.deepEqual(
      [after.memberId,after.date,after.start,after.end,after.role],
      [before.memberId,before.date,before.start,before.end,before.role],
      "o horário e posto nunca mudam quando se reposicionam pausas");
    assert.equal(assignmentMinutes(after),assignmentMinutes(before));
  }
  for(const member of source.team.members){
    assert.equal(result.assignments.filter(s=>s.memberId===member.id)
      .reduce((sum,s)=>sum+assignmentMinutes(s),0),9600);
  }
  assert.equal(result.assignments.filter(s=>
    assignmentMinutes(s)>540).length,6);
  const afterCertification=certifySchedule({
    period:{mode:"28d",start:"2026-11-02"},
    team:source.team,openingHours:source.openingHours,
    mealBreakPolicy:"v2",hoursPolicy:"rolling28",
    functionalCoveragePolicy:"qualified50",
    candidateAssignments:result.assignments,
  });
  assert.equal(afterCertification.status,"valid",
    JSON.stringify(afterCertification.issues));
  const functional=(shifts:readonly WorkAssignment[])=>analyzeFunctionalCapacity({
    period:{mode:"28d",start:"2026-11-02"},
    team:source.team,openingHours:source.openingHours,
    assignments:shifts,minimumPercent:50,
  });
  assert.equal(functional(result.assignments)?.observedRoleGapMinutes,
    functional(assignments)?.observedRoleGapMinutes);
  assert.equal(JSON.stringify(assignments),original,
    "a otimização não pode modificar o horário de entrada");
  assert.deepEqual(improveMealBreakStaggering({
    assignments,period,openingHours:source.openingHours,
    members:source.team.members,roles,
  }),result,"a distribuição deve ser determinística");
});

test("PR96: eliminar os 30 minutos sem Vendas em 18 novembro",()=>{
  const source=sample();
  const original=source.assignments.filter(s=>s.date==="2026-11-18");
  assert.equal(original.length,6);
  const before=original.map(s=>({...s,
    ...(s.mealBreak?{mealBreak:{...s.mealBreak}}:{})}));
  // Recreate the exact observed operational defect with synthetic IDs.
  const byIndex=[4,2,3,7,5,1];
  const shifts:[
    string,string,string,string,string
  ][]=[
    ["09:00","19:00","12:30","13:30","checkout"],
    ["09:00","17:30","12:00","13:00","sales"],
    ["09:00","19:00","12:00","13:00","sales"],
    ["08:30","18:30","11:30","12:30","checkout"],
    ["08:30","18:30","11:30","12:30","checkout"],
    ["08:30","18:30","12:30","13:30","sales"],
  ];
  const input=shifts.map(([start,end,mealStart,mealEnd,role],i)=>({
    memberId:source.team.members[byIndex[i]].id,
    date:"2026-11-18",start,end,role,
    mealBreak:{start:mealStart,end:mealEnd},
  }));
  const result=improveMealBreakStaggering({
    assignments:input,period,openingHours:source.openingHours,
    members:source.team.members,roles,
  });
  assert.ok(result.summary);
  // The test intentionally provides only this one day inside a 28-day
  // period, so other unstaffed days contribute the same fixed baseline.
  assert.equal(result.summary.before.emptyRoleMinutes-
    result.summary.after.emptyRoleMinutes,30);
  assert.equal(result.summary.before.peakSimultaneousBreaks,4);
  assert.equal(result.summary.before.minutesWithFourOrMoreBreaks,60);
  assert.ok(result.summary.after.emptyRoleMinutes>=0);
  assert.equal(result.summary.after.peakSimultaneousBreaks,2);
  assert.equal(result.summary.after.minutesWithThreeOrMoreBreaks,0);
  assert.equal(result.summary.before.roleGapMinutes,
    result.summary.after.roleGapMinutes);
  assert.equal(result.summary.after.uncoveredMinutes,
    result.summary.before.uncoveredMinutes);
  assert.equal(result.summary.after.soloMinutes,0);
  assert.deepEqual(original,before,"nenhum turno original foi modificado");
  // Preserve the configured 60-minute meal duration on every shift.
  for(const shift of result.assignments){
    assert.ok(shift.mealBreak);
    assert.equal(clockMinutes(shift.mealBreak.end)-
      clockMinutes(shift.mealBreak.start),60);
  }
});

test("PR96: horários não alinhados a 15 minutos não são reescritos",()=>{
  const source=sample();
  const openingHours=structuredClone(source.openingHours);
  openingHours.days[0].intervals[0].start="08:37";
  const original=source.assignments.filter(s=>s.date==="2026-11-02");
  const result=improveMealBreakStaggering({
    assignments:original,period,openingHours,
    members:source.team.members,roles,
  });
  assert.equal(result.summary,null);
  assert.deepEqual(result.assignments,original);
});

test("PR96: não otimizar sem funções efetivamente atribuídas",()=>{
  const source=sample();
  const original=source.assignments.map(s=>({
    ...s,role:undefined,
  }));
  const result=improveMealBreakStaggering({
    assignments:original,period,openingHours:source.openingHours,
    members:source.team.members,roles,
  });
  assert.equal(result.summary,null);
  assert.deepEqual(result.assignments,original);
});

test("PR96: diagnóstico real anonimizado mantém 6 jornadas e elimina os 11 dias com 4 pausas",()=>{
  const source=JSON.parse(readFileSync(
    new URL("./fixtures/pr96-meals-november-28d-anonymized.json",import.meta.url),
    "utf8",
  )) as Omit<Sample,"rotation">;
  const original=JSON.stringify(source);
  const before=certifySchedule({
    period:{mode:"28d",start:"2026-11-02"},
    team:source.team,openingHours:source.openingHours,
    mealBreakPolicy:"v2",hoursPolicy:"rolling28",
    functionalCoveragePolicy:"qualified50",
    candidateAssignments:source.assignments,
  });
  assert.equal(before.status,"valid",JSON.stringify(before.issues));
  assert.equal(source.assignments.filter(s=>assignmentMinutes(s)>540).length,6);
  const report=improveMealBreakStaggering({
    assignments:source.assignments,period,
    openingHours:source.openingHours,members:source.team.members,roles,
  });
  const summary=report.summary;
  assert.ok(summary);
  assert.equal(summary.assessedDays,28);
  assert.equal(summary.before.emptyRoleMinutes,30);
  assert.equal(summary.before.peakSimultaneousBreaks,4);
  assert.ok(summary.before.minutesWithFourOrMoreBreaks>0);
  assert.equal(summary.before.roleGapMinutes,21120);
  assert.equal(summary.after.emptyRoleMinutes,0);
  assert.equal(summary.after.minutesWithFourOrMoreBreaks,0);
  assert.equal(summary.after.minutesWithThreeOrMoreBreaks,0);
  assert.equal(summary.after.peakSimultaneousBreaks,2);
  assert.equal(summary.after.roleGapMinutes,21120);
  assert.equal(summary.after.uncoveredMinutes,0);
  assert.equal(summary.after.soloMinutes,0);
  assert.ok(summary.changedBreaks>0);
  for(const member of source.team.members){
    assert.equal(report.assignments.filter(s=>s.memberId===member.id)
      .reduce((sum,s)=>sum+assignmentMinutes(s),0),9600);
  }
  assert.equal(report.assignments.filter(s=>assignmentMinutes(s)>540).length,6);
  for(let i=0;i<source.assignments.length;i++){
    const a=source.assignments[i],b=report.assignments[i];
    assert.deepEqual([a.memberId,a.date,a.start,a.end,a.role],
      [b.memberId,b.date,b.start,b.end,b.role]);
  }
  const certificate=certifySchedule({
    period:{mode:"28d",start:"2026-11-02"},
    team:source.team,openingHours:source.openingHours,
    mealBreakPolicy:"v2",hoursPolicy:"rolling28",
    functionalCoveragePolicy:"qualified50",
    candidateAssignments:report.assignments,
  });
  assert.equal(certificate.status,"valid",JSON.stringify(certificate.issues));
  assert.equal(JSON.stringify(source),original);
});
