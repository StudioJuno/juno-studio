import { useState } from "react";
import { UserRound } from "lucide-react";
import type { Photo } from "../model";
import { rankPeople, type Person } from "./people";
import { namePerson, readPeople } from "./people-store";
import { faceEmbeddingFailure } from "./face-embed";
/**
 * Name the people who matter, once. Every later sort favours the frames where
 * they are sharp and their eyes are open.
 */
export default function PeoplePanel({
  projectId,
  photo,
  onChange,
}: {
  projectId: string;
  photo?: Photo;
  onChange?: (people: Person[]) => void;
}) {
  const [people, setPeople] = useState<Person[]>(() => readPeople(projectId));
  const [editing, setEditing] = useState("");
  const [draft, setDraft] = useState("");
  // People on this photo first: naming someone you are looking at is natural.
  const here = new Set(
    (photo?.analysis?.faces?.reads ?? [])
      .map((r) => r.personId)
      .filter((id): id is string => !!id),
  );
  const ordered = rankPeople(people).sort(
    (a, b) => Number(here.has(b.id)) - Number(here.has(a.id)),
  );
  const degraded = faceEmbeddingFailure();
  if (!ordered.length)
    return (
      <p className="micro-note">
        {degraded ||
          "Lancez une passe d’album pour que Juno repère les personnes de ce projet."}
      </p>
    );
  const save = (id: string, name: string) => {
    const next = namePerson(projectId, id, name);
    setPeople(next);
    onChange?.(next);
    setEditing("");
  };
  return (
    <div className="people-panel">
      {ordered.slice(0, 12).map((person) => (
        <div
          key={person.id}
          className={here.has(person.id) ? "person here" : "person"}
        >
          <UserRound size={13} />
          {editing === person.id ? (
            <input
              autoFocus
              aria-label="Nom de la personne"
              value={draft}
              maxLength={60}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => save(person.id, draft)}
              onKeyDown={(e) => {
                if (e.key === "Enter") save(person.id, draft);
                if (e.key === "Escape") setEditing("");
              }}
            />
          ) : (
            <button
              aria-label={
                person.name
                  ? "Renommer " + person.name
                  : "Nommer cette personne"
              }
              onClick={() => {
                setEditing(person.id);
                setDraft(person.name ?? "");
              }}
            >
              {person.name || "Sans nom"}
            </button>
          )}
          <small>{person.samples} photo(s)</small>
        </div>
      ))}
      <p className="micro-note">
        {degraded ||
          "Une personne nommée devient prioritaire dans le tri. La reconnaissance tourne entièrement sur cet ordinateur : vérifiez-la sur les profils et les visages qui se ressemblent beaucoup."}
      </p>
    </div>
  );
}
