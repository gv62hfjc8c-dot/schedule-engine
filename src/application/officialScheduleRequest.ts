/** Browser requests carry intent only. The server loads current state and
 * creates full validated replacement snapshots; clients cannot write ledgers.
 */
import type { AbsenceReason } from "../utils/approvedSchedules";

export type OfficialScheduleRequest =
  | {kind:"approve";candidateId:string;expectedVersion:number}
  | {kind:"replace";candidateId:string;replaceId:string;expectedVersion:number}
  | {kind:"cancel";scheduleId:string;expectedVersion:number}
  | {kind:"revise";sourceId:string;expectedVersion:number;
      personId:string;startDate:string;endDate:string;
      reason:AbsenceReason;note?:string;
      replacements:{date:string;personId:string}[]};

function isObject(x:unknown):x is Record<string,unknown> {
  return x!==null && typeof x==="object" && !Array.isArray(x);
}
const validUuid=(id:unknown):id is string=>typeof id==="string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id);
const validDate=(d:unknown):d is string=>{
  if(typeof d!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(d))return false;
  const v=Date.parse(d+"T00:00:00Z");
  return Number.isFinite(v)&&new Date(v).toISOString().slice(0,10)===d;
};
const reasons:AbsenceReason[]=[
  "sick_leave","vacation","leave","accident","departure","other",
];
export function parseOfficialScheduleRequest(raw:unknown):OfficialScheduleRequest|null {
  if(!isObject(raw)||!Number.isSafeInteger(raw.expectedVersion)||
    (raw.expectedVersion as number)<0)return null;
  const kind=raw.kind;
  if(kind!=="approve"&&kind!=="replace"&&kind!=="cancel"&&
    kind!=="revise")return null;
  const allowed=kind==="cancel"?["kind","scheduleId","expectedVersion"]:
    kind==="replace"?["kind","candidateId","replaceId","expectedVersion"]:
    kind==="revise"?["kind","sourceId","expectedVersion","personId",
      "startDate","endDate","reason","note","replacements"]:
      ["kind","candidateId","expectedVersion"];
  if(Object.keys(raw).some(key=>!allowed.includes(key)))return null;
  if(kind==="cancel")return typeof raw.scheduleId==="string"&&
    Boolean(raw.scheduleId.trim())?raw as OfficialScheduleRequest:null;
  if(kind==="revise"){
    if(typeof raw.sourceId!=="string"||!raw.sourceId.trim()||
      typeof raw.personId!=="string"||!raw.personId.trim()||
      !validDate(raw.startDate)||!validDate(raw.endDate)||
      raw.startDate>raw.endDate||
      (Date.parse(raw.endDate)-Date.parse(raw.startDate))/86400000>27||
      !reasons.includes(raw.reason as AbsenceReason)||
      (raw.note!==undefined&&(typeof raw.note!=="string"||
        raw.note.length>240))||
      !Array.isArray(raw.replacements)||raw.replacements.length>28)return null;
    const dates=new Set<string>();
    for(const value of raw.replacements){
      if(!isObject(value)||Object.keys(value).some(k=>!["date","personId"].includes(k))||
        !validDate(value.date)||value.date<raw.startDate||
        value.date>raw.endDate||typeof value.personId!=="string"||
        !value.personId.trim()||dates.has(value.date))return null;
      dates.add(value.date);
    }
    return raw as OfficialScheduleRequest;
  }
  if(!validUuid(raw.candidateId))return null;
  if(kind==="replace"&&(typeof raw.replaceId!=="string"||
    !raw.replaceId.trim()))return null;
  return raw as OfficialScheduleRequest;
}
