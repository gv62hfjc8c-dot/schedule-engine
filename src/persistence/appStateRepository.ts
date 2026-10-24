import { createDatabaseStateRepository } from "./databaseStateRepository";
import { createLocalStorageStateRepository } from "./localStorageStateRepository";

/**
 * SQLite on the existing Vite server is authoritative.
 * Browser localStorage is only used on the first database import.
 */
export const appStateRepository = createDatabaseStateRepository(
  window.fetch.bind(window),
  createLocalStorageStateRepository(window.localStorage),
  window.localStorage
);
