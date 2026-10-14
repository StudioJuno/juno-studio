import type { Person } from "./people";
/**
 * Who Juno recognises in a project, and who matters. Stored per project beside
 * the catalogue: naming the couple once changes every later sort.
 */
const key = (projectId: string) => "juno-people-" + projectId;
export function readPeople(projectId: string): Person[] {
  try {
    const raw = localStorage.getItem(key(projectId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const numbers = (v: unknown) =>
      Array.isArray(v) && v.every((n) => typeof n === "number");
    return parsed.filter(
      (p): p is Person =>
        !!p &&
        typeof p.id === "string" &&
        numbers(p.centre) &&
        (p.descriptor === undefined || numbers(p.descriptor)) &&
        typeof p.samples === "number",
    );
  } catch {
    return [];
  }
}
export function writePeople(projectId: string, people: Person[]) {
  try {
    // Bounded: an album of guests must not fill the browser storage.
    localStorage.setItem(key(projectId), JSON.stringify(people.slice(0, 200)));
  } catch {
    // Recognition is an aid, never a reason to fail a pass.
  }
}
export function namePerson(projectId: string, personId: string, name: string) {
  const people = readPeople(projectId).map((p) =>
    p.id === personId
      ? { ...p, name: name.trim().slice(0, 60) || undefined }
      : p,
  );
  writePeople(projectId, people);
  return people;
}
/** The people who should drive the sort: those the photographer named. */
export function priorityPeople(projectId: string) {
  return readPeople(projectId).filter((p) => p.name);
}
