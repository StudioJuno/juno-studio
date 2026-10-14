import type { Photo, Analysis, FaceRead } from "../model";
import { thumbnailBitmap } from "./thumbnail-bitmap";
import {
  hautesLumieres,
  jugementVisage,
  PEU_DE_DETAILS,
  peuDeDetails,
  RAISON_LUMIERES,
  RAISON_SOMBRE,
  TRES_SOMBRE,
  subjectRead,
  verdictFor,
  YEUX_FERMES,
} from "./quality";
import { grouperRafales, noterRafale, raisonPreference } from "./rafales";
import {
  cropFaces,
  faceDescriptors,
  faceEmbeddingAvailable,
  faceEmbeddingFailure,
  facesWorthDescribing,
} from "./face-embed";
export { faceEmbeddingFailure };
/** Posée par la passe d'album sur les autres images d'une rafale. */
export const RAISON_VARIANTE = "Autre image de la rafale : comparez avant d’écarter.";
/**
 * Les raisons que la passe d'album laisse sur une photo après l'avoir
 * retouchée. La variante se reconnaît à ce qu'elle n'est pas proposée : le
 * `groupId` est celui de la PREMIÈRE image de la rafale, pas de la meilleure,
 * et le tester marquait la gagnante elle-même dès qu'elle n'était pas la
 * première, soit 469 des 727 rafales de l'album de mesure (relecture du
 * 28/09/2026 ; le défaut datait de la 1.2.1).
 */
export function raisonsDePasse(a: Analysis, sensible: boolean): string[] {
  const raisons = [...a.reasons];
  if (sensible) raisons.push("Ambiance sombre ou très claire : exposition conservée.");
  if (!a.suggested) raisons.push(RAISON_VARIANTE);
  return [...new Set(raisons)];
}
/**
 * Le choix dans une rafale déjà formée (`members`, dans l'ordre de prise de
 * vue) : la proposée, les verdicts, la raison de variante. Modifie les
 * analyses en place.
 */
function choisirDansRafale(members: Photo[], priority: string[]) {
  const candidates = members.filter((p) => p.status !== "reject");
  if (!candidates.length) return;
  // Notes relatives à cette rafale : chaque personne comparée à elle-même.
  const notes = noterRafale(
    candidates.map((p) => p.analysis!),
    priority,
  );
  // L'image protégée, puis celle que le photographe a gardée à la main,
  // restent le choix de leur rafale : sinon la passe en gardait une seconde
  // et marquait la sienne « Autre image de la rafale » (relecture du
  // 29/09/2026). La note ne départage qu'ensuite.
  const ranked = candidates
    .map((p, i) => ({
      p,
      note: notes[i],
      protege: p.protected ? 1 : 0,
      gardee: p.status === "keep" ? 1 : 0,
    }))
    .sort(
      (a, b) =>
        b.protege - a.protege || b.gardee - a.gardee || b.note.total - a.note.total,
    );
  const gagnante = ranked[0];
  gagnante.p.analysis!.suggested = true;
  for (const { p, note } of ranked) {
    const verdict = verdictFor(p.analysis!, priority);
    if (p === gagnante.p)
      p.analysis!.verdict =
        members.length > 1
          ? `Meilleure de la rafale (${members.length} images) · ${verdict}`
          : verdict;
    else {
      const pourquoi = gagnante.protege
        ? "elle est protégée"
        : gagnante.gardee
          ? "vous l'avez gardée"
          : raisonPreference(gagnante.note, note);
      p.analysis!.verdict = `${verdict} Une autre image de la rafale est préférée${pourquoi ? " : " + pourquoi : ""}.`;
      // La raison de variante suit la rafale, pas la retouche : une passe
      // relancée ne retouche plus les photos déjà retouchées, et leur
      // retirait la raison sans la remettre (relecture du 29/09/2026).
      // Seulement sur les photos à décider : une photo gardée ou écartée
      // à la main est déjà tranchée.
      if (p.status === "pending")
        p.analysis = {
          ...p.analysis!,
          reasons: [...p.analysis!.reasons, RAISON_VARIANTE],
          advice: "review",
        };
    }
  }
}
/**
 * Refaire le choix d'une seule rafale après qu'une note a changé (Garder,
 * Écarter) : sans cela, « Comparer les rafales », qui recalcule, et « Voir
 * les propositions », qui lit le catalogue, désignaient deux images
 * différentes, et une image écartée restait proposée (relecture du
 * 29/09/2026). Les rafales ne sont pas refaites : seulement le choix dans la
 * rafale de `id`. Rend les photos de la rafale dont l'analyse a changé.
 */
