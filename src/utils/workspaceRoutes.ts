import type {WorkspaceSection} from "../components/ApplicationNavigation";

export const WORKSPACE_PATHS:Readonly<Record<WorkspaceSection,string>> = {
  schedules:"/horarios",
  generator:"/horarios/gerar",
  calendar:"/operacao",
  presence:"/operacao/cobertura",
  people:"/equipa",
  availability:"/equipa/disponibilidades",
  workRules:"/regras",
};

export interface WorkspaceRoute {
  section:WorkspaceSection;
  /** Present only for the dedicated daily management page. */
  dayDate:string|null;
  /** Resolved, canonical path; unknown URLs resolve to /horarios. */
  path:string;
  recognized:boolean;
}

function isCivilDate(value:string):boolean {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const parsed=new Date(value+"T12:00:00Z");
  return Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0,10)===value;
}

export function workspacePath(section:WorkspaceSection,dayDate?:string|null):string {
  if(section==="schedules"&&dayDate!==null&&dayDate!==undefined){
    if(!isCivilDate(dayDate))throw Error("Data inválida para uma rota diária.");
    return "/horarios/"+dayDate;
  }
  return WORKSPACE_PATHS[section];
}

export function resolveWorkspaceRoute(pathname:string):WorkspaceRoute {
  const path=pathname.replace(/\/+$/,"")||"/";
  const dateMatch=/^\/horarios\/(\d{4}-\d{2}-\d{2})$/.exec(path);
  if(dateMatch && isCivilDate(dateMatch[1]))
    return {section:"schedules",dayDate:dateMatch[1],path,recognized:true};
  for(const [section,canonical] of Object.entries(WORKSPACE_PATHS) as Array<[WorkspaceSection,string]>){
    if(path===canonical)
      return {section,dayDate:null,path:canonical,recognized:true};
  }
  // Root and unknown paths remain safe: no silent data loading from an
  // arbitrary date, and no dead-end page after refreshing an old bookmark.
  return {section:"schedules",dayDate:null,path:WORKSPACE_PATHS.schedules,
    recognized:path==="/"};
}
