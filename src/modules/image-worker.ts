import { parse } from "exifr";
import {
  decodeRaster,
  decodeRawPreview,
  decodeRawReduit,
  isRaw,
  resizeRaster,
  makeCanvas,
  setRasterCacheLimit,
  vers8Bits,
  PREVIEW_MIN_WIDTH,
  type Raster,
} from "./raster";
import { ANALYSIS_WIDTH } from "./quality";
import { setColorBase, srgbProfile, tagSrgb } from "./color";
import { analyzePixels } from "../pixels";
import { processRaster } from "./pipeline";
import { encodeTiff16 } from "./local-edits";
import { photoFailure } from "./image-errors";
import { luminanceReduite, mesurerNiveau, VERSION_NIVEAU } from "./level";
import { avecTemps, empreinteDe, instantExif, lireCR3, type Empreinte } from "./rafales";
import { mesureDuRendu, type MesureRendu } from "./auto-tone";
import type { SubjectMask } from "./subject";
const huitBits = (r: Raster) =>
  r.data instanceof Uint16Array ? vers8Bits(r.data) : r.data;
function canvas(r: Raster) {
  const c = makeCanvas(r.width, r.height);
  const data =
    r.data instanceof Uint16Array
      ? vers8Bits(r.data)
      : new Uint8ClampedArray(r.data);
  (
    c.getContext("2d", {
      colorSpace: "srgb",
    }) as OffscreenCanvasRenderingContext2D
  ).putImageData(new ImageData(data, r.width, r.height), 0, 0);
  return c as OffscreenCanvas;
}
/**
 * Les masques de détourage d'une demande, un par calque « Sujet détouré ».
 *
 * Ils accompagnent chaque demande au lieu d'être gardés ici : le travailleur
 * n'en retenait que huit quand l'interface croyait en avoir envoyé douze, une
 * voie d'export n'était pas celle qui les avait reçus, et un travailleur
 * recréé après une erreur les avait tous perdus. Sept cents kilo-octets par
 * masque se copient en moins d'une milliseconde.
 */
