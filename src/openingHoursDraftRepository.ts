import {
  validateWeeklyOpeningHours,type WeeklyOpeningHours,
} from "./operatingHours";

export const OPENING_HOURS_DRAFT_KEY="schedule-engine:v2:opening-hours:v1";
const VERSION=1;
type ReadStorage=Pick<Storage,"getItem">;
type WriteStorage=Pick<Storage,"setItem">;

export type OpeningHoursDraftLoad =
  | {status:"loaded";value:WeeklyOpeningHours}
  | {status:"empty"|"invalid"|"unavailable";value:null};
export type OpeningHoursDraftSave =
  | {ok:true;value:WeeklyOpeningHours}
  | {ok:false;message:string};

/** Draft-only browser storage. Never a verified organisation account. */
export function loadOpeningHoursDraft(storage:ReadStorage):OpeningHoursDraftLoad {
  let raw:string|null;
  try {raw=storage.getItem(OPENING_HOURS_DRAFT_KEY);}
  catch {return {status:"unavailable",value:null};}
  if(raw===null)return {status:"empty",value:null};
  try {
    const parsed:unknown=JSON.parse(raw);
    if(!parsed || typeof parsed!=="object" || Array.isArray(parsed) ||
       (parsed as {version?:unknown}).version!==VERSION)
      return {status:"invalid",value:null};
    const checked=validateWeeklyOpeningHours(
      (parsed as {weeklyHours?:unknown}).weeklyHours
    );
    return checked.valid
      ? {status:"loaded",value:checked.value}
      : {status:"invalid",value:null};
  }catch {return {status:"invalid",value:null};}
}

export function saveOpeningHoursDraft(
  storage:WriteStorage,input:unknown
):OpeningHoursDraftSave {
  const checked=validateWeeklyOpeningHours(input);
  if(!checked.valid)return {ok:false,message:checked.issues[0]};
  try {
    storage.setItem(OPENING_HOURS_DRAFT_KEY,
      JSON.stringify({version:VERSION,weeklyHours:checked.value}));
    return {ok:true,value:checked.value};
  }catch {
    return {ok:false,message:"Não foi possível guardar os horários neste dispositivo."};
  }
}

export function loadOpeningHoursDraftFromBrowser():OpeningHoursDraftLoad {
  try{return loadOpeningHoursDraft(window.localStorage);}
  catch{return {status:"unavailable",value:null};}
}
export function saveOpeningHoursDraftToBrowser(
  input:unknown
):OpeningHoursDraftSave {
  try{return saveOpeningHoursDraft(window.localStorage,input);}
  catch{return {ok:false,message:"Não foi possível guardar os horários neste dispositivo."};}
}
