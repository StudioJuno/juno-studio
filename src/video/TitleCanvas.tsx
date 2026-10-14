import { useEffect, useMemo, useRef } from "react";
import type { Title, Sequence } from "./types";
import { rasterTitle } from "./title-render";
import { motionAt } from "./motion";
export default function TitleCanvas({
  title,
  sequence,
  frame,
}: {
  title: Title;
  sequence: Sequence;
  frame: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null),
    key = JSON.stringify(title);
  const raster = useMemo(() => {
    try {
      return { ...rasterTitle(title, sequence), error: "" };
    } catch (e) {
      return {
        canvas: document.createElement("canvas"),
        placement: undefined,
        error: String(e),
      };
    }
  }, [key, sequence.width, sequence.height]);
  useEffect(() => {
    const c = ref.current;
    if (c) {
      c.width = raster.canvas.width;
      c.height = raster.canvas.height;
      c.getContext("2d")!.drawImage(raster.canvas, 0, 0);
    }
  }, [raster]);
  const m = motionAt(title.motion, frame - (title.motionOrigin ?? title.start)),
    p = raster.placement;
  if (raster.error)
    return <small className="vf-preview-error">{raster.error}</small>;
  return (
    <canvas
      ref={ref}
      aria-label={title.text || title.graphic?.kind}
      style={
        p
          ? {
              position: "absolute",
              left: `${(p.x / sequence.width) * 100 + m.x * 100}%`,
              top: `${(p.y / sequence.height) * 100 + m.y * 100}%`,
              width: `${(p.width / sequence.width) * 100}%`,
              height: `${(p.height / sequence.height) * 100}%`,
              maxWidth: "none",
              opacity: m.opacity,
              transform: `translate(-50%,-50%) rotate(${m.rotation}deg) scale(${m.scale})`,
              pointerEvents: "none",
            }
          : {
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              pointerEvents: "none",
            }
      }
    />
  );
}
