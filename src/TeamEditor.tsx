import { useState, type FormEvent } from "react";
import { countActiveMembers, type TeamRoster } from "./team";
import {
  loadTeamDraftFromBrowser, saveTeamDraftToBrowser,
} from "./teamDraftRepository";

type Feedback = {kind:"error"|"success";message:string};

export function TeamEditor() {
  const [initial] = useState(loadTeamDraftFromBrowser);
  const [roster,setRoster] = useState<TeamRoster>(()=>
    initial.status==="loaded" ? initial.value : {members:[]}
  );
  const [canEdit,setCanEdit] = useState(
    initial.status==="empty" || initial.status==="loaded"
  );
  const [name,setName] = useState("");
  const [weeklyDaysOff,setWeeklyDaysOff] = useState<number|null>(null);
  const [editingId,setEditingId] = useState<string|null>(null);
  const [feedback,setFeedback] = useState<Feedback|null>(()=>
    initial.status==="unavailable"
      ? {kind:"error",message:"Não é possível aceder aos dados da equipa neste dispositivo."}
      : initial.status==="invalid"
        ? {kind:"error",message:"Não foi possível recuperar a lista de colaboradores guardada."}
        : null
  );

  const activeCount=countActiveMembers(roster);

  function persist(next:TeamRoster, successMessage:string):boolean {
    const saved=saveTeamDraftToBrowser(next);
    if(!saved.ok){
      setFeedback({kind:"error",message:saved.message});
      return false;
    }
    setRoster(saved.value);
    const hasActive=saved.value.members.some(person=>person.active);
    setFeedback({kind:"success",message:successMessage +
      (!hasActive ? " É necessário pelo menos um colaborador ativo para concluir esta etapa." : "")});
    return true;
  }

  function submitMember(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(!canEdit)return;
    let id=editingId;
    if(id===null){
      try {
        id=window.crypto.randomUUID();
      }catch{
        setFeedback({kind:"error",message:"Não foi possível criar o identificador do colaborador."});
        return;
      }
    }
    const current=roster.members.find(member=>member.id===id);
    if(editingId!==null && !current){
      setFeedback({kind:"error",message:"O colaborador já não está disponível para edição."});
      return;
    }
    const changed={
      id,
      name,
      active:current?.active??true,
      ...(weeklyDaysOff===null?{}:{weeklyDaysOff}),
    };
    const next:TeamRoster={
      members:editingId
        ? roster.members.map(member=>member.id===editingId ? changed : member)
        : [...roster.members,changed],
    };
    if(persist(next,editingId ? "Dados do colaborador atualizados." : "Colaborador adicionado.")){
      setName("");
      setWeeklyDaysOff(null);
      setEditingId(null);
    }
  }

  function editMember(id:string){
    const member=roster.members.find(person=>person.id===id);
    if(!member)return;
    setEditingId(id);
    setName(member.name);
    setWeeklyDaysOff(member.weeklyDaysOff??null);
    setFeedback(null);
    document.getElementById("team-name")?.focus();
  }

  function cancelEdit(){
    setEditingId(null);
    setName("");
    setWeeklyDaysOff(null);
    setFeedback(null);
  }

  function toggleMember(id:string){
    if(!canEdit)return;
    const member=roster.members.find(item=>item.id===id);
    if(!member)return;
    const next:TeamRoster={
      members:roster.members.map(item=>
        item.id===id ? {...item,active:!item.active} : item
      ),
    };
    persist(next,member.active
      ? "Colaborador marcado como inativo."
      : "Colaborador marcado como ativo.");
  }

  return (
    <section className="surface team-panel" aria-label="Gestão da equipa">
      <header className="team-header">
        <div>
          <p className="surface-kicker">Colaboradores</p>
          <h2>Equipa</h2>
          <p>Organiza quem pode integrar o planeamento de horários.</p>
        </div>
        <div className="team-count" aria-label={activeCount+" colaboradores ativos"}>
          <strong>{activeCount}</strong>
          <span>{activeCount===1 ? "ativo" : "ativos"}</span>
        </div>
      </header>

      {!canEdit && (
        <div className="team-recovery" role="alert">
          <p>{initial.status==="invalid"
            ? "Os dados guardados não puderam ser validados. Para não os substituir sem autorização, a edição está bloqueada."
            : "Não foi possível aceder ao armazenamento local. Recarrega a página quando estiver disponível."}</p>
          {initial.status==="invalid" && (
            <button type="button" className="team-action"
              onClick={()=>{
                if(window.confirm("Substituir a lista de colaboradores guardada neste dispositivo?")){
                  setCanEdit(true);
                  setFeedback(null);
                }
              }}>
              Começar uma nova lista
            </button>
          )}
        </div>
      )}

      {canEdit && (
        <>
          <div className="team-list" aria-label="Lista de colaboradores">
            {roster.members.length===0
              ? <div className="team-empty">
                  <p><strong>Ainda não adicionaste colaboradores.</strong></p>
                  <p>Adiciona a primeira pessoa para começares a organizar a equipa.</p>
                </div>
              : roster.members.map(member=>(
                <div className="team-person" key={member.id}>
                  <span className="team-avatar" aria-hidden="true">
                    {member.name.slice(0,1).toLocaleUpperCase("pt-PT")}
                  </span>
                  <div className="team-person-info">
                    <strong>{member.name}</strong>
                    <span className={member.active
                      ? "team-status team-status-active"
                      : "team-status team-status-inactive"}>
                      {member.active ? "Ativo" : "Inativo"}
                    </span>
                    <span className="team-days-off-summary">
                      {member.weeklyDaysOff===undefined
                        ? "Folgas por semana: por definir"
                        : member.weeklyDaysOff+" "+
                          (member.weeklyDaysOff===1?"dia sem trabalho/semana":
                            "dias sem trabalho/semana")}
                    </span>
                  </div>
                  <div className="team-person-actions">
                    <button type="button" className="team-action"
                      onClick={()=>editMember(member.id)}
                      aria-label={"Editar "+member.name}>Editar</button>
                    <button type="button" className="team-action"
                      onClick={()=>toggleMember(member.id)}
                      aria-label={(member.active ? "Desativar " : "Ativar ")+member.name}>
                      {member.active ? "Desativar" : "Ativar"}
                    </button>
                  </div>
                </div>
              ))}
          </div>

          <form className="team-form" onSubmit={submitMember}>
            <h3>{editingId ? "Editar colaborador" : "Adicionar colaborador"}</h3>
            <label htmlFor="team-name">Nome do colaborador <span aria-hidden="true">*</span></label>
            <input id="team-name" name="teamName" type="text" required
              minLength={2} maxLength={120} autoComplete="off"
              placeholder="Nome do colaborador" value={name}
              onChange={event=>{
                setName(event.target.value);
                setFeedback(null);
              }}/>
            <label htmlFor="team-weekly-days-off">Dias de folga por semana</label>
            <select id="team-weekly-days-off" name="weeklyDaysOff"
              value={weeklyDaysOff===null?"":weeklyDaysOff}
              onChange={event=>{
                setWeeklyDaysOff(event.target.value===""?null:Number(event.target.value));
                setFeedback(null);
              }}>
              <option value="">Por definir (sem regra adicional)</option>
              {Array.from({length:7},(_,days)=>(
                <option key={days} value={days}>
                  {days} {days===1?"dia":"dias"}
                </option>
              ))}
            </select>
            <p className="team-field-help">
              Define apenas a quantidade semanal. O motor escolhe os dias
              sem trabalho conforme o funcionamento da empresa e as 40 horas
              obrigatórias. Não são definidas folgas em dias específicos.
            </p>
            <div className="team-form-actions">
              <button type="submit" className="button button-primary">
                {editingId ? "Guardar alterações" : "Adicionar à equipa"}
              </button>
              {editingId && (
                <button type="button" className="team-action" onClick={cancelEdit}>
                  Cancelar edição
                </button>
              )}
            </div>
          </form>
        </>
      )}

      {feedback && <p className={feedback.kind==="error" ? "form-error" : "form-success"}
        role={feedback.kind==="error" ? "alert" : "status"}>
        {feedback.message}
      </p>}

      <p className="team-help">
        Os colaboradores inativos não devem ser incluídos em novos horários.
        Os dados ficam guardados apenas neste dispositivo.
      </p>
    </section>
  );
}
