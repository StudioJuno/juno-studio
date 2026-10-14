import { useRef, useState } from "react";
import type { PointerEvent } from "react";
import { RotateCcw } from "lucide-react";
import { uid, type Adjustments, type Point } from "../model";
import {
  COLOR_BANDS,
  IDENTITY_CURVE,
  type ColorBand,
  type Curves,
} from "./advanced-color";
import Range from "./NumericRange";
type Props = {
  adjustments: Adjustments;
  onAdjust: (patch: Partial<Adjustments>, group?: string) => void;
};
export default function AdvancedAdjustments({
  adjustments: a,
  onAdjust,
}: Props) {
  const [channel, setChannel] = useState<keyof Curves>("rgb"),
    [band, setBand] = useState<ColorBand>("orange"),
    [selected, setSelected] = useState(0);
  const points = a.curves?.[channel] || IDENTITY_CURVE;
  const latest = useRef(points);
  latest.current = points;
  const drag = useRef<{ index: number; group: string } | undefined>(undefined);
  const index = Math.min(selected, points.length - 1),
    point = points[index];
  const mix = a.colorMix?.[band] || { hue: 0, saturation: 0, luminance: 0 };
  function curve(next: Point[], group?: string) {
    latest.current = next;
    onAdjust({ curves: { ...a.curves, [channel]: next } }, group);
  }
  function setPoint(i: number, p: Point, group?: string) {
    const list = latest.current;
    const x =
      i === 0
        ? 0
        : i === list.length - 1
          ? 1
          : Math.max(
              list[i - 1].x + 0.005,
              Math.min(list[i + 1].x - 0.005, p.x),
            );
    curve(
      list.map((old, n) =>
        n === i ? { x, y: Math.max(0, Math.min(1, p.y)) } : old,
      ),
      group,
    );
  }
  function position(e: PointerEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height)),
    };
  }
  function start(e: PointerEvent<SVGSVGElement>) {
    e.preventDefault();
    const target = e.target as Element,
      hit = target.getAttribute("data-point");
    let i = hit === null ? -1 : Number(hit);
    const group = uid();
    if (i < 0) {
      if (points.length >= 16) return;
      const p = position(e);
      if (
        p.x < 0.005 ||
        p.x > 0.995 ||
        points.some((pt) => Math.abs(pt.x - p.x) < 0.01)
      )
        return;
      const next = [...points, p].sort((l, r) => l.x - r.x);
      i = next.indexOf(p);
      curve(next, group);
    }
    setSelected(i);
    drag.current = { index: i, group };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function preset(kind: string) {
    setSelected(0);
    curve(
      kind === "contrast"
        ? [
            { x: 0, y: 0 },
            { x: 0.25, y: 0.18 },
            { x: 0.75, y: 0.82 },
            { x: 1, y: 1 },
          ]
        : kind === "soft"
          ? [
              { x: 0, y: 0.06 },
              { x: 0.5, y: 0.5 },
              { x: 1, y: 0.94 },
            ]
          : IDENTITY_CURVE.map((p) => ({ ...p })),
    );
  }
  return (
    <div className="advanced-adjustments">
      <details open>
        <summary>Tonalité & présence</summary>
        <Range
          label="Blancs"
          value={a.whites || 0}
          onChange={(v, g) => onAdjust({ whites: v }, g)}
        />
        <Range
          label="Noirs"
          value={a.blacks || 0}
          onChange={(v, g) => onAdjust({ blacks: v }, g)}
        />
        <Range
          label="Vibrance"
          value={a.vibrance || 0}
          onChange={(v, g) => onAdjust({ vibrance: v }, g)}
        />
        <Range
          label="Clarté"
          value={a.clarity || 0}
          onChange={(v, g) => onAdjust({ clarity: v }, g)}
        />
      </details>
      <details>
        <summary>Courbes de tonalité</summary>
        <div className="curve-options">
          <label>
            Canal{" "}
            <select
              aria-label="Canal de la courbe"
              value={channel}
              onChange={(e) => {
                setChannel(e.target.value as keyof Curves);
                setSelected(0);
              }}
            >
              <option value="rgb">RVB global</option>
              <option value="red">Rouge</option>
              <option value="green">Vert</option>
              <option value="blue">Bleu</option>
            </select>
          </label>
          <select
            aria-label="Préréglage de courbe"
            value=""
            onChange={(e) => preset(e.target.value)}
          >
            <option value="" disabled>
              Préréglage
            </option>
            <option value="linear">Linéaire</option>
            <option value="contrast">Contraste doux</option>
            <option value="soft">Noirs adoucis</option>
          </select>
        </div>
        <svg
          className={`tone-curve ${channel}`}
          viewBox="0 0 240 240"
          role="img"
          aria-label="Courbe entrée-sortie, du noir au blanc. Ajoutez ou déplacez un point, ou utilisez les champs ci-dessous."
          onPointerDown={start}
          onPointerMove={(e) => {
            if (drag.current)
              setPoint(drag.current.index, position(e), drag.current.group);
          }}
          onPointerUp={() => {
            drag.current = undefined;
          }}
          onPointerCancel={() => {
            drag.current = undefined;
          }}
        >
          {[60, 120, 180].map((n) => (
            <g key={n} className="curve-grid">
              <line x1={n} x2={n} y1="0" y2="240" />
              <line x1="0" x2="240" y1={n} y2={n} />
            </g>
          ))}
          <line className="curve-reference" x1="0" y1="240" x2="240" y2="0" />
          <polyline
            points={points
              .map((p) => `${p.x * 240},${(1 - p.y) * 240}`)
              .join(" ")}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
          {points.map((p, i) => (
            <circle
              key={i}
              data-point={i}
              cx={p.x * 240}
              cy={(1 - p.y) * 240}
              r={i === index ? 6 : 4}
              fill="currentColor"
            />
          ))}
        </svg>
        <div className="curve-options">
          <label>
            Point{" "}
            <select
              aria-label="Point de la courbe"
              value={index}
              onChange={(e) => setSelected(Number(e.target.value))}
            >
              {points.map((_, i) => (
                <option key={i} value={i}>
                  {i + 1}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={points.length >= 16}
            onClick={() => {
              const gaps = points
                .slice(1)
                .map((p, i) => ({ i, gap: p.x - points[i].x }))
                .sort((a, b) => b.gap - a.gap);
              const i = gaps[0].i;
              const p = {
                x: (points[i].x + points[i + 1].x) / 2,
                y: (points[i].y + points[i + 1].y) / 2,
              };
              const next = [
                ...points.slice(0, i + 1),
                p,
                ...points.slice(i + 1),
              ];
              curve(next);
              setSelected(i + 1);
            }}
          >
            Ajouter un point
          </button>
        </div>
        {index > 0 && index < points.length - 1 && (
          <Range
            label="Entrée du point"
            value={point.x * 100}
            min={Math.ceil((points[index - 1].x + 0.005) * 1000) / 10}
            max={Math.floor((points[index + 1].x - 0.005) * 1000) / 10}
            step={0.1}
            unit="%"
            onChange={(v, g) => setPoint(index, { ...point, x: v / 100 }, g)}
          />
        )}
        <Range
          label="Sortie du point"
          value={point.y * 100}
          min={0}
          max={100}
          step={0.1}
          unit="%"
          onChange={(v, g) => setPoint(index, { ...point, y: v / 100 }, g)}
        />
        <div className="curve-options">
          <button
            disabled={index === 0 || index === points.length - 1}
            onClick={() => {
              curve(points.filter((_, i) => i !== index));
              setSelected(0);
            }}
          >
            Retirer le point
          </button>
          <button onClick={() => preset("linear")}>
            <RotateCcw size={13} /> Courbe linéaire
          </button>
        </div>
      </details>
      <details>
        <summary>Mélangeur de couleurs · TSL</summary>
        <div className="color-band-list">
          {COLOR_BANDS.map((b) => (
            <button
              key={b.id}
              title={b.label}
              aria-label={`Couleur ${b.label}`}
              aria-pressed={band === b.id}
              onClick={() => setBand(b.id)}
              style={{ "--band-color": b.color } as React.CSSProperties}
            >
              <span />
              {b.label}
            </button>
          ))}
        </div>
        <Range
          label="Teinte de la couleur"
          value={mix.hue}
          onChange={(v, g) =>
            onAdjust(
              { colorMix: { ...a.colorMix, [band]: { ...mix, hue: v } } },
              g,
            )
          }
        />
        <Range
          label="Saturation de la couleur"
          value={mix.saturation}
          onChange={(v, g) =>
            onAdjust(
              {
                colorMix: { ...a.colorMix, [band]: { ...mix, saturation: v } },
              },
              g,
            )
          }
        />
        <Range
          label="Luminance de la couleur"
          value={mix.luminance}
          onChange={(v, g) =>
            onAdjust(
              { colorMix: { ...a.colorMix, [band]: { ...mix, luminance: v } } },
              g,
            )
          }
        />
        <button
          className="text-button"
          onClick={() =>
            onAdjust({
              colorMix: {
                ...a.colorMix,
                [band]: { hue: 0, saturation: 0, luminance: 0 },
              },
            })
          }
        >
          <RotateCcw size={13} /> Réinitialiser cette couleur
        </button>
      </details>
      <details>
        <summary>Détails & bruit</summary>
        <Range
          label="Netteté"
          value={a.sharpening || 0}
          min={0}
          onChange={(v, g) => onAdjust({ sharpening: v }, g)}
        />
        <Range
          label="Réduction du bruit"
          value={a.noiseReduction || 0}
          min={0}
          onChange={(v, g) => onAdjust({ noiseReduction: v }, g)}
        />
        <p className="micro-note">
          Contrôlez les détails à 100 %. Réduction classique, disponible hors
          ligne.
        </p>
      </details>
    </div>
  );
}
