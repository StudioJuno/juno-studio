import { database, emit } from "../db";
import type { Photo } from "../model";
import {
  estSuivi,
  photoChanges,
  readField,
  restoreFields,
  same,
  type CommandRecord,
  type PhotoChange,
} from "./records";

export async function photoHistory(
  projectId: string,
): Promise<CommandRecord[]> {
  return (
    (await (
      await database
    ).getAllFromIndex("commands", "projectId", projectId)) as CommandRecord[]
  )
    .filter((r) => r.count > 0)
    .sort((a, b) => b.updated - a.updated);
}

/** Metadata and edits commit together. A repeated execution ID never applies twice. */
export async function photoTransaction(
  input: {
    id: string;
    projectId: string;
    ids: string[];
    label: string;
    source: CommandRecord["source"];
    expected?: Record<string, number>;
    append?: boolean;
    jobId?: string;
  },
  update: (photo: Photo) => Photo,
) {
  const db = await database;
  const tx = db.transaction(
    ["photos", "commands", "commandChanges"],
    "readwrite",
  );
  const changed: Photo[] = [];
  try {
    const existing = (await tx.objectStore("commands").get(input.id)) as
      | CommandRecord
      | undefined;
    if (existing && !input.append) {
      await tx.done;
      return existing;
    }
    if (
      existing &&
      (existing.projectId !== input.projectId || existing.state !== "done")
    )
      throw Error(
        "Cette passe a été annulée. Lancez une nouvelle passe pour continuer.",
      );
    const ids = [...new Set(input.ids)];
    if (!ids.length || ids.length > 20000)
      throw Error("Sélection vide ou trop grande.");
    for (const id of ids) {
      if (
        input.append &&
        (await tx.objectStore("commandChanges").get([input.id, id]))
      )
        continue;
      const old = (await tx.objectStore("photos").get(id)) as Photo | undefined;
      if (!old || old.projectId !== input.projectId)
        throw Error("La sélection contient une photo absente de ce projet.");
      if (input.expected && input.expected[id] !== (old.revision || 0))
        throw Error(
          "La sélection a changé pendant la préparation. Relancez la commande : aucun changement appliqué.",
        );
      const next = update(structuredClone(old));
      const fields = photoChanges(old, next, true);
      if (!fields.length) continue;
      next.id = old.id;
      next.projectId = old.projectId;
      next.source = old.source;
      next.hash = old.hash;
      next.thumbnail = "";
      next.revision = (old.revision || 0) + 1;
      await tx.objectStore("photos").put(next);
      await tx
        .objectStore("commandChanges")
        .put({ commandId: input.id, id, fields } satisfies PhotoChange);
      changed.push(next);
    }
    const record: CommandRecord = {
      id: input.id,
      projectId: input.projectId,
      label: input.label.slice(0, 250),
      source: input.source,
      count: (existing?.count || 0) + changed.length,
      created: existing?.created || Date.now(),
      // `updated` date le dernier geste du photographe : c'est l'ordre du
      // journal, et la commande que vise « annule ». Chaque photo d'une passe
      // d'album la rafraîchissait, et « annule » tapé après « Garde » défaisait
      // la passe entière au lieu de « Garde ».
      updated: existing?.updated || Date.now(),
      state: "done",
      jobId: input.jobId,
    };
    await tx.objectStore("commands").put(record);
    await tx.done;
    emit(changed);
    return record;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* Transaction may already be aborted. */
    }
    await tx.done.catch(() => {});
    throw error;
  }
}

/** Undo only our fields; unrelated later edits survive. Conflicting photos are preserved. */
export async function restoreCommand(id: string, redo = false) {
  const tx = (await database).transaction(
    ["photos", "commands", "commandChanges", "jobs"],
    "readwrite",
  );
  try {
    const record = (await tx.objectStore("commands").get(id)) as
      | CommandRecord
      | undefined;
    if (!record) {
      await tx.done;
      throw Error("Commande introuvable.");
    }
    if (record.jobId) {
      const job = await tx.objectStore("jobs").get(record.jobId);
      if (job && ["running", "queued"].includes(job.state)) {
        await tx.done;
        throw Error(
          "Mettez cette passe en pause dans l’activité avant de l’annuler.",
        );
      }
    }
    const changes = (await tx
      .objectStore("commandChanges")
      .index("commandId")
      .getAll(id)) as PhotoChange[];
    const changed: Photo[] = [];
    let conflicts = 0;
    for (const change of changes) {
      if (!!change.undone !== redo) continue;
      const photo = (await tx.objectStore("photos").get(change.id)) as
        | Photo
        | undefined;
      if (
        !photo ||
        change.fields.some(
          (c) =>
            !estSuivi(c.path) &&
            !same(readField(photo, c.path), redo ? c.before : c.after),
        )
      ) {
        conflicts++;
        continue;
      }
      // La proposition et son drapeau d'apprentissage repartent à
      // l'annulation, et reviennent au rétablissement tels qu'ils étaient
      // au moment d'annuler, et non tels que la passe les avait posés : le
      // drapeau revenait à « pas encore appris », et Juno apprenait une
      // seconde fois la même correction (relecture du 29/09/2026).
      if (!redo)
        change.fields = change.fields.map((c) =>
          estSuivi(c.path)
            ? { ...c, after: structuredClone(readField(photo, c.path)) }
            : c,
        );
      const next = restoreFields(photo, change.fields, redo);
      next.revision = (photo.revision || 0) + 1;
      await tx.objectStore("photos").put(next);
      change.undone = !redo;
      await tx.objectStore("commandChanges").put(change);
      changed.push(next);
    }
    const undone = changes.filter((c) => c.undone).length;
    record.state =
      undone === changes.length && undone
        ? "undone"
        : undone
          ? "partial"
          : "done";
    record.undone = undone;
    record.updated = Date.now();
    await tx.objectStore("commands").put(record);
    await tx.done;
    emit(changed);
    return { count: changed.length, conflicts, record };
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* Already closed. */
    }
    await tx.done.catch(() => {});
    throw error;
  }
}
