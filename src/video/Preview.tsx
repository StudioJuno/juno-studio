import { audioMix } from "./audio-mix";
import MotionHandle from "./MotionHandle";
import MaskLayer from "./MaskLayer";
import TitleCanvas from "./TitleCanvas";
import { captionRuns } from "./title-render";
import { animatedClip } from "./animation";
import { BASE_GRADE } from "./edit";
import { useEffect, useRef, useState } from "react";
import type { Asset, Clip, Mask, Sequence, Title } from "./types";
import {
  audioAudible,
  monitorFrameTime,
  monitorMustSeek,
  monitorTime,
  monitorTolerance,
} from "./edit";
import { frameTimes } from "./frame-index";
import { useHeld } from "./playhead-state";
const STYLES: Record<string, Partial<Clip["grade"]>> = {
  original: {},
  signature: { warmth: 0.045, contrast: 1.04, saturation: 0.92, fade: 0.015 },
  editorial: { contrast: 1.13, saturation: 0.85 },
  golden: { warmth: 0.11, contrast: 1.04, saturation: 1.04, fade: 0.015 },
  film: { contrast: 0.94, saturation: 0.8, warmth: 0.04, fade: 0.03 },
  mono: { saturation: 0, contrast: 1.12 },
};
const lutCache = new Map<
  string,
  Promise<{ size: number; min: number[]; max: number[]; values: number[] }>
