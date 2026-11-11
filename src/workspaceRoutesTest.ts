import {resolveWorkspaceRoute,workspacePath,WORKSPACE_PATHS} from "./utils/workspaceRoutes";
import type {WorkspaceSection} from "./components/ApplicationNavigation";
function ensure(condition:boolean,message:string){if(!condition)throw Error(message);}

const expected:Record<WorkspaceSection,string>={
  schedules:"/horarios",
  generator:"/horarios/gerar",
  calendar:"/operacao",
  presence:"/operacao/cobertura",
  people:"/equipa",
  availability:"/equipa/disponibilidades",
  workRules:"/regras",
};
ensure(Object.keys(WORKSPACE_PATHS).length===7,"Exactly the seven real workspaces need routes.");
for(const [section,path] of Object.entries(expected) as Array<[WorkspaceSection,string]>){
  ensure(workspacePath(section)===path,"Wrong canonical route for "+section);
  const resolved=resolveWorkspaceRoute(path);
  ensure(resolved.section===section&&resolved.path===path&&resolved.recognized&&
    resolved.dayDate===null,"Route must round-trip without inventing a day: "+path);
  const trailing=resolveWorkspaceRoute(path+"/");
  ensure(trailing.path===path&&trailing.section===section,
    "Trailing slash must resolve safely: "+path);
}

for(const valid of ["2026-11-10","2028-02-29","2026-01-01"]){
  const path=workspacePath("schedules",valid);
  const result=resolveWorkspaceRoute(path);
  ensure(result.section==="schedules"&&result.dayDate===valid&&
    result.path===path&&result.recognized,"Date deep link must round-trip: "+valid);
}
for(const invalid of ["2026-02-29","2026-13-10","2026-11-31","2026-11-00"]){
  let rejected=false;
  try{workspacePath("schedules",invalid);}
  catch{rejected=true;}
  ensure(rejected,"Invalid date must never be encoded as a daily URL.");
  ensure(!resolveWorkspaceRoute("/horarios/"+invalid).recognized,
    "Invalid day path must not appear valid.");
}
ensure(resolveWorkspaceRoute("/").path==="/horarios",
  "The application root must resolve to the scheduling workspace.");
ensure(!resolveWorkspaceRoute("/random").recognized,
  "An unsupported address must be recognized as unknown.");
ensure(resolveWorkspaceRoute("/random").path==="/horarios",
  "Unknown addresses must return to a safe canonical workspace.");
console.log("Workspace routes: seven stable URLs, daily deep links and invalid-day guards PASS.");
