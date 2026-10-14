import { correctCaptionWord, captionIssues } from "./transcript-correction";
import type { Caption, Sequence } from "./types";
import { frame, seconds } from "./edit";
export default function CaptionWords({
  caption: c,
  sequence: s,
  onChange,
  onSeek,
}: {
  caption: Caption;
  sequence: Sequence;
  onChange: (c: Caption) => void;
  onSeek: (frame: number) => void;
}) {
  if (!c.words?.length)
    return (
      <p className="vf-hint">
        Pas de repères par mot. Une transcription locale peut les créer.
        Modifier le texte complet retire ses anciens repères ; Annuler permet de
        les retrouver.
      </p>
    );
  return (
    <details className="caption-word-editor">
      <summary>Synchronisation des mots · {c.words.length}</summary>
      <p className="vf-hint">
        Temps relatifs au début du sous-titre. Cliquez sur un mot pour le
        retrouver dans l’aperçu. Modifier le texte complet retire ses repères.
      </p>
      {captionIssues(c, s.fps).map((issue) => (
        <p className="vf-hint vf-warning" key={issue}>
          {issue}
        </p>
      ))}
      {c.words.map((w, i) => (
        <div className="vf-title-timing" key={i}>
          <input
            aria-label={`Corriger le mot ${i + 1}`}
            className={
              w.confidence !== undefined && w.confidence < 0.65
                ? "uncertain-word"
                : ""
            }
            key={c.text.slice(w.from, w.to)}
            defaultValue={c.text.slice(w.from, w.to)}
            onBlur={(e) => {
              const next = correctCaptionWord(c, i, e.target.value);
              if (next === c) e.target.value = c.text.slice(w.from, w.to);
              else onChange(next);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
          />
          <button
            aria-label={`Afficher au mot ${i + 1}`}
            onClick={() => onSeek(c.start + w.start)}
          >
            {c.text.slice(w.from, w.to)}
          </button>
          {(["start", "end"] as const).map((edge) => (
            <label key={edge}>
              {edge === "start" ? "Début" : "Fin"} (s)
              <input
                aria-label={`${edge === "start" ? "Début" : "Fin"} du mot ${i + 1}`}
                type="number"
                min={0}
                step={s.fps.d / s.fps.n}
                key={`${edge}-${w[edge]}`}
                defaultValue={Number(seconds(w[edge], s).toFixed(3))}
                onBlur={(e) => {
                  const v = Number(e.target.value);
                  if (e.target.value === "" || !Number.isFinite(v)) {
                    e.target.value = String(seconds(w[edge], s));
                    return;
                  }
                  const min =
                      edge === "start"
                        ? (c.words![i - 1]?.end ?? 0)
                        : w.start + 1,
                    max =
                      edge === "start"
                        ? w.end - 1
                        : (c.words![i + 1]?.start ?? c.duration);
                  const value = Math.max(min, Math.min(max, frame(v, s)));
                  e.target.value = String(Number(seconds(value, s).toFixed(3)));
                  if (value !== w[edge])
                    onChange({
                      ...c,
                      words: c.words!.map((word, j) =>
                        j === i ? { ...word, [edge]: value } : word,
                      ),
                    });
                }}
              />
            </label>
          ))}
        </div>
      ))}
    </details>
  );
}
