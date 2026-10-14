import {
  getProjects,
  getPhotos,
  putProject,
  putPhotos,
  getSetting,
  setSetting,
} from "./db";
import { DEFAULT, type Photo } from "./model";
import { inspect, fingerprint } from "./image";
let boot: Promise<void> | undefined;
export function initialize() {
  return (boot ??= (async () => {
    if (await getSetting("initialized")) return;
    const existing = await getProjects();
    if (existing.length) {
      await setSetting("initialized", true);
      return;
    }
    const project = {
      id: "demo-wedding",
      name: "Camille & Louis",
      date: "2026-09-12",
      location: "Un jour en Provence",
      demo: true,
      kind: "Mariage",
      created: Date.now(),
    };
    const photos: Photo[] = [];
    for (let i = 0; i < 12; i++) {
      try {
        const source = `./demo/${String(i).padStart(2, "0")}.jpg`;
        const r = await fetch(source);
        if (!r.ok) continue;
        const blob = await r.blob();
        photos.push({
          id: `demo-${i}`,
          projectId: project.id,
          name: `JUNO_${String(i + 1).padStart(4, "0")}.jpg`,
          source,
          ...(await inspect(blob)),
          size: blob.size,
          hash: await fingerprint(blob),
          status: "pending",
          stars: 0,
          protected: false,
          chapter:
            i < 3
              ? "Préparatifs"
              : i < 6
                ? "Cérémonie"
                : i < 9
                  ? "Le couple"
                  : "Réception",
          adjustments: { ...DEFAULT },
          history: [],
          created: Date.now() + i,
        });
      } catch {}
    }
    await putProject(project);
    await putPhotos(photos);
    for (const config of [
      {
        id: "demo-portrait",
        name: "Visages du studio",
        kind: "Portrait",
        prefix: "portrait",
        location: "Lumière naturelle",
      },
      {
        id: "demo-produit",
        name: "Maison Aube",
        kind: "Produit",
        prefix: "produit",
        location: "Campagne de collection",
      },
    ]) {
      const project = {
        id: config.id,
        name: config.name,
        date: "2026-09-18",
        location: config.location,
        demo: true,
        kind: config.kind,
        created: Date.now(),
      };
      await putProject(project);
      const ps: Photo[] = [];
      for (let i = 0; i < 3; i++) {
        try {
          const source = "./demo/" + config.prefix + "-" + i + ".jpg";
          const r = await fetch(source);
          if (!r.ok) continue;
          const blob = await r.blob();
          ps.push({
            id: config.id + "-" + i,
            projectId: project.id,
            name:
              config.prefix.toUpperCase() +
              "_" +
              String(i + 1).padStart(3, "0") +
              ".jpg",
            source,
            ...(await inspect(blob)),
            size: blob.size,
            hash: await fingerprint(blob),
            status: "pending",
            stars: 0,
            protected: false,
            chapter: config.kind === "Portrait" ? "Portraits" : "Packshots",
            adjustments: { ...DEFAULT },
            history: [],
            created: Date.now() + i,
          });
        } catch {}
      }
      await putPhotos(ps);
    }
    await setSetting("initialized", true);
  })());
}
export async function load(projectId?: string) {
  await initialize();
  const projects = await getProjects();
  const id = projects.some((p) => p.id === projectId)
    ? projectId
    : projects[0]?.id;
  return {
    projects,
    projectId: id || "",
    photos: id ? await getPhotos(id) : [],
  };
}
