import type {OrganizationSetupSnapshot} from "./entryRouting";
import type {CompanyDraftLoad} from "./companyDraftRepository";
import type {OpeningHoursDraftLoad} from "./openingHoursDraftRepository";
import type {TeamDraftLoad} from "./teamDraftRepository";
import {teamIsReady} from "./team";

/**
 * Local, non-authoritative snapshot used to exercise the pure post-login
 * decision. A real account must use independently verified server data.
 */
export function localSetupSnapshot(
  company:CompanyDraftLoad,
  openingHours:OpeningHoursDraftLoad,
  team:TeamDraftLoad
):OrganizationSetupSnapshot|null {
  if (company.status==="invalid" || company.status==="unavailable" ||
      openingHours.status==="invalid" || openingHours.status==="unavailable" ||
      team.status==="invalid" || team.status==="unavailable")
    return null;
  const checks:OrganizationSetupSnapshot["checks"]={};
  if (company.status==="loaded")checks.company="valid";
  if (openingHours.status==="loaded")checks.operatingHours="valid";
  if (team.status==="loaded")
    checks.team=teamIsReady(team.value) ? "valid" : "invalid";
  return {checks};
}
