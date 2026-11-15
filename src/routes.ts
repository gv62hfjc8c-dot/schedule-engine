/** Apenas a navegação da fundação. Nenhuma rota de geração está ativa. */
export type FoundationPage = "welcome" | "calendar" | "settings";

export function pageForPath(pathname: string): FoundationPage {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/horarios") return "calendar";
  if (path === "/configuracao") return "settings";
  return "welcome";
}

export function knownFoundationPath(pathname: string): boolean {
  return pathname === "/" || pathname === "/horarios" ||
    pathname === "/horarios/" || pathname === "/configuracao" ||
    pathname === "/configuracao/";
}
