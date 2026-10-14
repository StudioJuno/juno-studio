/**
 * La recherche par le sens, calculée sur cet ordinateur.
 *
 * Le modèle est SigLIP 2 de Google, embarqué avec l'application. Rien n'est
 * envoyé sur le réseau : ni les photos, ni les recherches.
 *
 * Pourquoi celui-là et pas CLIP d'OpenAI : la carte officielle de CLIP exclut
 * explicitement tout déploiement, commercial ou non. SigLIP 2 est publié sous
 * Apache 2.0 et il est multilingue, donc utilisable en français sans passer
 * par une traduction.
 */
import {
  env,
  AutoTokenizer,
  AutoProcessor,
  RawImage,
  SiglipTextModel,
  SiglipVisionModel,
} from "@huggingface/transformers";
/** SigLIP travaille sur un contexte de texte de longueur fixe. */
const CONTEXTE = 64;
type Charge = {
  tokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>;
  processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>;
  vision: Awaited<ReturnType<typeof SiglipVisionModel.from_pretrained>>;
  texte: Awaited<ReturnType<typeof SiglipTextModel.from_pretrained>>;
  device: string;
};
let charge: Promise<Charge> | undefined;
async function load(base: string): Promise<Charge> {
  charge ??= (async () => {
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.localModelPath = base + "models/";
    const opts = { dtype: "q8" as const };
    const tokenizer = await AutoTokenizer.from_pretrained("siglip2");
    const processor = await AutoProcessor.from_pretrained("siglip2");
    // Le processeur, pas la carte graphique, et c'est mesuré : sur ce modèle
    // quantifié en huit bits, WebAssembly rend 1 077 ms par photo contre
    // 1 231 au processeur graphique. Les formats que le GPU accélère
    // vraiment (fp16, q4f16) descendent à 190 ms, mais ils perdent en
    // précision : une première place sur quatre au lieu de trois, sur des
    // recherches dont la bonne réponse était connue. Une recherche rapide
    // qui sort la mauvaise photo ne sert à rien.
    for (const device of ["wasm", "cpu"] as const) {
      try {
        const vision = await SiglipVisionModel.from_pretrained("siglip2", {
          ...opts,
          device,
        });
        const texte = await SiglipTextModel.from_pretrained("siglip2", {
          ...opts,
          device,
        });
        return { tokenizer, processor, vision, texte, device };
      } catch (e) {
        if (device === "cpu") throw e;
      }
    }
    throw Error("Modèle de recherche indisponible");
  })();
  return charge;
}
/** Un vecteur normalisé : la comparaison devient un simple produit. */
function normalise(v: Float32Array | number[]) {
  let somme = 0;
  for (const x of v) somme += x * x;
  const n = Math.sqrt(somme) || 1;
  return Array.from(v, (x) => x / n);
}
type Entree =
  | { id: string; base: string; kind: "images"; images: ImageBitmap[] }
  | { id: string; base: string; kind: "texte"; textes: string[] };
self.onmessage = async (event: MessageEvent<Entree>) => {
  const message = event.data;
  try {
    const m = await load(message.base);
    if (message.kind === "images") {
      const vecteurs: (number[] | null)[] = [];
      for (const bitmap of message.images) {
        try {
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
          const ctx = canvas.getContext("2d")!;
          ctx.drawImage(bitmap, 0, 0);
          const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
          const image = new RawImage(
            new Uint8ClampedArray(data.data),
            bitmap.width,
            bitmap.height,
            4,
          );
          const entree = await m.processor(image);
          const sortie = await m.vision(entree);
          vecteurs.push(normalise(sortie.pooler_output.data));
        } catch {
          vecteurs.push(null);
        } finally {
          bitmap.close();
        }
      }
      self.postMessage({ id: message.id, vecteurs, device: m.device });
      return;
    }
    const entree = m.tokenizer(message.textes, {
      padding: "max_length",
      max_length: CONTEXTE,
      truncation: true,
    });
    const sortie = await m.texte(entree);
    const taille = sortie.pooler_output.dims[1];
    const plat = sortie.pooler_output.data;
    const vecteurs = message.textes.map((_, i) =>
      normalise(plat.slice(i * taille, (i + 1) * taille)),
    );
    self.postMessage({ id: message.id, vecteurs, device: m.device });
  } catch (error) {
    self.postMessage({
      id: message.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
export {};
