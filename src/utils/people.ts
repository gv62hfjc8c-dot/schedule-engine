import type { Person } from "../types";

export function normalizePersonName(name: string): string {
  const normalized = name.trim().replace(/\s+/g, " ");

  if (!normalized) {
    throw new Error("O nome da pessoa é obrigatório.");
  }

  return normalized;
}

export function createPerson(id: string, name: string): Person {
  return {
    id,
    name: normalizePersonName(name),
    active: true,
  };
}

export function renamePerson(
  person: Person,
  name: string
): Person {
  return {
    ...person,
    name: normalizePersonName(name),
  };
}

export function setPersonActive(
  person: Person,
  active: boolean
): Person {
  return {
    ...person,
    active,
  };
}

export function getActivePeople(people: Person[]): Person[] {
  return people.filter((person) => person.active);
}
