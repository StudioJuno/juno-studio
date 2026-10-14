import { same } from "../assistant/records";
import {
  database,
  getPhoto,
  getPhotos,
  getThumbnail,
  putPhoto,
  putOriginal,
  getOriginal,
  modifyPhoto,
} from "../db";
import {
  uid,
  DEFAULT,
  STYLES,
  chaptersFor,
  editPhoto,
  autoSettings,
  type Analysis,
  type Photo,
  type Project,
} from "../model";
import {
  inspect,
  inspectPhoto,
  inspectionSource,
  fingerprint,
  exportPhoto,
  sourceBlob,
  download,
  avecRendu,
  besoinRendu,
  mesurerRendu,
} from "../image";
import {
  analyzeFaces,
  withFaces,
  groupSuggestions,
  raisonsDePasse,
  VERSION_VISAGES,
} from "./culling";
import { comparableSharpness } from "./quality";
import { correctionDe, VERSION_NIVEAU } from "./level";
import { VERSION_EMPREINTE } from "./rafales";
import {
  autoTone,
  ecartDuRendu,
  profilPorte,
  renduDe,
  sceneGroups,
  sansExposition,
  sceneSettings,
  sensible,
} from "./auto-tone";
import { readProfile } from "./style-profile";
import { aimForLook, combineLook } from "./look";
import { embedImages, semanticAvailable } from "./semantic";
import { thumbnailBitmap } from "./thumbnail-bitmap";
import { readLook } from "./look-store";
import { readXmpProfile } from "./xmp-store";
import { clusterFaces, type FaceInput } from "./people";
import { priorityPeople, readPeople, writePeople } from "./people-store";
import { laneCount } from "./image-client";
import JSZip from "jszip";
import { PhotoError, photoFailure, type PhotoFailure } from "./image-errors";
import { nativePhoto, supportedPhoto } from "./raster";
import { photoTransaction } from "../assistant/journal";
import { VERSION_JUNO } from "../workbench/version";
export type JobState =
  | "queued"
  | "running"
  | "paused"
  | "interrupted"
  | "done"
  | "failed"
  | "cancelled";
export type Job = {
  id: string;
  kind: "import" | "analyze" | "export" | "balance" | "album";
  label: string;
  projectId: string;
  projectName: string;
  state: JobState;
  total: number;
  cursor: number;
  created: number;
  updated: number;
  errors: { index: number; name: string; message: string }[];
  errorCount: number;
  skipped: number;
  resolvedCount?: number;
  options: any;
};
let snapshot: Job[] = [],
  started: Promise<void> | undefined,
  working = false,
  diskBlocked = false;
const listeners = new Set<(jobs: Job[]) => void>(),
  controls = new Map<string, "pause" | "cancel">();
export const subscribeJobs = (fn: (jobs: Job[]) => void) => {
  listeners.add(fn);
  fn(snapshot);
  return () => {
    listeners.delete(fn);
  };
};
const terminal = (j: Job) => ["done", "cancelled"].includes(j.state);
/**
 * Assign every detected face of an album to a person, so the sort can favour
 * the ones the photographer named. Runs on signatures already computed with
 * the faces: no extra model, no second pass over the pixels.
 */
async function identifyPeople(projectId: string, photos: Photo[]) {
  const faces: FaceInput[] = [];
  for (const photo of photos)
    (photo.analysis?.faces?.reads ?? []).forEach((read, index) => {
      // Un visage déjà rattaché l'est pour de bon : le refusionner à chaque
      // passe doublait le compte « N photo(s) » de chaque personne et figeait
      // son centre (relecture du 29/09/2026). Seuls les nouveaux visages sont
      // comparés aux personnes connues.
      if (read.personId) return;
      if (read.signature?.length || read.descriptor?.length)
        faces.push({
          id: photo.id + ":" + index,
          signature: read.signature,
          descriptor: read.descriptor,
          turned: read.turned,
        });
    });
  if (!faces.length) return;
  const { people, assignment } = clusterFaces(faces, readPeople(projectId));
  writePeople(projectId, people);
  for (const photo of photos) {
    const reads = photo.analysis?.faces?.reads;
    if (!reads?.length) continue;
    const next = reads.map((read, index) => ({
      ...read,
      personId: assignment.get(photo.id + ":" + index) ?? read.personId,
    }));
    if (next.some((r, i) => r.personId !== reads[i].personId))
      await modifyPhoto(photo.id, (latest) =>
        latest.analysis?.faces
          ? {
              ...latest,
              analysis: {
                ...latest.analysis,
                faces: { ...latest.analysis.faces, reads: next },
              },
            }
          : latest,
      );
  }
}
export const remainingErrors = (j: Job) =>
  Math.max(0, (j.errorCount || 0) - (j.resolvedCount || 0));
export type JobIssue = {
  index: number;
  name: string;
  id: string;
  size: number;
  source: string;
  hash?: string;
  failure: PhotoFailure;
  attempts: any[];
  resolvedBy?: string;
};
/**
 * L'image sur laquelle chercher les visages : celle d'analyse, de 1 024 px.
 *
 * La vignette de 480 px ne suffit pas : mesuré sur 950 photos de mariage, un
 * sourire plissé y passait pour des yeux fermés dans près d'une alerte sur
 * deux. On prend l'image déjà décodée par le préchargement quand il l'a,
 * sinon on la redemande ; la vignette ne sert qu'en dernier recours.
 */
