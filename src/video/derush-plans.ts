import { useEffect, useRef, useState } from "react";
import type { Asset, VideoProject } from "./types";
import { releverVisages } from "./reframe-scan";
import { passages } from "./derush";

/**
 * Le type de plan d'un rush, d'après la taille des visages : le signal fiable
 * du classement (PLAN-DERUSHAGE.md, partie 3.3). Le détecteur de visages est
 * celui du tri photo et du recadrage, dans les travailleurs de l'interface.
 */
export type TypePlan = "gros" | "moyen" | "large" | "sans-visage";
export const PLANS: Record<TypePlan, string> = {
  gros: "Gros plan",
  moyen: "Plan moyen",
  large: "Plan large",
  "sans-visage": "Sans visage",
};
/**
 * Les seuils, en part de la hauteur de l'image occupée par le plus grand
 * visage : un visage d'un quart de l'image est un gros plan ; d'un
 * quatorzième, un plan moyen (personnage à la taille) ; en deçà, un plan
 * large. À régler sur de vrais rushes.
 */
export const SEUILS_PLAN = { gros: 0.22, moyen: 0.07, presence: 0.3 };

const mediane = (v: number[]) => {
  const t = [...v].sort((a, b) => a - b);
  return t[Math.floor(t.length / 2)];
};

/**
 * Le type d'un plan à partir de la hauteur du plus grand visage de chaque
 * relevé (0 sans visage). « Sans visage » quand moins de 30 % des relevés en
 * montrent un : une silhouette de passage ne fait pas un plan sur quelqu'un.
 */
export function typeDePlan(hauteurs: number[]): TypePlan {
  const avec = hauteurs.filter((h) => h > 0);
  if (!hauteurs.length || avec.length < Math.max(1, hauteurs.length * SEUILS_PLAN.presence)) return "sans-visage";
  const m = mediane(avec);
  return m >= SEUILS_PLAN.gros ? "gros" : m >= SEUILS_PLAN.moyen ? "moyen" : "large";
}

/**
 * Relève les visages sur un rush (un relevé toutes les 10 s, de 3 à 12) et
 * rend son type de plan. Les relevés qui tombent dans un passage masqué ne
 * comptent pas : on classe ce qui sera monté.
 */
export async function classerPlan(a: Asset, signal?: AbortSignal): Promise<TypePlan> {
  if (!a.proxy) throw Error("Aperçu absent");
  const n = Math.max(3, Math.min(12, Math.round(a.duration / 10))),
    r = await releverVisages(a.proxy, 0, a.duration, n, signal),
    masques = passages(a.derush).filter((p) => p.etat === "masque");
  const hauteurs = r.echantillons
    .filter((e) => !masques.some((p) => e.seconde >= p.debut && e.seconde < p.fin))
    .map((e) => Math.max(0, ...e.visages.map((v) => v.h)));
  return typeDePlan(hauteurs);
}

/**
 * Classe en fond, un rush à la fois, les rushes dérushés dont le type de
 * plan n'est pas encore connu, tant que le studio vidéo est ouvert sur le
 * projet. Une pause entre deux rushes laisse la main au montage.
 *
 * Les types relevés sont écrits par lots (dix rushes, ou toutes les 20 s, ou
 * en quittant le projet) : chaque écriture change la révision du projet, que
 * l'interface relit en entier.
 */
export function useClassementDesPlans(
  project: VideoProject | undefined,
  api: NonNullable<Window["juno"]>["video"] | undefined,
) {
  const [echecs, setEchecs] = useState<ReadonlySet<string>>(new Set()),
    // Relevés mais pas encore écrits : ne pas les relever deux fois.
    [faits, setFaits] = useState<ReadonlySet<string>>(new Set()),
    attente = useRef(new Map<string, TypePlan>());
  const projetId = project?.id;
  const aFaire = (project?.assets || []).filter(
    (a) =>
      a.kind === "video" &&
      a.status === "ready" &&
      a.derush &&
      !a.derush.plan &&
      a.proxy &&
      !echecs.has(a.id) &&
      !faits.has(a.id),
  );
  const prochain = aFaire[0]?.id;
  const ecrire = useRef(async (_id?: string) => {});
  ecrire.current = async (id = projetId) => {
    if (!api || !id || !attente.current.size) return;
    const lot = Object.fromEntries(attente.current);
    attente.current = new Map();
    await api.derushPlans({ projectId: id, plans: lot }).catch(() => {});
  };
  // Toutes les 20 s, et en quittant le projet.
  useEffect(() => {
    const id = projetId,
      minuterie = setInterval(() => void ecrire.current(id), 20000);
    return () => {
      clearInterval(minuterie);
      void ecrire.current(id);
    };
  }, [projetId, api]);
  // Rien de plus à relever : ce qui attend part tout de suite.
  useEffect(() => {
    if (!prochain) void ecrire.current();
  }, [prochain]);
  useEffect(() => {
    if (!project || !api || !prochain) return;
    const controleur = new AbortController(),
      a = project.assets.find((x) => x.id === prochain)!;
    const minuterie = setTimeout(() => {
      classerPlan(a, controleur.signal)
        .then((plan) => {
          if (controleur.signal.aborted) return;
          attente.current.set(a.id, plan);
          setFaits((x) => new Set([...x, a.id]));
          if (attente.current.size >= 10) void ecrire.current();
        })
        .catch((e) => {
          // Un rush illisible pour le détecteur n'est pas relu en boucle.
          if (controleur.signal.aborted) return;
          console.warn("Type de plan non relevé pour " + a.name + " : " + (e?.message || e));
          setEchecs((x) => new Set([...x, a.id]));
        });
    }, 1500);
    return () => {
      clearTimeout(minuterie);
      controleur.abort();
    };
  }, [project?.id, prochain, api]);
  return aFaire.length;
}
