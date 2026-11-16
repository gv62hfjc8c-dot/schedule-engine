/** First onboarding domain concept: the name by which an organisation is known. */
export interface CompanyIdentity {
  name: string;
}

export type CompanyIdentityValidation =
  | { valid: true; company: CompanyIdentity; issues: [] }
  | { valid: false; company: null; issues: string[] };

export function validateCompanyIdentity(value: unknown): CompanyIdentityValidation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {valid:false,company:null,issues:["Indica o nome da empresa."]};
  }
  const name = (value as {name?:unknown}).name;
  if (typeof name !== "string") {
    return {valid:false,company:null,issues:["Indica o nome da empresa."]};
  }
  const trimmed=name.trim().replace(/\s+/gu," ").normalize("NFC");
  if (trimmed.length < 2) {
    return {valid:false,company:null,
      issues:["O nome da empresa deve ter pelo menos 2 caracteres."]};
  }
  if (trimmed.length > 120) {
    return {valid:false,company:null,
      issues:["O nome da empresa deve ter no máximo 120 caracteres."]};
  }
  if (/[\p{Cc}\p{Cf}]/u.test(trimmed)) {
    return {valid:false,company:null,
      issues:["O nome da empresa contém caracteres não permitidos."]};
  }
  return {valid:true,company:{name:trimmed},issues:[]};
}
