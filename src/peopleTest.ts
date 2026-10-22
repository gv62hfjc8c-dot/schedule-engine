import type { Person } from "./types";
import {
  createPerson,
  getActivePeople,
  normalizePersonName,
  renamePerson,
  setPersonActive,
} from "./utils/people";

const person = createPerson("p1", "  Ana   Silva  ");

if (
  person.id !== "p1" ||
  person.name !== "Ana Silva" ||
  person.active !== true
) {
  throw new Error("Pessoa não foi criada corretamente");
}

const renamed = renamePerson(person, "Ana Costa");

if (renamed.name !== "Ana Costa") {
  throw new Error("Pessoa não foi renomeada corretamente");
}

const archived = setPersonActive(renamed, false);

if (archived.active !== false) {
  throw new Error("Pessoa não foi arquivada corretamente");
}

const people: Person[] = [
  person,
  archived,
  createPerson("p2", "Bruno"),
];

const active = getActivePeople(people);

if (active.length !== 2) {
  throw new Error("Filtro de pessoas ativas falhou");
}

let emptyNameRejected = false;

try {
  normalizePersonName("   ");
} catch {
  emptyNameRejected = true;
}

if (!emptyNameRejected) {
  throw new Error("Nome vazio deveria ser rejeitado");
}

console.log("People V0: todos os testes passaram.");
