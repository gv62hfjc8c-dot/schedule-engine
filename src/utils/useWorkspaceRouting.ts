import {useEffect,useState} from "react";
import type {WorkspaceSection} from "../components/ApplicationNavigation";
import {resolveWorkspaceRoute,workspacePath,type WorkspaceRoute} from "./workspaceRoutes";

/**
 * A tiny history adapter for the seven stable workspaces.
 * No package or backend dependency: Vite serves index.html on direct navigation.
 * The URL is the source of truth, including on popstate.
 */
export function useWorkspaceRouting(){
  const [route,setRoute]=useState<WorkspaceRoute>(()=>
    resolveWorkspaceRoute(window.location.pathname));
  useEffect(()=>{
    const canonical=resolveWorkspaceRoute(window.location.pathname);
    if(window.location.pathname!==canonical.path){
      window.history.replaceState(window.history.state,"",
        canonical.path+window.location.search+window.location.hash);
    }
    setRoute(canonical);
    const onPopState=()=>{
      const next=resolveWorkspaceRoute(window.location.pathname);
      if(window.location.pathname!==next.path)
        window.history.replaceState(window.history.state,"",
          next.path+window.location.search+window.location.hash);
      setRoute(next);
    };
    window.addEventListener("popstate",onPopState);
    return ()=>window.removeEventListener("popstate",onPopState);
  },[]);

  function navigate(section:WorkspaceSection,dayDate?:string|null){
    const path=workspacePath(section,dayDate);
    if(path===window.location.pathname)return;
    window.history.pushState({},"",path);
    setRoute(resolveWorkspaceRoute(path));
    window.scrollTo(0,0);
  }

  return {route,navigate};
}
