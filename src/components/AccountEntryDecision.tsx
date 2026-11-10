import { useState } from "react";

export interface AccountEntryDecisionProps {
  onStartFresh():void;
  onImportConfirmed():void;
}

/**
 * Only used when a *verified empty cloud account* encounters unowned legacy
 * browser configuration. Remote records always take precedence in the repository.
 */
export default function AccountEntryDecision({onStartFresh,onImportConfirmed}:AccountEntryDecisionProps) {
  const [ownsData,setOwnsData]=useState(false);
  const [showDetails,setShowDetails]=useState(false);
  return <main className="entry-screen">
    <section className="entry-card" aria-labelledby="entry-title">
      <div className="entry-brand">
        <span className="entry-brand-symbol" aria-hidden="true">SE</span>
        <strong>Schedule Engine</strong>
      </div>
      <div className="entry-hero">
        <div className="entry-shield" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="25" height="25" fill="none" stroke="currentColor"
            strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>
            <path d="m9 12 2 2 4-4"/>
          </svg>
        </div>
        <span className="entry-eyebrow">CONFIGURAÇÃO INICIAL</span>
        <h1 id="entry-title">Como queres começar?</h1>
        <p>Encontrámos uma configuração antiga guardada neste navegador.
          Por segurança, não será associada à tua conta sem autorização.</p>
      </div>
      <div className="entry-options">
        <section className="entry-option entry-option-primary">
          <div className="entry-option-heading">
            <span className="entry-option-icon" aria-hidden="true">+</span>
            <h2>Começar com uma conta vazia</h2>
          </div>
          <p>Configura a tua operação e a tua equipa de raiz.
            Os dados antigos ficam preservados neste navegador e não serão importados.</p>
          <button type="button" className="entry-primary-button" onClick={onStartFresh}>
            Começar do zero
          </button>
        </section>
        <section className="entry-option">
          <div className="entry-option-heading">
            <span className="entry-option-icon" aria-hidden="true">↥</span>
            <h2>Importar dados existentes</h2>
          </div>
          <p>Recupera a configuração antiga apenas se tiveres a certeza de que te pertence.
            A importação será associada à conta com sessão iniciada.</p>
          <label className="entry-consent">
            <input type="checkbox" checked={ownsData} onChange={event=>setOwnsData(event.target.checked)}/>
            <span>Confirmo que sou o proprietário dos dados antigos deste navegador.</span>
          </label>
          <button type="button" className="entry-outline-button" disabled={!ownsData}
            onClick={onImportConfirmed}>Importar a minha configuração</button>
        </section>
      </div>
      <div className="entry-security">
        <span aria-hidden="true">●</span>
        <span>Nenhum dado será importado automaticamente.</span>
      </div>
      <button type="button" className="entry-details-toggle"
        aria-expanded={showDetails} aria-controls="entry-security-details"
        onClick={()=>setShowDetails(value=>!value)}>
        {showDetails?"Ocultar informações de segurança":"Como protegemos os teus dados?"}
      </button>
      <div id="entry-security-details" className="entry-details" hidden={!showDetails}>
        <p>Os dados locais não identificam de forma segura o proprietário.
          Começar do zero não os apaga. Importar requer a tua confirmação explícita.
          Se a conta já tiver configuração na cloud, essa configuração tem prioridade.</p>
      </div>
    </section>
  </main>;
}
