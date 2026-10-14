import { openDB } from "idb";
import { validateCatalog } from "./modules/catalog-validation";
import type { Photo, Project } from "./model";
import {
  photoChanges,
  type CommandRecord,
  type PhotoChange,
} from "./assistant/records";
export type CatalogEvent = { photos: Photo[]; projectId?: string };
const listeners = new Set<(event: CatalogEvent) => void>();
export const subscribeCatalog = (fn: (event: CatalogEvent) => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
export const emit = (photos: Photo[]) => {
  for (const listener of listeners) {
    try {
      listener({ photos });
    } catch (error) {
      console.error("Catalogue listener failed", error);
    }
  }
};
export const database = openDB("juno-studio-v1", 3, {
  upgrade(d, old, _next, tx) {
    if (old < 1) {
      d.createObjectStore("projects", { keyPath: "id" });
      d.createObjectStore("photos", { keyPath: "id" });
      d.createObjectStore("originals");
      d.createObjectStore("settings");
    }
    if (old < 2) {
      tx.objectStore("photos").createIndex("projectId", "projectId");
      d.createObjectStore("thumbnails");
      d.createObjectStore("jobs", { keyPath: "id" });
      const entries = d.createObjectStore("jobItems", {
        keyPath: ["jobId", "index"],
      });
      entries.createIndex("jobId", "jobId");
      // The version-change transaction migrates every thumbnail atomically.
      const cursor = tx.objectStore("photos").openCursor();
      void (async () => {
        let c = await cursor;
        while (c) {
          const p = c.value as Photo;
          if (p.thumbnail) {
            await tx.objectStore("thumbnails").put(p.thumbnail, p.id);
            await c.update({ ...p, thumbnail: "" });
          }
          c = await c.continue();
        }
      })();
    }
    if (old < 3) {
      const commands = d.createObjectStore("commands", { keyPath: "id" });
      commands.createIndex("projectId", "projectId");
      const changes = d.createObjectStore("commandChanges", {
        keyPath: ["commandId", "id"],
      });
      changes.createIndex("commandId", "commandId");
    }
  },
  blocked() {
    window.dispatchEvent(new Event("juno-database-blocked"));
  },
  blocking() {
    void database.then((d) => d.close());
  },
});
export async function getProjects(): Promise<Project[]> {
  return (await (await database).getAll("projects")).sort(
    (a, b) => a.created - b.created,
  );
}
export async function putProject(p: Project) {
  await (await database).put("projects", p);
}
export async function getPhotos(projectId?: string): Promise<Photo[]> {
  const db = await database;
  const ps =
    projectId === undefined
      ? await db.getAll("photos")
      : await db.getAllFromIndex("photos", "projectId", projectId);
  return ps.sort((a, b) => a.created - b.created);
}
export async function getPhoto(id: string): Promise<Photo | undefined> {
  return (await database).get("photos", id);
}
export async function getProjectCounts() {
  const db = await database;
  const projects = await getProjects();
  return Object.fromEntries(
    await Promise.all(
      projects.map(async (p) => [
        p.id,
        await db.countFromIndex("photos", "projectId", p.id),
      ]),
    ),
  );
}
export async function getThumbnail(id: string): Promise<string> {
  return (await (await database).get("thumbnails", id)) || "";
}
export async function hydratePhoto(p: Photo): Promise<Photo> {
  return { ...p, thumbnail: p.thumbnail || (await getThumbnail(p.id)) };
}
export async function putPhotos(ps: Photo[]) {
  const tx = (await database).transaction(
    ["photos", "thumbnails"],
    "readwrite",
  );
  for (const p of ps) {
    if (p.thumbnail) tx.objectStore("thumbnails").put(p.thumbnail, p.id);
    tx.objectStore("photos").put({ ...p, thumbnail: "" });
  }
  await tx.done;
  emit(ps.map((p) => ({ ...p, thumbnail: "" })));
}
export async function putPhoto(p: Photo) {
  await putPhotos([p]);
}
/**
 * Le nom d'une modification à la main dans l'historique : on doit savoir ce
 * qu'on annule. Tout s'appelait « Réglage manuel », si bien qu'annuler un
 * réglage pouvait défaire un tri sans le dire (relecture du 29/09/2026).
 */
function etiquetteManuelle(fields: { path: string }[]) {
  const quoi = new Set(
    fields.map((f) =>
      f.path.startsWith("adjustments.") ? "adjustments" : f.path,
    ),
  );
  if (quoi.size !== 1) return "Modification manuelle";
  const [seul] = quoi;
  return (
    (
      {
        adjustments: "Réglage manuel",
        status: "Tri",
        stars: "Étoiles",
        protected: "Protection",
        chapter: "Chapitre",
      } as Record<string, string>
    )[seul] ?? "Modification manuelle"
  );
}
export async function modifyPhoto(
  id: string,
  update: (p: Photo) => Photo,
): Promise<Photo> {
  return (await modifyPhotoBatch([{ id, update }]))[0];
}
/** Atomic, ordered writes share a transaction and preserve each photo's history. */
export async function modifyPhotoBatch(
  entries: { id: string; update: (p: Photo) => Photo }[],
): Promise<Photo[]> {
  const tx = (await database).transaction(
    ["photos", "commands", "commandChanges"],
    "readwrite",
  );
  try {
    const saved: Photo[] = [];
    for (const { id, update } of entries) {
      const old = (await tx.objectStore("photos").get(id)) as Photo | undefined;
      if (!old) throw Error("Photo introuvable.");
      const next = {
        ...update(structuredClone(old)),
        id: old.id,
        projectId: old.projectId,
        thumbnail: "",
        revision: (old.revision || 0) + 1,
      };
      const fields = photoChanges(old, next);
      if (fields.length) {
        // Un geste au curseur se regroupe en une seule entrée. La photo garde son
        // editGroup après le geste : le tri, les étoiles ou la protection qui
        // suivent ne doivent pas s'y fondre, sinon annuler le réglage les
        // annulerait aussi sans le dire.
        const geste =
          next.editGroup &&
          fields.every((f) => f.path.startsWith("adjustments."));
        const commandId = geste
          ? `gesture:${id}:${next.editGroup}`
          : crypto.randomUUID();
        const previous = (await tx.objectStore("commands").get(commandId)) as
          | CommandRecord
          | undefined;
        const prior = (await tx
          .objectStore("commandChanges")
          .get([commandId, id])) as PhotoChange | undefined;
        const merged = new Map((prior?.fields || []).map((f) => [f.path, f]));
        for (const f of fields)
          merged.set(f.path, {
            ...f,
            before: merged.has(f.path) ? merged.get(f.path)!.before : f.before,
          });
        await tx.objectStore("commandChanges").put({
          commandId,
          id,
          fields: [...merged.values()],
        } satisfies PhotoChange);
        await tx.objectStore("commands").put({
          id: commandId,
          projectId: old.projectId,
          label: etiquetteManuelle(fields) + " · " + old.name,
          source: "manual",
          created: previous?.created || Date.now(),
          updated: Date.now(),
          count: 1,
          state: "done",
        } satisfies CommandRecord);
      }
      await tx.objectStore("photos").put(next);
      saved.push(next);
    }
    await tx.done;
    emit(saved);
    return saved;
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
export async function putOriginal(id: string, blob: Blob) {
  await (await database).put("originals", blob, id);
}
export async function getOriginal(id: string): Promise<Blob> {
  const b = await (await database).get("originals", id);
  if (!b) throw Error("Original introuvable. Réimportez le fichier.");
  return b;
}
export async function getSetting(key: string) {
  return (await database).get("settings", key);
}
export async function setSetting(key: string, value: unknown) {
  return (await database).put("settings", value, key);
}
export async function restoreProject(project: Project, photos: Photo[]) {
  photos = validateCatalog(project, photos).photos;
  const tx = (await database).transaction(
    ["projects", "photos", "thumbnails"],
    "readwrite",
  );
  tx.objectStore("projects").add(project);
  for (const p of photos) {
    if (p.thumbnail) tx.objectStore("thumbnails").put(p.thumbnail, p.id);
    tx.objectStore("photos").add({ ...p, thumbnail: "" });
  }
  await tx.done;
  emit(photos.map((p) => ({ ...p, thumbnail: "" })));
}