>();
function readLut(id: string) {
  const cached = lutCache.get(id);
  if (cached) {
    lutCache.delete(id);
    lutCache.set(id, cached);
    return cached;
  }
  const request = window.juno!.video.readLut(id).catch((error) => {
    if (lutCache.get(id) === request) lutCache.delete(id);
    throw error;
  });
  lutCache.set(id, request);
  while (lutCache.size > 8) lutCache.delete(lutCache.keys().next().value!);
  return request;
}
let audioContext: AudioContext | undefined;
const sources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();
export function resumeAudio() {
  audioContext ??= new AudioContext();
  void audioContext.resume();
}
function Layer({
  asset,
  clip,
  sequence,
  frame,
  playing,
  beforeColor,
}: {
  asset: Asset;
  clip: Clip;
  sequence: Sequence;
  frame: number;
  playing: boolean;
  beforeColor?: boolean;
}) {
  const [lutError, setLutError] = useState("");
  const picture = !(
      asset.kind === "audio" ||
      clip.component === "audio" ||
      clip.track >= 10
    ),
    src = asset.proxy || asset.source;
  // Les instants des images du fichier lu, pour se poser au milieu de
  // l'image que l'export montre (edit.ts, `monitorFrameTime`).
  const [times, setTimes] = useState<{ src: string; list: number[] }>();
  useEffect(() => {
    if (!picture || asset.kind !== "video") return;
    let alive = true;
    void frameTimes(src).then(
      (list) => alive && list && setTimes({ src, list }),
    );
    return () => {
      alive = false;
    };
  }, [src, picture, asset.kind]);
  const video = useRef<HTMLVideoElement>(null),
    audio = useRef<HTMLAudioElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    gain = useRef<GainNode | null>(null),
    panner = useRef<StereoPannerNode | null>(null),
    draw = useRef<() => void>(() => {}),
    // La cible où le moniteur a été posé à l'arrêt, et le fichier lu alors.
    placed = useRef<{ src: string; time: number } | undefined>(undefined),
    current = useRef({ clip, sequence, frame, playing, beforeColor });
  current.current = { clip, sequence, frame, playing, beforeColor };
  useEffect(() => {
    const el = video.current || audio.current;
    if (!el) return;
    audioContext ??= new AudioContext();
    const source = sources.get(el) || audioContext.createMediaElementSource(el),
      g = audioContext.createGain(),
      pan = audioContext.createStereoPanner(),
      meter = audioContext.createAnalyser();
    meter.fftSize = 512;
    sources.set(el, source);
    source.connect(g);
    g.connect(pan);
    pan.connect(meter);
    meter.connect(audioContext.destination);
    panner.current = pan;
    const samples = new Float32Array(meter.fftSize);
    const timer = setInterval(() => {
      const now = current.current;
      if (!now.playing) return;
      meter.getFloatTimeDomainData(samples);
      const peak = samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
      window.dispatchEvent(
        new CustomEvent("juno-audio-meter", {
          detail: {
            id: now.clip.id,
            track: now.clip.track,
            peak,
            at: Date.now(),
          },
        }),
      );
    }, 150);
    gain.current = g;
    return () => {
      el.pause();
      source.disconnect();
      g.disconnect();
      pan.disconnect();
      meter.disconnect();
      clearInterval(timer);
      panner.current = null;
      gain.current = null;
    };
  }, [asset.id, asset.proxy]);
  useEffect(() => {
    const el = video.current,
      c = canvas.current;
    if (!el || !c) return;
    const gl = c.getContext("webgl", {
      alpha: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    });
    if (!gl) return;
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw Error(gl.getShaderInfoLog(s) || "Shader vidéo");
      return s;
    };
    const vs = shader(
        gl.VERTEX_SHADER,
        "attribute vec2 pos;varying vec2 uv;void main(){uv=vec2((pos.x+1.0)*0.5,1.0-(pos.y+1.0)*0.5);gl_Position=vec4(pos,0.0,1.0);}",
      ),
      fs = shader(
        gl.FRAGMENT_SHADER,
        "precision highp float;varying vec2 uv;uniform sampler2D tex;uniform float exposure;uniform float contrast;uniform float sat;uniform float warmth;uniform float tint;uniform float fade;uniform sampler2D cubeTex;uniform float cubeSize;uniform float cubeMix;uniform vec3 cubeMin;uniform vec3 cubeMax;vec3 point(vec3 q){return texture2D(cubeTex,vec2((q.y*cubeSize+q.x+0.5)/(cubeSize*cubeSize),(q.z+0.5)/cubeSize)).rgb;}vec3 lookup(vec3 v){vec3 q=clamp((v-cubeMin)/(cubeMax-cubeMin),0.0,1.0)*(cubeSize-1.0);vec3 a=floor(q),b=min(a+1.0,vec3(cubeSize-1.0)),f=q-a;return mix(mix(mix(point(vec3(a.x,a.y,a.z)),point(vec3(b.x,a.y,a.z)),f.x),mix(point(vec3(a.x,b.y,a.z)),point(vec3(b.x,b.y,a.z)),f.x),f.y),mix(mix(point(vec3(a.x,a.y,b.z)),point(vec3(b.x,a.y,b.z)),f.x),mix(point(vec3(a.x,b.y,b.z)),point(vec3(b.x,b.y,b.z)),f.x),f.y),f.z);}void main(){vec3 v=pow(max(texture2D(tex,uv).rgb,vec3(0.0)),vec3(2.4))*exp2(exposure);v*=vec3(1.0+warmth,1.0-tint,1.0-warmth);v=pow(max(v,vec3(0.0)),vec3(1.0/2.4));float l=dot(v,vec3(0.2126,0.7152,0.0722));v=clamp(((vec3(l)+(v-vec3(l))*sat)-0.5)*contrast+0.5,0.0,1.0);v=fade+(1.0-fade)*v;if(cubeSize>1.0)v=mix(v,lookup(v),cubeMix);gl_FragColor=vec4(v,1.0);}",
      );
    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const position = gl.getAttribLocation(program, "pos");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    let alive = true;
    const cubeTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, cubeTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 0, 255]),
    );
    gl.uniform1i(gl.getUniformLocation(program, "cubeTex"), 1);
    gl.uniform1i(gl.getUniformLocation(program, "tex"), 0);
    gl.uniform1f(gl.getUniformLocation(program, "cubeSize"), 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    setLutError("");
    if (clip.grade.lutId)
      void readLut(clip.grade.lutId)
        .then((cube) => {
          if (!alive) return;
          if (!gl.getExtension("OES_texture_float"))
            throw Error(
              "La carte graphique ne permet pas l’aperçu de cette LUT",
            );
          const data = new Float32Array(cube.size ** 3 * 4);
          for (let i = 0; i < cube.size ** 3; i++) {
            data[i * 4] = cube.values[i * 3];
            data[i * 4 + 1] = cube.values[i * 3 + 1];
            data[i * 4 + 2] = cube.values[i * 3 + 2];
            data[i * 4 + 3] = 1;
          }
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, cubeTexture);
          gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA,
            cube.size * cube.size,
            cube.size,
            0,
            gl.RGBA,
            gl.FLOAT,
            data,
          );
          gl.uniform1f(gl.getUniformLocation(program, "cubeSize"), cube.size);
          gl.uniform3fv(gl.getUniformLocation(program, "cubeMin"), cube.min);
          gl.uniform3fv(gl.getUniformLocation(program, "cubeMax"), cube.max);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, texture);
          lastSignature = "";
          draw.current();
        })
        .catch((e) => alive && setLutError(e.message));
    let timer = 0,
      videoFrame = 0,
      lastSignature = "";
    const render = () => {
      if (el.readyState < 2 || !el.videoWidth) return;
      const signature = JSON.stringify([
        el.currentTime,
        el.videoWidth,
        current.current.clip.grade,
        current.current.beforeColor,
      ]);
      if (signature === lastSignature) return;
      lastSignature = signature;
      const width = Math.min(1280, el.videoWidth),
        height = Math.round((el.videoHeight * width) / el.videoWidth);
      if (c.width !== width || c.height !== height) {
        c.width = width;
        c.height = height;
      }
      gl.viewport(0, 0, c.width, c.height);
      const g = current.current.beforeColor
          ? { ...BASE_GRADE }
          : { ...current.current.clip.grade },
        style = STYLES[g.style] || {};
      for (const [k, v] of Object.entries(style)) {
        const key = k as keyof typeof style;
        if (key === "contrast" || key === "saturation")
          g[key] *= 1 + (Number(v) - 1) * g.intensity;
        else
          (g as unknown as Record<string, number>)[key] +=
            (v as number) * g.intensity;
      }
      for (const [k, v] of Object.entries({
        exposure: g.exposure,
        contrast: g.contrast,
        sat: g.saturation,
        warmth: g.warmth,
        tint: g.tint,
        fade: g.fade,
        cubeMix: current.current.beforeColor ? 0 : (g.lutIntensity ?? 1),
      }))
        gl.uniform1f(gl.getUniformLocation(program, k), v);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, el);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    draw.current = render;
    const loop = () => {
      render();
      if (el.requestVideoFrameCallback)
        videoFrame = el.requestVideoFrameCallback(loop);
      else timer = requestAnimationFrame(loop);
    };
    loop();
    el.addEventListener("loadeddata", render);
    el.addEventListener("seeked", render);
    return () => {
      alive = false;
      cancelAnimationFrame(timer);
      if (videoFrame) el.cancelVideoFrameCallback(videoFrame);
      el.removeEventListener("loadeddata", render);
      gl.deleteTexture(cubeTexture);
      el.removeEventListener("seeked", render);
      draw.current = () => {};
      gl.deleteTexture(texture);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  }, [asset.id, asset.proxy, clip.grade.lutId]);
  useEffect(() => {
    const el = video.current || audio.current;
    if (!el) return;
    const local = frame - clip.start,
      target =
        times?.src === src && asset.kind === "video"
          ? monitorFrameTime(times.list, clip, sequence, frame)
          : monitorTime(clip, asset, sequence, frame),
      fade = Math.min(
        1,
        clip.fadeIn ? local / clip.fadeIn : 1,
        clip.fadeOut ? (clip.duration - local) / clip.fadeOut : 1,
      );
    if (gain.current)
      gain.current.gain.value = !audioAudible(sequence, clip)
        ? 0
        : clip.gain *
          audioMix(sequence, clip).gain *
          sequence.masterGain *
          Math.max(0, fade);
    if (panner.current) panner.current.pan.value = audioMix(sequence, clip).pan;
    el.playbackRate = clip.speed;
    const last = placed.current;
    placed.current = undefined;
    if (
      monitorMustSeek(
        el.currentTime,
        target,
        last?.src === el.src ? last.time : undefined,
        monitorTolerance(clip, asset, sequence, playing),
        playing,
      )
    )
      try {
        el.currentTime = target;
      } catch {}
    if (!playing) placed.current = { src: el.src, time: target };
    if (playing && asset.kind !== "image") void el.play().catch(() => {});
    else el.pause();
    draw.current();
  }, [
    frame,
    beforeColor,
    playing,
    clip,
    sequence,
    asset.kind,
    asset.fps?.n,
    asset.fps?.d,
    asset.proxy,
    asset.source,
    times,
  ]);
  const local = frame - clip.start,
    opacity =
      clip.opacity *
      Math.max(
        0,
        Math.min(
          1,
          clip.fadeIn ? local / clip.fadeIn : 1,
          clip.fadeOut ? (clip.duration - local) / clip.fadeOut : 1,
        ),
      );
  if (asset.kind === "audio" || clip.component === "audio" || clip.track >= 10)
    return (
      <audio ref={audio} src={src} preload="auto" crossOrigin="anonymous" />
    );
  return (
    <div
      className="vf-layer"
      style={{
        opacity,
        transform: `translate(${clip.x * 100}%,${clip.y * 100}%) rotate(${clip.rotation}deg) scale(${clip.scale})`,
      }}
    >
      <video
        ref={video}
        src={src}
        preload="auto"
        playsInline
        crossOrigin="anonymous"
      />
      <canvas ref={canvas} data-video-clip={clip.id} />
      {lutError && <small className="vf-preview-error">{lutError}</small>}
    </div>
  );
}
export default function Preview({
  sequence,
  selectedTitle,
  onTitleChange,
  selectedMask,
  onMaskChange,
  onMaskError,
  assets,
  frame,
  playing,
  beforeColor,
}: {
  sequence: Sequence;
  assets: Asset[];
  frame: number;
  playing: boolean;
  beforeColor?: boolean;
  selectedTitle?: string;
  onTitleChange?: (t: Title) => void;
  selectedMask?: { clipId: string; maskId: string };
  onMaskChange?: (clipId: string, mask: Mask) => void;
  onMaskError?: (e: unknown) => void;
}) {
  // Le titre en cours de glissement ne vaut que pour l'image et la séquence où
  // il a été tiré. Pas d'effet de remise à zéro ici : à chaque image, il
  // programmait un rendu de plus, et une rafale de flèches finissait en erreur
  // React 185 avec une touche perdue (playhead-state.ts).
  const [draft, setDraft] = useHeld<Title>([
    sequence,
    selectedTitle,
    frame,
    playing,
  ]);
  const container = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1, height: 1 });
  useEffect(() => {
    const parent = container.current?.parentElement;
    if (!parent) return;
    const observer = new ResizeObserver(() => {
      const style = getComputedStyle(parent);
      const w =
        parent.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight);
      const h =
        parent.clientHeight -
        parseFloat(style.paddingTop) -
        parseFloat(style.paddingBottom);
      const scale = Math.max(
        0,
        Math.min(w / sequence.width, h / sequence.height),
      );
      setSize({
        width: sequence.width * scale,
        height: sequence.height * scale,
      });
    });
    observer.observe(parent);
    return () => observer.disconnect();
  }, [sequence.width, sequence.height]);
  const active = sequence.clips
      .filter(
        (c) =>
          c.start <= frame &&
          c.start + c.duration > frame &&
          !sequence.tracks?.[c.track]?.hidden,
      )
      .sort(
        (a, b) =>
          a.track - b.track || a.start - b.start || a.id.localeCompare(b.id),
      ),
    map = new Map(assets.map((a) => [a.id, a]));
  return (
    <div
      ref={container}
      className="vf-preview"
      style={{ width: size.width, height: size.height, flexShrink: 0 }}
    >
      {active.map((c) => {
        const a = map.get(c.assetId);
        return (
          a && (
            <Layer
              key={c.id + ":" + a.proxy}
              asset={a}
              clip={animatedClip(c, frame)}
              sequence={sequence}
              frame={frame}
              playing={playing}
              beforeColor={beforeColor}
            />
          )
        );
      })}
      {active.flatMap((c) =>
        (c.masks ?? []).map((m) => (
          <MaskLayer
            key={c.id + ":" + m.id}
            clip={c}
            mask={m}
            sequence={sequence}
            frame={frame}
            active={
              !playing &&
              selectedMask?.clipId === c.id &&
              selectedMask?.maskId === m.id
            }
            onChange={
              onMaskChange ? (next) => onMaskChange(c.id, next) : undefined
            }
            onError={onMaskError}
          />
        )),
      )}
      {[
        ...sequence.titles.map((t) => (draft?.id === t.id ? draft : t)),
        ...sequence.captions
          .filter((t) => t.start <= frame && t.start + t.duration > frame)
          .flatMap((t) => captionRuns(t, sequence)),
      ]
        .filter((t) => t.start <= frame && t.start + t.duration > frame)
        .map((t) => (
          <TitleCanvas key={t.id} title={t} sequence={sequence} frame={frame} />
        ))}
      {!playing &&
        onTitleChange &&
        sequence.titles
          .filter(
            (t) =>
              t.id === selectedTitle &&
              t.start <= frame &&
              t.start + t.duration > frame,
          )
          .map((t) => (
            <MotionHandle
              key={t.id}
              title={draft?.id === t.id ? draft : t}
              sequence={sequence}
              frame={frame}
              onDraft={setDraft}
              onCommit={(next) => {
                setDraft(undefined);
                onTitleChange(next);
              }}
              onCancel={() => setDraft(undefined)}
            />
          ))}
      {!active.length &&
        ![...sequence.titles, ...sequence.captions].some(
          (t) => t.start <= frame && t.start + t.duration > frame,
        ) && (
          <div className="vf-preview-empty">
            Placez vos médias sur la timeline.
          </div>
        )}
    </div>
  );
}
