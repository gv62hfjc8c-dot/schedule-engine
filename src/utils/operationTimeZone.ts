/** One operational calendar and one IANA zone; never infer from the browser. */
export const DEFAULT_OPERATION_TIME_ZONE = "Atlantic/Azores";
export function isIanaOperationTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try { new Intl.DateTimeFormat("en-GB",{timeZone:value}); return true; }
  catch { return false; }
}
export function resolveOperationTimeZone(saved: string | undefined): string {
  return isIanaOperationTimeZone(saved) ? saved : DEFAULT_OPERATION_TIME_ZONE;
}
