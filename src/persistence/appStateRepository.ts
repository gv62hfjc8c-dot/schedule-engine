import { createLocalStorageStateRepository } from "./localStorageStateRepository";

export const appStateRepository =
  createLocalStorageStateRepository(window.localStorage);
