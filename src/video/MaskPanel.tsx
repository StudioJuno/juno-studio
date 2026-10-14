import { Plus, Trash2, Crosshair } from "lucide-react";
import type { Clip, Mask, Sequence } from "./types";
import {
  MASK_EFFECTS,
  MASK_LIMIT,
  MASK_SHAPES,
  maskAt,
  newMask,
  removeMaskKey,
  setMaskKey,
} from "./masks";
import NumericRange from "../modules/NumericRange";
export default function MaskPanel({
  clip,
  sequence,
  playhead,
  selected,
  onSelect,
  onChange,
  onTrack,
  onError,
  tracking,
}: {
  clip: Clip;
  sequence: Sequence;
  playhead: number;
  selected: string;
  onSelect: (id: string) => void;
  /** Rend `false` quand les masques sont refusés (piste verrouillée...). */
  onChange: (masks: Mask[]) => boolean | void;
  onTrack: (mask: Mask) => void;
  onError: (e: unknown) => void;
  tracking: boolean;
}) {
  const masks = clip.masks ?? [],
    local = playhead - clip.start,
    inside = local >= 0 && local < clip.duration;
  // Le refus remonte jusqu'au champ numérique, qui reprend la vraie valeur au
  // lieu de garder le texte tapé.
  const patch = (id: string, part: Partial<Mask>) =>
    onChange(masks.map((m) => (m.id === id ? { ...m, ...part } : m)));
  const guard = (run: () => void) => {
    try {
      run();
    } catch (e) {
      onError(e);
    }
  };
  return (
    <div className="vf-masks">
      <div className="vf-panel-heading">
        <h2>Masques du plan</h2>
        <button
          aria-label="Ajouter un masque"
          disabled={masks.length >= MASK_LIMIT}
          onClick={() => {
            const added = {
              ...newMask(),
              keys: [
                {
                  frame: Math.max(0, Math.min(clip.duration - 1, local)),
                  x: 0.5,
                  y: 0.5,
                },
              ],
            };
            if (onChange([...masks, added]) !== false) onSelect(added.id);
          }}
        >
          <Plus size={16} />
        </button>
      </div>
      {!masks.length && (
        <p className="vf-hint">
          Un masque cache une zone du plan : flou, pixelisation ou cache plein.
          Sa taille reste constante ; seule sa position suit le sujet.
        </p>
      )}
      {masks.map((m) => {
        const key = m.keys.find((k) => k.frame === local),
          here = maskAt(m, local);
        return (
          <article
            key={m.id}
            className={selected === m.id ? "vf-mask selected" : "vf-mask"}
          >
            <header>
              <button
                aria-label={"Choisir le masque " + (m.name || m.effect)}
                onClick={() => onSelect(m.id)}
              >
                {m.name ||
                  MASK_EFFECTS.find((e) => e.id === m.effect)?.name ||
                  m.effect}
              </button>
              <button
                aria-label="Supprimer le masque"
                onClick={() => onChange(masks.filter((x) => x.id !== m.id))}
              >
                <Trash2 size={13} />
              </button>
            </header>
            <label>
              Effet
              <select
                aria-label="Effet du masque"
                value={m.effect}
                onChange={(e) =>
                  patch(m.id, { effect: e.target.value as Mask["effect"] })
                }
              >
                {MASK_EFFECTS.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Forme
              <select
                aria-label="Forme du masque"
                value={m.shape}
                onChange={(e) =>
                  patch(m.id, { shape: e.target.value as Mask["shape"] })
                }
              >
                {MASK_SHAPES.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
            {m.effect === "solid" && (
              <label>
                Couleur du cache
                <input
                  type="color"
                  aria-label="Couleur du cache"
                  value={m.color ?? "#000000"}
                  onChange={(e) => patch(m.id, { color: e.target.value })}
                />
              </label>
            )}
            {(
              [
                ["width", "Largeur (%)", 1, 100, 100],
                ["height", "Hauteur (%)", 1, 100, 100],
                ["strength", "Intensité (%)", 0, 100, 100],
                ["feather", "Contour doux (%)", 0, 50, 100],
              ] as const
            ).map(([field, label, min, max, mult]) => (
              <NumericRange
                key={field}
                label={label}
                min={min}
                max={max}
                step={1}
                value={Math.round(m[field] * mult)}
                onChange={(v) => patch(m.id, { [field]: v / mult })}
              />
            ))}
            <div className="vf-mask-keys">
              <span>
                Repères · {m.keys.length}
                {inside
                  ? ` · ici ${Math.round(here.x * 100)} % / ${Math.round(here.y * 100)} %`
                  : " · curseur hors du plan"}
              </span>
              <button
                disabled={!inside}
                aria-label="Poser un repère de position"
                onClick={() =>
                  guard(() =>
                    patch(
                      m.id,
                      setMaskKey(m, local, here.x, here.y) as Partial<Mask>,
                    ),
                  )
                }
              >
                Poser un repère
              </button>
              <button
                disabled={!key || m.keys.length < 2}
                aria-label="Retirer le repère de cette image"
                onClick={() => patch(m.id, removeMaskKey(m, local))}
              >
                Retirer
              </button>
              <button
                disabled={!inside || tracking}
                aria-label="Suivre automatiquement le sujet"
                onClick={() => onTrack(m)}
              >
                <Crosshair size={13} />
                {tracking ? "Suivi en cours…" : "Suivre le sujet"}
              </button>
            </div>
            {m.tracked && (
              <p className="vf-hint">
                Suivi calculé sur ce plan. Contrôlez le résultat : un sujet qui
                sort du cadre ou change de lumière peut faire dériver le masque.
              </p>
            )}
          </article>
        );
      })}
    </div>
  );
}
