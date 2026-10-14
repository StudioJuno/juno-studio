import { sourceToDisplay } from "./ai-mask";
import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Heart,
  X,
  Lock,
  ZoomIn,
} from "lucide-react";
import type { Photo, Point } from "../model";
import { groupSuggestions } from "./culling";
import { priorityPeople } from "./people-store";
import { useThumbnail } from "./PhotoThumbnail";
import { renderPhoto, toBlob } from "../image";
function Frame({
  photo,
  zoom,
  center,
  faceFocus,
  onCenter,
  onRate,
  onProtect,
}: {
  photo: Photo;
  zoom: number;
  center: Point;
  faceFocus: boolean;
  onCenter: (p: Point) => void;
  onRate: (p: Photo, s: Photo["status"]) => void;
  onProtect: (p: Photo) => void;
}) {
  const region = photo.analysis?.faces?.regions?.[0];
  const focus =
    faceFocus && region
      ? sourceToDisplay(
          { x: region.x + region.w / 2, y: region.y + region.h / 2 },
          photo,
        )
      : center;
  const thumbnail = useThumbnail(photo),
    [image, setImage] = useState("");
  useEffect(() => {
    let live = true,
      url = "";
    const controller = new AbortController();
    setImage("");
    if (!photo.previewOnly)
      void renderPhoto(photo, photo.adjustments, 1600, controller.signal)
        .then(async (c) => {
          try {
            const blob = await toBlob(c, "image/jpeg", 0.9);
            if (live) {
              url = URL.createObjectURL(blob);
              setImage(url);
            }
          } finally {
            c.width = c.height = 1;
          }
        })
        .catch(() => {});
    return () => {
      live = false;
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [photo.id, photo.adjustments]);
  return (
    <article className={`compare-frame ${photo.status}`}>
      <div
        className="compare-image"
        onPointerMove={(e) => {
          if (e.buttons !== 1 || zoom === 1) return;
          const r = e.currentTarget.getBoundingClientRect();
          onCenter({
            x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
            y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
          });
        }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          if (zoom > 1) {
            const r = e.currentTarget.getBoundingClientRect();
            onCenter({
              x: (e.clientX - r.left) / r.width,
              y: (e.clientY - r.top) / r.height,
            });
          }
        }}
      >
        {(image || thumbnail) && (
          <img
            src={image || thumbnail}
            draggable={false}
            alt={photo.name}
            style={{
              transform: `scale(${zoom})`,
              transformOrigin: `${focus.x * 100}% ${focus.y * 100}%`,
            }}
          />
        )}
        <span className="compare-status">
          {photo.status === "keep"
            ? "Gardée"
            : photo.status === "reject"
              ? "Écartée"
              : photo.analysis?.suggested
                ? "Proposée"
                : "À décider"}
        </span>
      </div>
      <div className="compare-caption">
        <b>{photo.name}</b>
        <small>
          {photo.analysis?.faces
            ? `${photo.analysis.faces.count} visage(s) · ${photo.analysis.faces.closedEyes} yeux possiblement fermés`
            : "Vérifiez la netteté et l’expression"}
          {photo.color ? ` · ${photo.color.space}` : ""}
        </small>
        <div>
          <button
            className={photo.status === "keep" ? "selected" : ""}
            onClick={() => onRate(photo, "keep")}
          >
            <Heart size={14} /> Garder
          </button>
          <button
            disabled={photo.protected}
            onClick={() => onRate(photo, "reject")}
          >
            <X size={14} /> Écarter
          </button>
          <button
            aria-label={
              photo.protected
                ? "Déprotéger " + photo.name
                : "Protéger " + photo.name
            }
            onClick={() => onProtect(photo)}
          >
            <Lock size={14} />
            {photo.protected ? "Protégée" : "Protéger"}
          </button>
        </div>
      </div>
    </article>
  );
}
export default function ComparePanel({
  photos,
  currentId,
  onRate,
  onProtect,
  onClose,
}: {
  photos: Photo[];
  currentId?: string;
  onRate: (p: Photo, s: Photo["status"]) => void;
  onProtect: (p: Photo) => void;
  onClose: () => void;
}) {
  const groups = useMemo(() => {
    // Avec les personnes désignées, comme la passe d'album : sans elles, la
    // vue proposait une autre image que celle gardée.
    const ranked = groupSuggestions(
        photos,
        photos[0] ? priorityPeople(photos[0].projectId).map((p) => p.id) : [],
      ),
      map = new Map<string, Photo[]>();
    for (const p of ranked) {
      const id = p.analysis?.groupId || p.id;
      const group = map.get(id) || [];
      group.push(p);
      map.set(id, group);
    }
    return [...map.values()].filter((g) => g.length > 1);
  }, [photos]);
  const [index, setIndex] = useState(() =>
      Math.max(
        0,
        groups.findIndex((g) => g.some((p) => p.id === currentId)),
      ),
    ),
    [count, setCount] = useState(2),
    [offset, setOffset] = useState(0),
    [zoom, setZoom] = useState(1),
    [faceFocus, setFaceFocus] = useState(false),
    [center, setCenter] = useState<Point>({ x: 0.5, y: 0.5 });
  const group = groups[Math.min(index, groups.length - 1)] || [],
    shown = group.slice(offset, offset + count);
  function navigate(n: number) {
    setIndex((i) => Math.max(0, Math.min(groups.length - 1, i + n)));
    setOffset(0);
    setZoom(1);
    setCenter({ x: 0.5, y: 0.5 });
  }
  return (
    <section className="compare-panel">
      <div className="compare-toolbar">
        <button className="text-button" onClick={onClose}>
          <ChevronLeft size={15} /> Toutes les photos
        </button>
        <b>Comparer les rafales</b>
        <label>
          Images
          <select
            aria-label="Nombre d’images comparées"
            value={count}
            onChange={(e) => {
              setCount(Number(e.target.value));
              setOffset(0);
            }}
          >
            <option value={2}>2</option>
            <option value={3}>3</option>
            <option value={4}>4</option>
          </select>
        </label>
        <button
          className="text-button"
          disabled={!shown.some((p) => p.analysis?.faces?.regions?.length)}
          onClick={() => {
            setFaceFocus(!faceFocus);
            setZoom(faceFocus ? 1 : 3);
          }}
        >
          Visages
        </button>
        <label>
          <ZoomIn size={15} /> Zoom lié
          <input
            aria-label="Zoom de comparaison"
            type="range"
            min={1}
            max={4}
            step={0.25}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
        </label>
      </div>
      {!groups.length ? (
        <div className="empty-state">
          <h3>Aucune rafale repérée</h3>
          <p>
            Importez des images proches ou lancez l’analyse du projet. Vos
            sélections restent modifiables à tout moment.
          </p>
        </div>
      ) : (
        <>
          <div className="compare-navigation">
            <button
              aria-label="Rafale précédente"
              disabled={index === 0}
              onClick={() => navigate(-1)}
            >
              <ChevronLeft size={17} />
            </button>
            <span>
              Rafale {Math.min(index + 1, groups.length)} / {groups.length} ·{" "}
              {group.length} images similaires
            </span>
            <button
              aria-label="Rafale suivante"
              disabled={index >= groups.length - 1}
              onClick={() => navigate(1)}
            >
              <ChevronRight size={17} />
            </button>
            <span className="micro-note">
              Cliquez et glissez pour déplacer le zoom sur toutes les images.
            </span>
          </div>
          <div
            className="compare-grid"
            style={{
              gridTemplateColumns: `repeat(${Math.min(count, shown.length)},minmax(0,1fr))`,
            }}
          >
            {shown.map((p) => (
              <Frame
                key={p.id}
                photo={p}
                zoom={zoom}
                center={center}
                faceFocus={faceFocus}
                onCenter={(p) => {
                  setFaceFocus(false);
                  setCenter(p);
                }}
                onRate={onRate}
                onProtect={onProtect}
              />
            ))}
          </div>
          {group.length > count && (
            <div className="compare-navigation">
              <button
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - count))}
              >
                Images précédentes
              </button>
              <span>
                {offset + 1}–{Math.min(offset + count, group.length)} /{" "}
                {group.length}
              </span>
              <button
                disabled={offset + count >= group.length}
                onClick={() => setOffset(offset + count)}
              >
                Images suivantes
              </button>
            </div>
          )}
          <p className="micro-note">
            Le regroupement est une proposition. Une image protégée ne peut pas
            être écartée. Aucune décision ne supprime un original.
          </p>
        </>
      )}
    </section>
  );
}
