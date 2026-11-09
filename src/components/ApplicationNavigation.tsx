import type { ReactNode } from "react";
export type WorkspaceSection="schedules"|"generator"|"calendar"|"presence"|"people"|"availability"|"workRules";
export type WorkspaceArea="schedules"|"operation"|"team"|"rules";
export const PRIMARY_NAV:Array<{id:WorkspaceArea;label:string;description:string;section:WorkspaceSection}>= [
  {id:"schedules",label:"Horários",description:"Calendário e propostas",section:"schedules"},
  {id:"operation",label:"Operação",description:"Funcionamento e cobertura",section:"calendar"},
  {id:"team",label:"Equipa",description:"Pessoas e disponibilidades",section:"people"},
  {id:"rules",label:"Regras",description:"Políticas e limites",section:"workRules"},
];
export const SECONDARY_NAV:Array<{section:WorkspaceSection;label:string;parent:WorkspaceArea}>= [
  {section:"calendar",label:"Calendário operacional",parent:"operation"},
  {section:"presence",label:"Presença mínima",parent:"operation"},
  {section:"people",label:"Colaboradores",parent:"team"},
  {section:"availability",label:"Disponibilidades",parent:"team"},
];
const ICONS:Record<WorkspaceArea,ReactNode>={
  schedules:<><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M8 15l2 2 4-4"/></>,
  operation:<><rect x="3" y="9" width="18" height="12" rx="2"/><path d="M3 9l2-6h14l2 6M9 21v-8h6v8"/></>,
  team:<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
  rules:<><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2" fill="currentColor" stroke="none"/><circle cx="16" cy="17" r="2" fill="currentColor" stroke="none"/></>,
};
export function areaFor(section:WorkspaceSection):WorkspaceArea {
  if(section==="generator"||section==="schedules")return "schedules";
  if(section==="calendar"||section==="presence")return "operation";
  if(section==="people"||section==="availability")return "team";
  return "rules";
}
export function sectionLabel(section:WorkspaceSection):string {
  if(section==="generator")return "Gerar horário";
  if(section==="workRules")return "Regras";
  if(section==="schedules")return "Calendário mensal";
  return SECONDARY_NAV.find(item=>item.section===section)?.label??"Horários";
}
export interface ApplicationNavigationProps {
  activeSection:WorkspaceSection;
  navigate(section:WorkspaceSection):void;
  mobileOpen:boolean;
  closeMobile():void;
}
export default function ApplicationNavigation({
  activeSection,navigate,mobileOpen,closeMobile,
}:ApplicationNavigationProps){
  const activeArea=areaFor(activeSection);
  const go=(section:WorkspaceSection)=>{navigate(section);closeMobile();};
  return <>
    {mobileOpen&&<button type="button" className="app-nav-scrim"
      aria-label="Fechar navegação" onClick={closeMobile}/>}
    <aside className={"application-sidebar"+(mobileOpen?" is-open":"")} aria-label="Navegação da aplicação">
      <div className="app-sidebar-brand">
        <span className="app-brand-mark" aria-hidden="true">SE</span>
        <div><strong>Schedule Engine</strong><small>Workspace</small></div>
        <button type="button" className="app-sidebar-close" aria-label="Fechar menu"
          onClick={closeMobile}>×</button>
      </div>
      <nav aria-label="Áreas principais" className="app-sidebar-navigation">
        <span className="app-sidebar-kicker">Áreas de trabalho</span>
        {PRIMARY_NAV.map(item=><div key={item.id} className="app-nav-group">
          <button type="button" className={"app-nav-link"+(activeArea===item.id?" active":"")}
            aria-current={activeArea===item.id?"page":undefined}
            onClick={()=>go(item.section)}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"
              strokeLinejoin="round" aria-hidden="true">{ICONS[item.id]}</svg>
            <span className="app-nav-copy"><strong>{item.label}</strong><small>{item.description}</small></span>
          </button>
          {activeArea===item.id&&SECONDARY_NAV.some(child=>child.parent===item.id)&&
            <div className="app-nav-children" aria-label={"Secções de "+item.label}>
              {SECONDARY_NAV.filter(child=>child.parent===item.id).map(child=>
                <button key={child.section} type="button"
                  className={"app-nav-child"+(activeSection===child.section?" active":"")}
                  aria-current={activeSection===child.section?"page":undefined}
                  onClick={()=>go(child.section)}>{child.label}</button>)}
            </div>}
          {activeArea==="schedules"&&item.id==="schedules"&&activeSection==="generator"&&
            <div className="app-nav-children">
              <button type="button" className="app-nav-child active"
                aria-current="page" onClick={()=>go("generator")}>Gerar horário</button>
            </div>}
        </div>)}
      </nav>
      <div className="app-sidebar-footer">
        <span className="app-sidebar-footer-dot" aria-hidden="true"/>
        <span>Dados protegidos por conta</span>
      </div>
    </aside>
  </>;
}
