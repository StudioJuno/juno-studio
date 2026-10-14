import { useRef } from "react";
import type { Clip, Mask, Sequence } from "./types";
import { maskAmount, maskAt, setMaskKey } from "./masks";
/**
 * Shows where a mask hides the picture and lets it be dragged frame by frame.
 * The monitor approximates the treatment; the export renders it for real.
 */
export default function MaskLayer({
  clip,
  mask,
  sequence: s,
  frame,
  active,
  onChange,
  onError,
}: {
  clip: Clip;
  mask: Mask;
  sequence: Sequence;
  frame: number;
  active: boolean;
  onChange?: (mask: Mask) => void;
  onError?: (e: unknown) => void;
}) {
  const drag = useRef<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const local = frame - clip.start,
    here = maskAt(mask, local),
    amount = maskAmount(mask, s),
    scale = 100 / Math.max(1, s.width);
  const soft = Math.max(0, Math.min(0.5, mask.feather)),
    radius =
      mask.shape === "ellipse"
        ? "50%"
        : `${Math.round((soft * Math.min(amount.width, amount.height)) / 2)}px`;
  const treatment =
    mask.effect === "solid"
      ? { background: mask.color ?? "#000000" }
      : {
          backdropFilter: `blur(${Math.max(2, Math.round(amount.sigma * (mask.effect === "pixelate" ? 1.2 : 1)))}px)`,
        };
  const box: React.CSSProperties = {
    position: "absolute",
    left: `${here.x * 100}%`,
    top: `${here.y * 100}%`,
    width: `${amount.width * scale}%`,
    height: `${(amount.height / Math.max(1, s.height)) * 100}%`,
    transform: "translate(-50%,-50%)",
    borderRadius: radius,
    pointerEvents: "none",
    ...treatment,
    ...(soft > 0 && mask.effect !== "solid"
      ? {
          maskImage: `radial-gradient(${mask.shape === "ellipse" ? "ellipse" : "closest-side"} closest-side, #000 ${Math.round((1 - soft) * 100)}%, transparent 100%)`,
        }
      : {}),
    outline: active ? "1px dashed rgba(255,255,255,.8)" : "none",
    zIndex: 4,
  };
  const commit = (x: number, y: number) => {
    if (!onChange) return;
    try {
      onChange(
        setMaskKey(mask, Math.max(0, Math.min(clip.duration - 1, local)), x, y),
      );
    } catch (e) {
      onError?.(e);
    }
  };
  return (
    <>
      <div aria-hidden style={box} data-mask={mask.id} />
      {active && onChange && local >= 0 && local < clip.duration && (
        <button
          className="mask-position-handle"
          aria-label="Déplacer le masque"
          title="Glisser pour placer le masque sur cette image · flèches pour ajuster"
          style={{
            position: "absolute",
            left: `${here.x * 100}%`,
            top: `${here.y * 100}%`,
            transform: "translate(-50%,-50%)",
            zIndex: 6,
            touchAction: "none",
            cursor: "move",
            width: 24,
            height: 24,
            borderRadius: "50%",
            border: "2px solid #fff",
            background: "#1f3d6b",
            color: "#fff",
            padding: 0,
          }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            const rect = e.currentTarget.parentElement!.getBoundingClientRect();
            drag.current = {
              x: e.clientX,
              y: e.clientY,
              width: rect.width,
              height: rect.height,
            };
            e.currentTarget.setPointerCapture(e.pointerId);
            e.preventDefault();
            e.currentTarget.focus();
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            commit(
              here.x + (e.clientX - d.x) / d.width,
              here.y + (e.clientY - d.y) / d.height,
            );
            d.x = e.clientX;
            d.y = e.clientY;
          }}
          onPointerUp={(e) => {
            drag.current = null;
            if (e.currentTarget.hasPointerCapture(e.pointerId))
              e.currentTarget.releasePointerCapture(e.pointerId);
          }}
          onPointerCancel={() => (drag.current = null)}
          onKeyDown={(e) => {
            const d = (
              {
                ArrowLeft: [-1, 0],
                ArrowRight: [1, 0],
                ArrowUp: [0, -1],
                ArrowDown: [0, 1],
              } as Record<string, number[]>
            )[e.key];
            if (!d) return;
            e.preventDefault();
            e.stopPropagation();
            const step = e.shiftKey ? 0.01 : 0.002;
            commit(here.x + d[0] * step, here.y + d[1] * step);
          }}
        >
          ✥
        </button>
      )}
    </>
  );
}
