import { useState } from "react";
import { Diamond, Trash2 } from "lucide-react";
import type { Clip, Sequence } from "./types";
import {
  ANIMATION_FIELDS,
  addKey,
  valueAt,
  type AnimatedField,
  type Keyframe,
} from "./animation";
import { timecode } from "./edit";
import { useHeld } from "./playhead-state";
export default function Keyframes({
  clip,
  sequence,
  at,
  onChange,
  onSeek,
}: {
  clip: Clip;
  sequence: Sequence;
  at: number;
  onChange: (clip: Clip) => void;
  onSeek: (frame: number) => void;
}) {
  const [field, setField] = useState<AnimatedField>("x"),
    [easing, setEasing] = useState<Keyframe["easing"]>("smooth"),
    [message, setMessage] = useState("");
  const local = at - clip.start,
    keys = clip.animation?.[field] || [],
    current = valueAt(keys, local, clip[field]);
  const display = (v: number) =>
    field === "gain"
      ? Math.round(20 * Math.log10(Math.max(0.001, v)) * 10) / 10
      : Math.round(v * 10000) / 100;
  // Ce que la personne tape vaut pour la position où elle l'a tapé ; ailleurs,
  // le champ montre la valeur au curseur. Sans effet de remise à zéro : il
  // programmait un rendu de plus à chaque image (playhead-state.ts).
  const [typed, setValue] = useHeld<string>([current, field, clip.id, at]),
    value = typed ?? String(display(current));
  return (
    <details className="vf-keyframes">
      <summary>
        <Diamond size={14} /> Animation · images clés
      </summary>
      <label className="vf-field">
        Propriété
        <select
          value={field}
          onChange={(e) => setField(e.target.value as AnimatedField)}
        >
          {Object.entries(ANIMATION_FIELDS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.name}
            </option>
          ))}
        </select>
      </label>
      <label className="vf-field">
        Valeur ({field === "gain" ? "dB" : "%"})
        <input
          aria-label="Valeur de l’image clé"
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
      <label className="vf-field">
        Vers la prochaine image clé
        <select
          value={easing}
          onChange={(e) => setEasing(e.target.value as Keyframe["easing"])}
        >
          <option value="smooth">Progression douce</option>
          <option value="linear">Linéaire</option>
          <option value="hold">Maintien</option>
        </select>
      </label>
      <button
        disabled={local < 0 || local >= clip.duration}
        onClick={() => {
          try {
            const n = Number(value.replace(",", "."));
            if (!value.trim() || !Number.isFinite(n))
              throw Error("Indiquez un nombre.");
            onChange(
              addKey(
                clip,
                field,
                local,
                field === "gain" ? Math.pow(10, n / 20) : n / 100,
                easing,
              ),
            );
            setMessage("");
          } catch (e) {
            setMessage((e as Error).message);
          }
        }}
      >
        <Diamond size={13} /> Placer au curseur
      </button>
      {message && <p role="status">{message}</p>}
      <div className="vf-key-list">
        {keys.map((k) => (
          <div key={k.frame}>
            <button
              onClick={() =>
                onSeek(
                  Math.max(
                    clip.start,
                    Math.min(
                      clip.start + clip.duration - 1,
                      clip.start + k.frame,
                    ),
                  ),
                )
              }
            >
              {timecode(Math.max(0, k.frame), sequence)} · {display(k.value)}
              {field === "gain" ? " dB" : " %"}
              {k.frame < 0 || k.frame >= clip.duration ? " · hors coupe" : ""}
            </button>
            <button
              aria-label={`Supprimer l’image clé à ${k.frame}`}
              onClick={() =>
                onChange({
                  ...clip,
                  animation: {
                    ...clip.animation,
                    [field]: keys.filter((x) => x.frame !== k.frame),
                  },
                })
              }
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
      <p className="vf-hint">
        Les images clés remplacent la valeur fixe de cette propriété. Les points
        hors de la coupe conservent le mouvement lors du raccourcissement du
        plan.
      </p>
    </details>
  );
}
