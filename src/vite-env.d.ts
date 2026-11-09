/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_OFFICIAL_APPROVAL_READY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
