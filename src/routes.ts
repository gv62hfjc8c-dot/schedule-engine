/** Rotas V2. O gerador mensal utiliza a página de calendário existente. */
export type FoundationPage = "welcome" | "calendar" | "settings" | "setup" | "operatingHours" | "team";

export function pageForPath(pathname: string): FoundationPage {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/horarios") return "calendar";
  if (path === "/configuracao") return "settings";
  if (path === "/configuracao/inicial") return "setup";
  if (path === "/configuracao/funcionamento") return "operatingHours";
  if (path === "/configuracao/equipa") return "team";
  return "welcome";
}

export function knownFoundationPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  return path === "/" || path === "/horarios" ||
    path === "/configuracao" || path === "/configuracao/inicial" ||
    path === "/configuracao/funcionamento" ||
    path === "/configuracao/equipa";
}
