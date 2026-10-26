import { createLocalStorageStateRepository } from "./localStorageStateRepository";
import { createSupabaseStateRepository } from "./supabaseStateRepository";
import { supabaseAuthClient } from "./supabaseInstance";
import type { StateRepository } from "./stateRepository";

/**
 * Supabase is authoritative; localStorage is only read at first import.
 * No scheduling domain module references Supabase directly.
 */
export const appStateRepository: StateRepository = supabaseAuthClient
  ? createSupabaseStateRepository(
      supabaseAuthClient,
      createLocalStorageStateRepository(window.localStorage),
      window.localStorage
    )
  : {
      async load() {
        throw new Error("A ligação Supabase não está configurada.");
      },
      async save() {
        throw new Error("A ligação Supabase não está configurada.");
      },
    };