async function imageVisages(
  p: Photo,
  ready?: { vision?: ImageBitmap; visionSource?: number },
): Promise<{ image: string | ImageBitmap; source?: number }> {
  if (ready?.vision) return { image: ready.vision, source: ready.visionSource };
  try {
    const r = await inspectPhoto(p, "background", "", true);
    if (r.vision) return { image: r.vision, source: r.visionSource };
  } catch {
    // L'original manque (disque débranché) : la vignette vaut mieux que rien.
  }
  return { image: p.thumbnail || (await getThumbnail(p.id)) };
}
/** Les visages d'une photo, lus sur la meilleure image disponible. */
async function lireVisages(p: Photo, ready?: { vision?: ImageBitmap; visionSource?: number }) {
  const v = await imageVisages(p, ready);
  return analyzeFaces(v.image, v.source);
}
/**
 * L'inclinaison, pour une photo analysée avant qu'on sache la mesurer : prise
 * du préchargement s'il l'a, sinon d'une nouvelle lecture. Un échec ne coûte
 * que la proposition de redressement, jamais la photo.
 */
async function avecNiveau(
  p: Photo,
  a: Analysis,
  ready?: { analysis?: Analysis },
): Promise<Analysis> {
  if (a.level?.version === VERSION_NIVEAU) return a;
  try {
    const level =
      ready?.analysis?.level?.version === VERSION_NIVEAU
        ? ready.analysis.level
        : (await inspectPhoto(p)).analysis
            .level;
    return level ? { ...a, level } : a;
  } catch {
    return a;
  }
}
/**
 * Les mesures venues après la première analyse d'une photo (inclinaison,
 * empreinte de rafale) : prises du préchargement s'il les a, sinon d'une
 * seule nouvelle lecture pour les deux. Un échec ne coûte que ce qu'elles
 * apportent, jamais la photo.
 */
async function avecMesures(
  p: Photo,
  a: Analysis,
  ready?: { analysis?: Analysis },
): Promise<Analysis> {
  const niveau = a.level?.version === VERSION_NIVEAU,
    rafale = a.empreinte?.version === VERSION_EMPREINTE;
  if (niveau && rafale) return a;
  try {
    const r = ready?.analysis;
    const neuve =
      r &&
      (niveau || r.level?.version === VERSION_NIVEAU) &&
      (rafale || r.empreinte?.version === VERSION_EMPREINTE)
        ? r
        : (await inspectPhoto(p)).analysis;
    return {
      ...a,
      ...(!niveau && neuve.level ? { level: neuve.level } : {}),
      ...(!rafale && neuve.empreinte ? { empreinte: neuve.empreinte } : {}),
      // La case la plus nette (29/09/2026), prise au passage de la relecture.
      ...(a.nettetePointe === undefined && neuve.nettetePointe !== undefined
        ? { nettetePointe: neuve.nettetePointe }
        : {}),
    };
  } catch {
    return a;
  }
}
/**
 * Mesurer l'inclinaison des photos qui ne l'ont pas encore, avant une
 * consigne « redresse ». Rend la nouvelle révision de chaque photo touchée,
 * pour que la commande qui suit ne croie pas à une modification concurrente.
 */
export async function mesurerNiveaux(ids: string[]) {
  const revisions: Record<string, number> = {};
  for (const id of ids) {
    const p = await getPhoto(id);
    if (!p?.analysis || p.analysis.level?.version === VERSION_NIVEAU) continue;
    const { level } = await avecNiveau(p, p.analysis);
    if (!level) continue;
    const next = await modifyPhoto(p.id, (latest) =>
      latest.analysis
        ? { ...latest, analysis: { ...latest.analysis, level } }
        : latest,
    );
    revisions[id] = next.revision || 0;
  }
  return revisions;
}
/**
 * Une photo convertie par FFmpeg (HEIC, PSD, JPEG XL…) analysée avant le
 * 29/09/2026 l'a été sur une image NOIRE (compression TIFF 32946 ignorée par
 * UTIF). Une vraie photo n'a jamais une luminosité et une netteté exactement
 * nulles : c'est la signature de ce défaut.
 */
