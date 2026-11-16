import type {OrganizationSetupSnapshot} from "./entryRouting";
import type {CompanyDraftLoad} from "./companyDraftRepository";
import type {OpeningHoursDraftLoad} from "./openingHoursDraftRepository";

/**
 * Local, non-authoritative snapshot used to exercise the pure post-login
 * decision. Real account routing must later use server-validated data.
 */
export function localSetupSnapshot(
  company:CompanyDraftLoad,
  openingHours:OpeningHoursDraftLoad
):OrganizationSetupSnapshot|null {
  if (company.status==="invalid" || company.status==="unavailable" ||
      openingHours.status==="invalid" || openingHours.status==="unavailable")
    return null;
  const checks:OrganizationSetupSnapshot["checks"]={};
  if (company.status==="loaded")checks.company="valid";
  if (openingHours.status==="loaded")checks.operatingHours="valid";
  return {checks};
}
