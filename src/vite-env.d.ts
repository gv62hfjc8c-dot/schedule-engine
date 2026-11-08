/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_GENERATOR_28_DAY_READY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
