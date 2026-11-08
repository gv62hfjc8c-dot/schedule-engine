import { useEffect,useState } from "react";
import { supabaseAuthClient } from "../persistence/supabaseInstance";
import type { StoredGeneratedSchedule } from "../persistence/generatedScheduleRepository";

interface Props {
  proposal:StoredGeneratedSchedule;
}
interface Readiness {
  ready:boolean;
  alreadyApproved:boolean;
  version:number|null;
  historyStatus:string;
  message:string;
}
const enabled=import.meta.env.VITE_OFFICIAL_APPROVAL_READY==="true";

/**
 * Readiness is ALWAYS resolved by the authenticated server. A saved proposal
 * cannot be promoted by a client boolean or by marking an unknown history empty.
 * The rollout flag stays disabled until the Edge service and its history
 * attestation have been verified against real Supabase Auth sessions.
 */
export default function OfficialApprovalPanel({proposal}:Props){
  const [readiness,setReadiness]=useState<Readiness|null>(null);
  const [state,setState]=useState<"loading"|"blocked"|"ready"|"approved"|"saving"|"failed">(
    enabled?"loading":"blocked",
  );
  const [message,setMessage]=useState(
    enabled?"A verificar o histórico oficial no servidor.":
    "Aprovação oficial indisponível: é necessário integrar e certificar o histórico anterior.",
  );
  const [retry,setRetry]=useState(0);
  useEffect(()=>{
    if(!enabled||!supabaseAuthClient)return;
    const client=supabaseAuthClient;
    const owner=client.user?.id;
    let active=true;
    setState("loading");
    setReadiness(null);
    void client.request("/functions/v1/official-schedules-v2?candidate_id="+
      encodeURIComponent(proposal.id)).then(async response=>{
      const value:unknown=await response.json();
      if(!active||client.user?.id!==owner)return;
      if(!response.ok||!value||typeof value!=="object")
        throw Error("Não foi possível confirmar o estado oficial.");
      const ready=value as Partial<Readiness>;
      if(typeof ready.ready!=="boolean"||
         typeof ready.alreadyApproved!=="boolean"||
         (ready.version!==null&&!Number.isSafeInteger(ready.version))||
         typeof ready.message!=="string")
        throw Error("Resposta oficial incompleta.");
      const data:Readiness={
        ready:ready.ready,alreadyApproved:ready.alreadyApproved,
        version:ready.version??null,
        historyStatus:ready.historyStatus??"",
        message:ready.message,
      };
      setReadiness(data);
      setMessage(data.message);
      setState(data.alreadyApproved?"approved":data.ready?"ready":"blocked");
    }).catch(()=>{
      if(!active||client.user?.id!==owner)return;
      setState("failed");
      setMessage("Não foi possível consultar o serviço oficial. Não assumir aprovação.");
    });
    return()=>{active=false;};
  },[proposal.id,retry]);

  async function approve(){
    const client=supabaseAuthClient;
    const owner=client?.user?.id;
    const version=readiness?.version;
    if(!enabled||!client||!owner||state!=="ready"||
       typeof version!=="number"||!Number.isSafeInteger(version))return;
    if(!window.confirm("Aprovar oficialmente esta proposta? "+
      "A operação fica registada no histórico de versões."))return;
    setState("saving");
    try{
      const response=await client.request("/functions/v1/official-schedules-v2",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({kind:"approve",candidateId:proposal.id,
          expectedVersion:version}),
      });
      const value:unknown=await response.json();
      if(client.user?.id!==owner)throw Error("A sessão mudou durante o pedido.");
      if(!value||typeof value!=="object")throw Error("Resposta oficial inválida.");
      const result=value as {ok?:unknown;issues?:unknown;version?:unknown};
      if(!response.ok||result.ok!==true){
        const reasons=Array.isArray(result.issues)?result.issues
          .filter((v):v is string=>typeof v==="string"):[];
        throw Error(reasons[0]??"A aprovação não foi confirmada.");
      }
      // Success only after a real response from the trusted commit service.
      setState("approved");
      setMessage("Horário oficialmente aprovado e versionado no Supabase.");
      setReadiness({ready:false,alreadyApproved:true,
        version:typeof result.version==="number"?result.version:version+1,
        historyStatus:"approved",message:"Horário oficialmente aprovado."});
    }catch(error){
      setState("failed");
      setMessage(error instanceof Error?error.message:
        "Não foi possível confirmar a aprovação. Reconsulta o histórico.");
    }
  }
  return <section className="se-readonly-note" aria-label="Aprovação oficial">
    <strong>Aprovação oficial</strong>
    <p role="status">{message}</p>
    {enabled&&state==="ready"&&<button type="button" className="primary-button"
      onClick={()=>{void approve();}}>Aprovar horário oficialmente</button>}
    {enabled&&(state==="failed"||state==="blocked")&&
      <button type="button" className="se-outline"
        onClick={()=>setRetry(v=>v+1)}>Verificar novamente</button>}
  </section>;
}
