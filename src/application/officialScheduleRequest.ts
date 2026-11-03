/** Public request boundary for trusted official-schedule commands.
 * Only these identifiers and optimistic version are accepted from browsers.
 * Identity, the schedule draft, configuration and time come from the server.
 */
export type OfficialScheduleRequest =
  | {kind:"approve";candidateId:string;expectedVersion:number}
  | {kind:"replace";candidateId:string;replaceId:string;expectedVersion:number}
  | {kind:"cancel";scheduleId:string;expectedVersion:number};

function isObject(x:unknown):x is Record<string,unknown> {
  return !!x && typeof x==="object" && !Array.isArray(x);
}
export function parseOfficialScheduleRequest(
  raw:unknown
):OfficialScheduleRequest|null {
  if(!isObject(raw) ||
    !Number.isSafeInteger(raw.expectedVersion) ||
    (raw.expectedVersion as number)<0)return null;
  const kind=raw.kind;
  if(kind!=="approve"&&kind!=="replace"&&kind!=="cancel")return null;
  const allowed=kind==="cancel"?["kind","scheduleId","expectedVersion"]:
    kind==="replace"?["kind","candidateId","replaceId","expectedVersion"]:
    ["kind","candidateId","expectedVersion"];
  if(Object.keys(raw).some(key=>!allowed.includes(key)))return null;
  if(kind==="cancel")return typeof raw.scheduleId==="string"&&raw.scheduleId.trim()
    ?raw as OfficialScheduleRequest:null;
  if(typeof raw.candidateId!=="string"||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(raw.candidateId))
    return null;
  if(kind==="replace"&&
    (typeof raw.replaceId!=="string"||!raw.replaceId.trim()))return null;
  return raw as OfficialScheduleRequest;
}