export function convertieEnNoir(p: Photo) {
  return (
    nativePhoto(p.name) &&
    p.analysis?.brightness === 0 &&
    p.analysis?.sharpness === 0
  );
}
/** Refaire vignette et analyse d'une photo décodée en noir ; les autres passent. */
async function reparerConversion(p: Photo): Promise<Photo> {
  if (!convertieEnNoir(p)) return p;
  try {
    const r = await inspectPhoto(p);
    r.vision?.close();
    await (await database).put("thumbnails", r.thumbnail, p.id);
    // Une analyse neuve, sans visages : la passe les relira.
    return await modifyPhoto(p.id, (latest) => ({
      ...latest,
      analysis: r.analysis,
      capturedAt: latest.capturedAt ?? r.capturedAt,
    }));
  } catch {
    // L'original manque : la photo garde son analyse, la passe continue.
    return p;
  }
}
/** Le redressement que la passe d'album pose d'elle-même : le palier sûr seulement. */
export function redressementAuto(a: Analysis | undefined) {
  const straighten = correctionDe(a?.level, ["auto"]);
  return straighten ? { straighten } : {};
}
export async function jobIssues(id: string): Promise<JobIssue[]> {
  await startJobs();
  const job = snapshot.find((j) => j.id === id);
  if (!job) return [];
  const entries = await (
    await database
  ).getAllFromIndex("jobItems", "jobId", id);
  return entries
    .filter((e) => e.result === "error")
    .map((e) => ({
      index: e.index,
      name: e.payload.name || e.payload.id,
      id: e.payload.id,
      size: e.payload.size,
      source: e.payload.source,
      hash: e.sourceHash,
      failure:
        e.failure ||
        photoFailure(
          Error(
            job.errors.find((x) => x.index === e.index)?.message ||
              "Erreur d’importation enregistrée dans une version précédente.",
          ),
        ),
      attempts: e.attempts || [],
      resolvedBy: e.resolvedBy,
    }));
}
const retryLocks = new Set<string>();
export async function retryJobFailures(id: string, index?: number) {
  await startJobs();
  if (retryLocks.has(id)) return;
  const job = snapshot.find((j) => j.id === id);
  if (!job || job.kind !== "import") throw Error("Importation introuvable.");
  if (["running", "queued"].includes(job.state))
    throw Error("Attendez la fin de cette importation.");
  if (
    snapshot.some(
      (j) =>
        j.options.retryOf === id &&
        ["running", "queued", "paused", "interrupted"].includes(j.state),
    )
  )
    throw Error(
      "Une reprise de cette importation existe déjà dans les tâches.",
    );
  retryLocks.add(id);
  try {
    const entries = await (
      await database
    ).getAllFromIndex("jobItems", "jobId", id);
    const failed = entries.filter(
      (e) =>
        e.result === "error" &&
        !e.resolvedBy &&
        (index === undefined || e.index === index),
    );
    if (!failed.length) throw Error("Aucun fichier en échec à reprendre.");
    const project = await (await database).get("projects", job.projectId);
    if (!project) throw Error("Le projet a été supprimé.");
    return await enqueueJob(
      "import",
      project,
      failed.map((e) => ({
        ...e.payload,
        sourceHash: e.sourceHash,
        retryOrigin: { jobId: id, index: e.index },
      })),
      { ...job.options, retryOf: id },
    );
  } finally {
    retryLocks.delete(id);
  }
}
async function resolveRetry(
  origin: { jobId: string; index: number },
  by: string,
) {
  const db = await database,
    entry = await db.get("jobItems", [origin.jobId, origin.index]);
  if (!entry || entry.resolvedBy) return;
  await db.put("jobItems", {
    ...entry,
    resolvedBy: by,
    resolvedAt: Date.now(),
  });
  const parent = snapshot.find((j) => j.id === origin.jobId);
  if (parent) {
    const all = await db.getAllFromIndex("jobItems", "jobId", parent.id);
    await publish({
      ...parent,
      resolvedCount: all.filter((e) => e.result === "error" && e.resolvedBy)
        .length,
    });
  }
  if (entry.payload.retryOrigin)
    await resolveRetry(entry.payload.retryOrigin, by);
}
export async function exportJobReport(id: string) {
  const job = snapshot.find((j) => j.id === id);
  if (!job) throw Error("Tâche introuvable.");
  const issues = await jobIssues(id);
  const report = {
    schema: 1,
    application: "Juno Studio",
    version: VERSION_JUNO,
    generatedAt: new Date().toISOString(),
    job: {
      id: job.id,
      project: job.projectName,
      total: job.total,
      processed: job.cursor,
      errors: job.errorCount,
      resolved: job.resolvedCount || 0,
      state: job.state,
    },
    files: await Promise.all(
      issues.map(async (issue) => ({
        ...issue,
        location: window.juno?.importSourceInfo
          ? await window.juno
              .importSourceInfo(issue.id)
              .catch((e) => ({ error: e.message }))
          : undefined,
      })),
    ),
  };
  const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: "application/json",
    }),
    name = "Juno-diagnostic-import-" + id + ".json";
  if (window.juno) await window.juno.saveFile(name, await blob.arrayBuffer());
  else await download(blob, name);
}
async function publish(job: Job) {
  job.updated = Date.now();
  await (await database).put("jobs", job);
  snapshot = [job, ...snapshot.filter((j) => j.id !== job.id)].sort(
    (a, b) => b.created - a.created,
  );
  for (const fn of listeners) {
    try {
      fn(snapshot);
    } catch (e) {
      console.error("Job listener", e);
    }
  }
}
export function startJobs() {
  return (started ??= (async () => {
    snapshot = ((await (await database).getAll("jobs")) as Job[]).sort(
      (a, b) => b.created - a.created,
    );
    for (const job of snapshot) {
      if (job.state === "running" || job.state === "queued") {
        job.state = "interrupted";
        await (await database).put("jobs", job);
      }
    }
    for (const fn of listeners) {
      try {
        fn(snapshot);
      } catch (e) {
        console.error("Job listener", e);
      }
    }
  })());
}
/**
 * La première retouche d'une photo : balance, exposition, style Lightroom,
 * puis style appris, posé en dernier par autoTone (voir learnProfile).
 */
