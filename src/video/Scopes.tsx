import { useEffect, useRef, useState } from "react";
export default function Scopes({ clipId }: { clipId: string }) {
  const ref = useRef<HTMLCanvasElement>(null),
    [mode, setMode] = useState<"histogram" | "waveform" | "parade">(
      "histogram",
    ),
    [range, setRange] = useState({ black: 0, white: 0, ready: false });
  useEffect(() => {
    const scratch = document.createElement("canvas");
    scratch.width = 192;
    scratch.height = 108;
    const ctx = scratch.getContext("2d", { willReadFrequently: true })!;
    const draw = () => {
      const canvases = [
          ...document.querySelectorAll<HTMLCanvasElement>(
            ".vf-preview canvas[data-video-clip]",
          ),
        ],
        source =
          canvases.find((c) => c.dataset.videoClip === clipId) ||
          canvases.at(-1),
        out = ref.current;
      if (!source?.width || !out) return;
      ctx.drawImage(source, 0, 0, 192, 108);
      const data = ctx.getImageData(0, 0, 192, 108).data,
        bins = [new Uint32Array(64), new Uint32Array(64), new Uint32Array(64)];
      let black = 0,
        white = 0;
      for (let i = 0; i < data.length; i += 4) {
        for (let c = 0; c < 3; c++)
          bins[c][Math.min(63, Math.floor(data[i + c] / 4))]++;
        const l =
          0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        if (l <= 2) black++;
        if (l >= 253) white++;
      }
      const g = out.getContext("2d")!;
      g.clearRect(0, 0, 256, 86);
      g.fillStyle = "#0d1318";
      g.fillRect(0, 0, 256, 86);
      g.strokeStyle = "#25323a";
      for (let i = 1; i < 4; i++) {
        g.beginPath();
        g.moveTo(i * 64, 0);
        g.lineTo(i * 64, 86);
        g.stroke();
      }
      if (mode === "histogram") {
        g.globalCompositeOperation = "screen";
        bins.forEach((b, c) => {
          const max = Math.max(...b, 1);
          g.fillStyle = ["#d97973a0", "#81bd83a0", "#7a9fcfa0"][c];
          b.forEach((v, i) => {
            const h = (Math.log1p(v) / Math.log1p(max)) * 78;
            g.fillRect(i * 4, 86 - h, 3, h);
          });
        });
      } else {
        g.globalAlpha = 0.15;
        for (let y = 0; y < 108; y++)
          for (let x = 0; x < 192; x++) {
            const i = (y * 192 + x) * 4;
            if (mode === "waveform") {
              const l =
                0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
              g.fillStyle = "#d1e8d8";
              g.fillRect((x / 192) * 256, 85 - (l / 255) * 85, 2, 1);
            } else
              for (let c = 0; c < 3; c++) {
                g.fillStyle = ["#ff7c78", "#7af58c", "#8badff"][c];
                g.fillRect(
                  (c * 256) / 3 + ((x / 192) * 256) / 3,
                  85 - (data[i + c] / 255) * 85,
                  1,
                  1,
                );
              }
          }
        g.globalAlpha = 1;
      }
      g.globalCompositeOperation = "source-over";
      setRange({
        black: (100 * black) / (data.length / 4),
        white: (100 * white) / (data.length / 4),
        ready: true,
      });
    };
    draw();
    const timer = setInterval(draw, 500);
    return () => clearInterval(timer);
  }, [clipId, mode]);
  return (
    <div className="vf-scopes">
      <h3>
        Scopes <small>Aperçu SDR 8 bits</small>
      </h3>
      <select
        aria-label="Type de scope"
        value={mode}
        onChange={(e) => setMode(e.target.value as typeof mode)}
      >
        <option value="histogram">Histogramme RGB</option>
        <option value="waveform">Waveform · luminance</option>
        <option value="parade">Parade RGB</option>
      </select>
      <canvas
        width={256}
        height={86}
        ref={ref}
        aria-label="Histogramme couleur du plan affiché"
      />
      <div>
        <span>
          Proche du noir{" "}
          <b>{range.ready ? range.black.toFixed(1) + " %" : "·"}</b>
        </span>
        <span>
          Proche du blanc{" "}
          <b>{range.ready ? range.white.toFixed(1) + " %" : "·"}</b>
        </span>
      </div>
    </div>
  );
}
