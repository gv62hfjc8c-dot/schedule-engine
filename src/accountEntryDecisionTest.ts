import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import AccountEntryDecision from "./components/AccountEntryDecision";

function check(value:boolean,message:string){if(!value)throw Error(message);}
const markup=renderToStaticMarkup(createElement(AccountEntryDecision,{
  onStartFresh:()=>{},onImportConfirmed:()=>{},
}));
check(markup.includes("Como queres começar?"),"First-use screen must show a decision, not an error.");
check(markup.includes("Começar do zero"),"Fresh-account option must be prominent.");
check(markup.includes("Importar a minha configuração"),"Import option must remain available.");
check(/type="checkbox"[^>]*\/?>/.test(markup),"Import requires a separate explicit ownership checkbox.");
check(/disabled=""[^>]*>Importar a minha configuração/.test(markup),
  "Import action must be disabled until separate ownership consent.");
check(!markup.includes("Não foi possível sincronizar"),"A first-use decision is not a sync error.");
check(markup.includes("Nenhum dado será importado automaticamente."),
  "Safety invariant must be visible.");
console.log("PR59 initial account decision: fresh priority, explicit consent and safe messaging PASS.");
