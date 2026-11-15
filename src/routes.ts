/** Rotas atuais. O motor de geração ainda não existe na V2. */
export type FoundationPage = "welcome" | "calendar" | "settings" | "setup";

export function pageForPath(pathname: string): FoundationPage {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/horarios") return "calendar";
  if (path === "/configuracao") return "settings";
  if (path === "/configuracao/inicial") return "setup";
  return "welcome";
}

export function knownFoundationPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  return path === "/" || path === "/horarios" ||
    path === "/configuracao" || path === "/configuracao/inicial";
}
