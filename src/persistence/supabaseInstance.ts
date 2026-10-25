import {
  getSupabaseConfig,
  SupabaseAuthClient,
} from "./supabaseAuth";

let configurationError: string | null = null;
let configuredClient: SupabaseAuthClient | null = null;

try {
  const config = getSupabaseConfig();
  if (config) {
    configuredClient = new SupabaseAuthClient(
      config,
      window.fetch.bind(window),
      window.localStorage
    );
  }
} catch (error) {
  configurationError = error instanceof Error
    ? error.message
    : "Configuração Supabase inválida.";
}

export const supabaseAuthClient = configuredClient;
export const supabaseConfigurationError = configurationError;
