import { graphicLanes } from "./motion";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Film,
  Music2,
  Minus,
  Plus,
  Scissors,
  Trash2,
  Link2,
  Unlink,
  Copy,
  Lock,
  Unlock,
} from "lucide-react";
import type { Asset, Sequence, Clip } from "./types";
import {
  fps,
  length,
  seconds,
  timecode,
  trim,
  moveClip,
  overwriteVideoTrack,
  linkedClips,
  unlink,
  duplicateClip,
} from "./edit";
const DEVERROUILLEZ = "Déverrouillez la piste avant de la modifier.";
export default function Timeline({
  sequence: s,
  assets,
  playhead,
  selected,
  onSelect,
  onSeek,
  onChange,
  onAdd,
  onSplit,
  onRemove,
  onTitleSelect,
  onError,
}: {
  sequence: Sequence;
  assets: Asset[];
  playhead: number;
  selected: string;
  onSelect: (id: string) => void;
  onSeek: (frame: number) => void;
  onChange: (s: Sequence) => void;
  /** `entier` : Maj tenue au lâcher, le rush entier au lieu de ses morceaux utiles. */
  onAdd: (id: string, start: number, track: number, entier?: boolean) => void;
  onSplit: () => void;
  onRemove: () => void;
  onTitleSelect?: (id: string) => void;
  /** Un geste refusé, dit tout haut (piste verrouillée). */
  onError?: (e: unknown) => void;
}) {
  const dragCleanup = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    const height = Math.max(
      200,
      Math.min(
        520,
        Number(localStorage.getItem("juno-timeline-height") || 260),
      ),
    );
    document.documentElement.style.setProperty(
      "--timeline-height",
      height + "px",
    );
  }, []);
  const dragged = useRef(false);
  // La séquence du dernier rendu. Elle ne change pendant un glissement que si
  // le montage a été remplacé (un suivi de masque terminé, repris) : le lâcher
  // réécrirait alors la copie prise au début du geste.
  const shown = useRef(s);
  shown.current = s;
  useEffect(() => () => dragCleanup.current?.(), [s.id]);
  const [scale, setScale] = useState(70),
    [scroll, setScroll] = useState(0),
    [ghost, setGhost] = useState<Sequence | null>(null),
    view = useRef<HTMLDivElement>(null),
    rate = fps(s),
    total = useMemo(() => length(s), [s]),
    width = Math.max(1100, (seconds(total, s) + 15) * scale),
    display = ghost || s,
    titleLanes = graphicLanes(display.titles),
    map = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]),
    tracks = useMemo(
      () =>
        [
          ...new Set([
            0,
            10,
            11,
            ...Object.keys(s.tracks || {}).map(Number),
            ...s.clips.map((c) => c.track),
          ]),
        ].sort((a, b) => (a < 10 && b < 10 ? b - a : a - b)),
      [s.clips, s.tracks],
    ),
    pixel = (f: number) => (f / rate) * scale;
  const locked = (id: string) =>
    linkedClips(s, id).some((x) => s.tracks?.[x.track]?.locked);
  /**
   * Glisser un plan verrouillé : rien ne bouge, et le refus est dit dès que
   * la souris a vraiment bougé, de côté ou vers une autre piste. Un simple
   * clic sélectionne le plan comme avant, sans message.
   */
  function refuseDrag(e: React.PointerEvent) {
    dragCleanup.current?.();
    const startX = e.clientX,
      startY = e.clientY || 0;
    const move = (event: PointerEvent) => {
      if (
        Math.abs(event.clientX - startX) <= 3 &&
        Math.abs((event.clientY || 0) - startY) <= 3
      )
        return;
      dragCleanup.current?.();
      onError?.(DEVERROUILLEZ);
    };
    const stop = () => dragCleanup.current?.();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
    window.addEventListener("pointercancel", stop, { once: true });
    dragCleanup.current = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      dragCleanup.current = undefined;
    };
  }
  function drag(e: React.PointerEvent, c: Clip, edge?: "start" | "end") {
    e.stopPropagation();
    if (e.button !== 0) return;
    if (locked(c.id)) {
      refuseDrag(e);
      return;
    }
    dragCleanup.current?.();
    dragged.current = false;
    const startX = e.clientX,
      original = s;
    let next = s,
      // La souris est sur une autre piste, verrouillée : le plan n'y va pas.
      versVerrouillee = false;
    const move = (event: PointerEvent) => {
      const delta = Math.round(((event.clientX - startX) / scale) * rate);
      if (Math.abs(event.clientX - startX) > 3) dragged.current = true;
      if (edge) {
        next = trim(
          original,
          c.id,
          edge,
          (edge === "start" ? c.start : c.start + c.duration) + delta,
        );
        if (edge === "end") {
          const group = linkedClips(next, c.id);
          const excess = Math.max(
            0,
            ...group.map((x) => {
              const a = map.get(x.assetId);
              return a && a.kind !== "image"
                ? x.duration -
                    Math.max(
                      1,
                      Math.floor(
                        ((a.duration - x.inUs / 1e6) / x.speed) * rate,
                      ),
                    )
                : 0;
            }),
          );
          if (excess)
            next = trim(
              original,
              c.id,
              "end",
              c.start + c.duration + delta - excess,
            );
        }
      } else {
        let pos = Math.max(0, c.start + delta);
        if (!event.altKey) {
          const points = [
            playhead,
            ...original.clips
              .filter((x) => x.id !== c.id)
              .flatMap((x) => [x.start, x.start + x.duration]),
          ];
          const near = points.find((x) => Math.abs(pixel(x - pos)) < 8);
          if (near !== undefined) pos = near;
        }
        const under = document
          .elementFromPoint(event.clientX, event.clientY)
          ?.closest<HTMLElement>("[data-track]");
        const target = under ? Number(under.dataset.track) : c.track;
        const compatible = c.track >= 10 === target >= 10;
        versVerrouillee =
          compatible &&
          target !== c.track &&
          !!original.tracks?.[target]?.locked;
        next = moveClip(original, c.id, pos, compatible ? target : c.track);
      }
      setGhost(next);
    };
    const end = () => {
      dragCleanup.current?.();
      setGhost(null);
      // Lâché sur une piste verrouillée : rien n'est écrit, et le refus est
      // dit (il était muet, ou enregistrait une séquence inchangée).
      if (versVerrouillee) {
        onError?.(DEVERROUILLEZ);
        return;
      }
      if (next === s) return;
      if (shown.current !== original) {
        onError?.(
          "Le montage a été mis à jour pendant le glissement : rien n’a été déplacé. Refaites le geste.",
        );
        return;
      }
      try {
        onChange(
          edge
            ? next
            : overwriteVideoTrack(
                next,
                linkedClips(next, c.id).map((x) => x.id),
              ),
        );
      } catch (error) {
        onError?.(error);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end, { once: true });
    const cancel = () => {
      dragCleanup.current?.();
      setGhost(null);
    };
    window.addEventListener("pointercancel", cancel, { once: true });
    dragCleanup.current = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", cancel);
      dragCleanup.current = undefined;
    };
  }
  function dragFade(e: React.PointerEvent, c: Clip, edge: "start" | "end") {
    e.stopPropagation();
    e.preventDefault();
    if (e.button !== 0) return;
    if (locked(c.id)) {
      refuseDrag(e);
      return;
    }
    dragCleanup.current?.();
    const original = s,
      x = e.clientX;
    let next = s;
    const move = (event: PointerEvent) => {
      const delta = Math.round(((event.clientX - x) / scale) * rate);
      const value = Math.max(
        0,
        Math.min(
          c.duration,
          edge === "start" ? c.fadeIn + delta : c.fadeOut - delta,
        ),
      );
      const ids = new Set(
        c.component === "video"
          ? linkedClips(original, c.id).map((p) => p.id)
          : [c.id],
      );
      next = {
        ...original,
        clips: original.clips.map((p) =>
          ids.has(p.id)
            ? { ...p, [edge === "start" ? "fadeIn" : "fadeOut"]: value }
            : p,
        ),
      };
      setGhost(next);
    };
    const end = () => {
      dragCleanup.current?.();
      setGhost(null);
      if (shown.current === original && next !== original) onChange(next);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end, { once: true });
    const cancel = () => {
      dragCleanup.current?.();
      setGhost(null);
    };
    window.addEventListener("pointercancel", cancel, { once: true });
    dragCleanup.current = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", cancel);
      dragCleanup.current = undefined;
    };
  }
  function dragGain(e: React.PointerEvent, c: Clip) {
    e.stopPropagation();
    e.preventDefault();
    if (e.button !== 0) return;
    if (locked(c.id)) {
      refuseDrag(e);
      return;
    }
    dragCleanup.current?.();
    const original = s,
      y = e.clientY;
    let next = s;
    const move = (event: PointerEvent) => {
      const gain = Math.max(
        0,
        Math.min(
          4,
          Math.round((c.gain + (y - event.clientY) / 35) * 100) / 100,
        ),
      );
      next = {
        ...original,
        clips: original.clips.map((p) => (p.id === c.id ? { ...p, gain } : p)),
      };
      setGhost(next);
    };
    const end = () => {
      dragCleanup.current?.();
      setGhost(null);
      if (shown.current === original && next !== original) onChange(next);
    };
    const cancel = () => {
      dragCleanup.current?.();
      setGhost(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end, { once: true });
    window.addEventListener("pointercancel", cancel, { once: true });
    dragCleanup.current = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", cancel);
      dragCleanup.current = undefined;
    };
  }
  function dragTitle(
    e: React.PointerEvent,
    id: string,
    edge?: "start" | "end",
  ) {
    e.stopPropagation();
    if (e.button !== 0) return;
    dragCleanup.current?.();
    dragged.current = false;
    const original = s,
      t = s.titles.find((x) => x.id === id);
    if (!t) return;
    const x = e.clientX;
    let next = s;
    const move = (event: PointerEvent) => {
      const delta = Math.round(((event.clientX - x) / scale) * rate);
      if (Math.abs(event.clientX - x) > 3) dragged.current = true;
      let start = t.start,
        duration = t.duration;
      if (edge === "start") {
        start = Math.max(
          0,
          Math.min(t.start + t.duration - 1, t.start + delta),
        );
        duration = t.duration + t.start - start;
      } else if (edge === "end") duration = Math.max(1, t.duration + delta);
      else start = Math.max(0, t.start + delta);
      next = {
        ...original,
        titles: original.titles.map((item) =>
          item.id === id ? { ...item, start, duration } : item,
        ),
      };
      setGhost(next);
    };
    const end = () => {
      dragCleanup.current?.();
      setGhost(null);
      if (shown.current === original && next !== original) onChange(next);
    };
    const cancel = () => {
      dragCleanup.current?.();
      setGhost(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end, { once: true });
    window.addEventListener("pointercancel", cancel, { once: true });
    dragCleanup.current = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", cancel);
      dragCleanup.current = undefined;
    };
  }
  function scrub(e: React.PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    onSeek(point(e));
    const move = (event: PointerEvent) => onSeek(point(event));
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end, { once: true });
  }
  const point = (e: { clientX: number }) =>
    Math.max(
      0,
      Math.round(
        ((e.clientX -
          (view.current?.getBoundingClientRect().left || 0) +
          (view.current?.scrollLeft || 0) -
          92) /
          scale) *
          rate,
      ),
    );
  const rulerStep = scale >= 60 ? 2 : 5,
    first = Math.max(0, Math.floor(scroll / scale / rulerStep) - 1),
    ticks = Array.from(
      {
        length:
          Math.ceil((view.current?.clientWidth || 1200) / scale / rulerStep) +
          3,
      },
      (_, i) => (i + first) * rulerStep,
    );
  return (
    <section className="vf-timeline">
      <input
        className="timeline-height"
        aria-label="Hauteur de la timeline"
        type="range"
        min="200"
        max="520"
        defaultValue={Number(
          localStorage.getItem("juno-timeline-height") || 260,
        )}
        onChange={(e) => {
          const value = Math.max(200, Math.min(520, Number(e.target.value)));
          document.documentElement.style.setProperty(
            "--timeline-height",
            value + "px",
          );
          localStorage.setItem("juno-timeline-height", String(value));
        }}
      />
      <div className="vf-timeline-tools">
        <b>
          Timeline <span>{s.name}</span>
        </b>
        <button
          title="Ajouter une piste image au-dessus"
          aria-label="Ajouter une piste image"
          onClick={() => {
            const used = new Set(tracks.filter((t) => t < 10));
            const free = Array.from({ length: 10 }, (_, i) => i).find(
              (i) => !used.has(i),
            );
            if (free === undefined) {
              onError?.("Limite de dix pistes image atteinte.");
              return;
            }
            onChange({
              ...s,
              tracks: { ...s.tracks, [free]: { name: `Vidéo ${free + 1}` } },
            });
          }}
        >
          <Plus size={14} /> Piste image
        </button>
        <button aria-label="Ajouter une piste audio" onClick={() => {
          const free=Array.from({length:10},(_,i)=>i+10).find(n=>!tracks.includes(n));
          if(free === undefined) { onError?.("Limite de dix pistes audio atteinte."); return; }
          onChange({...s,tracks:{...s.tracks,[free]:{name:`Audio ${free-9}`}}});
        }}><Plus size={14}/> Piste son</button>
        <button
          onClick={onSplit}
          disabled={!selected}
          title="Couper au curseur (S)"
        >
          <Scissors size={15} />
          Couper
        </button>
        <button onClick={onRemove} disabled={!selected} title="Retirer le plan">
          <Trash2 size={15} />
        </button>
        <span className="vf-time-display">{timecode(playhead, s)}</span>
        <button
          disabled={!selected}
          onClick={() => {
            // Refus dit tout haut : dupliquer un plan verrouillé laissait une
            // annulation vide et un enregistrement, sans un mot.
            if (locked(selected)) onError?.(DEVERROUILLEZ);
            else onChange(duplicateClip(s, selected));
          }}
          title="Dupliquer le plan et son lien"
        >
          <Copy size={15} />
        </button>
        <button
          disabled={!s.clips.find((c) => c.id === selected)?.linkId}
          onClick={() => onChange(unlink(s, selected))}
          title="Dissocier l’image et le son"
        >
          <Unlink size={15} />
          Dissocier
        </button>
        <div className="vf-timeline-zoom">
          <Minus size={13} />
          <input
            aria-label="Zoom de la timeline"
            type="range"
            min="10"
            max="180"
            value={scale}
            onChange={(e) => setScale(Number(e.target.value))}
          />
          <Plus size={13} />
        </div>
      </div>
      <div
        ref={view}
        className="vf-timeline-scroll"
        onScroll={(e) => setScroll(e.currentTarget.scrollLeft)}
      >
        <div className="vf-timeline-content" style={{ width: width + 92 }}>
          <div className="vf-ruler" onPointerDown={scrub} onClick={(e) => onSeek(point(e))}>
            {ticks.map((t) => (
              <span key={t} style={{ left: 92 + t * scale }}>
                {Math.floor(t / 60)}:{String(t % 60).padStart(2, "0")}
              </span>
            ))}
          </div>
          {titleLanes.map((lane, laneIndex) => (
            <div
              className="vf-title-track"
              key={laneIndex}
              onPointerDown={(e) => {
                if (e.target === e.currentTarget) scrub(e);
              }}
            >
              <div className="vf-track-label">G{laneIndex + 1}</div>
              {lane
                .filter(
                  (t) =>
                    pixel(t.start + t.duration) > scroll - 300 &&
                    pixel(t.start) <
                      scroll + (view.current?.clientWidth || 1500) + 300,
                )
                .map((t) => (
                  <div
                    key={t.id}
                    role="button"
                    tabIndex={0}
                    aria-label={
                      "Modifier " +
                      (t.text || t.graphic?.kind || "élément graphique")
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      if (dragged.current) {
                        dragged.current = false;
                        return;
                      }
                      onSeek(t.start);
                      onTitleSelect?.(t.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSeek(t.start);
                        onTitleSelect?.(t.id);
                      }
                    }}
                    style={{
                      left: 92 + pixel(t.start),
                      width: Math.max(8, pixel(t.duration)),
                    }}
                    onPointerDown={(e) => dragTitle(e, t.id)}
                  >
                    <span
                      className="vf-clip-handle left"
                      title="Ajuster le début du titre"
                      onPointerDown={(e) => dragTitle(e, t.id, "start")}
                    />
                    {t.text || t.graphic?.kind || "Forme"}
                    <span
                      className="vf-clip-handle right"
                      title="Ajuster la fin du titre"
                      onPointerDown={(e) => dragTitle(e, t.id, "end")}
                    />
                  </div>
                ))}
            </div>
          ))}
          {tracks.map((track) => (
            <div
              key={track}
              data-track={track}
              className={`vf-track ${track >= 10 ? "audio" : ""}`}
              onClick={(e) => {
                onSelect("");
                onSeek(point(e));
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData("juno-video-asset");
                if (id) onAdd(id, point(e), track, e.shiftKey);
              }}
            >
              <div className="vf-track-label">
                {track < 10 ? <Film size={14} /> : <Music2 size={14} />}
                <b>{track < 10 ? "V" + (track + 1) : "A" + (track - 9)}</b>
                {track >= 10 && <button className="track-state" aria-label={`Couper le son A${track-9}`} aria-pressed={!!s.tracks?.[track]?.muted} onClick={()=>onChange({...s,tracks:{...s.tracks,[track]:{...s.tracks?.[track],muted:!s.tracks?.[track]?.muted}}})}>M</button>}
                {track >= 10 && <button className="track-state" aria-label={`Solo A${track-9}`} aria-pressed={!!s.tracks?.[track]?.solo} onClick={()=>onChange({...s,tracks:{...s.tracks,[track]:{...s.tracks?.[track],solo:!s.tracks?.[track]?.solo}}})}>S</button>}

                <button
                  className="track-state"
                  aria-label={`${s.tracks?.[track]?.locked ? "Déverrouiller" : "Verrouiller"} ${track < 10 ? "V" + (track + 1) : "A" + (track - 9)}`}
                  aria-pressed={!!s.tracks?.[track]?.locked}
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange({
                      ...s,
                      tracks: {
                        ...s.tracks,
                        [track]: {
                          ...s.tracks?.[track],
                          locked: !s.tracks?.[track]?.locked,
                        },
                      },
                    });
                  }}
                >
                  {s.tracks?.[track]?.locked ? (
                    <Lock size={12} />
                  ) : (
                    <Unlock size={12} />
                  )}
                </button>
              </div>
              {display.clips
                .filter(
                  (c) =>
                    c.track === track &&
                    pixel(c.start + c.duration) > scroll - 300 &&
                    pixel(c.start) <
                      scroll + (view.current?.clientWidth || 1500) + 300,
                )
                .map((c) => {
                  const a = map.get(c.assetId);
                  return (
                    <div
                      key={c.id}
                      className={`vf-clip ${selected === c.id ? "selected" : ""} ${c.component === "audio" ? "audio" : a?.kind || ""}`}
                      role="button"
                      tabIndex={0}
                      aria-label={`Plan ${a?.name || "Média manquant"}`}
                      style={{
                        left: 92 + pixel(c.start),
                        width: Math.max(8, pixel(c.duration)),
                      }}
                      onPointerDown={(e) => drag(e, c)}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (dragged.current) {
                          dragged.current = false;
                          return;
                        }
                        onSelect(c.id);
                        onSeek(c.start);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          onSelect(c.id);
                          onSeek(c.start);
                        }
                      }}
                    >
                      <span
                        className="vf-clip-handle left"
                        onPointerDown={(e) => drag(e, c, "start")}
                      />
                      {a?.thumbnail &&
                        c.component !== "audio" &&
                        track < 10 && (
                          <img draggable={false} src={a.thumbnail} />
                        )}
                      <span className="vf-clip-name">{a?.name}</span>
                      <span
                        className="vf-fade-shade in"
                        style={{ width: pixel(c.fadeIn) }}
                      />
                      <span
                        className="vf-fade-shade out"
                        style={{ width: pixel(c.fadeOut) }}
                      />
                      <button
                        className="vf-fade-handle in"
                        aria-label={`Fondu d’entrée de ${a?.name || "plan"}`}
                        title={`Fondu d’entrée · ${seconds(c.fadeIn, s).toFixed(2)} s`}
                        style={{
                          left: Math.min(
                            pixel(c.fadeIn),
                            Math.max(0, pixel(c.duration) - 12),
                          ),
                        }}
                        onPointerDown={(e) => dragFade(e, c, "start")}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <button
                        className="vf-fade-handle out"
                        aria-label={`Fondu de sortie de ${a?.name || "plan"}`}
                        title={`Fondu de sortie · ${seconds(c.fadeOut, s).toFixed(2)} s`}
                        style={{
                          right: Math.min(
                            pixel(c.fadeOut),
                            Math.max(0, pixel(c.duration) - 12),
                          ),
                        }}
                        onPointerDown={(e) => dragFade(e, c, "end")}
                        onClick={(e) => e.stopPropagation()}
                      />
                      {c.linkId && <Link2 size={11} className="clip-linked" />}
                      {a?.waveform && c.component !== "video" && (
                        <svg
                          className="vf-wave"
                          viewBox="0 0 300 30"
                          preserveAspectRatio="none"
                        >
                          <path
                            d={Array.from({ length: 150 }, (_, i) => {
                              const t =
                                  c.inUs / 1e6 +
                                  seconds((c.duration * i) / 150, s) * c.speed,
                                idx = Math.min(
                                  a.waveform!.length - 1,
                                  Math.floor(
                                    (t / a.duration) * a.waveform!.length,
                                  ),
                                ),
                                v = Math.min(1, a.waveform![idx] || 0) * 14;
                              return `M${i * 2},${15 - v}v${v * 2}`;
                            }).join(" ")}
                            fill="none"
                            stroke="currentColor"
                          />
                        </svg>
                      )}
                      {(track >= 10 || c.component === "audio") && (
                        <button
                          className="vf-gain-line"
                          aria-label={`Volume de ${a?.name || "son"} · ${Math.round(c.gain * 100)} %`}
                          title={`Volume · ${Math.round(c.gain * 100)} % · glisser verticalement`}
                          style={{
                            top: `${Math.max(17, Math.min(81, 85 - c.gain * 27))}%`,
                          }}
                          onPointerDown={(e) => dragGain(e, c)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      )}
                      <span
                        className="vf-clip-handle right"
                        onPointerDown={(e) => drag(e, c, "end")}
                      />
                    </div>
                  );
                })}
            </div>
          ))}
          <div
            className="vf-playhead"
            role="slider"
            aria-label="Tête de lecture"
            aria-valuemin={0}
            aria-valuemax={Math.max(0, total)}
            aria-valuenow={playhead}
            tabIndex={0}
            onPointerDown={scrub}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                e.preventDefault();
                e.stopPropagation();
                onSeek(
                  Math.max(
                    0,
                    Math.min(
                      total,
                      playhead + (e.key === "ArrowRight" ? 1 : -1),
                    ),
                  ),
                );
              }
            }}
            style={{
              left: 92 + pixel(playhead),
              height: tracks.length * 48 + 30 + titleLanes.length * 32,
            }}
          >
            <span />
          </div>
        </div>
      </div>
    </section>
  );
}
