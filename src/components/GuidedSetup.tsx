import {useState} from "react";
import type {WorkspaceSection} from "./ApplicationNavigation";

interface Props {
  operationConfirmed:boolean;
  cycleDecisionConfirmed:boolean;
  canConfirmOperation:boolean;
  saving:boolean;
  hasCoverage:boolean;
  coverageConfirmed:boolean;
  hasTeam:boolean;
  teamConfirmed:boolean;
  hasAvailabilityAndRules:boolean;
  availabilityRulesConfirmed:boolean;
  onConfirmOperation():void;
  onNavigate(section:WorkspaceSection):void;
}

/**
 * First real onboarding checkpoint: one explicit, persistable confirmation.
 * Other steps are visible as actionable destinations, not misleading PASS
 * badges. Data presence is not equivalent to a confirmed, valid schedule.
 */
export default function GuidedSetup({
  operationConfirmed,cycleDecisionConfirmed,canConfirmOperation,saving,
  hasCoverage,coverageConfirmed,hasTeam,teamConfirmed,hasAvailabilityAndRules,availabilityRulesConfirmed,onConfirmOperation,onNavigate,
}:Props){
  const [expanded,setExpanded]=useState(false);
  const completed=Number(operationConfirmed)+Number(coverageConfirmed)+Number(teamConfirmed)+Number(availabilityRulesConfirmed);
  return <section className="panel guided-setup" aria-label="Configuração inicial guiada">
    <div className="guided-setup-heading">
      <div>
        <span className="section-kicker">Configuração inicial</span>
        <h2>Preparar o primeiro horário</h2>
        <p>{operationConfirmed
          ?"Funcionamento confirmado. Continua pela cobertura e pela equipa."
          :"Revê o funcionamento da empresa e decide se utiliza ciclos de trabalho."}</p>
      </div>
      <div className="guided-setup-progress">
        <strong>{completed} de 5</strong>
        <small>etapas confirmadas</small>
        <button type="button" className="se-outline" aria-expanded={expanded}
          aria-controls="guided-setup-steps"
          onClick={()=>setExpanded(current=>!current)}>
          {expanded?"Ocultar etapas":"Ver etapas"}
        </button>
      </div>
    </div>
    {expanded && <ol id="guided-setup-steps" className="guided-setup-steps">
      <li>
        <div>
          <strong>1. Funcionamento, fuso e ciclo</strong>
          <p>{operationConfirmed?"Configuração confirmada. Alterações posteriores exigem nova confirmação."
            :cycleDecisionConfirmed
              ?"Escolha do ciclo registada. Confirma os horários de funcionamento."
              :"Decide se existe ciclo e qual a duração, antes de confirmar a operação."}</p>
        </div>
        {operationConfirmed?<span className="guided-status done">Confirmado</span>
          :<button type="button" className="primary-button"
            disabled={!canConfirmOperation||saving}
            onClick={onConfirmOperation}>
            Confirmar funcionamento
          </button>}
      </li>
      <li>
        <div><strong>2. Cobertura necessária</strong>
          <p>{coverageConfirmed?"Cobertura confirmada. Alterações posteriores exigem nova confirmação."
            :hasCoverage?"Regra padrão de 1 pessoa ativa. Confirma-a ou personaliza por dia."
            :"Corrige as regras de cobertura antes de confirmar."}</p></div>
        {coverageConfirmed?<span className="guided-status done">Confirmado</span>
          :<button type="button" className="se-outline"
            onClick={()=>onNavigate("presence")}>Confirmar cobertura</button>}
      </li>
      <li>
        <div><strong>3. Equipa e vínculos</strong>
          <p>{teamConfirmed?"Equipa confirmada. Alterações posteriores exigem nova confirmação."
            :hasTeam?"Existem colaboradores ativos. Revê os dados e confirma a equipa."
            :"Adiciona pelo menos um colaborador ativo e confirma a elegibilidade temporal."}</p></div>
        {teamConfirmed?<span className="guided-status done">Confirmado</span>
          :<button type="button" className="se-outline"
            onClick={()=>onNavigate("people")}>Confirmar equipa</button>}
      </li>
      <li>
        <div><strong>4. Disponibilidades e regras</strong>
          <p>{availabilityRulesConfirmed?"Disponibilidades e regras confirmadas. Alterações exigem nova confirmação."
            :hasAvailabilityAndRules?"Dados estruturalmente válidos; revê e confirma as disponibilidades e regras."
            :"Define os dias disponíveis ou indisponíveis e a duração padrão do turno."}</p></div>
        {availabilityRulesConfirmed?<span className="guided-status done">Confirmado</span>
          :<button type="button" className="se-outline"
            onClick={()=>onNavigate("availability")}>Ver disponibilidades</button>}
      </li>
      <li>
        <div><strong>5. Primeira proposta</strong>
          <p>Gerar não é aprovar: só uma proposta validada pode ser arquivada.</p></div>
        <button type="button" className="se-outline"
          onClick={()=>onNavigate("generator")}>Ir para geração</button>
      </li>
    </ol>}
    {!cycleDecisionConfirmed && <p className="guided-setup-note">
      O primeiro passo só fica disponível depois de guardares uma escolha explícita:
      sem ciclo fixo ou ciclo de 7, 14 ou 28 dias.
    </p>}
  </section>;
}