export function rechoisirRafale(
  photos: Photo[],
  id: string,
  priority: string[] = [],
): Photo[] {
  const groupe = photos.find((p) => p.id === id)?.analysis?.groupId;
  if (!groupe) return [];
  const avant = photos.filter((p) => p.analysis?.groupId === groupe && !figee(p));
  if (avant.length < 2) return [];
  const members = avant.map((p) => ({
    ...p,
    analysis: {
      ...p.analysis!,
      reasons: p.analysis!.reasons.filter(
        (x) => x !== RAISON_VARIANTE && !x.startsWith("Variante conservée"),
      ),
      suggested: false,
      verdict: undefined,
    },
  }));
  for (const p of members) p.analysis.advice = p.analysis.reasons.length ? "review" : "normal";
  choisirDansRafale(members, priority);
  return members.filter((p, i) => {
    const a = avant[i].analysis!,
      b = p.analysis!;
    return (
      a.suggested !== b.suggested ||
      a.verdict !== b.verdict ||
      a.advice !== b.advice ||
      JSON.stringify(a.reasons) !== JSON.stringify(b.reasons)
    );
  });
}
/**
 * Une copie reçue de l'équipe n'a ni original ni empreinte de rafale
 * (l'empreinte n'est pas publiée : 3,4 ko par photo, plafond de 8 Mo). La
 * regrouper ici retomberait sur la règle de la 1.2.1 : 3 083 « rafales » au
 * lieu de 1 053 sur l'album de mesure. Elle garde le regroupement reçu.
 */
const figee = (p: Photo) => !!p.previewOnly && !p.analysis?.empreinte;
/**
 * Reconnaître les rafales, puis n'en proposer qu'une image : la meilleure
 * (src/modules/rafales.ts). Chaque photo porte la phrase qui explique son sort.
 */
export function groupSuggestions(
  photos: Photo[],
  priority: string[] = [],
): Photo[] {
  // Les raisons tirées des visages sont refaites avec les personnes désignées,
  // comme le verdict : l'une ne doit jamais contredire l'autre. Celle de
  // variante l'est aussi, puisque les rafales se refont à chaque passe.
  const result: Photo[] = photos.map((p) =>
    figee(p)
      ? { ...p }
      : {
          ...p,
          analysis: p.analysis
            ? {
                ...raisonsVisage(
                  {
                    ...p.analysis,
                    reasons: p.analysis.reasons.filter(
                      (x) => x !== RAISON_VARIANTE && !x.startsWith("Variante conservée"),
                    ),
                  },
                  priority,
                ),
                groupId: undefined,
                suggested: false,
                // Refait à chaque passe : une image écartée depuis ne garde pas
                // « Meilleure de la rafale » à côté de la nouvelle meilleure.
                verdict: undefined,
              }
            : undefined,
        },
  );
  const byId = new Map(result.map((p) => [p.id, p]));
  for (const group of grouperRafales(result.filter((p) => !figee(p)))) {
    const members = group.map((id) => byId.get(id)!).filter(Boolean);
    for (const p of members) p.analysis!.groupId = members[0].id;
    choisirDansRafale(members, priority);
  }
  // A photo outside any burst still deserves its sentence.
  for (const p of result)
    if (p.analysis && !p.analysis.verdict)
      p.analysis.verdict = verdictFor(p.analysis, priority);
  return result;
}
const RAISON_FLOU = "Visage principal flou : vérifier la netteté",
  RAISON_DOUTE = "Netteté du visage à vérifier à 100 %",
  RAISON_YEUX = "Yeux fermés sur le visage principal : vérifier";
/**
 * Les raisons qui viennent des visages, recalculées d'un bloc : netteté du
 * visage principal, et « Peu de détails » redérivé de la mesure globale.
 *
 * Appelée sans priorité juste après la lecture des visages, puis de nouveau
 * avec les personnes désignées une fois qu'on les a reconnues : sans ce second
 * passage, une mariée floue sauvée par un invité net restait « gardée » d'office
 * sous le verdict « Visage principal flou » (trouvé en relecture, 28/09/2026).
 */
