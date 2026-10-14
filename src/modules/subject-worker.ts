/**
 * Détourer la personne qu'on désigne d'un clic.
 *
 * Le modèle est SlimSAM, une version allégée de Segment Anything, publiée
 * sous Apache 2.0. Rien ne sort de cet ordinateur.
 *
 * Pourquoi un clic plutôt qu'un détourage automatique : un album de mariage
 * est fait de groupes et de plans larges, où « le sujet » n'existe pas tout
 * seul. Essayé et mesuré, un modèle de portrait (MODNet) rend une silhouette
 * trouée sur un couple et des taches informes sur un discours à six personnes.
 * Désigner règle la question au lieu de la deviner.
 *
 * Le travail se fait en deux temps. L'encodeur lit l'image une fois, ce qui
 * coûte l'essentiel ; chaque clic ne fait ensuite que décoder, ce qui est
 * presque instantané. C'est ce qui rend l'outil utilisable.
 */
import { env, SamModel, AutoProcessor, RawImage } from "@huggingface/transformers";
/**
 * SAM travaille de toute façon sur 1024 pixels. Lui donner une image de six
 * mille n'apporte rien et coûte tout le redimensionnement du masque : mesuré,
 * 5,9 s contre 1,8 s, pour une confiance identique.
 */
const LARGEUR = 1024;
type Charge = {
  processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>;
  model: Awaited<ReturnType<typeof SamModel.from_pretrained>>;
  device: string;
};
let charge: Promise<Charge> | undefined;
/** L'image en cours et sa lecture : un clic suivant n'a plus qu'à décoder. */
let courante:
  | {
      cle: string;
      image: RawImage;
      embeddings: Record<string, unknown>;
      width: number;
      height: number;
    }
  | undefined;
async function load(base: string): Promise<Charge> {
  charge ??= (async () => {
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.localModelPath = base + "models/";
    const processor = await AutoProcessor.from_pretrained("slimsam");
    // Le processeur graphique d'abord : 1,8 s contre 5,9 en WebAssembly.
    for (const device of ["webgpu", "wasm"] as const) {
      try {
        const model = await SamModel.from_pretrained("slimsam", {
          dtype: "fp32",
          device,
        });
        return { processor, model, device };
      } catch (e) {
        if (device === "wasm") throw e;
      }
    }
    throw Error("Modèle de détourage indisponible");
  })();
  return charge;
}
type Entree = {
  id: string;
  base: string;
  cle: string;
  bitmap?: ImageBitmap;
  points: [number, number][];
};
self.onmessage = async (event: MessageEvent<Entree>) => {
  const { id, base, cle, bitmap, points } = event.data;
  try {
    const m = await load(base);
    if (bitmap || courante?.cle !== cle) {
      if (!bitmap) throw Error("Image à relire");
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(bitmap, 0, 0);
      const pixels = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      const w = bitmap.width,
        h = bitmap.height;
      bitmap.close();
      const image = new RawImage(new Uint8ClampedArray(pixels.data), w, h, 4);
      const reduite =
        w > LARGEUR
          ? await image.resize(LARGEUR, Math.round((h * LARGEUR) / w))
          : image;
      const entree = await m.processor(reduite);
      courante = {
        cle,
        // L'image est gardée, pas seulement sa lecture : le processeur doit
        // la revoir à chaque clic pour placer le point dans son repère.
        image: reduite,
        // get_image_embeddings rend deux tenseurs, pas un. Les passer en bloc
        // sous un seul nom privait le décodeur des embeddings de position :
        // il répondait quand même, avec un masque qui couvrait toute l'image.
        embeddings: (await (
          m.model as unknown as {
            get_image_embeddings(i: unknown): Promise<Record<string, unknown>>;
          }
        ).get_image_embeddings(entree)) as Record<string, unknown>,
        width: reduite.width,
        height: reduite.height,
      };
    }
    const c = courante!;
    // Les points arrivent en proportion de l'image, pour ne dépendre ni de sa
    // taille d'origine ni de celle à laquelle elle est affichée. Le processeur
    // les remet ensuite dans le repère du modèle, ce qu'il ne peut faire qu'en
    // voyant l'image : lui en donner une fausse de un pixel envoyait le point
    // dans un coin.
    const enPixels = points.map(([x, y]) => [x * c.width, y * c.height]);
    const entree = await m.processor(c.image, { input_points: [[enPixels]] });
    const sortie = await (m.model as unknown as (i: unknown) => Promise<{
      pred_masks: unknown;
      iou_scores: { data: ArrayLike<number> };
    }>)({ ...(entree as Record<string, unknown>), ...c.embeddings });
    // pred_masks sort en basse résolution et en logits : un logit négatif
    // reste « vrai » en JavaScript. C'est post_process_masks qui seuille et
    // remet le masque à la taille de l'image.
    const masques = await (
      m.processor as unknown as {
        post_process_masks(
          m: unknown,
          o: unknown,
          r: unknown,
        ): Promise<{ dims: number[]; data: ArrayLike<number> }[][]>;
      }
    ).post_process_masks(
      sortie.pred_masks,
      (entree as Record<string, unknown>).original_sizes,
      (entree as Record<string, unknown>).reshaped_input_sizes,
    );
    // SAM propose trois découpes ; on garde celle dont il est le plus sûr.
    const scores = Array.from(sortie.iou_scores.data);
    const meilleur = scores.indexOf(Math.max(...scores));
    const decoupes = masques[0][0];
    const [, h, w] = decoupes.dims;
    const brut = decoupes.data;
    const debut = meilleur * h * w;
    const masque = new Uint8ClampedArray(w * h);
    for (let k = 0; k < w * h; k++) masque[k] = brut[debut + k] ? 255 : 0;
    self.postMessage({
      id,
      masque,
      width: w,
      height: h,
      confiance: Math.round(scores[meilleur] * 1000) / 1000,
      device: m.device,
    });
  } catch (error) {
    bitmap?.close();
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
export {};