function proposition(a: Analysis, options: any) {
  return autoTone(
    a,
    a.cast
      ? { cast: a.cast, brightness: a.brightness, clipped: a.clipped }
      : undefined,
    options.styleProfile,
    options.xmpProfile,
  );
}
/**
 * Les réglages de chaque photo, ramenés vers la médiane de sa scène : deux
 * cents images d'un vin d'honneur ne doivent pas dériver dans huit sens.
 * Calculés sur les analyses complètes, rendu des RAW compris.
 */
function harmoniser(photos: Photo[], options: any) {
  const proposals = new Map<string, ReturnType<typeof autoTone>>();
  for (const p of photos)
    if (p.analysis) proposals.set(p.id, proposition(p.analysis, options));
  const harmonised: Record<string, ReturnType<typeof autoTone>> = {};
  const analyses = new Map(photos.map((p) => [p.id, p.analysis]));
  for (const scene of sceneGroups(photos)) {
    const members = scene.filter((id) => proposals.has(id));
    const tuned = sceneSettings(
      members.map((id) => proposals.get(id)!),
      undefined,
      members.map((id) => ecartDuRendu(analyses.get(id))),
      // Une photo sensible garde son exposition : la scène ne la tire pas.
      members.map((id) => sensible(analyses.get(id))),
    );
    members.forEach((id, i) => (harmonised[id] = tuned[i]));
  }
  return harmonised;
}
export async function enqueueJob(
  kind: Job["kind"],
  project: Project,
  items: any[],
  options: any = {},
) {
  await startJobs();
  if (kind === "album") {
    if (!STYLES.some((s) => s.id === options.style))
      throw Error("Choisissez un style Juno disponible.");
    if (
      snapshot.some(
        (j) =>
          j.kind === "album" &&
          j.projectId === project.id &&
          ["queued", "running", "paused", "interrupted"].includes(j.state),
      )
    )
      throw Error(
        "Une passe d’album existe déjà. Reprenez-la ou annulez-la dans l’activité.",
      );
    const requested = new Set(items.map((i) => i.id));
    const photos = (await getPhotos(project.id)).filter((p) =>
      requested.has(p.id),
    );
    if (!photos.length)
      throw Error("Cet album ne contient aucune photo à traiter.");
    const frozen = photos.map((p) => ({
      id: p.id,
      name: p.name,
      adjustments: JSON.stringify(p.adjustments),
      status: p.status,
      alreadyEdited: !same(p.adjustments, DEFAULT),
    }));
    items = [
      ...frozen.map((p) => ({ ...p, phase: "analyze" })),
      ...frozen.map((p) => ({ ...p, phase: "retouch" })),
    ];
    // One first pass per photo, then harmonised inside each scene so a whole
    // moment keeps the same look instead of drifting frame by frame.
    const profile = readProfile();
    // Le style appris des vraies retouches Lightroom, s'il y en a un. Il se
    // pose après la mesure de l'image, jamais à sa place.
    const xmpProfile = readXmpProfile();
    // Le rendu appris des photos livrées ne vise que la couleur : la mesure a
    // montré que viser la tonalité dégradait le résultat.
    const lookProfile = readLook();
    // La visée de chaque scène (sceneSettings) n'est plus calculée ici mais au
    // début de la retouche, sur les analyses que la passe vient de compléter :
    // calculée à l'avance, elle reposait pour un RAW sur l'aperçu intégré, et
    // l'emportait ensuite sur la mesure du rendu (voir harmoniser).
    options = {
      ...options,
      photoCount: photos.length,
      photoIds: photos.map((p) => p.id),
      localOnly: true,
      cloudSpentCents: 0,
      budgetCents: 500,
      styleProfile: profile,
      xmpProfile,
      lookProfile,
    };
  }
  const job: Job = {
    id: uid(),
    kind,
    label: {
      import: "Importation",
      analyze: "Analyse locale",
      export: "Exportation",
      balance: "Équilibrage",
      album: "Album · analyse puis retouche locale",
    }[kind],
    projectId: project.id,
    projectName: project.name,
    state: "queued",
    total: items.length,
    cursor: 0,
    created: Date.now(),
    updated: Date.now(),
    errors: [],
    errorCount: 0,
    skipped: 0,
    options,
  };
  const tx = (await database).transaction(["jobs", "jobItems"], "readwrite");
  if (kind === "album") {
    const existing = (await tx.objectStore("jobs").getAll()) as Job[];
    if (
      existing.some(
        (j) =>
          j.kind === "album" &&
          j.projectId === project.id &&
          ["queued", "running", "paused", "interrupted"].includes(j.state),
      )
    ) {
      tx.abort();
      await tx.done.catch(() => {});
      throw Error("Une passe d’album existe déjà. Reprenez-la dans Activité.");
    }
  }
  tx.objectStore("jobs").add(job);
  items.forEach((payload, index) =>
    tx.objectStore("jobItems").add({ jobId: job.id, index, payload }),
  );
  await tx.done;
  await publish(job);
  void pump();
  return job.id;
}
export async function controlJob(
  id: string,
  action: "pause" | "resume" | "cancel",
) {
  const job = snapshot.find((j) => j.id === id);
  if (!job || terminal(job)) return;
  if (job.state === "running") {
    controls.set(id, action === "cancel" ? "cancel" : "pause");
    return;
  }
  if (action === "resume") {
    if (job.kind === "album") {
      const command = await (await database).get("commands", "album:" + job.id);
      if (command && command.state !== "done")
        throw Error(
          "Cette passe a été annulée dans l’historique. Rétablissez-la ou annulez la tâche avant de lancer une nouvelle passe.",
        );
    }
    controls.delete(id);
    await publish({ ...job, state: "queued" });
    diskBlocked = false;
    void pump();
  } else {
    if (action === "cancel" && job.options.folder)
      await window.juno?.finishExport(job.options.folder);
    await publish({
      ...job,
      state: action === "cancel" ? "cancelled" : "paused",
    });
  }
}
export async function clearFinishedJobs() {
  const done = snapshot.filter((j) => terminal(j) && !remainingErrors(j)),
    db = await database;
  const tx = db.transaction(["jobs", "jobItems"], "readwrite");
  for (const job of done) {
    tx.objectStore("jobs").delete(job.id);
    let c = await tx.objectStore("jobItems").index("jobId").openCursor(job.id);
    while (c) {
      await c.delete();
      c = await c.continue();
    }
  }
  await tx.done;
  const removed = new Set(done.map((j) => j.id));
  snapshot = snapshot.filter((j) => !removed.has(j.id));
  for (const fn of listeners) {
    try {
      fn(snapshot);
    } catch (e) {
      console.error("Job listener", e);
    }
  }
}
async function pump() {
  if (working || diskBlocked) return;
  const next = [...snapshot].reverse().find((j) => j.state === "queued");
  if (!next) return;
  working = true;
  let job = { ...next, state: "running" as JobState };
  try {
    await publish(job);
    const hashes = new Set(
      job.kind === "import"
        ? (await getPhotos(job.projectId)).map((p) => p.hash)
        : [],
    );
    const zip =
      job.kind === "export" && !job.options.folder ? new JSZip() : undefined;
    // Browser ZIPs cannot resume midway without retaining all encoded images.
    if (zip) job.cursor = 0;
    // Look ahead over the worker lanes: analysing photo N + 1 while photo N is
    // being written costs nothing and fills the pool the queue now offers.
    const lookahead =
      job.kind === "analyze" || job.kind === "album" ? laneCount() : 0;
    const prefetched = new Map<number, Promise<any>>();
    // Une image d'analyse préchargée et jamais servie tient un ImageBitmap :
    // le rendre à la mémoire quand on l'abandonne.
    const oublier = (key: number) => {
      void prefetched.get(key)?.then((r) => r?.vision?.close?.());
      prefetched.delete(key);
    };
    const prefetchFrom = async (start: number) => {
      if (!lookahead) return;
      // Garder l'élément en cours (start - 1) : il est lu juste après cet
      // appel. L'effacer jetait tout le préchargement, et chaque photo était
      // décodée deux fois (relecture du 29/09/2026).
      for (const key of [...prefetched.keys()])
        if (key < start - 1) oublier(key);
      for (let i = start; i < Math.min(job.total, start + lookahead); i++) {
        if (prefetched.has(i)) continue;
        prefetched.set(
          i,
          (async () => {
            const ahead = await (await database).get("jobItems", [job.id, i]);
            const payload = ahead?.payload;
            if (!payload?.id || payload.phase === "retouch") return undefined;
            const photo = await getPhoto(payload.id);
            if (!photo || convertieEnNoir(photo)) return undefined;
            const visages =
              !!job.options.faces &&
              photo.analysis?.faces?.version !== VERSION_VISAGES;
            // Le rendu de Juno d'un RAW, mesuré par la passe d'album : ici, il
            // se fait sur les voies libres, pendant qu'une autre photo s'écrit.
            const rendu = job.kind === "album" && besoinRendu(photo);
            if (
              comparableSharpness(photo.analysis, photo.width, photo.height) &&
              !visages &&
              photo.analysis?.level?.version === VERSION_NIVEAU &&
              photo.analysis?.empreinte?.version === VERSION_EMPREINTE
            )
              return rendu ? { rendu: await mesurerRendu(photo) } : undefined;
            return await inspectPhoto(photo, "background", "", visages, rendu);
            // A prefetch failure is never fatal: the ordered pass will retry
            // the same photo and report the real error.
          })().catch(() => undefined),
        );
      }
    };
    while (job.cursor < job.total) {
      const control = controls.get(job.id);
      if (control) {
        controls.delete(job.id);
        job.state = control === "cancel" ? "cancelled" : "paused";
        break;
      }
      const entry = await (
        await database
      ).get("jobItems", [job.id, job.cursor]);
      if (!entry) throw Error("Élément de tâche introuvable.");
      const item = entry.payload;
      void prefetchFrom(job.cursor + 1);
      let result = "done";
      try {
        if (job.kind === "import") {
          if (!supportedPhoto(item.name))
            throw new PhotoError({
              code: "UNSUPPORTED_FORMAT",
              stage: "format",
              message:
                "Ce format n’est pas pris en charge par le moteur photo.",
              technical: "Extension : " + item.name.split(".").pop(),
              retryable: false,
            });
          if (
            item.source?.startsWith("juno://") &&
            window.juno?.secureImportSource
          ) {
            const secured = await window.juno.secureImportSource({
              id: item.id,
              hash: entry.sourceHash || item.sourceHash,
            });
            entry.sourceHash = secured.hash;
            entry.managed = true;
            item.size = secured.size;
            await (await database).put("jobItems", entry);
          }
          const blob =
            item.blob ||
            (item.source === "idb"
              ? await getOriginal(item.id)
              : await fetch(item.source).then((r) => {
                  if (!r.ok) throw Error("Original indisponible.");
                  return r.blob();
                }));
          const hash = await fingerprint(blob);
          if (
            (entry.sourceHash || item.sourceHash) &&
            (entry.sourceHash || item.sourceHash) !== hash
          )
            throw Error("Le fichier source a changé depuis la copie vérifiée.");
          entry.sourceHash = hash;
          await (await database).put("jobItems", entry);
          if (hashes.has(hash)) job.skipped++;
          else {
            let meta: Awaited<ReturnType<typeof inspect>> | undefined;
            for (let attempt = 0; attempt < 2; attempt++) {
              try {
                meta = await inspect(
                  await inspectionSource(item, blob),
                  item.name,
                  "background",
                  item.id + ":" + hash,
                  false,
                  // Un HEIC est décodé depuis sa conversion : l'EXIF est dans l'original.
                  nativePhoto(item.name) ? blob : undefined,
                );
                break;
              } catch (error) {
                const failure = photoFailure(error, "decode");
                entry.attempts = [
                  ...(entry.attempts || []),
                  { at: Date.now(), failure },
                ];
                await (await database).put("jobItems", entry);
                if (!failure.retryable || attempt === 1) throw error;
              }
            }
            if (!meta) throw Error("Le moteur n’a pas renvoyé de résultat.");
            const p: Photo = {
              id: item.id,
              name: item.name,
              size: item.size,
              source: item.source,
              projectId: job.projectId,
              ...meta,
              hash,
              status: "pending",
              stars: 0,
              protected: false,
              chapter: chaptersFor(job.options.kind)[1],
              adjustments: { ...DEFAULT },
              history: [],
              created: job.created + job.cursor,
            };
            if (item.source === "idb") await putOriginal(p.id, blob);
            await putPhoto(p);
            hashes.add(hash);
          }
          if (item.retryOrigin) await resolveRetry(item.retryOrigin, job.id);
        } else if (job.kind === "analyze") {
          let p = await getPhoto(item.id);
          if (!p) throw Error("Photo introuvable.");
          p = await reparerConversion(p);
          const ready = await prefetched.get(job.cursor);
          let a =
            (comparableSharpness(p.analysis, p.width, p.height)
              ? p.analysis
              : undefined) ||
            ready?.analysis ||
            (await inspectPhoto(p)).analysis;
          a = await avecMesures(p, a, ready);
          if (job.options.faces && a.faces?.version !== VERSION_VISAGES)
            a = withFaces(a, await lireVisages(p, ready));
          await modifyPhoto(p.id, (latest) => ({ ...latest, analysis: a }));
        } else if (job.kind === "album") {
          let p = await getPhoto(item.id);
          if (!p || p.projectId !== job.projectId)
            throw Error("Photo introuvable dans cet album.");
          if (item.phase === "analyze") {
            p = await reparerConversion(p);
            const ready = await prefetched.get(job.cursor);
            let a =
              (comparableSharpness(p.analysis, p.width, p.height)
                ? p.analysis
                : undefined) ||
              ready?.analysis ||
              (await inspectPhoto(p))
                .analysis;
            a = await avecMesures(p, a, ready);
            if (job.options.faces && a.faces?.version !== VERSION_VISAGES) {
              try {
                a = withFaces(a, await lireVisages(p, ready));
              } catch (error) {
                a = {
                  ...a,
                  advice: "review",
                  reasons: [
                    ...a.reasons,
                    "Visages non vérifiés : " + (error as Error).message,
                  ],
                };
              }
            }
            // Un RAW : mesurer ce que Juno rend vraiment, pour que l'exposition
            // automatique vise le fichier exporté et non l'aperçu du boîtier.
            a = await avecRendu(p, a, ready);
            await modifyPhoto(p.id, (latest) => ({ ...latest, analysis: a }));
            // Le résumé de sens, pour chercher plus tard en français. C'est un
            // plus : s'il échoue, la passe d'album continue sans lui.
            if (job.options.semantic !== false && !p.semantic && semanticAvailable())
              try {
                const vignette = p.thumbnail || (await getThumbnail(p.id));
                if (vignette) {
                  const bitmap = await thumbnailBitmap(vignette);
                  const [vecteur] = await embedImages([bitmap]);
                  if (vecteur)
                    await modifyPhoto(p.id, (latest) => ({
                      ...latest,
                      semantic: Float32Array.from(vecteur),
                    }));
                }
              } catch {
                // La recherche par le sens ne bloque jamais une passe d'album.
              }
          } else {
            if (!job.options.grouped) {
              const targets = new Set(job.options.photoIds as string[]);
              const album = (await getPhotos(job.projectId)).filter(
                (p) => targets.has(p.id) && p.analysis,
              );
              await identifyPeople(job.projectId, album);
              const ranked = groupSuggestions(
                (await getPhotos(job.projectId)).filter(
                  (p) => targets.has(p.id) && p.analysis,
                ),
                priorityPeople(job.projectId).map((p) => p.id),
              );
              for (const candidate of ranked)
                if (candidate.analysis)
                  await modifyPhoto(candidate.id, (latest) => ({
                    ...latest,
                    analysis: {
                      ...latest.analysis!,
                      groupId: candidate.analysis!.groupId,
                      verdict: candidate.analysis!.verdict,
                      suggested: candidate.analysis!.suggested,
                      // Refaites avec les personnes désignées, comme le verdict.
                      reasons: candidate.analysis!.reasons,
                      advice: candidate.analysis!.advice,
                    },
                  }));
              job.options = {
                ...job.options,
                grouped: true,
                sceneSettings: harmoniser(
                  (await getPhotos(job.projectId)).filter(
                    (p) => targets.has(p.id) && p.analysis,
                  ),
                  job.options,
                ),
              };
              p = (await getPhoto(item.id))!;
            }
            const commandId = "album:" + job.id;
            const done = await (
              await database
            ).get("commandChanges", [commandId, p.id]);
            if (!done) {
              if (
                p.status === "reject" ||
                p.protected ||
                item.alreadyEdited ||
                JSON.stringify(p.adjustments) !== item.adjustments ||
                p.status !== item.status
              )
                job.skipped++;
              else {
                if (!p.analysis)
                  throw Error(
                    "L’analyse de cette photo n’a pas abouti ; sa retouche est à reprendre.",
                  );
                const a = p.analysis;
                const sensitive = sensible(a);
                // White balance, exposure, then the learned style of the house.
                const correction =
                  job.options.sceneSettings?.[p.id] ??
                  proposition(a, job.options);
                // Puis la couleur du rendu appris, ajoutée à la balance des
                // blancs déjà calculée, jamais posée à sa place. Pour un RAW,
                // l'écart se mesure sur le rendu de Juno : c'est lui qui sort.
                const look = renduDe(a)?.look ?? a.look;
                const vise =
                  look && job.options.lookProfile
                    ? combineLook(
                        correction,
                        aimForLook(look, job.options.lookProfile),
                      )
                    : correction;
                // L'inclinaison, seulement quand les lignes sont sûres : une
                // erreur de redressement se voit plus qu'une absence.
                const droit = redressementAuto(a);
                await photoTransaction(
                  {
                    id: commandId,
                    projectId: job.projectId,
                    ids: [p.id],
                    label: "Album · première retouche Juno",
                    source: "recipe",
                    append: true,
                    jobId: job.id,
                    expected: { [p.id]: p.revision || 0 },
                  },
                  (latest) => ({
                    ...editPhoto(
                      latest,
                      {
                        ...vise,
                        ...droit,
                        style: job.options.style,
                        intensity: 100,
                      },
                      commandId,
                    ),
                    // Remember the proposal so a later correction teaches Juno.
                    proposal: { ...vise, ...droit },
                    // Et le style appris qu'elle porte : l'habitude du
                    // photographe, c'est ce style plus sa correction. Toutes
                    // les photos de la passe portent celui de son lancement,
                    // qui aura changé quand on les corrigera.
                    // Une photo sensible ne porte pas l'exposition apprise
                    // (voir autoTone) : son profil porté non plus.
                    proposalProfile: sensitive
                      ? sansExposition(profilPorte(job.options.styleProfile))
                      : profilPorte(job.options.styleProfile),
                    proposalLearned: false,
                    status:
                      latest.status === "pending"
                        ? a.suggested && a.advice !== "review"
                          ? "keep"
                          : "pending"
                        : latest.status,
                  }),
                );
                const review = raisonsDePasse(a, sensitive);
                await modifyPhoto(p.id, (latest) => ({
                  ...latest,
                  analysis: {
                    ...latest.analysis!,
                    advice: review.length ? "review" : "normal",
                    reasons: review,
                  },
                }));
              }
            }
          }
        } else if (job.kind === "balance") {
          const p = await getPhoto(item.id);
          if (!p) throw Error("Photo introuvable.");
          const a = await avecRendu(
            p,
            p.analysis || (await inspectPhoto(p)).analysis,
          );
          // Skip photos edited since this batch was requested.
          if (JSON.stringify(p.adjustments) !== item.adjustments) job.skipped++;
          else
            await modifyPhoto(p.id, (latest) =>
              JSON.stringify(latest.adjustments) === item.adjustments
                ? editPhoto(
                    latest,
                    autoTone(
                      a,
                      a.cast
                        ? {
                            cast: a.cast,
                            brightness: a.brightness,
                            clipped: a.clipped,
                          }
                        : undefined,
                      job.options.styleProfile,
                    ),
                  )
                : latest,
            );
        } else {
          const p = item as Photo,
            blob = await exportPhoto(
              p,
              job.options.format,
              job.options.size,
              job.options.quality,
            );
          const name = exportName(p, job.cursor, job.options.format);
          if (job.options.folder)
            await window.juno!.writeExport(
              job.options.folder,
              name,
              await blob.arrayBuffer(),
            );
          else zip!.file(name, blob);
        }
      } catch (e) {
        result = "error";
        const failure = photoFailure(e);
        let message = failure.message;
        entry.failure = failure;
        if (failure.code === "DISK_SPACE") job.state = "paused";
        // Un export arrêté par un disque plein reprend à cette même photo :
        // « Reprendre » passait à la suivante et la photo manquait au dossier
        // livré. Elle n'est donc pas comptée en échec, et le message parle
        // d'export, pas d'importation.
        if (failure.code === "DISK_SPACE" && job.kind === "export") {
          result = "";
          message =
            "Espace disque insuffisant pour écrire l’export. Libérez de la place sur le disque de destination, puis reprenez l’export dans l’activité : il repartira de cette photo.";
        } else job.errorCount++;
        if (job.errors.length < 100)
          job.errors.push({
            index: job.cursor,
            name: item.name || item.id,
            message: message.slice(0, 300),
          });
      }
      // Reprise après un disque plein : la photo est passée, son avertissement
      // n'a plus lieu d'être.
      if (job.kind === "export" && result === "done")
        job.errors = job.errors.filter((x) => x.index !== job.cursor);
      if (result)
        await (
          await database
        ).put("jobItems", {
          ...entry,
          result,
          payload:
            job.kind === "import" && result === "done"
              ? { ...item, blob: undefined }
              : item,
        });
      if (result) job.cursor++;
      await publish({ ...job });
      if (job.state === "paused") break;
      await new Promise((r) => setTimeout(r, 0));
    }
    for (const key of [...prefetched.keys()]) oublier(key);
    if (job.state === "running") {
      if (job.kind === "analyze") {
        const photos = await getPhotos(job.projectId);
        await identifyPeople(job.projectId, photos);
        const ranked = groupSuggestions(
          await getPhotos(job.projectId),
          priorityPeople(job.projectId).map((p) => p.id),
        );
        for (const p of ranked)
          if (p.analysis)
            await modifyPhoto(p.id, (latest) => ({
              ...latest,
              analysis: latest.analysis
                ? {
                    ...latest.analysis,
                    groupId: p.analysis!.groupId,
                    verdict: p.analysis!.verdict,
                    suggested:
                      latest.status !== "reject" && p.analysis!.suggested,
                    // Refaites avec les personnes désignées, comme le verdict.
                    reasons: p.analysis!.reasons,
                    advice: p.analysis!.advice,
                  }
                : p.analysis,
            }));
      }
      if (job.kind === "export") {
        const entries = await (
          await database
        ).getAllFromIndex("jobItems", "jobId", job.id);
        const manifest = JSON.stringify(
          {
            schema: 3,
            projectId: job.projectId,
            projectName: job.projectName,
            colorSpace: "sRGB",
            created: new Date(job.created).toISOString(),
            total: job.total,
            errorCount: entries.filter((e) => e.result === "error").length,
            errors: entries
              .filter((e) => e.result === "error")
              .map((e) => ({ index: e.index, name: e.payload.name })),
            photos: entries
              .filter((e) => e.result === "done")
              .map((e) => ({
                id: e.payload.id,
                name: exportName(e.payload, e.index, job.options.format),
                adjustments: e.payload.adjustments,
                hash: e.payload.hash,
              })),
          },
          null,
          2,
        );
        if (job.options.folder) {
          await window.juno!.writeExport(
            job.options.folder,
            "juno-reglages.json",
            new TextEncoder().encode(manifest).buffer,
          );
          await window.juno!.finishExport(job.options.folder);
        } else {
          zip!.file("juno-reglages.json", manifest);
          await download(
            await zip!.generateAsync({ type: "blob", compression: "STORE" }),
            job.projectName + "-photos.zip",
          );
        }
      }
      job.state = "done";
    } else if (job.state === "cancelled" && job.options.folder)
      await window.juno!.finishExport(job.options.folder);
    await publish(job);
  } catch (e) {
    job.state = "failed";
    job.errors.push({
      index: job.cursor,
      name: "Tâche",
      message: (e as Error).message.slice(0, 300),
    });
    try {
      await publish(job);
    } catch (writeError) {
      diskBlocked = true;
      job.state = "interrupted";
      job.errors.push({
        index: job.cursor,
        name: "Disque",
        message:
          "Enregistrement interrompu : " +
          String(writeError) +
          ". Vérifiez le disque puis reprenez.",
      });
      snapshot = [job, ...snapshot.filter((j) => j.id !== job.id)];
      for (const fn of listeners) {
        try {
          fn(snapshot);
        } catch {}
      }
    }
  } finally {
    working = false;
    void pump();
  }
}
function exportName(p: Photo, index: number, format: string) {
  return `${String(index + 1).padStart(4, "0")}_${p.name.replace(/\.[^.]+$/, "").replace(/[^\p{L}\p{N}_-]/gu, "_")}_Juno.${format === "tiff" ? "tif" : format === "png" ? "png" : "jpg"}`;
}
