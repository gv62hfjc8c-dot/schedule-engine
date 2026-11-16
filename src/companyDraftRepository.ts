import {validateCompanyIdentity, type CompanyIdentity} from "./companyIdentity";
import type {OrganizationSetupSnapshot} from "./entryRouting";

/**
 * Isolated local draft storage until an authenticated organisation repository
 * exists. This is NOT a cross-device/company account, cloud storage or
 * authoritative completion state. Never store passwords or personal data here.
 */
export const COMPANY_DRAFT_KEY="schedule-engine:v2:company-identity:v1";
const VERSION=1;

export interface KeyValueStorage {
  getItem(key:string):string|null;
  setItem(key:string,value:string):void;
}
export type CompanyDraftLoad =
  | {status:"loaded"; company:CompanyIdentity}
  | {status:"empty"|"invalid"|"unavailable";company:null};

export function loadCompanyDraft(storage:Pick<KeyValueStorage,"getItem">):CompanyDraftLoad {
  let raw:string|null;
  try{raw=storage.getItem(COMPANY_DRAFT_KEY);}
  catch{return {status:"unavailable",company:null};}
  if(raw===null)return {status:"empty",company:null};
  try{
    const parsed:unknown=JSON.parse(raw);
    if(!parsed || typeof parsed!=="object" || Array.isArray(parsed) ||
       (parsed as {version?:unknown}).version!==VERSION)
      return {status:"invalid",company:null};
    const identity=validateCompanyIdentity((parsed as {company?:unknown}).company);
    return identity.valid
      ? {status:"loaded",company:identity.company}
      : {status:"invalid",company:null};
  }catch{return {status:"invalid",company:null};}
}

export type CompanyDraftSave =
  | {ok:true;company:CompanyIdentity}
  | {ok:false;message:string};

export function saveCompanyDraft(
  storage:Pick<KeyValueStorage,"setItem">, input:unknown
):CompanyDraftSave {
  const validation=validateCompanyIdentity(input);
  if(!validation.valid)return {ok:false,message:validation.issues[0]};
  try{
    storage.setItem(COMPANY_DRAFT_KEY,
      JSON.stringify({version:VERSION,company:validation.company}));
    return {ok:true,company:validation.company};
  }catch{
    return {ok:false,message:"Não foi possível guardar os dados neste dispositivo."};
  }
}

/**
 * Use a validated local draft only for the current company section.
 * Other sections remain unvalidated, so the app cannot claim setup is done.
 * A storage failure is unknown—not an empty new account.
 */
export function companyDraftSetupSnapshot(
  loaded:CompanyDraftLoad
):OrganizationSetupSnapshot|null {
  if(loaded.status==="invalid" || loaded.status==="unavailable")return null;
  return loaded.status==="loaded"
    ? {checks:{company:"valid"}}
    : {checks:{}};
}
