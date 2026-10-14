import { useId, useRef, useState } from "react";
import { uid } from "../model";

export function parseSetting(
  text: string,
  min: number,
  max: number,
  step: number,
): number | undefined {
  const normalized = text.trim().replace(",", ".");
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return;
  const value = Number(normalized);
  if (!Number.isFinite(value)) return;
  return Number(
    Math.max(min, Math.min(max, Math.round(value / step) * step)).toFixed(6),
  );
}

/** Le texte montré pour une valeur : trois décimales au plus. */
const format = (value: number) => String(Number(value.toFixed(3)));

export default function NumericRange({
  label,
  value,
  min = -100,
  max = 100,
  step = 1,
  unit = "",
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /**
   * Une valeur choisie. Renvoyer `false` dit qu'elle a été refusée (tête hors
   * du plan, piste verrouillée...) : le champ reprend alors la vraie valeur au
   * lieu de garder le texte tapé.
   */
  onChange: (value: number, group?: string) => boolean | void;
}) {
  const id = useId();
  // Le texte du champ, et la valeur qu'il reflétait quand il a été posé.
  // Hors saisie, dès que la valeur change (la tête qui avance sous un plan
  // animé, une annulation), le champ montre la nouvelle valeur. C'est ajusté
  // pendant le rendu même, pas dans un effet : un effet qui remettait le texte
  // à jour programmait un rendu de plus à chaque image d'un plan animé, et une
  // rafale de flèches finissait en erreur React 185 avec des touches perdues
  // (src/video/playhead-state.ts). Pendant la saisie, le texte tapé reste.
  const [shown, setShown] = useState(() => ({ text: format(value), value }));
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const cancelled = useRef(false),
    // Le texte du champ au moment où l'on y est entré.
    entered = useRef<string | undefined>(undefined),
    group = useRef<string | undefined>(undefined);
  const stale = !editing && !Object.is(shown.value, value);
  if (stale) setShown({ text: format(value), value });
  const text = stale ? format(value) : shown.text;
  const setText = (next: string) => setShown({ text: next, value });
  // Le champ montre de nouveau la valeur, et la suit.
  const follow = () => setShown({ text: format(value), value });
  function commit() {
    setEditing(false);
    const untouched = text === entered.current;
    entered.current = undefined;
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    // Rien n'a été tapé : rien n'est écrit. Le texte montré n'est qu'un
    // arrondi de la valeur (trois décimales, figées pendant la lecture) :
    // l'écrire posait une image clé sur un plan animé, arrondissait au pas un
    // réglage exact et faisait passer un plan recadré en « Réglé à la main ».
    if (untouched) {
      follow();
      return;
    }
    const next = parseSetting(text, min, max, step);
    if (next === undefined) {
      setText(String(value));
      setError("Saisissez un nombre.");
      return;
    }
    setError("");
    if (next !== value && onChange(next, uid()) === false) follow();
    else setText(String(next));
  }
  return (
    <div className="range-row numeric-range">
      <div className="range-heading">
        <label htmlFor={id}>{label}</label>
        <div className="range-value">
          <input
            id={id}
            aria-label={`${label} : valeur`}
            type="text"
            inputMode="decimal"
            value={text}
            aria-invalid={!!error}
            aria-describedby={error ? `${id}-error` : undefined}
            onFocus={() => {
              entered.current = text;
              setEditing(true);
              setError("");
            }}
            onChange={(e) => {
              const typed = e.target.value;
              setShown((s) => ({ ...s, text: typed }));
            }}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                cancelled.current = true;
                setText(String(value));
                e.currentTarget.blur();
              }
              if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                e.preventDefault();
                const base = parseSetting(text, min, max, step) ?? value;
                const stepped = String(
                  parseSetting(
                    String(
                      base +
                        (e.key === "ArrowUp" ? 1 : -1) *
                          step *
                          (e.shiftKey ? 10 : 1),
                    ),
                    min,
                    max,
                    step,
                  ),
                );
                setShown((s) => ({ ...s, text: stepped }));
              }
            }}
          />
          {unit && <span>{unit}</span>}
        </div>
      </div>
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onPointerDown={() => {
          group.current = uid();
        }}
        onPointerUp={() => {
          group.current = undefined;
        }}
        onPointerCancel={() => {
          group.current = undefined;
        }}
        onKeyDown={(e) => {
          if (!e.repeat) group.current = uid();
        }}
        onKeyUp={() => {
          group.current = undefined;
        }}
        onBlur={() => {
          group.current = undefined;
        }}
        onChange={(e) => {
          group.current ||= uid();
          onChange(Number(e.target.value), group.current);
        }}
      />
      {error && (
        <small id={`${id}-error`} role="alert">
          {error}
        </small>
      )}
    </div>
  );
}