function masquesDe(recus?: Record<string, SubjectMask>) {
  if (!recus) return undefined;
  const parCalque = new Map(Object.entries(recus));
  return parCalque.size ? (e: { id: string }) => parCalque.get(e.id) : undefined;
}
let chain = Promise.resolve();
self.onmessage = ({ data: request }) => {
  chain = chain
    .then(async () => {
      try {
        const { id, kind, blob, name, key, base, adjustments, max,
          subjectMasks, vision, exif, rendu } = request;
        setColorBase(base);
        setRasterCacheLimit(
          (kind === "thumbnail" ? 32 : kind === "render" ? 512 : 128) *
            1024 *
            1024,
        );
        // Le rendu de Juno d'un RAW, seul : la passe d'album le demande pour
        // une photo déjà analysée (voir auto-tone.ts, VERSION_RENDU).
        if (kind === "rendu") {
          const r = await decodeRawReduit(blob, ANALYSIS_WIDTH);
          const result: MesureRendu = mesureDuRendu(huitBits(r), r.width, r.height);
          self.postMessage({ id, result });
          return;
        }
        // Sorting only needs a faithful picture, not a decoded RAW: the
        // embedded preview gives one in milliseconds.
        const preview =
          kind === "inspect" && isRaw(name)
            ? await decodeRawPreview(
                blob,
                PREVIEW_MIN_WIDTH,
                rendu ? ANALYSIS_WIDTH : 0,
              )
            : undefined;
        const raster =
          preview ||
          (await decodeRaster(blob, name, kind === "inspect" ? "" : key));
        if (kind === "inspect") {
          const thumbnail = await canvas(
              resizeRaster(raster, 480),
            ).convertToBlob({ type: "image/jpeg", quality: 0.8 }),
            small = resizeRaster(raster, ANALYSIS_WIDTH);
          const pixels = huitBits(small);
          // Sans aperçu intégré, l'analyse a été faite sur le développement
          // LibRaw lui-même : c'est déjà le rendu de Juno.
          let mesureRendu: MesureRendu | undefined;
          if (rendu && isRaw(name))
            mesureRendu = preview
              ? preview.reduit &&
                mesureDuRendu(huitBits(preview.reduit), preview.reduit.width, preview.reduit.height)
              : mesureDuRendu(pixels, small.width, small.height);
          let meta: any = {};
          try {
            meta =
              (await parse(exif || blob, {
                pick: [
                  "DateTimeOriginal",
                  "Make",
                  "Model",
                  "ISO",
                  "FNumber",
                  "ExposureTime",
                  "ProfileDescription",
                ],
                icc: true,
              })) || {};
          } catch {}
          const capturedAt =
            raster.capturedAt ||
            (meta.DateTimeOriginal instanceof Date
              ? meta.DateTimeOriginal.getTime()
              : undefined);
          const color =
            meta.ProfileDescription && !/\.tiff?$/i.test(name)
              ? {
                  space: "sRGB",
                  source: "embedded",
                  profile: String(meta.ProfileDescription).slice(0, 160),
                }
              : raster.color;
          // L'image d'analyse, rendue à la demande pour les visages : la
          // vignette de 480 px ne suffit pas à juger des yeux sur un plan
          // moyen, et cette image-ci est déjà décodée. Transférée, pas copiée.
          const image = vision
            ? await createImageBitmap(
                new ImageData(new Uint8ClampedArray(pixels), small.width, small.height),
              )
            : undefined;
          // L'inclinaison, mesurée sur une réduction par moyenne de surface
          // de l'image entière : environ 100 ms par photo. Une mesure qui
          // échoue ne coûte que la proposition de redressement.
          let level: NonNullable<ReturnType<typeof analyzePixels>["level"]> | undefined;
          try {
            const l = luminanceReduite(raster.data, raster.width, raster.height, 1024, raster.data instanceof Uint16Array);
            level = { ...mesurerNiveau(l.gris, l.w, l.h), version: VERSION_NIVEAU };
          } catch {}
          // L'empreinte de rafale : l'heure au millième (une rafale tient dix
          // images dans la seconde) et trois signaux d'image. Quelques
          // millisecondes ; un échec ne coûte que la reconnaissance des rafales.
          let empreinte: Empreinte | undefined;
          try {
            let temps: { instant?: number; boitier?: string } = {};
            if (/\.cr3$/i.test(name))
              temps = lireCR3(await blob.slice(0, 1 << 20).arrayBuffer());
            else {
              // En texte : l'heure affichée par le boîtier, sans fuseau.
              const brut: any =
                (await parse(exif || blob, {
                  pick: ["DateTimeOriginal", "SubSecTimeOriginal", "SerialNumber"],
                  reviveValues: false,
                }).catch(() => null)) || {};
              temps = {
                instant: instantExif(brut.DateTimeOriginal, brut.SubSecTimeOriginal),
                boitier: brut.SerialNumber,
              };
            }
            empreinte = avecTemps(empreinteDe(pixels, small.width, small.height), temps);
          } catch {}
          self.postMessage({
            id,
            result: {
              width: raster.width,
              height: raster.height,
              thumbnail,
              vision: image,
              visionSource: image ? Math.max(raster.width, raster.height) : undefined,
              analysis: {
                ...analyzePixels(pixels, small.width, small.height),
                level,
                empreinte,
                ...(mesureRendu ? { rendu: mesureRendu } : {}),
              },
              bitDepth: raster.bitDepth,
              camera: raster.camera || {
                make: meta.Make,
                model: meta.Model,
                iso: meta.ISO,
                aperture: meta.FNumber,
                shutter: meta.ExposureTime,
              },
              capturedAt,
              color,
            },
          }, { transfer: image ? [image] : [] });
        } else {
          const r = processRaster(raster, adjustments, max, masquesDe(subjectMasks));
          if (kind === "tiff") {
            const buffer = encodeTiff16(
              r.data,
              r.width,
              r.height,
              await srgbProfile(),
            );
            self.postMessage({ id, result: buffer }, { transfer: [buffer] });
          } else if (kind === "encode") {
            const image = await canvas(r).convertToBlob({
              type: request.format === "png" ? "image/png" : "image/jpeg",
              quality: request.quality,
            });
            self.postMessage({ id, result: await tagSrgb(image) });
          } else
            self.postMessage(
              { id, result: r },
              { transfer: [r.data.buffer as ArrayBuffer] },
            );
        }
      } catch (e) {
        self.postMessage({
          id: request.id,
          error: photoFailure(e, request.kind),
        });
      }
    })
    .catch(() => {});
};