export function raisonsVisage(a: Analysis, priority: string[] = []): Analysis {
  const nettete = jugementVisage(a, priority);
  const reasons = a.reasons.filter(
    (x) =>
      !x.startsWith(RAISON_FLOU) &&
      !x.startsWith(RAISON_DOUTE) &&
      !x.startsWith(RAISON_YEUX) &&
      !x.startsWith(PEU_DE_DETAILS) &&
      x !== RAISON_SOMBRE &&
      x !== RAISON_LUMIERES,
  );
  // Exposition, redérivée elle aussi : les hautes lumières se jugent sur les
  // visages une fois lus, et les analyses anciennes suivent la règle du jour.
  if (a.brightness < TRES_SOMBRE) reasons.unshift(RAISON_SOMBRE);
  if (hautesLumieres(a)) reasons.push(RAISON_LUMIERES);
  if (nettete === "flou") reasons.push(RAISON_FLOU);
  if (nettete === "doute") reasons.push(RAISON_DOUTE);
  // Le verdict dit « Yeux fermés » au-dessus de ce seuil ; le décompte du
  // lecteur de visages (« Yeux possiblement fermés ») en prend un plus haut,
  // et ne voit pas une personne désignée petite dans le cadre : la photo
  // restait gardée d'office sous ce verdict (relecture du 29/09/2026).
  const sujet = subjectRead(a.faces?.reads, priority);
  if (
    sujet &&
    sujet.eyesClosed > YEUX_FERMES &&
    !reasons.some((x) => x.startsWith("Yeux possiblement fermés"))
  )
    reasons.push(RAISON_YEUX);
  // « Peu de détails » juge l'image entière : un portrait net sur fond flou en
  // a peu. Quand le visage est mesuré net, c'est lui qui compte : 50 des 756
  // photos livrées de l'album de mesure étaient mises « à vérifier » à tort.
  // Redérivée à chaque fois, elle revient si le jugement change.
  if (nettete !== "net" && peuDeDetails(a.sharpness, a.sharpnessWidth ?? 0, a.nettetePointe))
    reasons.push(PEU_DE_DETAILS);
  return { ...a, reasons, advice: reasons.length ? "review" : "normal" };
}
export function withFaces(
  analysis: Analysis,
  result: {
    count: number;
    closedEyes: number;
    blink: number;
    regions?: Analysis["faces"] extends infer F
      ? F extends { regions?: infer R }
        ? R
        : never
      : never;
    reads?: FaceRead[];
    subjectSharpness?: number;
    /** Lus sur la vignette de secours : à relire quand l'original revient. */
    vignette?: boolean;
  },
): Analysis {
  const reasons = analysis.reasons.filter(
    (x) =>
      !x.startsWith("Yeux possiblement fermés") &&
      // Une lecture réussie remplace le constat d'échec d'une passe précédente.
      !x.startsWith("Visages non vérifiés"),
  );
  if (result.closedEyes)
    reasons.push(`Yeux possiblement fermés · ${result.closedEyes} visage(s)`);
  const next = raisonsVisage({
    ...analysis,
    reasons,
    faces: {
      count: result.count,
      closedEyes: result.closedEyes,
      blink: result.blink,
      regions: result.regions,
      reads: result.reads,
      subjectSharpness: result.subjectSharpness,
      // Une lecture faite sur la vignette, faute d'original, ne vaut pas
      // l'image de 1 024 px : une version distincte la fait relire plus tard.
      version: result.vignette ? VERSION_VISAGES + "-vignette" : VERSION_VISAGES,
    },
  });
  return { ...next, verdict: verdictFor(next) };
}
/**
 * A pool of vision workers. MediaPipe runs on the CPU, so one worker used one
 * photo at a time left every other core idle during an album pass.
 */
type VisionLane = { worker?: Worker; busy: number };
const lanes: VisionLane[] = [];
let sequence = 0;
type FaceResult = {
  count: number;
  closedEyes: number;
  blink: number;
  regions?: { x: number; y: number; w: number; h: number }[];
  reads?: FaceRead[];
  subjectSharpness?: number;
  /** Visages lus sur la vignette de secours, faute d'original. */
  vignette?: boolean;
};
const pending = new Map<
  number,
  {
    resolve: (value: FaceResult) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
    lane: VisionLane;
  }
>();
/** Vision is CPU bound: leave cores for the image workers and the interface. */
export function visionLaneCount(cores = navigator.hardwareConcurrency || 4) {
  return Math.max(1, Math.min(3, Math.floor(cores / 3)));
}
function visionLane(): VisionLane {
  if (!lanes.length)
    for (let i = 0; i < visionLaneCount(); i++) lanes.push({ busy: 0 });
  const lane = lanes.reduce((a, b) => (b.busy < a.busy ? b : a));
  if (!lane.worker) {
    lane.worker = new Worker(new URL("./vision-worker.js", document.baseURI));
    lane.worker.onmessage = ({ data }) => {
      const p = pending.get(data.id);
      if (!p) return;
      clearTimeout(p.timer);
      pending.delete(data.id);
      lane.busy = Math.max(0, lane.busy - 1);
      if (data.error) p.reject(Error(data.error));
      else p.resolve(data.result);
    };
    lane.worker.onerror = () => {
      // One lane failing must not leave the others' requests hanging.
      for (const [id, p] of [...pending.entries()])
        if (p.lane === lane) {
          clearTimeout(p.timer);
          pending.delete(id);
          p.reject(Error("Le modèle local de visages n’a pas pu démarrer."));
        }
      lane.worker?.terminate();
      lane.worker = undefined;
      lane.busy = 0;
    };
  }
  return lane;
}
/**
 * Les visages d'une image déjà décodée.
 *
 * Le recadrage vertical part d'images de film, pas de vignettes : il lui faut
 * cette porte d'entrée. L'image est consommée par le travailleur.
 */
