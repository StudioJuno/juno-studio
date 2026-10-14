import Range from "./NumericRange";
import {
  renderEditedThumbnail,
  rememberEditedThumbnail,
} from "./edited-thumbnail";
import { getThumbnail } from "../db";
import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import {
  Loader2,
  Brush,
  Crop,
  Move,
  Trash2,
  Eye,
  EyeOff,
  RotateCcw,
} from "lucide-react";
import {
  DEFAULT,
  uid,
  type Adjustments,
  type Photo,
  type Point,
  type LocalEdit,
} from "../model";
import { calquesSujet, pointsDe, renderPhoto, subjectBitmap } from "../image";
import {
  cachedSubjectMask,
  raisonDetourage,
  subjectCoverage,
  subjectMaskFor,
} from "./subject";
import { displayToFrame, displayToSource, effectiveCrop } from "./geometry";
import { sourceToDisplay } from "./ai-mask";
type Tool = "view" | "crop" | LocalEdit["tool"];
export default function EditorPreview({
  photo,
  before,
  zoom,
  onError,
  onAdjust,
}: {
  photo: Photo;
  before: boolean;
  zoom: boolean;
  onError: (s: string) => void;
  onAdjust: (patch: Partial<Adjustments>, group?: string) => void;
}) {
  const mount = useRef<HTMLDivElement>(null),
    overlay = useRef<HTMLCanvasElement>(null),
    [loading, setLoading] = useState(false),
    [quality, setQuality] = useState<"draft" | "final">("draft"),
    [previewFailed, setPreviewFailed] = useState(false),
    [tool, setTool] = useState<Tool>("view"),
    [radius, setRadius] = useState(5),
    [amount, setAmount] = useState(0.5),
    [opacity, setOpacity] = useState(70),
    [source, setSource] = useState<Point>(),
    [layers, setLayers] = useState(false),
    [subjectBusy, setSubjectBusy] = useState(false),
    [recalculSujet, setRecalculSujet] = useState(false);
  const stroke = useRef<Point[]>([]),
    start = useRef<Point | undefined>(undefined),
    // L'état le plus récent de la photo, pour ce qui aboutit après coup.
    derniere = useRef(photo),
    // Un groupe d'annulation par passage dans le champ « Nom du calque ».
    groupeNom = useRef("");
  useEffect(() => {
    derniere.current = photo;
  });
  /**
   * Détourer la personne cliquée, puis créer la retouche qui la vise.
   *
   * Le point désigné est enregistré, pas le masque : il se recalcule, et le
   * catalogue reste léger. Le masque est gardé en mémoire le temps de
   * travailler sur la photo.
   */
  async function detourer(p: Point) {
    if (subjectBusy) return;
    const cible = photo;
    setSubjectBusy(true);
    onError("");
    try {
      const points: [number, number][] = [[p.x, p.y]];
      // L'image vient du moteur de Juno, pas du navigateur : c'est ce qui
      // permet de détourer un RAW ou un TIFF 16 bits. Elle est réduite à
      // mille vingt-quatre pixels, la taille à laquelle le modèle travaille :
      // une photo de six mille pixels devenait un canevas de quatre-vingt-seize
      // méga-octets dans le travailleur, et l'application se fermait.
      const masque = await subjectMaskFor(cible.id, points, () =>
        subjectBitmap(cible),
      );
      const part = subjectCoverage(masque);
      if (part < 0.005)
        throw Error(
          "Rien de reconnaissable à cet endroit. Cliquez au milieu d’une personne.",
        );
      if (part > 0.92)
        throw Error(
          "Le détourage a pris presque toute l’image. Cliquez plus précisément sur une personne.",
        );
      // Le calcul a pris une ou deux secondes : un coup de pinceau a pu être
      // donné entre-temps. Partir des calques tels qu'ils sont maintenant, pas
      // tels qu'ils étaient au clic, sinon le coup de pinceau disparaissait.
      const now = derniere.current;
      if (now.id !== cible.id)
        throw Error(
          "Le détourage a été abandonné : une autre photo est ouverte. Relancez-le sur la photo voulue.",
        );
      const edits = now.adjustments.localEdits || [];
      if (edits.length >= 100) throw Error("100 calques maximum par photo.");
      onAdjust({
        localEdits: [
          ...edits,
          {
            id: uid(),
            name: "Sujet détouré",
            tool: "subject",
            points: [p],
            radius: 0,
            amount: 0.3,
            opacity: 1,
            visible: true,
          },
        ],
      });
      onError(
        `Personne détourée : ${Math.round(part * 100)} % de l’image, confiance ${Math.round(masque.confiance * 100)} %. Réglez la lumière dans les calques.`,
      );
    } catch (error) {
      onError(raisonDetourage(error));
    } finally {
      setSubjectBusy(false);
    }
  }
  const [dimensions, setDimensions] = useState({ w: 1, h: 1 });
  useEffect(() => {
    setSource(undefined);
    setTool("view");
    stroke.current = [];
    start.current = undefined;
  }, [photo.id]);
  // Le nom d'un calque ne change pas l'image : le retirer de la clé évite un
  // rendu complet à chaque lettre saisie.
  const adjustmentKey = JSON.stringify({
    ...photo.adjustments,
    localEdits: photo.adjustments.localEdits?.map(({ name: _nom, ...reste }) => reste),
  });
  const shownPhoto = useRef("");
  useEffect(() => {
    let stopped = false,
      finalShown = false;
    const controller = new AbortController();
    setLoading(true);
    setPreviewFailed(false);
    if (shownPhoto.current !== photo.id) {
      mount.current?.replaceChildren();
      shownPhoto.current = photo.id;
      setQuality("draft");
    }
    const adjustments = before ? DEFAULT : photo.adjustments;
    const present = (c: HTMLCanvasElement, final: boolean) => {
      if (stopped || !mount.current || (!final && finalShown)) return;
      finalShown = final;
      c.setAttribute(
        "aria-label",
        before ? "Photo originale" : "Photo retouchée",
      );
      c.dataset.style = before ? "original" : adjustments.style;
      c.dataset.mode = before ? "original" : "edited";
      c.dataset.edits = String(adjustments.localEdits?.length || 0);
      c.dataset.crop = JSON.stringify(adjustments.cropRect || null);
      c.dataset.quality = final ? "final" : "draft";
      if (zoom) {
        const bounds = effectiveCrop(adjustments, photo.width, photo.height);
        const originalEdge = Math.max(
          photo.width * bounds.w,
          photo.height * bounds.h,
        );
        const scale = final ? 1 : originalEdge / Math.max(c.width, c.height);
        c.style.width = `${(c.width * scale) / (window.devicePixelRatio || 1)}px`;
        c.style.height = `${(c.height * scale) / (window.devicePixelRatio || 1)}px`;
      }
      mount.current.replaceChildren(c);
      setDimensions({ w: c.width, h: c.height });
      setQuality(final ? "final" : "draft");
      if (final) {
        setLoading(false);
        rememberEditedThumbnail(photo, adjustments, c);
      }
    };
    if (photo.previewOnly) {
      void getThumbnail(photo.id)
        .then((src) => {
          if (stopped || !mount.current) return;
          const img = document.createElement("img");
          img.src = photo.thumbnail || src;
          img.className = "remote-preview";
          mount.current.replaceChildren(img);
          setLoading(false);
        })
        .catch(() => {
          if (!stopped) setLoading(false);
        });
    } else {
      void renderEditedThumbnail(photo, adjustments, controller.signal)
        .then((c) => present(c, false))
        .catch(() => {});
    }
    // Un calque « Sujet détouré » dont le masque n'est plus en mémoire (après
    // un redémarrage) : il se recalcule avant le rendu, et on le dit.
    const aRecalculer = calquesSujet(adjustments.localEdits).some(
      (e) => !cachedSubjectMask(photo.id, pointsDe(e)),
    );
    setRecalculSujet(aRecalculer && !photo.previewOnly);
    const timer = setTimeout(() => {
      if (photo.previewOnly) return;
      void renderPhoto(
        photo,
        adjustments,
        zoom ? Math.max(photo.width, photo.height) : 1600,
        controller.signal,
        (message) => {
          if (!stopped) onError(message);
        },
      )
        .then((c) => present(c, true))
        .catch((e) => {
          if (!stopped && e.name !== "AbortError") {
            setLoading(false);
            setPreviewFailed(true);
            onError(e.message);
          }
        })
        .finally(() => {
          if (!stopped) setRecalculSujet(false);
        });
    }, 180);
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    photo.id,
    photo.hash,
    photo.source,
    adjustmentKey,
    before,
    photo.previewOnly,
    zoom,
  ]);
  const canvas = () => mount.current?.querySelector("canvas");
  function point(e: PointerEvent): Point | undefined {
    const c = canvas();
    if (!c) return;
    const r = c.getBoundingClientRect(),
      x = (e.clientX - r.left) / r.width,
      y = (e.clientY - r.top) / r.height;
    if (x < 0 || y < 0 || x > 1 || y > 1) return;
    return { x, y };
  }
  function draw() {
    const o = overlay.current,
      c = canvas();
    if (!o || !c) return;
    const rect = c.getBoundingClientRect(),
      parent = o.parentElement!.getBoundingClientRect();
    o.style.left = rect.left - parent.left + "px";
    o.style.top = rect.top - parent.top + "px";
    o.style.width = rect.width + "px";
    o.style.height = rect.height + "px";
    o.width = c.width;
    o.height = c.height;
    const ctx = o.getContext("2d")!;
    ctx.clearRect(0, 0, o.width, o.height);
    const crop = effectiveCrop(photo.adjustments, photo.width, photo.height),
      swap = photo.adjustments.rotation % 180 !== 0,
      scale = c.width / (swap ? photo.height * crop.h : photo.width * crop.w);
    if (tool === "mask") {
      for (const edit of photo.adjustments.localEdits || []) {
        if (edit.tool !== "mask" || !edit.visible) continue;
        ctx.strokeStyle = "#af81db";
        ctx.globalAlpha = 0.4;
        ctx.lineWidth =
          2 * edit.radius * Math.min(photo.width, photo.height) * scale;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        edit.points.forEach((p, i) => {
          const q = sourceToDisplay(p, photo);
          if (i) ctx.lineTo(q.x * c.width, q.y * c.height);
          else ctx.moveTo(q.x * c.width, q.y * c.height);
        });
        if (edit.points.length === 1) {
          const q = sourceToDisplay(edit.points[0], photo);
          ctx.lineTo(q.x * c.width + 0.01, q.y * c.height);
        }
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = tool === "mask" ? "#bb92ec" : "#f5e9bb";
    ctx.fillStyle = "#f5e9bb22";
    ctx.lineWidth = Math.max(2, c.width / 400);
    if (tool === "crop" && start.current && stroke.current.length) {
      const p = start.current,
        q = stroke.current[stroke.current.length - 1];
      ctx.strokeRect(
        p.x * c.width,
        p.y * c.height,
        (q.x - p.x) * c.width,
        (q.y - p.y) * c.height,
      );
      ctx.fillRect(
        p.x * c.width,
        p.y * c.height,
        (q.x - p.x) * c.width,
        (q.y - p.y) * c.height,
      );
    } else {
      ctx.lineWidth =
        (radius / 100) * Math.min(photo.width, photo.height) * scale * 2;
      ctx.globalAlpha = 0.35;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      stroke.current.forEach((p, i) =>
        i
          ? ctx.lineTo(p.x * c.width, p.y * c.height)
          : ctx.moveTo(p.x * c.width, p.y * c.height),
      );
      if (stroke.current.length === 1) {
        const p = stroke.current[0];
        ctx.lineTo(p.x * c.width + 0.1, p.y * c.height);
      }
      ctx.stroke();
    }
  }
  useEffect(() => {
    const frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [tool, photo.adjustments, dimensions.w, dimensions.h, loading, zoom]);
  function down(e: PointerEvent) {
    if (before || tool === "view" || photo.previewOnly) return;
    const p = point(e);
    if (!p) return;
    // Le détourage lit l'original, pas l'aperçu : il n'a aucune raison
    // d'attendre le rendu pleine qualité, contrairement aux pinceaux qui
    // peignent sur ce qui est affiché.
    if (tool === "subject") {
      e.preventDefault();
      void detourer(displayToSource(p, photo.adjustments, photo.width, photo.height));
      return;
    }
    if (loading || quality !== "final") return;
    e.preventDefault();
    if (tool === "clone" && (e.altKey || !source)) {
      setSource(displayToSource(p, photo.adjustments, photo.width, photo.height));
      onError("Source du tampon définie. Peignez la zone à corriger.");
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    stroke.current = [p];
    start.current = p;
    draw();
  }
  function move(e: PointerEvent) {
    if (!start.current) return;
    const p = point(e);
    if (p && stroke.current.length < 2000) {
      stroke.current.push(p);
      draw();
    }
  }
  function end() {
    if (!start.current || !stroke.current.length) return;
    // Le cadre se dessine dans le repère redressé ; les pinceaux, eux, se
    // posent sur la source, là où les retouches locales sont appliquées.
    const points = stroke.current.map((p) =>
      tool === "crop"
        ? displayToFrame(p, photo.adjustments, photo.width, photo.height)
        : displayToSource(p, photo.adjustments, photo.width, photo.height),
    );
    if (tool === "crop") {
      const p = points[0],
        q = points[points.length - 1];
      // Un geste, un pas d'annulation : sans groupe, la marge remise à zéro
      // et le cadre faisaient deux pas, et le premier Annuler montrait une
      // photo sans aucun recadrage.
      if (Math.abs(p.x - q.x) > 0.02 && Math.abs(p.y - q.y) > 0.02)
        onAdjust(
          {
            crop: 0,
            cropRect: {
              x: Math.min(p.x, q.x),
              y: Math.min(p.y, q.y),
              w: Math.abs(p.x - q.x),
              h: Math.abs(p.y - q.y),
            },
          },
          "recadrage-" + uid(),
        );
      setTool("view");
    } else if (tool !== "view") {
      const names = {
        exposure: "Lumière locale",
        warmth: "Couleur locale",
        soften: "Adoucissement",
        clone: "Tampon",
        mask: "Zone IA",
        subject: "Sujet détouré",
      };
      const edits = photo.adjustments.localEdits || [];
      if (edits.length >= 100) onError("100 calques maximum par photo.");
      else
        onAdjust({
          localEdits: [
            ...edits,
            {
              id: uid(),
              name: names[tool],
              tool,
              points,
              radius: radius / 100,
              amount,
              opacity: opacity / 100,
              visible: true,
              source: tool === "clone" ? source : undefined,
            },
          ],
        });
    }
    stroke.current = [];
    start.current = undefined;
    overlay.current
      ?.getContext("2d")
      ?.clearRect(0, 0, dimensions.w, dimensions.h);
  }
  const edits = photo.adjustments.localEdits || [];
  return (
    <>
      <div className="retouch-toolbar">
        <label>
          <Brush size={14} />
          <select
            aria-label="Outil de retouche"
            value={tool}
            disabled={before || !!photo.previewOnly}
            onChange={(e) => setTool(e.target.value as Tool)}
          >
            <option value="view">Parcourir</option>
            <option value="crop">Recadrer librement</option>
            <option value="exposure">Pinceau · lumière</option>
            <option value="warmth">Pinceau · couleur</option>
            <option value="soften">Pinceau · adoucir</option>
            <option value="clone">Tampon de duplication</option>
            <option value="subject">Détourer une personne</option>
            <option value="mask">Masque pour l’IA</option>
          </select>
        </label>
        {tool !== "view" && tool !== "crop" && (
          <>
            <Range
              label="Taille du pinceau"
              min={1}
              max={20}
              value={radius}
              unit="%"
              onChange={setRadius}
            />
            {tool !== "mask" && (
              <Range
                label="Opacité du pinceau"
                min={5}
                max={100}
                value={opacity}
                unit="%"
                onChange={setOpacity}
              />
            )}
            {(tool === "exposure" || tool === "warmth") && (
              <label>
                Force
                <input
                  aria-label="Force du pinceau"
                  type="number"
                  min="-2"
                  max="2"
                  step=".1"
                  value={amount}
                  onChange={(e) => setAmount(Number(e.target.value))}
                />
              </label>
            )}
          </>
        )}
        <button
          onClick={() => setLayers(!layers)}
          className={layers ? "selected" : ""}
        >
          Calques · {edits.length}
        </button>
        {photo.adjustments.cropRect && (
          <button
            title="Annuler le cadrage libre"
            onClick={() =>
              onAdjust({ cropRect: undefined, crop: 0 }, "recadrage-" + uid())
            }
          >
            <Crop size={14} />
            <RotateCcw size={12} />
          </button>
        )}
      </div>
      {tool !== "view" && (
        <p className="tool-hint">
          {tool === "crop"
            ? "Dessinez un rectangle sur la photo pour recadrer."
            : tool === "clone"
              ? "Cliquez pour choisir la source, puis peignez. Alt + clic pour changer de source."
              : tool === "mask"
                ? "Peignez la zone à transmettre à l’atelier IA. Le masque ne change pas la photo."
                : tool === "subject"
                  ? subjectBusy
                    ? "Détourage en cours…"
                    : "Cliquez sur une personne : Juno la détoure et n’éclaircit qu’elle. Le premier clic sur une photo demande une seconde ou deux."
                  : "Peignez sur la photo. Chaque geste crée un calque que vous pouvez masquer ou supprimer."}
        </p>
      )}
      <div
        className={`canvas-stage interactive-stage ${zoom ? "zoom" : ""} ${tool !== "view" ? "painting" : ""}`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={() => {
          stroke.current = [];
          start.current = undefined;
          overlay.current
            ?.getContext("2d")
            ?.clearRect(0, 0, dimensions.w, dimensions.h);
        }}
      >
        <div className="canvas-mount" ref={mount} />
        <canvas className="brush-overlay" ref={overlay} />
        {loading && (
          <span className="canvas-loading">
            <Loader2 size={15} className="spin" />{" "}
            {recalculSujet
              ? "Recalcul du détourage"
              : "Affinage de l’aperçu"}
          </span>
        )}
        <span className="preview-tag">
          {photo.previewOnly
            ? "Aperçu partagé · originaux à relier"
            : before
              ? "Original"
              : previewFailed
                ? "Aperçu limité · rendu précis indisponible"
                : quality === "draft"
                  ? "Aperçu rapide · affinage en cours"
                  : "Aperçu retouché"}
        </span>
      </div>
      {layers && (
        <div className="layer-list">
          {!edits.length && (
            <p>
              Choisissez un pinceau et peignez sur la photo pour créer votre
              premier calque.
            </p>
          )}
          {[...edits].reverse().map((e) => (
            <div key={e.id}>
              <button
                aria-label={`${e.visible ? "Masquer" : "Afficher"} ${e.name}`}
                onClick={() =>
                  onAdjust({
                    localEdits: edits.map((x) =>
                      x.id === e.id ? { ...x, visible: !x.visible } : x,
                    ),
                  })
                }
              >
                {e.visible ? <Eye size={14} /> : <EyeOff size={14} />}
              </button>
              <input
                aria-label="Nom du calque"
                value={e.name}
                maxLength={60}
                // Toute la saisie d'un passage dans le champ est un seul pas
                // d'annulation, pas un pas par lettre.
                onFocus={() => (groupeNom.current = "nom-" + uid())}
                onChange={(event) =>
                  onAdjust(
                    {
                      localEdits: edits.map((x) =>
                        x.id === e.id ? { ...x, name: event.target.value } : x,
                      ),
                    },
                    groupeNom.current || "nom-" + e.id,
                  )
                }
              />
              <Range
                label={`Opacité de ${e.name}`}
                min={0}
                max={100}
                value={Math.round(e.opacity * 100)}
                unit="%"
                onChange={(v, group) =>
                  onAdjust(
                    {
                      localEdits: edits.map((x) =>
                        x.id === e.id ? { ...x, opacity: v / 100 } : x,
                      ),
                    },
                    group,
                  )
                }
              />
              <button
                aria-label={`Supprimer ${e.name}`}
                onClick={() =>
                  onAdjust({ localEdits: edits.filter((x) => x.id !== e.id) })
                }
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
