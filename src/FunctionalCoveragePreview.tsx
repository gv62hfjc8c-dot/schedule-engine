import {useState} from "react";
import {loadTeamDraftFromBrowser} from "./teamDraftRepository";
import {WEEKDAYS,type WeeklyOpeningHours} from "./operatingHours";
import {civilDayOfWeek} from "./schedulePeriods";
import {OPERATIONAL_ROLES} from "./team";
import {
  allocateFunctionalCoverage,
  type FunctionalAllocationResult,
} from "./functionalCoverage";
import type {WorkAssignment} from "./workAssignments";

const ROLE_LABELS:Record<string,string>={
  checkout:"Caixa",sales:"Vendas",
};

/** Manual, read-only trial based on the CURRENT displayed day and the CURRENT
 * locally saved qualifications. The generator and primary certificate remain
 * untouched. It makes role shortages visible instead of claiming false
 * coverage from a staff count or from dual-qualified people.
 */
export function FunctionalCoveragePreview({
  date,assignments,opening,legacy,
}:{
  date:string;
  assignments:readonly WorkAssignment[];
  opening:WeeklyOpeningHours|null;
  legacy:boolean;
}) {
  const [trial,setTrial]=useState<{
    result:FunctionalAllocationResult;
    names:Map<string,string>;
  }|null>(null);
  const [error,setError]=useState<string|null>(null);

  function runTrial(){
    setTrial(null);
    setError(null);
    if(legacy){
      setError("Este horário utiliza pausas do modelo anterior. Gera uma nova proposta para testar a cobertura funcional com segurança.");
      return;
    }
    if(!opening){
      setError("Configura primeiro o horário de funcionamento da empresa.");
      return;
    }
    const team=loadTeamDraftFromBrowser();
    if(team.status!=="loaded"){
      setError("Não foi possível consultar as funções da equipa. Abre Configuração → Equipa.");
      return;
    }
    const members=team.value.members;
    const withoutRole=members.filter(member=>member.active &&
      !member.qualifiedRoles?.length);
    if(withoutRole.length){
      setError("Existem "+withoutRole.length+
        " colaboradores ativos sem função definida. Define Caixa, Vendas ou ambas em Configuração → Equipa antes de testar.");
      return;
    }
    const weekday=WEEKDAYS[civilDayOfWeek(date)]?.id;
    const windows=opening.days.find(day=>day.day===weekday)?.intervals;
    if(!windows){
      setError("Não foi possível identificar o funcionamento desse dia.");
      return;
    }
    if(windows.length===0){
      setError("A empresa está encerrada neste dia.");
      return;
    }
    if(assignments.length===0){
      setError("Este dia não tem turnos para distribuir por função.");
      return;
    }
    const result=allocateFunctionalCoverage({
      date,
      members:members.map(member=>({
        id:member.id,active:member.active,
        qualifiedRoles:member.qualifiedRoles,
      })),
      assignments:[...assignments],
      opening:windows,
      roles:OPERATIONAL_ROLES,
      minimumPercent:50,
    });
    setTrial({result,names:new Map(members.map(member=>
      [member.id,member.name]))});
  }

  const report=trial?.result.certification;
  const gaps=report?.issues.filter(issue=>
    issue.code==="ROLE_COVERAGE_GAP")??[];
  const firstGap=Object.fromEntries(OPERATIONAL_ROLES.map(role=>[
    role,gaps.find(gap=>gap.role===role),
  ])) as Record<string,(typeof gaps)[number]|undefined>;
  const problematic=report?.issues.filter(issue=>
    issue.code!=="ROLE_COVERAGE_GAP")??[];
  return (
    <details className="functional-preview" aria-label="Teste de cobertura funcional">
      <summary>Testar Caixa e Vendas neste dia</summary>
      <p>
        Simulação de funções para o dia selecionado, com base nos turnos e
        nas competências guardadas. Exige 50% dos colaboradores habilitados
        em cada função a trabalhar simultaneamente, excluindo pausas.
      </p>
      <p className="functional-preview-notice">
        Este teste não altera nem guarda turnos. Não faz parte da certificação
        mensal atual e não corrige automaticamente as jornadas ou as pausas.
      </p>
      <button className="button functional-preview-run" type="button"
        onClick={runTrial}>
        Simular distribuição de funções
      </button>
      {error&&<p className="form-error" role="alert">{error}</p>}
      {trial&&report&&
        <div className="functional-preview-results" role="status">
          <p className={report.status==="covered"
            ?"functional-preview-ok":"functional-preview-warning"}>
            <strong>{report.status==="covered"
              ?"Cobertura funcional verificada neste dia"
              :report.status==="uncovered"
                ?"Cobertura funcional insuficiente"
                :"Existem dados de funções ou turnos por corrigir"}</strong>
          </p>
          <div className="functional-preview-targets">
            {OPERATIONAL_ROLES.map(role=>
              <div key={role}>
                <strong>{ROLE_LABELS[role]}</strong>
                <span>{report.qualified[role]??0} habilitados na equipa</span>
                <span>Mínimo simultâneo: {report.targets[role]??0}</span>
                {firstGap[role]&&
                  <span className="functional-preview-warning">
                    Falta pelo menos {firstGap[role]!.missing} entre
                    {" "}{firstGap[role]!.start} e {firstGap[role]!.end}
                  </span>}
              </div>)}
          </div>
          <h4>Afetação proposta para este dia</h4>
          <ul className="functional-preview-allocations">
            {trial.result.allocations.map(entry=>
              <li key={entry.memberId}>
                <span>{trial.names.get(entry.memberId)??"Colaborador não encontrado"}</span>
                <strong>{ROLE_LABELS[entry.role]??entry.role}</strong>
              </li>)}
          </ul>
          {problematic.length>0&&
            <p className="functional-preview-warning">
              Existem {problematic.length} situações que impedem validar
              esta distribuição, incluindo colaboradores sem função atribuível
              ou sem competência para a função escolhida.
            </p>}
          {gaps.length>0&&
            <p className="functional-preview-warning">
              Foram detetados {gaps.length} intervalos com cobertura funcional
              inferior ao mínimo, considerando também as pausas. A simulação
              não declara o horário válido nesses períodos.
            </p>}
          <small>
            Cada polivalente conta numa única função durante todo o turno.
            Os 50% são calculados por função sobre todos os colaboradores
            ativos habilitados nessa função, mesmo os que hoje folgam.
          </small>
        </div>}
    </details>
  );
}
