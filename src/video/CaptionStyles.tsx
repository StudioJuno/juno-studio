import type { Sequence, CaptionStyle } from "./types";
import { captionTitle } from "./title-render";
import { CAPTION_PRESETS, captionPreset } from "./caption-presets";
import { titleSizeLimit } from "./transform";
export default function CaptionStyles({
  sequence: s,
  onChange,
}: {
  sequence: Sequence;
  onChange: (s: Sequence) => void;
}) {
  const value = captionTitle(
    { id: "style", text: "", start: 0, duration: 1 },
    s,
  );
  const patch = (part: CaptionStyle) =>
    onChange({ ...s, captionStyle: { ...s.captionStyle, ...part } });
  return (
    <details className="caption-styles" open>
      <summary>Style de tous les sous-titres</summary>
      <label>
        Preset
        <select
          aria-label="Preset de sous-titres"
          value=""
          onChange={(e) =>
            onChange({
              ...s,
              captionStyle: captionPreset(e.target.value, s.width, s.height),
            })
          }
        >
          <option value="">Choisir un style…</option>
          {CAPTION_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <p className="vf-hint">
        Appliqué à tous les sous-titres de cette séquence. Les styles sont
        intégrés à l’image lors de l’export vidéo ; le SRT conserve le texte et
        les temps.
      </p>
      <label>
        Animation des mots
        <select
          aria-label="Animation des mots"
          value={s.captionStyle?.wordMode ?? "none"}
          onChange={(e) =>
            patch({ wordMode: e.target.value as CaptionStyle["wordMode"] })
          }
        >
          <option value="none">Phrase complète</option>
          <option value="highlight">Karaoké · mot surligné</option>
          <option value="single">Un mot à la fois</option>
        </select>
      </label>
      {s.captionStyle?.wordMode === "highlight" && (
        <label>
          Couleur du mot actif
          <input
            aria-label="Couleur du mot actif"
            type="color"
            value={s.captionStyle.highlightColor ?? "#ffe45c"}
            onChange={(e) => patch({ highlightColor: e.target.value })}
          />
        </label>
      )}
      {s.captionStyle?.wordMode && s.captionStyle.wordMode !== "none" && (
        <p className="vf-hint">
          {s.captions.filter((c) => c.words?.length).length} /{" "}
          {s.captions.length} sous-titres synchronisés. Les autres restent
          affichés en phrase complète. Transcrivez le média pour obtenir des
          repères par mot.
        </p>
      )}
      <label>
        Effet d’apparition
        <select
          aria-label="Effet des sous-titres"
          value={s.captionStyle?.effect ?? "none"}
          onChange={(e) =>
            patch({ effect: e.target.value as CaptionStyle["effect"] })
          }
        >
          <option value="none">Aucun</option>
          <option value="pop">Pop social</option>
          <option value="rise">Apparition par le bas</option>
          <option value="fade">Fondu</option>
          <option value="slide">Glissement</option>
        </select>
      </label>
      <div className="vf-title-appearance">
        <label>
          Police
          <select
            value={value.fontFamily ?? "Arial"}
            onChange={(e) =>
              patch({
                fontFamily: e.target.value as CaptionStyle["fontFamily"],
              })
            }
          >
            {["Inter", "Arial", "Georgia", "monospace"].map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </label>
        <label>
          Graisse
          <select
            value={value.fontWeight ?? 600}
            onChange={(e) => patch({ fontWeight: Number(e.target.value) })}
          >
            <option value={400}>Normal</option>
            <option value={600}>Demi-gras</option>
            <option value={700}>Gras</option>
          </select>
        </label>
        {(
          [
            ["size", "Taille (px)", 12, titleSizeLimit(s.height), 1],
            ["y", "Position verticale (%)", 0, 1, 100],
            ["width", "Largeur (%)", 0.1, 1, 100],
            ["strokeWidth", "Contour (px)", 0, 24, 1],
            ["backgroundOpacity", "Opacité du fond (%)", 0, 1, 100],
            ["padding", "Marge (px)", 0, 200, 1],
          ] as const
        ).map(([key, label, min, max, m]) => (
          <label key={key}>
            {label}
            <input
              type="number"
              min={min * m}
              max={max * m}
              value={Math.round((value[key] ?? 0) * m)}
              onChange={(e) => {
                if (e.target.value !== "")
                  patch({
                    [key]: Math.max(
                      min,
                      Math.min(max, Number(e.target.value) / m),
                    ),
                  });
              }}
            />
          </label>
        ))}
        {(
          [
            ["color", "Texte"],
            ["strokeColor", "Contour"],
            ["backgroundColor", "Fond"],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              type="color"
              value={value[key] ?? "#000000"}
              onChange={(e) => patch({ [key]: e.target.value })}
            />
          </label>
        ))}
        {(
          [
            ["uppercase", "Majuscules"],
            ["italic", "Italique"],
            ["shadow", "Ombre"],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={value[key] ?? false}
              onChange={(e) => patch({ [key]: e.target.checked })}
            />
            {label}
          </label>
        ))}
      </div>
      <button onClick={() => onChange({ ...s, captionStyle: undefined })}>
        Rétablir le style classique
      </button>
    </details>
  );
}
