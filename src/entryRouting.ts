/**
 * Post-authentication entry decision.
 *
 * Pure, deterministic and independent of React, the auth provider and storage.
 * The future onboarding validators must produce each section's outcome.
 * Visiting a page, or asserting a generic "setupComplete" flag, is not proof.
 */
export const SETUP_SECTIONS = [
  "company",
  "operatingHours",
  "team",
  "availability",
  "rules",
  "coverage",
] as const;

export type SetupSection = (typeof SETUP_SECTIONS)[number];
export type SectionValidation = "valid" | "invalid";
export interface OrganizationSetupSnapshot {
  /** A missing key means that the section contains no validated data yet. */
  checks: Partial<Record<SetupSection, SectionValidation>>;
}

export type EntryDecision =
  | { kind: "sign_in"; destination: "/"; nextSection: null }
  | { kind: "setup_unavailable"; destination: null; nextSection: null }
  | { kind: "first_access" | "resume_setup";
      destination: "/configuracao/inicial" | "/configuracao/funcionamento"; nextSection: SetupSection }
  | { kind: "calendar"; destination: "/horarios"; nextSection: null };

const knownSections = new Set<string>(SETUP_SECTIONS);

/**
 * A null snapshot means "not retrieved", never "a new account".
 * A concrete empty checks object means "no configuration recorded".
 * All required sections must have been independently validated as valid.
 */
export function decideEntryAfterLogin(input: {
  authenticated: boolean;
  setup: OrganizationSetupSnapshot | null;
}): EntryDecision {
  if (!input.authenticated)
    return { kind: "sign_in", destination: "/", nextSection: null };

  const checks = input.setup?.checks;
  if (!checks || typeof checks !== "object" || Array.isArray(checks))
    return { kind: "setup_unavailable", destination: null, nextSection: null };

  for (const [key, value] of Object.entries(checks)) {
    if (!knownSections.has(key) || (value !== "valid" && value !== "invalid"))
      return { kind: "setup_unavailable", destination: null, nextSection: null };
  }

  const nextSection = SETUP_SECTIONS.find(section => checks[section] !== "valid");
  if (!nextSection)
    return { kind: "calendar", destination: "/horarios", nextSection: null };

  const started = Object.keys(checks).length > 0;
  return {
    kind: started ? "resume_setup" : "first_access",
    destination: nextSection === "operatingHours" ? "/configuracao/funcionamento" : "/configuracao/inicial",
    nextSection,
  };
}
