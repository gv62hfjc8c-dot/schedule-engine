import { useState, type FormEvent } from "react";
import { countActiveMembers, type OperationalRole, type TeamRoster } from "./team";
import {WEEKDAYS,type Weekday} from "./operatingHours";
import {
  loadTeamDraftFromBrowser, saveTeamDraftToBrowser,
} from "./teamDraftRepository";

type Feedback = {kind:"error"|"success";message:string};
type RoleChoice=""|"checkout"|"sales"|"both";

function roleChoiceFor(roles:readonly OperationalRole[]|undefined):RoleChoice {
  if(!roles)return "";
  if(roles.includes("checkout") && roles.includes("sales"))return "both";
  return roles.includes("checkout")?"checkout":"sales";
}
function roleDescription(roles:readonly OperationalRole[]|undefined):string {
  if(!roles)return "Por definir";
  if(roles.includes("checkout") && roles.includes("sales"))return "Caixa e Vendas";
  return roles.includes("checkout")?"Caixa":"Vendas";
}
function qualifiedRolesFor(choice:RoleChoice):OperationalRole[]|undefined {
  if(!choice)return undefined;
  return choice==="both"?["checkout","sales"]:[choice];
}

export function TeamEditor() {
  const [initial] = useState(loadTeamDraftFromBrowser);
  const [roster,setRoster] = useState<TeamRoster>(()=>
    initial.status==="loaded" ? initial.value : {members:[]}
  );
  const [canEdit,setCanEdit] = useState(
    initial.status==="empty" || initial.status==="loaded"
  );
  const [name,setName] = useState("");
  const [roleChoice,setRoleChoice] = useState<RoleChoice>("");
  const [weeklyDaysOff,setWeeklyDaysOff] = useState<number|null>(null);
  const [fixedDayOff,setFixedDayOff] = useState<Weekday|null>(null);
  const [weekendRotation,setWeekendRotation] = useState(false);
  const [weekendWeekdayRest,setWeekendWeekdayRest] = useState(1);
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
    const qualifiedRoles=qualifiedRolesFor(roleChoice);
    const changed={
      id,
      name,
      active:current?.active??true,
      ...(qualifiedRoles===undefined?{}:{qualifiedRoles}),
      ...(weeklyDaysOff===null?{}:{weeklyDaysOff}),
      ...(fixedDayOff===null?{}:{fixedDaysOff:[fixedDayOff]}),
      ...(weekendRotation?{weekendRest:{
        minimumWeekdayDaysOffOnFullWeekend:weekendWeekdayRest,
      }}:{}),
    };
    const next:TeamRoster={
      members:editingId
        ? roster.members.map(member=>member.id===editingId ? changed : member)
        : [...roster.members,changed],
    };
    if(persist(next,editingId ? "Dados do colaborador atualizados." : "Colaborador adicionado.")){
      setName("");
      setRoleChoice("");
      setWeeklyDaysOff(null);
      setFixedDayOff(null);
      setWeekendRotation(false);
      setWeekendWeekdayRest(1);
      setEditingId(null);
    }
  }

  function editMember(id:string){
    const member=roster.members.find(person=>person.id===id);
    if(!member)return;
    setEditingId(id);
    setName(member.name);
    setRoleChoice(roleChoiceFor(member.qualifiedRoles));
    setWeeklyDaysOff(member.weeklyDaysOff??null);
    setFixedDayOff(member.fixedDaysOff?.[0]??null);
    setWeekendRotation(member.weekendRest!==undefined);
    setWeekendWeekdayRest(
      member.weekendRest?.minimumWeekdayDaysOffOnFullWeekend??1);
    setFeedback(null);
    document.getElementById("team-name")?.focus();
  }

  function cancelEdit(){
    setEditingId(null);
    setName("");
    setRoleChoice("");
    setWeeklyDaysOff(null);
    setFixedDayOff(null);
    setWeekendRotation(false);
    setWeekendWeekdayRest(1);
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
                    <span className="team-days-off-summary">
                      Funções: {roleDescription(member.qualifiedRoles)}
                    </span>
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
                    {member.fixedDaysOff?.length?(
                      <span className="team-days-off-summary">
                        Folga fixa: {member.fixedDaysOff.map(day=>
                          WEEKDAYS.find(d=>d.id===day)?.label??day).join(", ")}
                      </span>
                    ):null}
                    {member.weekendRest&&<span className="team-days-off-summary">
                      Rotação de fins de semana completos ativa
                    </span>}
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
            <label htmlFor="team-qualified-roles">
              Funções que pode desempenhar
            </label>
            <select id="team-qualified-roles" name="qualifiedRoles"
              value={roleChoice}
              onChange={event=>{
                setRoleChoice(event.target.value as RoleChoice);
                setFeedback(null);
              }}>
              <option value="">Por definir (sem presumir competências)</option>
              <option value="checkout">Caixa</option>
              <option value="sales">Vendas</option>
              <option value="both">Caixa e Vendas</option>
            </select>
            <p className="team-field-help">
              Identifica as funções que o colaborador está habilitado a desempenhar.
              Esta informação ainda não atribui postos durante os turnos nem
              garante cobertura funcional. A distribuição por função será
              validada numa etapa posterior.
            </p>
            <label htmlFor="team-weekly-days-off">Dias de folga por semana</label>
            <select id="team-weekly-days-off" name="weeklyDaysOff"
              value={weeklyDaysOff===null?"":weeklyDaysOff}
              onChange={event=>{
                const next=event.target.value===""?null:Number(event.target.value);
                setWeeklyDaysOff(next);
                if(next===null){
                  setFixedDayOff(null);
                  setWeekendRotation(false);
                }else if(next===0)setFixedDayOff(null);
                setFeedback(null);
              }}>
              <option value="">Por definir (sem regra adicional)</option>
              {Array.from({length:7},(_,days)=>(
                <option key={days} value={days}>
                  {days} {days===1?"dia":"dias"}
                </option>
              ))}
            </select>
            <label htmlFor="team-fixed-rest">Folga fixa semanal (opcional)</label>
            <select id="team-fixed-rest" name="fixedRest" value={fixedDayOff??""}
              disabled={weeklyDaysOff===null||weeklyDaysOff===0}
              onChange={event=>{
                setFixedDayOff(event.target.value===""?null:event.target.value as Weekday);
                setFeedback(null);
              }}>
              <option value="">Sem dia fixo</option>
              {WEEKDAYS.map(weekday=><option key={weekday.id} value={weekday.id}>
                {weekday.label}
              </option>)}
            </select>
            <label className="team-rotation-toggle" htmlFor="team-weekend-rotation">
              <input id="team-weekend-rotation" name="weekendRotation"
                type="checkbox" checked={weekendRotation}
                disabled={weeklyDaysOff===null}
                onChange={event=>{
                  setWeekendRotation(event.target.checked);
                  setFeedback(null);
                }}/>
              <span>Participa na rotação de fins de semana completos</span>
            </label>
            {weekendRotation&&<>
              <label htmlFor="team-weekend-weekday-rest">
                Dias de descanso a preservar de segunda a sexta
                quando tiver sábado e domingo livres
              </label>
              <select id="team-weekend-weekday-rest" name="weekendWeekdayRest"
                value={weekendWeekdayRest}
                onChange={event=>{
                  setWeekendWeekdayRest(Number(event.target.value));
                  setFeedback(null);
                }}>
                {Array.from({length:6},(_,days)=><option key={days} value={days}>
                  {days} {days===1?"dia":"dias"}
                </option>)}
              </select>
            </>}
            <p className="team-field-help">
              A folga fixa é obrigatória. A rotação tenta distribuir fins de
              semana completos sem uma frequência fixa; normalmente mantém
              pelo menos uma folga de segunda a sexta mesmo nessa semana.
              Esta opção exige que as folgas habituais de todos os colaboradores
              ativos estejam configuradas. As horas são equilibradas em 28 dias.
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
