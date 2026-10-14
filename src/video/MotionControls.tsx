import { useState } from "react";
import type { Title, Sequence } from "./types";
import {
  MOTION_FIELDS,
  motionAt,
  motionKey,
  motionPreset,
  type MotionField,
} from "./motion";
import { fps, seconds } from "./edit";
import type { Keyframe } from "./animation";
export default function MotionControls({
  title: t,
  sequence: s,
  playhead,
  onPatch,
  onSeek,
  onError,
}: {
  title: Title;
  sequence: Sequence;
  playhead: number;
  onPatch: (p: Partial<Title>) => void;
  onSeek: (frame: number) => void;
  onError: (e: unknown) => void;
}) {
  const [field, setField] = useState<MotionField>("x"),
    [easing, setEasing] = useState<Keyframe["easing"]>("smooth");
  const local = playhead - t.start,
    active = local >= 0 && local < t.duration,
    values = motionAt(t.motion, local),
    range = MOTION_FIELDS[field];
  function key(value: number) {
    try {
      onPatch({
        motion: motionKey(t.motion, field, local, value, t.duration, easing),
      });
    } catch (e) {
      onError(e);
    }
  }
  return (
    <details className="motion-controls">
      <summary>Animation · images clés</summary>
      <label>
        Animation prête à l’emploi
        <select
          aria-label="Preset d’animation"
          value=""
          onChange={(e) =>
            onPatch({
              motion: motionPreset(e.target.value, t.duration, fps(s)),
            })
          }
        >
          <option value="">Choisir…</option>
          <option value="fade">Fondu entrée et sortie</option>
          <option value="rise">Apparition par le bas</option>
          <option value="pop">Pop · réseaux sociaux</option>
          <option value="slide">Glissement latéral</option>
          <option value="none">Aucune animation</option>
        </select>
      </label>
      <p className="vf-hint">
        Les valeurs sont relatives à la position et à la taille de l’élément.
        Placez le curseur, puis ajoutez des points pour composer le mouvement.
      </p>
      <label>
        Propriété
        <select
          aria-label="Propriété animée"
          value={field}
          onChange={(e) => setField(e.target.value as MotionField)}
        >
          {Object.entries(MOTION_FIELDS).map(([k, v]) => (
            <option value={k} key={k}>
              {v.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Interpolation
        <select
          value={easing}
          onChange={(e) => setEasing(e.target.value as Keyframe["easing"])}
        >
          <option value="smooth">Douce</option>
          <option value="linear">Linéaire</option>
          <option value="hold">Maintien</option>
        </select>
      </label>
      <label>
        {range.label}
        {field === "rotation" ? " (°)" : ""}
        <input
          aria-label="Valeur de l’image clé"
          type="number"
          min={range.min}
          max={range.max}
          step={field === "rotation" ? 1 : 0.01}
          disabled={!active}
          value={Math.round(values[field] * 100) / 100}
          onChange={(e) => {
            if (e.target.value !== "") key(Number(e.target.value));
          }}
        />
      </label>
      <button disabled={!active} onClick={() => key(values[field])}>
        Ajouter une clé au curseur
      </button>
      {!active && (
        <button onClick={() => onSeek(t.start)}>
          Aller au début de cet élément
        </button>
      )}
      {(t.motion?.[field] ?? []).map((k) => (
        <div className="motion-key" key={k.frame}>
          <button onClick={() => onSeek(t.start + k.frame)}>
            {seconds(k.frame, s).toFixed(2)} s · {k.value} ·{" "}
            {k.easing === "smooth"
              ? "douce"
              : k.easing === "hold"
                ? "maintien"
                : "linéaire"}
          </button>
          <button
            aria-label={`Supprimer la clé à ${k.frame}`}
            onClick={() =>
              onPatch({
                motion: {
                  ...t.motion,
                  [field]: t.motion?.[field]?.filter(
                    (x) => x.frame !== k.frame,
                  ),
                },
              })
            }
          >
            ×
          </button>
        </div>
      ))}
    </details>
  );
}
