import {
  validateTeamRoster,type TeamRoster,
} from "./team";

export const TEAM_DRAFT_KEY="schedule-engine:v2:team:v1";
const VERSION=1;
type ReadStorage=Pick<Storage,"getItem">;
type WriteStorage=Pick<Storage,"setItem">;

export type TeamDraftLoad =
  | {status:"loaded";value:TeamRoster}
  | {status:"empty"|"invalid"|"unavailable";value:null};
export type TeamDraftSave =
  | {ok:true;value:TeamRoster}
  | {ok:false;message:string};

/**
 * Local-only onboarding draft, with no company- or account-level isolation.
 * It must never become the authoritative personnel database. Do not add
 * contact, salary, absence, health or other sensitive fields here.
 */
export function loadTeamDraft(storage:ReadStorage):TeamDraftLoad {
  let raw:string|null;
  try {raw=storage.getItem(TEAM_DRAFT_KEY);}
  catch {return {status:"unavailable",value:null};}
  if(raw===null)return {status:"empty",value:null};
  try {
    const parsed:unknown=JSON.parse(raw);
    if(!parsed || typeof parsed!=="object" || Array.isArray(parsed) ||
       (parsed as {version?:unknown}).version!==VERSION)
      return {status:"invalid",value:null};
    const checked=validateTeamRoster((parsed as {team?:unknown}).team);
    return checked.valid
      ? {status:"loaded",value:checked.value}
      : {status:"invalid",value:null};
  }catch {return {status:"invalid",value:null};}
}

export function saveTeamDraft(storage:WriteStorage,input:unknown):TeamDraftSave {
  const checked=validateTeamRoster(input);
  if(!checked.valid)return {ok:false,message:checked.issues[0]};
  try {
    storage.setItem(TEAM_DRAFT_KEY,
      JSON.stringify({version:VERSION,team:checked.value}));
    return {ok:true,value:checked.value};
  }catch {
    return {ok:false,message:"Não foi possível guardar a equipa neste dispositivo."};
  }
}

export function loadTeamDraftFromBrowser():TeamDraftLoad {
  try {return loadTeamDraft(window.localStorage);}
  catch {return {status:"unavailable",value:null};}
}
export function saveTeamDraftToBrowser(input:unknown):TeamDraftSave {
  try {return saveTeamDraft(window.localStorage,input);}
  catch {return {ok:false,message:"Não foi possível guardar a equipa neste dispositivo."};}
}
