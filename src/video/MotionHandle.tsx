import { useMemo, useRef } from "react";
import type { Sequence, Title } from "./types";
import { motionAt } from "./motion";
import { titleBounds } from "./title-render";
import {
  dragAngle,
  dragFactor,
  rotateTitle,
  scaleTitle,
  wrapDegrees,
} from "./transform";
type Point = { x: number; y: number };
type Drag = {
  mode: "move" | "scale" | "rotate";
  origin: Point;
  anchor: Point;
  box: { width: number; height: number };
  title: Title;
  next: Title;
};
const BASE: React.CSSProperties = {
  position: "absolute",
  transform: "translate(-50%,-50%)",
  zIndex: 5,
  touchAction: "none",
  border: "2px solid #fff",
  padding: 0,
  color: "#fff",
  background: "#254d39",
};
export default function MotionHandle({
  title: t,
  sequence: s,
  frame,
  onDraft,
  onCommit,
  onCancel,
}: {
  title: Title;
  sequence: Sequence;
  frame: number;
  onDraft: (t: Title) => void;
  onCommit: (t: Title) => void;
  onCancel: () => void;
}) {
  const drag = useRef<Drag | null>(null);
  const motion = motionAt(t.motion, frame - (t.motionOrigin ?? t.start));
  const bounds = useMemo(() => {
    try {
      return titleBounds(t, s);
    } catch {
      return undefined;
    }
  }, [JSON.stringify(t), s.width, s.height]);
  const position = (title: Title, x: number, y: number) => ({
    ...title,
    x: Math.min(1, Math.max(0, x)),
    y: Math.min(1, Math.max(0, y)),
  });
  // Anchor of drawTitle: scale and rotation both pivot around it.
  const anchor = {
    x: ((t.x ?? 0.5) + motion.x) * 100,
    y: (t.y + motion.y) * 100,
  };
  // The drag keeps the true pivot; only the button is pulled back into view.
  const anchorView = {
    x: Math.min(97, Math.max(3, anchor.x)),
    y: Math.min(97, Math.max(3, anchor.y)),
  };
  /** Follow the preview transform so a handle sits where the pixels are. */
  const corner = (dx: number, dy: number) => {
    if (!bounds || bounds.empty) return undefined;
    // Animated elements pivot around the title anchor, like drawTitle does.
    const pivot = { x: (t.x ?? 0.5) * s.width, y: t.y * s.height },
      angle = (motion.rotation * Math.PI) / 180,
      rx = (bounds.x + (dx * bounds.width) / 2 - pivot.x) * motion.scale,
      ry = (bounds.y + (dy * bounds.height) / 2 - pivot.y) * motion.scale;
    const px =
        pivot.x +
        rx * Math.cos(angle) -
        ry * Math.sin(angle) +
        motion.x * s.width,
      py =
        pivot.y +
        rx * Math.sin(angle) +
        ry * Math.cos(angle) +
        motion.y * s.height;
    // An element larger than the frame must keep its handles reachable.
    const inside = (v: number) => Math.min(97, Math.max(3, v));
    return {
      x: inside((px / s.width) * 100),
      y: inside((py / s.height) * 100),
    };
  };
  const start = (
    mode: Drag["mode"],
    e: React.PointerEvent<HTMLButtonElement>,
  ) => {
    if (e.button !== 0) return;
    const box = e.currentTarget.parentElement!.getBoundingClientRect();
    drag.current = {
      mode,
      origin: { x: e.clientX, y: e.clientY },
      anchor: {
        x: box.left + (anchor.x / 100) * box.width,
        y: box.top + (anchor.y / 100) * box.height,
      },
      box: { width: box.width, height: box.height },
      title: t,
      next: t,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
    e.currentTarget.focus();
  };
  const move = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    const to = { x: e.clientX, y: e.clientY };
    if (d.mode === "move")
      d.next = position(
        d.title,
        (d.title.x ?? 0.5) + (to.x - d.origin.x) / d.box.width,
        d.title.y + (to.y - d.origin.y) / d.box.height,
      );
    else if (d.mode === "scale") {
      let factor = dragFactor(d.origin, to, d.anchor);
      if (e.shiftKey) factor = Math.round(factor * 10) / 10 || factor;
      d.next = scaleTitle(d.title, factor, s.height);
    } else {
      let degrees = (d.title.rotation ?? 0) + dragAngle(d.origin, to, d.anchor);
      if (e.shiftKey) degrees = Math.round(degrees / 15) * 15;
      d.next = rotateTitle(d.title, wrapDegrees(degrees));
    }
    onDraft(d.next);
  };
  const end = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    if (d && JSON.stringify(d.next) !== JSON.stringify(d.title))
      onCommit(d.next);
    else onCancel();
  };
  const lost = () => {
    if (drag.current) {
      drag.current = null;
      onCancel();
    }
  };
  const escape = (e: React.KeyboardEvent) => {
    if (e.key !== "Escape") return false;
    drag.current = null;
    onCancel();
    e.stopPropagation();
    return true;
  };
  const arrow = (e: React.KeyboardEvent) =>
    (
      ({
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      }) as Record<string, number[]>
    )[e.key];
  const scaleHandle = corner(1, 1),
    rotateHandle = corner(0, -1);
  return (
    <>
      <button
        className="motion-position-handle"
        aria-label="Déplacer l’élément graphique"
        title="Glisser pour déplacer · flèches pour ajuster · Échap pour annuler"
        style={{
          ...BASE,
          left: `${anchorView.x}%`,
          top: `${anchorView.y}%`,
          cursor: "move",
          width: 30,
          height: 30,
          borderRadius: "50%",
        }}
        onPointerDown={(e) => start("move", e)}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={lost}
        onLostPointerCapture={lost}
        onKeyDown={(e) => {
          if (escape(e)) return;
          const d = arrow(e);
          if (!d) return;
          e.preventDefault();
          e.stopPropagation();
          const step = e.shiftKey ? 0.01 : 0.001;
          onCommit(position(t, (t.x ?? 0.5) + d[0] * step, t.y + d[1] * step));
        }}
      >
        ✥
      </button>
      {scaleHandle && (
        <button
          className="motion-scale-handle"
          aria-label="Redimensionner l’élément graphique"
          title="Glisser pour redimensionner · flèches pour ajuster · Maj par paliers · Échap pour annuler"
          style={{
            ...BASE,
            left: `${scaleHandle.x}%`,
            top: `${scaleHandle.y}%`,
            cursor: "nwse-resize",
            width: 22,
            height: 22,
            borderRadius: 5,
            fontSize: 12,
            lineHeight: "18px",
          }}
          onPointerDown={(e) => start("scale", e)}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={lost}
          onLostPointerCapture={lost}
          onKeyDown={(e) => {
            if (escape(e)) return;
            const d = arrow(e);
            if (!d) return;
            e.preventDefault();
            e.stopPropagation();
            const step = e.shiftKey ? 0.1 : 0.01,
              direction = d[0] + -d[1];
            onCommit(scaleTitle(t, 1 + direction * step, s.height));
          }}
        >
          ⤡
        </button>
      )}
      {rotateHandle && (
        <button
          className="motion-rotate-handle"
          aria-label="Pivoter l’élément graphique"
          title="Glisser pour pivoter · flèches pour ajuster · Maj par paliers de 15° · Échap pour annuler"
          style={{
            ...BASE,
            left: `${rotateHandle.x}%`,
            top: `${rotateHandle.y}%`,
            cursor: "grab",
            width: 22,
            height: 22,
            borderRadius: "50%",
            fontSize: 12,
            lineHeight: "18px",
          }}
          onPointerDown={(e) => start("rotate", e)}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={lost}
          onLostPointerCapture={lost}
          onKeyDown={(e) => {
            if (escape(e)) return;
            const d = arrow(e);
            if (!d) return;
            e.preventDefault();
            e.stopPropagation();
            const step = e.shiftKey ? 10 : 1,
              direction = d[0] + -d[1];
            onCommit(
              rotateTitle(t, wrapDegrees((t.rotation ?? 0) + direction * step)),
            );
          }}
        >
          ↻
        </button>
      )}
    </>
  );
}