export type OptionsVisages = {
  /** Relire l'image par morceaux pour trouver les visages petits dans le cadre. */
  tuiles?: boolean;
  /**
   * Taille minimale d'un visage, rapportée au plus large, pour qu'on juge ses
   * yeux : un invité minuscule au fond ne doit pas faire écarter un portrait.
   */
  rapportYeux?: number;
  /**
   * Grand côté de la photo d'où vient l'image d'analyse. La netteté des
   * visages n'est mesurée que sur une grande source réduite à 1 024 px (voir
   * face-sharpness.js) : sans cette taille, elle ne l'est pas.
   */
  source?: number;
};
export async function analyzeFacesOn(
  image: ImageBitmap,
  options: OptionsVisages = {},
): Promise<FaceResult> {
  const lane = visionLane(),
    id = ++sequence;
  lane.busy++;
  return await new Promise<FaceResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      lane.busy = Math.max(0, lane.busy - 1);
      reject(Error("Délai dépassé pour l’analyse des visages."));
      lane.worker?.terminate();
      lane.worker = undefined;
    }, 60000);
    pending.set(id, { resolve, reject, timer, lane });
    lane.worker!.postMessage(
      { id, image, base: new URL("./", document.baseURI).href, ...options },
      [image],
    );
  });
}
/**
 * Les réglages retenus pour le tri, mesurés le 27/09/2026 sur 950 photos de
 * sept mariages réels :
 * - l'image d'analyse de 1 024 px, relue par morceaux : 1 039 visages trouvés
 *   contre 169 sur la vignette de 480 px seule. La résolution seule n'apporte
 *   rien (170) ; ce sont les morceaux qui paient ;
 * - à 1 024 px, 12 des 15 alertes « yeux fermés » sont justes, contre 4 sur 19
 *   à 480 px, où un sourire plissé passait pour un clignement ;
 * - un visage n'est jugé sur ses yeux que s'il fait au moins 40 % de la
 *   largeur du plus grand : un invité minuscule au fond ne fait pas écarter
 *   un portrait. À 60 %, deux vrais clignements étaient perdus.
 */
export const REGLAGES_VISAGES: OptionsVisages = { tuiles: true, rapportYeux: 0.4 };
/**
 * La version d'analyse : la changer fait réanalyser les albums. v5 (1.2.1) :
 * la netteté de la bande des yeux, indépendante de la taille du visage.
 */
export const VERSION_VISAGES = "mediapipe-face-v5";
/**
 * @param source l'image d'analyse de 1 024 px quand on l'a, sinon la vignette
 */
export async function analyzeFaces(
  source: string | ImageBitmap,
  /** Grand côté de la photo d'origine, quand l'image est celle d'analyse. */
  origine?: number,
): Promise<FaceResult> {
  const vignette = typeof source === "string";
  const image = vignette ? await thumbnailBitmap(source) : source;
  // Le travailleur consomme l'image qu'on lui donne ; les empreintes des
  // visages se découpent ensuite dans une copie, à la même résolution.
  const copie = await createImageBitmap(image);
  const result = await analyzeFacesOn(image, {
    ...REGLAGES_VISAGES,
    source: vignette ? undefined : origine,
  }).then((r) => ({ ...r, vignette }), (e) => {
    copie.close();
    throw e;
  });
  // A real descriptor identifies a person far better than face geometry.
  // The geometric signature stays as the fallback when the model is absent.
  if (result.reads?.length && faceEmbeddingAvailable()) {
    const wanted = facesWorthDescribing(result.reads);
    if (wanted.length)
      try {
        const crops = await cropFaces(
          copie,
          wanted.map(({ read }) => read.region),
        );
        const descriptors = await faceDescriptors(crops);
        const byIndex = new Map(
          wanted.map(({ index }, i) => [index, descriptors[i]]),
        );
        result.reads = result.reads.map((read, i) => ({
          ...read,
          descriptor: byIndex.get(i),
        }));
      } catch (error) {
        // Keep the geometric signatures: recognition degrades, nothing breaks.
        // The reason is kept so the interface can say it once.
        console.warn("Empreinte faciale indisponible", error);
      }
  }
  copie.close();
  return result;
}
