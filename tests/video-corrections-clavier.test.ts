// Rafales de flèches dans l'éditeur de montage (29/09/2026).
//
// Défaut : plus de 50 flèches envoyées sans que le planificateur de React
// passe (touche maintenue pendant un gel, touche maintenue sans délai)
// finissaient en erreur React 185 (« Maximum update depth exceeded »), levée
// dans le gestionnaire de la touche suivante, qui était perdue : la tête
// s'arrêtait une ou plusieurs images trop tôt.
//
// Cause : des effets remettaient un état à jour à chaque image (le titre en
// cours de glissement du moniteur, la valeur tapée des images clés, puis, vu
// en relecture, le texte des champs numériques de l'inspecteur dès que le plan
// sélectionné a des images clés : position, volume). Chaque flèche laissait
// donc un rendu de plus en attente à la fin de son commit, et React compte ces
// commits d'affilée comme des mises à jour imbriquées.
//
// La règle d'avant lisait les sources de src/video/ et ne regardait que les
// dépendances nommées frame, at ou playhead : elle ne voyait ni le champ
// numérique (src/modules/, dépendance `value`), ni une valeur dérivée de la
// tête sous un autre nom. Elle est remplacée ici par l'éditeur entier, monté
// avec le vrai React dans un DOM minimal, sur un montage animé partout (plan,
// son, musique, titre, sous-titre mot à mot, masque) : 200 flèches d'affilée
// par panneau, chacune rendue et validée par `flushSync` sans laisser passer
// la tâche du planificateur, et aucun rendu ne doit rester en attente.
import "fake-indexeddb/auto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { arrowStep, sameContext, stepFrame } from "../src/video/playhead-state";
import { animatedClip } from "../src/video/animation";
import { BASE_GRADE, length as filmLength } from "../src/video/edit";
import type { Asset, Clip, Sequence, VideoProject } from "../src/video/types";

// Le relevé des visages de « Recadrer » : tenu en main par les tests du
// recadrage pendant le montage (le vrai relevé lit une vidéo), le vrai module
// partout ailleurs.
const releve = vi.hoisted(() => ({
  hook: null as null | (() => Promise<unknown>),
}));
vi.mock("../src/video/reframe-scan", async (importOriginal) => {
  const m = await importOriginal<typeof import("../src/video/reframe-scan")>();
  return {
    ...m,
    releverVisages: (...a: Parameters<typeof m.releverVisages>) =>
      releve.hook
        ? (releve.hook() as ReturnType<typeof m.releverVisages>)
        : m.releverVisages(...a),
  };
});

// DOM minimal : juste ce que react-dom et l'éditeur lisent et écrivent.
class FakeNode {
  childNodes: FakeNode[] = [];
  parentNode: FakeNode | null = null;
  nodeValue: string | null = null;
  constructor(
    public nodeType: number,
    public nodeName: string,
    public ownerDocument: FakeDocument | null,
  ) {}
  get firstChild() {
    return this.childNodes[0] ?? null;
  }
  get lastChild() {
    return this.childNodes.at(-1) ?? null;
  }
  get nextSibling() {
    const p = this.parentNode;
    return p ? (p.childNodes[p.childNodes.indexOf(this) + 1] ?? null) : null;
  }
  get parentElement() {
    return this.parentNode instanceof FakeElement ? this.parentNode : null;
  }
  appendChild(c: FakeNode) {
    c.parentNode?.removeChild(c);
    this.childNodes.push(c);
    c.parentNode = this;
    return c;
  }
  insertBefore(c: FakeNode, ref: FakeNode | null) {
    if (!ref) return this.appendChild(c);
    c.parentNode?.removeChild(c);
    this.childNodes.splice(this.childNodes.indexOf(ref), 0, c);
    c.parentNode = this;
    return c;
  }
  removeChild(c: FakeNode) {
    const i = this.childNodes.indexOf(c);
    if (i >= 0) this.childNodes.splice(i, 1);
    c.parentNode = null;
    return c;
  }
  contains(c: FakeNode | null): boolean {
    for (let n = c; n; n = n.parentNode) if (n === this) return true;
    return false;
  }
  addEventListener() {}
  removeEventListener() {}
  get textContent(): string {
    if (this.nodeType === 3) return this.nodeValue ?? "";
    return this.childNodes.map((c) => c.textContent).join("");
  }
  set textContent(v: string) {
    if (this.nodeType === 3) {
      this.nodeValue = v;
      return;
    }
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [];
    if (v) this.appendChild(this.ownerDocument!.createTextNode(v));
  }
  querySelectorAll(selector: string): FakeElement[] {
    return all(this, (e) => e.matches(selector));
  }
  querySelector(selector: string) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}
// Sélecteurs simples : « balise.classe[attribut] », descendants séparés par
// des espaces, alternatives séparées par des virgules.
function compound(el: FakeElement, part: string) {
  const m = /^([\w*-]*)((?:\.[\w-]+)*)((?:\[[^\]]+\])*)$/.exec(part);
  if (!m) return false;
  if (m[1] && m[1] !== "*" && m[1].toUpperCase() !== el.nodeName) return false;
  const classes = (el.getAttribute("class") ?? "").split(/\s+/);
  for (const c of m[2].split(".").filter(Boolean))
    if (!classes.includes(c)) return false;
  for (const a of m[3].match(/\[[^\]]+\]/g) ?? []) {
    const [, name, value] = /^\[([\w-]+)(?:="?([^"\]]*)"?)?\]$/.exec(a) ?? [];
    if (!name || !el.hasAttribute(name)) return false;
    if (value !== undefined && el.getAttribute(name) !== value) return false;
  }
  return true;
}
function all(root: FakeNode, pick: (e: FakeElement) => boolean) {
  const out: FakeElement[] = [];
  const walk = (n: FakeNode) => {
    for (const c of n.childNodes) {
      if (c instanceof FakeElement && pick(c)) out.push(c);
      walk(c);
    }
  };
  walk(root);
  return out;
}
class FakeElement extends FakeNode {
  attributes = new Map<string, string>();
  dataset: Record<string, string> = {};
  style: Record<string, unknown> = {
    setProperty(this: Record<string, unknown>, k: string, v: unknown) {
      this[k] = v;
    },
    removeProperty(this: Record<string, unknown>, k: string) {
      delete this[k];
    },
    getPropertyValue(this: Record<string, unknown>, k: string) {
      return String(this[k] ?? "");
    },
  };
  // Un canevas du navigateur mesure 300 × 150 tant qu'on ne l'a pas réglé.
  width = 300;
  height = 150;
  context?: unknown;
  constructor(
    tag: string,
    doc: FakeDocument,
    public namespaceURI = "",
  ) {
    super(1, tag.toUpperCase(), doc);
  }
  get tagName() {
    return this.nodeName;
  }
  get options() {
    return this.childNodes.filter((c) => c.nodeName === "OPTION");
  }
  // Comme dans le navigateur, l'adresse d'un média est toujours un texte.
  get src() {
    return this.getAttribute("src") ?? "";
  }
  set src(v: string) {
    this.setAttribute("src", v);
  }
  setAttribute(k: string, v: unknown) {
    this.attributes.set(k, String(v));
    if (k.startsWith("data-"))
      this.dataset[k.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] =
        String(v);
  }
  setAttributeNS(_ns: string, k: string, v: unknown) {
    this.setAttribute(k, v);
  }
  getAttribute(k: string) {
    return this.attributes.get(k) ?? null;
  }
  hasAttribute(k: string) {
    return this.attributes.has(k);
  }
  removeAttribute(k: string) {
    this.attributes.delete(k);
  }
  removeAttributeNS(_ns: string, k: string) {
    this.removeAttribute(k);
  }
  matches(selector: string): boolean {
    return selector.split(",").some((alternative) => {
      const parts = alternative.trim().split(/\s+/);
      if (!compound(this, parts.pop()!)) return false;
      let n: FakeNode | null = this.parentNode;
      for (let i = parts.length - 1; i >= 0; i--) {
        while (n && !(n instanceof FakeElement && compound(n, parts[i])))
          n = n.parentNode;
        if (!n) return false;
        n = n.parentNode;
      }
      return true;
    });
  }
  closest(selector: string) {
    for (let n: FakeNode | null = this; n; n = n.parentNode)
      if (n instanceof FakeElement && n.matches(selector)) return n;
    return null;
  }
  getContext(kind: string) {
    if (kind !== "2d") return null;
    return (this.context ??= context2d(this));
  }
  getBoundingClientRect() {
    return {
      left: 0,
      top: 0,
      right: 320,
      bottom: 180,
      width: 320,
      height: 180,
    };
  }
  focus() {
    this.ownerDocument!.activeElement = this;
  }
  blur() {
    if (this.ownerDocument!.activeElement === this)
      this.ownerDocument!.activeElement = null;
  }
  pause() {}
  play() {
    return Promise.resolve();
  }
  load() {}
  showModal() {}
  close() {}
  click() {}
  scrollIntoView() {}
  setPointerCapture() {}
  releasePointerCapture() {}
  hasPointerCapture() {
    return false;
  }
}
class FakeDocument extends FakeNode {
  documentElement: FakeElement;
  body: FakeElement;
  defaultView: unknown = null;
  activeElement: FakeElement | null = null;
  constructor() {
    super(9, "#document", null);
    this.documentElement = new FakeElement("html", this);
    this.body = new FakeElement("body", this);
    this.appendChild(this.documentElement);
    this.documentElement.appendChild(this.body);
  }
  createElement(tag: string) {
    return new FakeElement(tag, this);
  }
  createElementNS(ns: string, tag: string) {
    return new FakeElement(tag, this, ns);
  }
  createTextNode(text: string) {
    const t = new FakeNode(3, "#text", this);
    t.nodeValue = text;
    return t;
  }
  elementFromPoint() {
    return null;
  }
}
// Contexte 2D qui accepte tout et ne dessine rien : les titres, les masques et
// l'histogramme passent par leur vrai chemin de rendu.
function context2d(canvas: FakeElement) {
  const state: Record<string | symbol, unknown> = { canvas };
  return new Proxy(state, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === "then" || typeof k !== "string") return undefined;
      if (k === "measureText")
        return (s: string) => ({
          width: String(s).length * 8,
          actualBoundingBoxAscent: 8,
          actualBoundingBoxDescent: 2,
        });
      // Un pavé opaque au centre : les titres ont une boîte, donc des poignées.
      if (k === "getImageData")
        return (_x: number, _y: number, w: number, h: number) => {
          const data = new Uint8ClampedArray(Math.max(1, w * h * 4));
          for (let y = Math.floor(h * 0.45); y < h * 0.55; y++)
            for (let x = Math.floor(w * 0.4); x < w * 0.6; x++)
              data.fill(255, (y * w + x) * 4, (y * w + x) * 4 + 4);
          return { data, width: w, height: h };
        };
      if (k.startsWith("create")) return () => ({ addColorStop() {} });
      return () => undefined;
    },
    set(t, k, v) {
      t[k] = v;
      return true;
    },
  });
}

type ReactModule = typeof import("react");
type ReactDomModule = typeof import("react-dom");
type ClientModule = typeof import("react-dom/client");
let React: ReactModule, ReactDom: ReactDomModule, Client: ClientModule;
let Preview: typeof import("../src/video/Preview").default;
let Keyframes: typeof import("../src/video/Keyframes").default;
let NumericRange: typeof import("../src/modules/NumericRange").default;
let VideoStudio: typeof import("../src/video/VideoStudio").default;
let document: FakeDocument;
// Les écouteurs posés sur `window` : c'est là que l'éditeur écoute le clavier.
const windowListeners = new Map<string, Set<(e: unknown) => void>>();
const saved: Record<string, unknown> = {};
const globals = [
  "window",
  "document",
  "ResizeObserver",
  "localStorage",
  "sessionStorage",
  "matchMedia",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "AudioContext",
  "getComputedStyle",
  "fetch",
];

// Le moteur vidéo de l'application : ce que l'éditeur lit au démarrage. Les
// autres appels répondent « rien » ; aucun n'est fait pendant les rafales.
function service(fixed: Record<string, unknown>) {
  return new Proxy(fixed, {
    get: (t, k) =>
      k in t
        ? t[k as string]
        : k === "then" || typeof k !== "string"
          ? undefined
          : async () => null,
  });
}
const frames = 600;
const asset = (a: Partial<Asset> & Pick<Asset, "id" | "name" | "kind">) =>
  ({
    size: 1,
    duration: 40,
    width: 320,
    height: 180,
    fps: { n: 25, d: 1 },
    codec: "h264",
    pixelFormat: "yuv420p",
    bits: 8,
    audioChannels: 2,
    sampleRate: 48000,
    color: {
      primaries: "bt709",
      transfer: "bt709",
      matrix: "bt709",
      range: "tv",
    },
    inputSpace: "rec709",
    spaceConfirmed: true,
    source: "juno-media://" + a.id,
    status: "ready",
    created: 1,
    waveform: Array.from({ length: 64 }, (_, i) => (i % 7) / 7),
    ...a,
  }) as Asset;
const ramp = (from: number, to: number) => [
  { frame: 0, value: from, easing: "linear" as const },
  { frame: 300, value: (from + to) / 2, easing: "smooth" as const },
  { frame: frames - 1, value: to, easing: "linear" as const },
];
const shot = (c: Partial<Clip> & Pick<Clip, "id" | "assetId">): Clip => ({
  track: 0,
  start: 0,
  duration: frames,
  inUs: 0,
  speed: 1,
  gain: 1,
  muted: false,
  opacity: 1,
  scale: 1,
  x: 0,
  y: 0,
  rotation: 0,
  fadeIn: 0,
  fadeOut: 0,
  grade: { ...BASE_GRADE },
  ...c,
});
// Tout ce qui peut bouger d'une image à l'autre bouge : la position et le son
// du plan (seules propriétés d'un plan qui prennent des images clés), le son
// lié, une musique, un titre animé sur ses cinq propriétés, un sous-titre
// surligné mot à mot, un masque qui se déplace.
function film(): VideoProject {
  const sequence: Sequence = {
    id: "s",
    name: "Film animé",
    version: 1,
    width: 320,
    height: 180,
    fps: { n: 25, d: 1 },
    masterGain: 1,
    ducking: {
      enabled: true,
      depth: 0.6,
      attack: 0.2,
      release: 0.5,
      hold: 0.3,
    },
    tracks: { "10": { name: "Voix" }, "11": { name: "Musique" } },
    clips: [
      shot({
        id: "plan",
        assetId: "rush",
        component: "video",
        linkId: "lien",
        animation: { x: ramp(-0.4, 0.4), y: ramp(0.3, -0.3) },
        masks: [
          {
            id: "masque",
            name: "Visage",
            effect: "blur",
            shape: "ellipse",
            width: 0.2,
            height: 0.25,
            strength: 0.6,
            feather: 0.1,
            keys: [
              { frame: 0, x: 0.2, y: 0.3 },
              { frame: 300, x: 0.5, y: 0.6 },
              { frame: frames - 1, x: 0.8, y: 0.4 },
            ],
          },
        ],
      }),
      shot({
        id: "voix",
        assetId: "rush",
        component: "audio",
        linkId: "lien",
        track: 10,
        audioRole: "voice",
        animation: { gain: ramp(0.3, 1.6) },
      }),
      shot({
        id: "musique",
        assetId: "piste",
        component: "audio",
        track: 11,
        audioRole: "music",
        animation: { gain: ramp(1.2, 0.2) },
      }),
    ],
    titles: [
      {
        id: "titre",
        text: "Titre animé",
        start: 0,
        duration: frames,
        size: 24,
        y: 0.5,
        color: "#ffffff",
        motion: {
          x: ramp(-0.2, 0.2),
          y: ramp(0.1, -0.1),
          scale: ramp(0.5, 1.5),
          rotation: ramp(-30, 30),
          opacity: ramp(0.2, 1),
        },
      },
    ],
    captions: [
      {
        id: "st",
        text: "Un deux trois",
        start: 0,
        duration: frames,
        words: [
          { start: 0, end: 150, from: 0, to: 2 },
          { start: 150, end: 330, from: 3, to: 7 },
          { start: 330, end: 590, from: 8, to: 13 },
        ],
        style: { wordMode: "highlight", effect: "pop" },
      },
    ],
    markers: [{ id: "repere", frame: 120, text: "Entrée" }],
    created: 1,
  };
  return {
    id: "p",
    name: "Mariage",
    photoProjectId: null,
    revision: 1,
    created: 1,
    updated: 1,
    assets: [
      asset({
        id: "rush",
        name: "Rush.mov",
        kind: "video",
        analysis: {
          scenes: [4],
          silences: [{ start: 5, end: 6 }],
          brightness: 0.5,
          clipped: 0,
        },
        transcript: [{ start: 0, end: 2, text: "Oui, je le veux." }],
      }),
      asset({ id: "piste", name: "Musique.wav", kind: "audio", codec: "pcm" }),
    ],
    sequences: [sequence],
    multicam: [],
    comments: [
      {
        id: "n",
        sequenceId: "s",
        frame: 40,
        text: "Belle lumière",
        resolved: false,
        created: 1,
      },
    ],
  };
}
let project = film();

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  for (const k of globals) saved[k] = g[k];
  document = new FakeDocument();
  const memory = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, String(v)),
      removeItem: (k: string) => void m.delete(k),
      clear: () => m.clear(),
    };
  };
  const media = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  });
  const engine = {
    available: true,
    version: "test",
    encoder: "test",
    platform: "darwin",
    luts: [],
    spaces: [{ id: "rec709", name: "Rec. 709" }],
    transcription: true,
  };
  const window = {
    document,
    HTMLIFrameElement: class {},
    event: undefined,
    addEventListener(type: string, fn: (e: unknown) => void) {
      if (!windowListeners.has(type)) windowListeners.set(type, new Set());
      windowListeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: (e: unknown) => void) {
      windowListeners.get(type)?.delete(fn);
    },
    dispatchEvent(e: { type: string }) {
      for (const fn of [...(windowListeners.get(e.type) ?? [])]) fn(e);
      return true;
    },
    matchMedia: media,
    juno: service({
      updates: undefined,
      onWindowFullscreen: () => () => {},
      windowFullscreen: async (value: boolean) => value,
      video: service({
        status: async () => engine,
        list: async () => ({
          projects: [
            {
              id: project.id,
              name: project.name,
              count: project.assets.length,
              revision: project.revision,
            },
          ],
          jobs: [],
        }),
        project: async () => structuredClone(project),
        commandHistory: async () => [],
      }),
      voice: service({
        status: async () => ({
          available: false,
          local: true,
          maxSeconds: 0,
          error: "",
        }),
      }),
      planner: service({ status: async () => ({ available: false }) }),
      review: service({ jobs: async () => [] }),
    }),
  };
  document.defaultView = window;
  g.window = window;
  g.document = document;
  g.localStorage = memory();
  g.sessionStorage = memory();
  g.matchMedia = media;
  g.requestAnimationFrame = (f: () => void) => setTimeout(f, 16);
  g.cancelAnimationFrame = (t: ReturnType<typeof setTimeout>) =>
    clearTimeout(t);
  g.getComputedStyle = () => ({
    paddingLeft: "0",
    paddingRight: "0",
    paddingTop: "0",
    paddingBottom: "0",
  });
  // Rien ne part sur le réseau : l'index des images d'un fichier est absent.
  g.fetch = async () => {
    throw Error("hors ligne");
  };
  g.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  g.AudioContext = class {
    destination = {};
    createMediaElementSource() {
      return { connect() {}, disconnect() {} };
    }
    createGain() {
      return { gain: { value: 1 }, connect() {}, disconnect() {} };
    }
    createStereoPanner() { return {pan:{value:0},connect(){},disconnect(){}}; }
    createAnalyser() { return {fftSize:512,getFloatTimeDomainData(data:Float32Array){data.fill(0);},connect(){},disconnect(){}}; }
    resume() {
      return Promise.resolve();
    }
  };
  React = await import("react");
  ReactDom = await import("react-dom");
  Client = await import("react-dom/client");
  Preview = (await import("../src/video/Preview")).default;
  Keyframes = (await import("../src/video/Keyframes")).default;
  NumericRange = (await import("../src/modules/NumericRange")).default;
  VideoStudio = (await import("../src/video/VideoStudio")).default;
}, 60000);
afterAll(async () => {
  // Laisser finir les tâches du planificateur de React avant de retirer le DOM.
  await new Promise((r) => setTimeout(r, 50));
  const g = globalThis as Record<string, unknown>;
  for (const k of globals)
    if (saved[k] === undefined) delete g[k];
    else g[k] = saved[k];
});

// La racine de React d'un conteneur : ses voies en attente disent s'il reste
// un rendu programmé après une image.
function fiberRoot(container: FakeElement) {
  const key = Object.keys(container).find((k) =>
    k.startsWith("__reactContainer$"),
  );
  return (
    container as unknown as Record<
      string,
      { stateNode: { pendingLanes: number } }
    >
  )[key!].stateNode;
}
function props(el: FakeElement) {
  const key = Object.keys(el).find((k) => k.startsWith("__reactProps$"))!;
  return (
    el as unknown as Record<string, Record<string, (e: unknown) => void>>
  )[key];
}
function inputValue(el: FakeElement | undefined) {
  return el && String((el as unknown as { value: unknown }).value);
}
function capture() {
  const errors: string[] = [];
  const spy = vi.spyOn(console, "error").mockImplementation((...a) => {
    errors.push(a.map(String).join(" ").slice(0, 300));
  });
  return { errors, restore: () => spy.mockRestore() };
}

// Monte `render(frame)`, puis déplace la tête image par image, chaque image
// rendue et validée tout de suite (comme une touche), sans rendre la main.
function burst(
  render: (frame: number) => React.ReactNode,
  count: number,
): { errors: string[]; pending: number } {
  const { createElement, useState } = React;
  const container = document.createElement("div");
  document.body.appendChild(container);
  let move: (f: number) => void = () => {};
  function Harness() {
    const [frame, setFrame] = useState(0);
    move = setFrame;
    return createElement("main", null, render(frame));
  }
  const root = Client.createRoot(container as unknown as HTMLElement);
  const fiber = fiberRoot(container);
  let pending = 0;
  const log = capture();
  try {
    ReactDom.flushSync(() => root.render(createElement(Harness)));
    for (let f = 1; f <= count; f++) {
      try {
        ReactDom.flushSync(() => move(f));
        if (fiber.pendingLanes) pending++;
      } catch (e) {
        log.errors.push("image " + f + " : " + (e as Error).message);
        break;
      }
    }
  } finally {
    log.restore();
  }
  ReactDom.flushSync(() => root.unmount());
  document.body.removeChild(container);
  return { errors: log.errors, pending };
}

const sequence = project.sequences[0];
const clip = sequence.clips[0];

describe("rafale de flèches : aucun rendu programmé par image", () => {
  it("le moniteur tient 200 images d'affilée sans erreur 185", () => {
    const r = burst(
      (frame) =>
        React.createElement(Preview, {
          sequence,
          assets: project.assets,
          frame,
          playing: false,
          selectedTitle: "titre",
          selectedMask: { clipId: "plan", maskId: "masque" },
          onTitleChange: () => {},
          onMaskChange: () => {},
        }),
      200,
    );
    expect(r.errors).toEqual([]);
    expect(r.pending).toBe(0);
  });
  it("les images clés tiennent 200 images d'affilée sans erreur 185", () => {
    const r = burst(
      (frame) =>
        React.createElement(Keyframes, {
          clip,
          sequence,
          at: frame,
          onChange: () => {},
          onSeek: () => {},
        }),
      200,
    );
    expect(r.errors).toEqual([]);
    expect(r.pending).toBe(0);
  });
  it("un champ numérique dont la valeur suit la tête tient 200 images", () => {
    // La position horizontale d'un plan animé, comme dans l'inspecteur.
    const r = burst(
      (frame) =>
        React.createElement(NumericRange, {
          label: "Position horizontale",
          min: -1,
          max: 1,
          step: 0.01,
          value: animatedClip(clip, frame).x,
          onChange: () => {},
        }),
      200,
    );
    expect(r.errors).toEqual([]);
    expect(r.pending).toBe(0);
  });
});

// L'éditeur entier. Chaque flèche passe par l'écouteur clavier de l'éditeur,
// comme une vraie touche ; après chaque image, les microtâches sont vidées
// (une promesse résolue par un effet aurait programmé son rendu), mais la
// tâche du planificateur de React ne passe jamais : c'est la touche maintenue
// pendant un gel.
async function mountStudio() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = Client.createRoot(container as unknown as HTMLElement);
  const fiber = fiberRoot(container);
  const settle = async (ready: () => boolean = () => true) => {
    for (let i = 0; i < 600; i++) {
      if (ready() && !fiber.pendingLanes) return;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw Error("L'éditeur ne se stabilise pas.");
  };
  const find = (pick: (e: FakeElement) => boolean) => all(container, pick)[0];
  const byText = (tag: string, text: string) =>
    find((e) => e.nodeName === tag && e.textContent.trim() === text);
  const byLabel = (label: string) =>
    find((e) => e.getAttribute("aria-label") === label);
  const act = async (el: FakeElement | undefined, handler = "onClick") => {
    if (!el) throw Error("Élément introuvable.");
    ReactDom.flushSync(() =>
      props(el)[handler]({
        stopPropagation() {},
        preventDefault() {},
        currentTarget: el,
        target: el,
        detail: 1,
        button: 0,
      }),
    );
    await settle();
  };
  const at = () => {
    const [h, m, s, f] = (
      find((e) => e.matches(".vf-transport span"))?.textContent ?? ""
    )
      .split(":")
      .map(Number);
    return ((h * 60 + m) * 60 + s) * 25 + f;
  };
  const key = (code: string, shiftKey = false) => {
    const event = {
      type: "keydown",
      code,
      key: code,
      shiftKey,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      repeat: true,
      target: document.body,
      preventDefault() {},
      stopPropagation() {},
    };
    for (const fn of [...(windowListeners.get("keydown") ?? [])]) fn(event);
  };
  // `count` flèches d'affilée : erreurs, images où un rendu restait en
  // attente, et flèches perdues (la tête n'est pas où elle devrait).
  const rafale = async (code: "ArrowRight" | "ArrowLeft", count: number) => {
    const from = at(),
      log = capture();
    let pending = 0;
    const waiting: number[] = [];
    try {
      for (let i = 1; i <= count; i++) {
        try {
          ReactDom.flushSync(() => key(code));
        } catch (e) {
          log.errors.push("flèche " + i + " : " + (e as Error).message);
        }
        for (let k = 0; k < 4; k++) await Promise.resolve();
        if (fiber.pendingLanes) {
          pending++;
          if (waiting.length < 5) waiting.push(i);
        }
      }
    } finally {
      log.restore();
    }
    const expected = Math.max(
      0,
      from + (code === "ArrowRight" ? count : -count),
    );
    await settle();
    return {
      errors: log.errors,
      pending,
      waiting,
      lost: Math.abs(expected - at()),
    };
  };
  ReactDom.flushSync(() =>
    root.render(React.createElement(VideoStudio, { onPhoto() {} })),
  );
  await settle(() => !!find((e) => e.matches(".vf-transport")));
  return {
    container,
    find,
    byText,
    byLabel,
    act,
    at,
    key,
    rafale,
    settle,
    unmount: () => {
      ReactDom.flushSync(() => root.unmount());
      document.body.removeChild(container);
    },
  };
}

describe(
  "éditeur entier sur un montage animé partout",
  { timeout: 30000 },
  () => {
    let studio: Awaited<ReturnType<typeof mountStudio>>;
    beforeAll(async () => {
      project = film();
      studio = await mountStudio();
    }, 60000);
    afterAll(() => studio?.unmount());
    const clipOf = (name: string, audio: boolean) =>
      studio.find(
        (e) =>
          e.getAttribute("aria-label") === "Plan " + name &&
          (e.getAttribute("class") ?? "").includes("audio") === audio,
      );
    const panel = (label: string) =>
      studio.find(
        (e) =>
          e.nodeName === "BUTTON" &&
          e.parentNode instanceof FakeElement &&
          (e.parentNode.getAttribute("class") ?? "").includes("vf-steps") &&
          e.textContent.trim() === label,
      );
    // Aller et retour de 200 images chacun, depuis l'image 50.
    async function allerRetour() {
      await studio.act(
        studio.find(
          (e) => e.nodeName === "BUTTON" && e.getAttribute("title") === "Début",
        ),
      );
      for (let i = 0; i < 5; i++) {
        ReactDom.flushSync(() => studio.key("ArrowRight", true));
        await studio.settle();
      }
      expect(studio.at()).toBe(50);
      const aller = await studio.rafale("ArrowRight", 200);
      const retour = await studio.rafale("ArrowLeft", 200);
      return { aller, retour, fin: studio.at() };
    }
    const clean = {
      aller: { errors: [], pending: 0, waiting: [], lost: 0 },
      retour: { errors: [], pending: 0, waiting: [], lost: 0 },
      fin: 50,
    };

    it("le moniteur montre le plan, le titre, le sous-titre et le masque", () => {
      expect(
        studio.find((e) => e.matches(".vf-preview-error")),
      ).toBeUndefined();
      expect(
        studio.find((e) => e.matches(".vf-preview canvas[data-video-clip]")),
      ).toBeTruthy();
      expect(studio.byLabel("Titre animé")).toBeTruthy();
      expect(studio.byLabel("Un deux trois")).toBeTruthy();
      expect(
        studio.find((e) => e.matches(".vf-preview div[data-mask]")),
      ).toBeTruthy();
    });
    it("montage et inspecteur du plan : position animée, images clés", async () => {
      await studio.act(clipOf("Rush.mov", false));
      const position = studio.byLabel("Position horizontale : valeur");
      expect(position).toBeTruthy();
      expect(
        studio.find((e) => e.matches("details.vf-keyframes")),
      ).toBeTruthy();
      expect(await allerRetour()).toEqual(clean);
      // Le champ montre la position du plan à l'image affichée.
      expect(inputValue(studio.byLabel("Position horizontale : valeur"))).toBe(
        String(Number(animatedClip(clip, 50).x.toFixed(3))),
      );
    });
    it("son du plan : volume animé, mixeur, voix, atténuation", async () => {
      await studio.act(panel("Son"));
      await studio.act(clipOf("Rush.mov", true));
      expect(studio.byLabel("Volume du plan : valeur")).toBeTruthy();
      expect(await allerRetour()).toEqual(clean);
      expect(inputValue(studio.byLabel("Volume du plan : valeur"))).toBe(
        String(Number(animatedClip(sequence.clips[1], 50).gain.toFixed(3))),
      );
    });
    it("musique : volume animé", async () => {
      await studio.act(clipOf("Musique.wav", true));
      expect(studio.byLabel("Volume du plan : valeur")).toBeTruthy();
      expect(await allerRetour()).toEqual(clean);
    });
    it("couleur : étalonnage et histogramme", async () => {
      await studio.act(clipOf("Rush.mov", false));
      await studio.act(panel("Couleur"));
      const scopes = studio.byLabel("Histogramme couleur du plan affiché");
      expect(scopes).toBeTruthy();
      // L'histogramme a lu l'image du moniteur.
      expect(scopes!.parentNode!.textContent).toMatch(/Proche du noir\s*\d/);
      expect(await allerRetour()).toEqual(clean);
    });
    it("motion design : titre animé sélectionné, poignées du moniteur", async () => {
      await studio.act(studio.byLabel("Modifier Titre animé"));
      expect(studio.byLabel("Preset d’animation")).toBeTruthy();
      expect(studio.byLabel("Déplacer l’élément graphique")).toBeTruthy();
      expect(studio.byLabel("Pivoter l’élément graphique")).toBeTruthy();
      expect(await allerRetour()).toEqual(clean);
    });
    it("sous-titres surlignés mot à mot", async () => {
      await studio.act(studio.byText("BUTTON", "Sous-titres"));
      expect(
        studio.find((e) => e.matches("details.caption-word-editor")),
      ).toBeTruthy();
      expect(await allerRetour()).toEqual(clean);
    });
    it("masques : masque qui se déplace, poignée active", async () => {
      await studio.act(panel("Masques"));
      expect(studio.byLabel("Poser un repère de position")).toBeTruthy();
      expect(studio.byLabel("Déplacer le masque")).toBeTruthy();
      expect(await allerRetour()).toEqual(clean);
    });
    it("transcription et notes", async () => {
      await studio.act(panel("Texte & IA"));
      expect(studio.byLabel("Média à transcrire")).toBeTruthy();
      expect(await allerRetour()).toEqual(clean);
      await studio.act(panel("Notes"));
      expect(await allerRetour()).toEqual(clean);
    });
    it("projets, activité et pilote ouverts", async () => {
      await studio.act(panel("Médias & montage"));
      await studio.act(studio.byLabel("Ouvrir les projets"));
      await studio.act(studio.find((e) => e.matches("button.activity-toggle")));
      expect(studio.byLabel("Fermer les projets")).toBeTruthy();
      expect(studio.byLabel("Activité du studio")).toBeTruthy();
      expect(await allerRetour()).toEqual(clean);
      // Le pilote ferme l'activité en s'ouvrant : un seul panneau à la fois.
      await studio.act(
        studio.find(
          (e) =>
            e.nodeName === "BUTTON" &&
            e.getAttribute("title") === "Pilote Juno · ⌘/Ctrl + Maj + P",
        ),
      );
      expect(all(document.body, (e) => e.matches(".pilot-panel")).length).toBe(
        1,
      );
      expect(await allerRetour()).toEqual(clean);
    });
  },
);

// Un film de 600 images dont le plan n'en occupe que 300 (un titre court
// jusqu'au bout) : la tête peut être dans le film mais hors du plan. Le plan
// a été recadré automatiquement (échelle et position non rondes) et sa
// position horizontale est animée.
function filmCourt(): VideoProject {
  const p = film();
  const s = p.sequences[0];
  p.id = "p-court";
  s.clips = [
    shot({
      id: "plan",
      assetId: "rush",
      component: "video",
      duration: 300,
      reframe: "couple",
      scale: 1.77778,
      y: -0.087654,
      animation: {
        x: [
          { frame: 0, value: -0.3, easing: "linear" },
          { frame: 149, value: 0.3, easing: "linear" },
          { frame: 299, value: 0.3, easing: "linear" },
        ],
      },
    }),
  ];
  s.titles = [
    {
      id: "fin",
      text: "Merci",
      start: 0,
      duration: frames,
      size: 24,
      y: 0.5,
      color: "#ffffff",
    },
  ];
  s.captions = [];
  s.markers = [];
  p.comments = [];
  return p;
}

describe(
  "éditeur : fin du film, valeur refusée, champ quitté sans saisie",
  { timeout: 30000 },
  () => {
    let studio: Awaited<ReturnType<typeof mountStudio>>;
    // Tout ce que l'éditeur enregistre.
    const saves: Sequence[] = [];
    const video = () =>
      (
        globalThis as unknown as {
          window: { juno: { video: Record<string, unknown> } };
        }
      ).window.juno.video;
    beforeAll(async () => {
      project = filmCourt();
      video().saveSequence = async (x: {
        sequence: Sequence;
        expectedVersion?: number;
      }) => {
        saves.push(structuredClone(x.sequence));
        return { version: (x.expectedVersion ?? 1) + 1, revision: 2 };
      };
      studio = await mountStudio();
      await studio.act(
        studio.find(
          (e) =>
            e.getAttribute("aria-label") === "Plan Rush.mov" &&
            !(e.getAttribute("class") ?? "").includes("audio"),
        ),
      );
    }, 60000);
    afterAll(() => {
      studio?.unmount();
      delete video().saveSequence;
      project = film();
    });
    const goTo = async (target: number) => {
      await studio.act(
        studio.find(
          (e) => e.nodeName === "BUTTON" && e.getAttribute("title") === "Début",
        ),
      );
      for (let i = 0; i < Math.floor(target / 10); i++) {
        ReactDom.flushSync(() => studio.key("ArrowRight", true));
        await studio.settle();
      }
      for (let i = 0; i < target % 10; i++) {
        ReactDom.flushSync(() => studio.key("ArrowRight"));
        await studio.settle();
      }
      expect(studio.at()).toBe(target);
    };
    const field = (label: string) => studio.byLabel(label + " : valeur")!;
    // Entrer dans le champ, taper (ou pas), puis Entrée ou sortie du champ.
    const fill = async (label: string, text?: string, enter = false) => {
      const fire = async (
        name: string,
        event: Record<string, unknown> = {},
      ) => {
        ReactDom.flushSync(() =>
          props(field(label))[name]({
            preventDefault() {},
            stopPropagation() {},
            currentTarget: { blur: () => props(field(label)).onBlur({}) },
            ...event,
          }),
        );
        await studio.settle();
      };
      await fire("onFocus");
      if (text !== undefined)
        await fire("onChange", { target: { value: text } });
      if (enter) await fire("onKeyDown", { key: "Enter" });
      else await fire("onBlur");
    };
    const monitorEmpty = () =>
      studio.find((e) => e.matches(".vf-preview-empty"))?.textContent;

    it("sortir des champs sans rien taper n'écrit rien : ni image clé, ni recadrage « à la main »", async () => {
      await goTo(40);
      const shown = [
        "Échelle",
        "Position horizontale",
        "Position verticale",
        "Rotation",
        "Opacité",
      ].map((l) => inputValue(field(l)));
      expect(shown.slice(0, 3)).toEqual(["1.778", "-0.139", "-0.088"]);
      for (const l of [
        "Échelle",
        "Position horizontale",
        "Position verticale",
        "Rotation",
        "Opacité",
      ])
        await fill(l);
      await fill("Position horizontale", undefined, true);
      await new Promise((r) => setTimeout(r, 30));
      await studio.settle();
      expect(saves).toEqual([]);
      expect(
        [
          "Échelle",
          "Position horizontale",
          "Position verticale",
          "Rotation",
          "Opacité",
        ].map((l) => inputValue(field(l))),
      ).toEqual(shown);
    });
    it("tête hors du plan : la valeur refusée ne reste pas affichée", async () => {
      await goTo(400);
      expect(inputValue(field("Position horizontale"))).toBe("0.3");
      await fill("Position horizontale", "0.1", true);
      expect(studio.find((e) => e.matches(".workspace-status"))?.textContent).toContain(
        "Placez le curseur dans le plan et indiquez une valeur valide.",
      );
      expect(inputValue(field("Position horizontale"))).toBe("0.3");
      for (let i = 0; i < 5; i++) {
        ReactDom.flushSync(() => studio.key("ArrowRight"));
        await studio.settle();
      }
      expect(inputValue(field("Position horizontale"))).toBe("0.3");
      // De retour dans le plan, le champ suit la tête.
      await goTo(0);
      expect(inputValue(field("Position horizontale"))).toBe("-0.3");
      expect(saves).toEqual([]);
    });
    it("flèches, Maj + flèches et boutons s'arrêtent sur la dernière image du film", async () => {
      await goTo(595);
      for (let i = 0; i < 30; i++) {
        ReactDom.flushSync(() => studio.key("ArrowRight"));
        await studio.settle();
      }
      expect(studio.at()).toBe(frames - 1);
      ReactDom.flushSync(() => studio.key("ArrowRight", true));
      await studio.settle();
      expect(studio.at()).toBe(frames - 1);
      expect(monitorEmpty()).toBeUndefined();
      await studio.act(
        studio.find(
          (e) =>
            e.nodeName === "BUTTON" &&
            e.getAttribute("title") === "Image suivante",
        ),
      );
      expect(studio.at()).toBe(frames - 1);
      await studio.act(
        studio.find(
          (e) =>
            e.nodeName === "BUTTON" &&
            e.getAttribute("title") === "Image précédente",
        ),
      );
      expect(studio.at()).toBe(frames - 2);
      ReactDom.flushSync(() => studio.key("ArrowLeft", true));
      await studio.settle();
      expect(studio.at()).toBe(frames - 12);
    });
    it("un clic sur la règle après la fin place la tête sur la dernière image", async () => {
      await goTo(10);
      const ruler = studio.find((e) => e.matches(".vf-ruler"))!;
      ReactDom.flushSync(() =>
        props(ruler).onClick({ clientX: 100000, stopPropagation() {} }),
      );
      await studio.settle();
      expect(studio.at()).toBe(frames - 1);
      expect(monitorEmpty()).toBeUndefined();
      // Dans le film, le clic place la tête où il tombe : 92 px de marge, puis
      // 70 px par seconde à 25 images par seconde.
      ReactDom.flushSync(() =>
        props(ruler).onClick({ clientX: 92 + 140, stopPropagation() {} }),
      );
      await studio.settle();
      expect(studio.at()).toBe(50);
    });
    it("le pilote envoyé après la fin s'arrête sur la dernière image et le dit", async () => {
      // Les réglages du composant Pilote, lus dans l'arbre de React.
      type Fiber = {
        type?: { name?: string };
        memoizedProps?: Record<string, unknown>;
        child?: Fiber | null;
        sibling?: Fiber | null;
      };
      const walk = (
        f: Fiber | null | undefined,
      ): Record<string, unknown> | undefined => {
        for (let n = f; n; n = n.sibling) {
          if (n.type?.name === "Pilot") return n.memoizedProps;
          const r = walk(n.child);
          if (r) return r;
        }
      };
      const pilot = walk(
        (fiberRoot(studio.container) as unknown as { current: Fiber }).current,
      ) as {
        capture: () => Promise<unknown>;
        run: (plan: unknown, context: unknown) => Promise<string>;
      };
      const go = async (seconds: number) => {
        const answer = await pilot.run(
          {
            id: "x",
            text: "va à " + seconds + " s",
            actions: [{ kind: "video.seek", seconds }],
            scope: "current",
            label: "",
            explanation: "",
            source: "text",
          },
          await pilot.capture(),
        );
        await studio.settle();
        return answer;
      };
      expect(await go(60)).toBe(
        "Le film dure 24.0 s : curseur placé sur sa dernière image.",
      );
      expect(studio.at()).toBe(frames - 1);
      expect(monitorEmpty()).toBeUndefined();
      expect(await go(10)).toBe("Curseur déplacé à 10 s.");
      expect(studio.at()).toBe(250);
    });
  },
);

describe("saisie dans un champ numérique", () => {
  // Un champ piloté par un parent qui peut changer sa valeur à tout moment
  // (la tête qui bouge sous un plan animé, une annulation...). Chaque geste
  // est suivi du passage du planificateur : ce qui est vérifié ici, c'est le
  // comportement de saisie, le même qu'avant la correction.
  // Le parent accepte tout de suite (montage), refuse (tête hors du plan,
  // piste verrouillée) ou applique plus tard (retouche photo : la valeur
  // revient une fois le catalogue écrit).
  function mount(
    initial: number,
    step = 0.01,
    parent: "accepte" | "refuse" | "plus tard" = "accepte",
  ) {
    const container = document.createElement("div");
    const root = Client.createRoot(container as unknown as HTMLElement);
    const fiber = fiberRoot(container);
    const changes: [number, string | undefined][] = [];
    const later: (() => void)[] = [];
    let setValue: (v: number) => void = () => {};
    function Parent() {
      const [value, set] = React.useState(initial);
      setValue = set;
      return React.createElement(NumericRange, {
        label: "Exposition",
        min: -4,
        max: 4,
        step,
        value,
        onChange: (v: number, group?: string) => {
          changes.push([v, group]);
          if (parent === "refuse") return false;
          if (parent === "plus tard") later.push(() => set(v));
          else set(v);
        },
      });
    }
    ReactDom.flushSync(() => root.render(React.createElement(Parent)));
    const field = () =>
      all(
        container,
        (e) => e.getAttribute("aria-label") === "Exposition : valeur",
      )[0];
    const settle = async () => {
      for (let i = 0; i < 50 && fiber.pendingLanes; i++)
        await new Promise((r) => setTimeout(r, 2));
    };
    // Le navigateur appelle `blur` pendant la touche : l'événement de sortie
    // du champ part aussitôt, dans le même lot de mises à jour.
    const fire = async (name: string, event: Record<string, unknown> = {}) => {
      ReactDom.flushSync(() =>
        props(field())[name]({
          preventDefault() {},
          stopPropagation() {},
          currentTarget: { blur: () => props(field()).onBlur({}) },
          ...event,
        }),
      );
      await settle();
    };
    return {
      text: () => inputValue(field()),
      error: () =>
        all(container, (e) => e.getAttribute("role") === "alert")[0]
          ?.textContent,
      pending: () => fiber.pendingLanes,
      focus: () => fire("onFocus"),
      type: (value: string) => fire("onChange", { target: { value } }),
      blur: () => fire("onBlur"),
      key: (key: string, shiftKey = false) =>
        fire("onKeyDown", { key, shiftKey }),
      move: async (v: number) => {
        ReactDom.flushSync(() => setValue(v));
        await settle();
      },
      moveNow: (v: number) => ReactDom.flushSync(() => setValue(v)),
      apply: async () => {
        ReactDom.flushSync(() => later.splice(0).forEach((f) => f()));
        await settle();
      },
      changes,
      unmount: () => ReactDom.flushSync(() => root.unmount()),
    };
  }
  it("suit la valeur dans le rendu même, sans rendu en attente", () => {
    const log = capture();
    const f = mount(0.25);
    expect(f.text()).toBe("0.25");
    f.moveNow(0.1234567);
    expect(f.text()).toBe("0.123");
    expect(f.pending()).toBe(0);
    f.moveNow(-1.5);
    expect(f.text()).toBe("-1.5");
    expect(f.pending()).toBe(0);
    f.unmount();
    log.restore();
    expect(log.errors).toEqual([]);
  });
  it("garde la saisie pendant l'édition, même si la valeur change", async () => {
    const f = mount(0.25);
    await f.focus();
    await f.type("1,5");
    await f.move(0.3);
    expect(f.text()).toBe("1,5");
    await f.move(0.35);
    expect(f.text()).toBe("1,5");
    // En quittant le champ, la saisie est appliquée, puis le champ suit.
    await f.blur();
    expect(f.changes.map((c) => c[0])).toEqual([1.5]);
    expect(f.changes[0][1]).toBeTruthy();
    expect(f.text()).toBe("1.5");
    await f.move(0.2);
    expect(f.text()).toBe("0.2");
    f.unmount();
  });
  it("Échap rend la valeur sans rien appliquer", async () => {
    const f = mount(0.25);
    await f.focus();
    await f.type("3");
    await f.key("Escape");
    expect(f.text()).toBe("0.25");
    expect(f.changes).toEqual([]);
    await f.move(0.5);
    expect(f.text()).toBe("0.5");
    f.unmount();
  });
  it("une saisie illisible est refusée et le champ reprend la valeur", async () => {
    const f = mount(0.25);
    await f.focus();
    await f.type("abc");
    await f.blur();
    expect(f.error()).toBe("Saisissez un nombre.");
    expect(f.text()).toBe("0.25");
    expect(f.changes).toEqual([]);
    // Revenir dans le champ efface le message.
    await f.focus();
    expect(f.error()).toBeUndefined();
    await f.blur();
    f.unmount();
  });
  it("Entrée applique, les flèches haut et bas avancent d'un pas", async () => {
    const f = mount(0.25);
    await f.focus();
    await f.key("ArrowUp");
    expect(f.text()).toBe("0.26");
    await f.key("ArrowDown", true);
    expect(f.text()).toBe("0.16");
    expect(f.changes).toEqual([]);
    await f.key("Enter");
    expect(f.changes.map((c) => c[0])).toEqual([0.16]);
    expect(f.text()).toBe("0.16");
    f.unmount();
  });
  it("quitter le champ sans rien changer ne crée pas de modification", async () => {
    const f = mount(0.25);
    await f.focus();
    await f.blur();
    expect(f.changes).toEqual([]);
    expect(f.text()).toBe("0.25");
    f.unmount();
  });
  // Le texte montré n'est qu'un arrondi (trois décimales) d'une valeur qui
  // peut tomber entre deux crans du pas : une position interpolée entre deux
  // images clés, une échelle posée par le recadrage automatique, un réglage
  // d'Auto. En sortir sans rien taper l'écrivait arrondie au pas : une image
  // clé de plus sur un plan animé, un plan recadré passé « Réglé à la main ».
  it("entrer puis sortir sans rien taper n'écrit rien, même hors du pas", async () => {
    const f = mount(0.1234567);
    expect(f.text()).toBe("0.123");
    await f.focus();
    await f.blur();
    expect(f.changes).toEqual([]);
    expect(f.text()).toBe("0.123");
    // Entrée sans rien taper : pas davantage.
    await f.focus();
    await f.key("Enter");
    expect(f.changes).toEqual([]);
    // Taper, puis revenir au texte d'origine : rien n'a changé.
    await f.focus();
    await f.type("0.5");
    await f.type("0.123");
    await f.blur();
    expect(f.changes).toEqual([]);
    expect(f.error()).toBeUndefined();
    // Le champ suit toujours la valeur.
    await f.move(0.2);
    expect(f.text()).toBe("0.2");
    // Une vraie saisie est appliquée, arrondie au pas comme avant.
    await f.focus();
    await f.type("0.456");
    await f.blur();
    expect(f.changes.map((c) => c[0])).toEqual([0.46]);
    expect(f.text()).toBe("0.46");
    f.unmount();
  });
  it("valeur qui bouge pendant qu'on est dans le champ (lecture) : rien n'est écrit, le champ la reprend en sortant", async () => {
    const f = mount(0.1234567);
    await f.focus();
    // Dans le champ, le texte ne bouge pas sous le curseur.
    await f.move(0.2);
    expect(f.text()).toBe("0.123");
    await f.move(-0.3456789);
    expect(f.text()).toBe("0.123");
    // En sortir sans rien taper n'écrit pas la valeur lue à l'entrée.
    await f.blur();
    expect(f.changes).toEqual([]);
    expect(f.text()).toBe("-0.346");
    await f.move(0.25);
    expect(f.text()).toBe("0.25");
    // Même chose avec Échap.
    await f.focus();
    await f.move(0.3);
    await f.key("Escape");
    expect(f.changes).toEqual([]);
    await f.move(0.35);
    expect(f.text()).toBe("0.35");
    f.unmount();
  });
  it("valeur refusée par le parent : le champ reprend la vraie valeur et la suit", async () => {
    const f = mount(0.1234567, 0.01, "refuse");
    // Sortir sans rien taper ne propose rien : le parent aurait refusé, avec
    // son message, un geste que personne n'a fait.
    await f.focus();
    await f.blur();
    expect(f.changes).toEqual([]);
    await f.focus();
    await f.type("0.5");
    await f.key("Enter");
    expect(f.changes.map((c) => c[0])).toEqual([0.5]);
    expect(f.text()).toBe("0.123");
    await f.move(0.3);
    expect(f.text()).toBe("0.3");
    // Une nouvelle saisie est encore proposée.
    await f.focus();
    await f.type("-1");
    await f.blur();
    expect(f.changes.map((c) => c[0])).toEqual([0.5, -1]);
    expect(f.text()).toBe("0.3");
    f.unmount();
  });
  it("parent qui applique plus tard (retouche photo) : la saisie reste affichée en attendant", async () => {
    const f = mount(0.25, 0.01, "plus tard");
    await f.focus();
    await f.type("1,5");
    await f.key("Enter");
    expect(f.changes.map((c) => c[0])).toEqual([1.5]);
    expect(f.text()).toBe("1.5");
    await f.apply();
    expect(f.text()).toBe("1.5");
    await f.move(0.3);
    expect(f.text()).toBe("0.3");
    await f.focus();
    await f.blur();
    expect(f.changes).toHaveLength(1);
    f.unmount();
  });
});

describe("valeur tapée dans les images clés", () => {
  function mount(at: number, c: Clip = clip) {
    const container = document.createElement("div");
    const root = Client.createRoot(container as unknown as HTMLElement);
    const show = (a: number, cc: Clip = c) =>
      ReactDom.flushSync(() =>
        root.render(
          React.createElement(Keyframes, {
            clip: cc,
            sequence,
            at: a,
            onChange: () => {},
            onSeek: () => {},
          }),
        ),
      );
    show(at);
    const input = () =>
      all(
        container,
        (e) => e.getAttribute("aria-label") === "Valeur de l’image clé",
      )[0];
    const type = (text: string) =>
      ReactDom.flushSync(() =>
        props(input()).onChange({ target: { value: text } }),
      );
    const value = () => inputValue(input());
    return { show, type, value, unmount: () => root.unmount() };
  }
  it("reste tant que la tête ne bouge pas, et suit la tête dès qu'elle bouge", () => {
    const log = capture();
    const still = { ...clip, animation: undefined };
    const k = mount(10, still);
    expect(k.value()).toBe("0");
    k.type("12,5");
    expect(k.value()).toBe("12,5");
    // Un rendu sans changement de position garde la saisie.
    k.show(10);
    expect(k.value()).toBe("12,5");
    // La tête bouge : le champ montre la valeur au curseur...
    k.show(11);
    expect(k.value()).toBe("0");
    // ... et la saisie ne revient pas en revenant à la même image.
    k.show(10);
    expect(k.value()).toBe("0");
    k.type("");
    expect(k.value()).toBe("");
    k.unmount();
    log.restore();
    expect(log.errors).toEqual([]);
  });
});

describe("pas de la tête aux flèches", () => {
  it("flèches, Maj ×10, autres touches sans effet", () => {
    expect(arrowStep({ code: "ArrowRight", shiftKey: false })).toBe(1);
    expect(arrowStep({ code: "ArrowLeft", shiftKey: false })).toBe(-1);
    expect(arrowStep({ code: "ArrowRight", shiftKey: true })).toBe(10);
    expect(arrowStep({ code: "ArrowLeft", shiftKey: true })).toBe(-10);
    expect(arrowStep({ code: "Space", shiftKey: false })).toBe(0);
    expect(arrowStep({ code: "KeyS", shiftKey: true })).toBe(0);
  });
  it("chaque touche part de la position laissée par la précédente", () => {
    // 460 flèches à droite puis 460 à gauche, appliquées comme React applique
    // des mises à jour fonctionnelles en file : aucune ne se perd.
    let f = 20;
    for (let i = 0; i < 460; i++)
      f = stepFrame(f, arrowStep({ code: "ArrowRight", shiftKey: false }));
    expect(f).toBe(480);
    for (let i = 0; i < 460; i++)
      f = stepFrame(f, arrowStep({ code: "ArrowLeft", shiftKey: false }));
    expect(f).toBe(20);
    expect(stepFrame(3, -10)).toBe(0);
  });
  it("la tête s'arrête sur la dernière image du film", () => {
    let f = 595;
    for (let i = 0; i < 30; i++) f = stepFrame(f, 1, 599);
    expect(f).toBe(599);
    expect(stepFrame(590, 10, 599)).toBe(599);
    expect(stepFrame(599, -1, 599)).toBe(598);
    // Une tête restée au-delà (plans retirés depuis) revient dans le film.
    expect(stepFrame(700, -1, 599)).toBe(599);
    // Montage vide : la tête reste au début.
    expect(stepFrame(0, 1, -1)).toBe(0);
  });
  it("même contexte : valeurs une à une, comparaison de React", () => {
    const s = { id: "x" };
    expect(sameContext([s, 1, "a", false], [s, 1, "a", false])).toBe(true);
    expect(sameContext([s, 1], [{ id: "x" }, 1])).toBe(false);
    expect(sameContext([NaN], [NaN])).toBe(true);
    expect(sameContext([0], [-0])).toBe(false);
    expect(sameContext([1], [1, undefined])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Film qui raccourcit, piste verrouillée (30/09/2026).
//
// Défaut 1 : seul le pilote ramenait la tête dans le film quand il le
// raccourcissait. Annuler l'ajout d'un plan en fin de film, le retirer, le
// raccourcir, retirer ses blancs ou reprendre une version enregistrée plus
// courte laissaient la tête après la dernière image : le moniteur affichait
// « Placez vos médias sur la timeline. » sur un film qui a des plans.
//
// Défaut 2 : sur une piste verrouillée, les masques (panneau et poignée du
// moniteur), le suivi du sujet, le changement de piste, l'ajout d'un média,
// l'assemblage des scènes, un passage de transcription et « Dissocier »
// écrivaient quand même, sans message (ou avec celui, périmé, du geste
// précédent) ; un champ refusé gardait le texte tapé.

const DEVERROUILLEZ = "Déverrouillez la piste avant de la modifier.";
type Studio = Awaited<ReturnType<typeof mountStudio>>;
const videoApi = () =>
  (
    globalThis as unknown as {
      window: { juno: { video: Record<string, unknown> } };
    }
  ).window.juno.video;

// Un éditeur neuf sur `p`, qui garde tout ce qu'il enregistre.
async function openStudio(p: VideoProject) {
  project = p;
  (globalThis as unknown as { localStorage: Storage }).localStorage.clear();
  const saves: Sequence[] = [];
  videoApi().saveSequence = async (x: {
    sequence: Sequence;
    expectedVersion?: number;
  }) => {
    saves.push(structuredClone(x.sequence));
    return { version: (x.expectedVersion ?? 1) + 1, revision: 2 };
  };
  const studio = await mountStudio();
  const toast = () =>
    studio.find((e) => e.matches(".workspace-status"))?.textContent ?? "";
  // Ferme le message affiché : celui qui suit vient du geste testé.
  const clearToast = async () => {
    const close = studio.find((e) => e.matches(".workspace-status button"));
    if (close) await studio.act(close);
    expect(toast()).toBe("");
  };
  const press = async (key: string, extra: Record<string, unknown> = {}) => {
    const event = {
      type: "keydown",
      code: key.length === 1 ? "Key" + key.toUpperCase() : key,
      key,
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      repeat: false,
      target: document.body,
      preventDefault() {},
      stopPropagation() {},
      ...extra,
    };
    ReactDom.flushSync(() => {
      for (const fn of [...(windowListeners.get("keydown") ?? [])]) fn(event);
    });
    await studio.settle();
  };
  const fire = async (
    el: FakeElement | undefined,
    handler: string,
    event: Record<string, unknown> = {},
  ) => {
    if (!el) throw Error("Élément introuvable pour " + handler);
    ReactDom.flushSync(() =>
      props(el)[handler]({
        preventDefault() {},
        stopPropagation() {},
        currentTarget: el,
        target: el,
        button: 0,
        detail: 1,
        ...event,
      }),
    );
    await studio.settle();
  };
  const windowEvent = async (type: string, event: Record<string, unknown>) => {
    ReactDom.flushSync(() => {
      for (const fn of [...(windowListeners.get(type) ?? [])]) fn(event);
    });
    await studio.settle();
  };
  const field = (label: string) => studio.byLabel(label + " : valeur");
  // Taper dans un champ numérique puis Entrée.
  const fill = async (label: string, text: string) => {
    const ev = (name: string, event: Record<string, unknown> = {}) =>
      fire(field(label), name, {
        currentTarget: { blur: () => props(field(label)!).onBlur({}) },
        ...event,
      });
    await ev("onFocus");
    await ev("onChange", { target: { value: text } });
    await ev("onKeyDown", { key: "Enter" });
  };
  const panel = (label: string) =>
    studio.find(
      (e) =>
        e.nodeName === "BUTTON" &&
        e.parentNode instanceof FakeElement &&
        (e.parentNode.getAttribute("class") ?? "").includes("vf-steps") &&
        e.textContent.trim() === label,
    );
  const clips = (name: string, audio: boolean) =>
    all(
      studio.container,
      (e) =>
        e.getAttribute("aria-label") === "Plan " + name &&
        (e.getAttribute("class") ?? "").split(/\s+/).includes("audio") ===
          audio,
    );
  const button = (text: string) =>
    studio.find(
      (e) => e.nodeName === "BUTTON" && e.textContent.trim().startsWith(text),
    );
  const titled = (title: string) =>
    studio.find(
      (e) => e.nodeName === "BUTTON" && e.getAttribute("title") === title,
    );
  // La tête sur la dernière image : clic sur la règle, loin après la fin.
  const toEnd = async () => {
    await fire(
      studio.find((e) => e.matches(".vf-ruler")),
      "onClick",
      { clientX: 1e7 },
    );
  };
  const monitorEmpty = () =>
    studio.find((e) => e.matches(".vf-preview-empty"))?.textContent;
  const last = () => saves.at(-1)!;
  // Laisser l'enregistrement en file se terminer.
  const saved = async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 2));
    await studio.settle();
  };
  const close = () => {
    studio.unmount();
    delete videoApi().saveSequence;
    project = film();
  };
  return {
    ...studio,
    saves,
    toast,
    clearToast,
    press,
    fire,
    windowEvent,
    field,
    fill,
    panel,
    clips,
    button,
    titled,
    toEnd,
    monitorEmpty,
    last,
    saved,
    close,
  };
}
type Ouvert = Awaited<ReturnType<typeof openStudio>>;
// Le temps code affiché sous le moniteur (à la cadence de la séquence).
const timecodeShown = (s: Ouvert) =>
  s.find((e) => e.matches(".vf-transport span"))?.textContent;
// Choisir la cadence dans les réglages de séquence.
async function cadence(s: Ouvert, value: string) {
  if (!s.titled("Réglages de séquence")) throw Error("Réglages absents");
  await s.act(s.titled("Réglages de séquence"));
  const select = s.find(
    (e) =>
      e.nodeName === "SELECT" &&
      !!e.parentNode &&
      e.parentNode.textContent.trim().startsWith("Cadence"),
  );
  await s.fire(select, "onChange", { target: { value } });
  await s.saved();
}

describe(
  "la tête reste dans le film quand le film raccourcit",
  { timeout: 30000 },
  () => {
    // filmCourt : 600 images (un plan de 300, un titre jusqu'au bout).
    // « Ajouter Rush.mov » pose un plan de 1 000 images à l'image 600 : le
    // film passe à 1 600 images, la tête à 600.
    async function withAppended() {
      const s = await openStudio(filmCourt());
      await s.act(s.byLabel("Ajouter Rush.mov"));
      await s.saved();
      expect(s.at()).toBe(frames);
      expect(filmLength(s.last())).toBe(1600);
      return s;
    }
    it("annuler l'ajout d'un plan en fin de film (bouton, puis ⌘Z après Rétablir)", async () => {
      const s = await withAppended();
      try {
        await s.act(s.button("Annuler"));
        expect(s.at()).toBe(frames - 1);
        // Le titre, qui dure jusqu'au bout, est à l'écran.
        expect(s.monitorEmpty()).toBeUndefined();
        expect(s.byLabel("Merci")).toBeTruthy();
        // Rétablir rallonge le film : la tête ne bouge pas.
        await s.act(s.byLabel("Rétablir"));
        expect(s.at()).toBe(frames - 1);
        await s.toEnd();
        expect(s.at()).toBe(1599);
        await s.press("z", { metaKey: true });
        expect(s.at()).toBe(frames - 1);
        expect(s.monitorEmpty()).toBeUndefined();
        // ⇧⌘Z puis ⌘Z depuis la fin : même chose.
        await s.press("z", { metaKey: true, shiftKey: true });
        await s.toEnd();
        await s.press("z", { metaKey: true });
        expect(s.at()).toBe(frames - 1);
      } finally {
        s.close();
      }
    });
    it("rétablir un film plus court", async () => {
      const s = await withAppended();
      try {
        // Retirer le plan ajouté, annuler (la tête reste à 600), puis
        // rétablir le retrait depuis la fin du film.
        await s.press("Delete");
        await s.act(s.button("Annuler"));
        await s.toEnd();
        expect(s.at()).toBe(1599);
        await s.act(s.byLabel("Rétablir"));
        expect(s.at()).toBe(frames - 1);
        expect(s.monitorEmpty()).toBeUndefined();
      } finally {
        s.close();
      }
    });
    it("retirer le plan (touche Suppr, bouton de la timeline)", async () => {
      const s = await withAppended();
      try {
        await s.press("Delete");
        await s.saved();
        expect(filmLength(s.last())).toBe(frames);
        expect(s.at()).toBe(frames - 1);
        expect(s.monitorEmpty()).toBeUndefined();
        await s.act(s.button("Annuler"));
        await s.act(
          s.clips("Rush.mov", false).find((e) =>
            (e.getAttribute("class") ?? "").includes("selected"),
          ) ?? s.clips("Rush.mov", false)[1],
        );
        await s.toEnd();
        await s.act(s.titled("Retirer le plan"));
        expect(s.at()).toBe(frames - 1);
      } finally {
        s.close();
      }
    });
    it("raccourcir le plan par sa poignée de fin", async () => {
      const s = await withAppended();
      try {
        await s.toEnd();
        const plan = s
          .clips("Rush.mov", false)
          .find((e) => (e.getAttribute("class") ?? "").includes("selected"))!;
        const handle = all(plan, (e) => e.matches(".vf-clip-handle.right"))[0];
        await s.fire(handle, "onPointerDown", { clientX: 1000 });
        // 140 px à 70 px par seconde : 2 s, 50 images de moins.
        await s.windowEvent("pointermove", { clientX: 860 });
        await s.windowEvent("pointerup", { clientX: 860 });
        await s.saved();
        expect(filmLength(s.last())).toBe(1550);
        expect(s.at()).toBe(1549);
        expect(s.monitorEmpty()).toBeUndefined();
      } finally {
        s.close();
      }
    });
    it("retirer les blancs du plan en fin de film", async () => {
      const s = await withAppended();
      try {
        await s.act(s.panel("Son"));
        await s.act(s.button("Sélectionner le son lié à ce plan"));
        await s.toEnd();
        expect(s.at()).toBe(1599);
        await s.act(s.button("Retirer 1 blanc"));
        await s.saved();
        const total = filmLength(s.last());
        expect(total).toBeLessThan(1600);
        expect(s.at()).toBe(total - 1);
        expect(s.monitorEmpty()).toBeUndefined();
      } finally {
        s.close();
      }
    });
    it("une version enregistrée plus courte reprise pendant le montage", async () => {
      const s = await openStudio(filmCourt());
      try {
        await s.toEnd();
        expect(s.at()).toBe(frames - 1);
        // Une tâche (un suivi, une autre fenêtre) enregistre la séquence :
        // le titre ne dure plus que 400 images, le film non plus.
        const next = structuredClone(project);
        next.revision = 2;
        next.sequences[0].version = 2;
        next.sequences[0].titles[0].duration = 400;
        project = next;
        for (let i = 0; i < 100 && s.at() === frames - 1; i++)
          await new Promise((r) => setTimeout(r, 40));
        await s.settle();
        expect(s.at()).toBe(399);
        expect(s.monitorEmpty()).toBeUndefined();
      } finally {
        s.close();
      }
    });
    // Témoin, et non preuve d'une correction : la tête était déjà ramenée
    // dans le film quand la cadence baisse (ce test passait avant la
    // conversion de la tête à la cadence).
    it("témoin : de 50 à 25 images/s sur la dernière image, la tête reste dans le film", async () => {
      const s = await openStudio(filmCourt());
      try {
        await cadence(s, "50/1");
        await s.toEnd();
        expect(timecodeShown(s)).toBe("00:00:23:49");
        await cadence(s, "25/1");
        expect(timecodeShown(s)).toBe("00:00:23:24");
        expect(s.monitorEmpty()).toBeUndefined();
      } finally {
        s.close();
      }
    });
  },
);

// Le film de l'éditeur entier, rush filmé à la verticale (320 × 180 dans une
// séquence 16/9 : « Recadrer » a donc quelque chose à faire).
function filmVerrou(tracks?: Sequence["tracks"]): VideoProject {
  const p = film();
  p.id = "p-verrou";
  p.assets[0].width = 180;
  p.assets[0].height = 320;
  if (tracks) p.sequences[0].tracks = { ...p.sequences[0].tracks, ...tracks };
  return p;
}

describe(
  "piste verrouillée : aucune écriture, un refus dit tout haut",
  { timeout: 30000 },
  () => {
    // L'éditeur sur filmVerrou, le plan V1 sélectionné, V1 verrouillée par
    // son bouton ; l'enregistrement du verrou est fait.
    async function locked(track = "V1", tracks?: Sequence["tracks"]) {
      const s = await openStudio(filmVerrou(tracks));
      await s.act(s.clips("Rush.mov", false)[0]);
      if (track) {
        await s.act(s.byLabel("Verrouiller " + track));
        await s.saved();
        expect(s.last().tracks?.[track === "V1" ? 0 : 10]?.locked).toBe(true);
      }
      await s.clearToast();
      return { s, count: s.saves.length };
    }
    const plan = (x: Sequence) => x.clips.find((c) => c.id === "plan")!;

    it("masque : un champ refusé reprend sa valeur, avec le message", async () => {
      const { s, count } = await locked();
      try {
        await s.act(s.panel("Masques"));
        expect(inputValue(s.field("Largeur (%)"))).toBe("20");
        await s.fill("Largeur (%)", "60");
        await s.saved();
        expect(s.saves.length).toBe(count);
        expect(s.toast()).toContain(DEVERROUILLEZ);
        expect(inputValue(s.field("Largeur (%)"))).toBe("20");
        // Déverrouillée, la même saisie est écrite.
        await s.act(s.byLabel("Déverrouiller V1"));
        await s.fill("Largeur (%)", "60");
        await s.saved();
        expect(plan(s.last()).masks?.[0].width).toBe(0.6);
      } finally {
        s.close();
      }
    });
    it("masque : ajouter, supprimer, effet, repère, poignée du moniteur", async () => {
      const { s } = await locked();
      try {
        await s.act(s.panel("Masques"));
        const gestures: [string, () => Promise<void>][] = [
          ["ajout", () => s.act(s.byLabel("Ajouter un masque"))],
          ["suppression", () => s.act(s.byLabel("Supprimer le masque"))],
          [
            "effet",
            () =>
              s.fire(s.byLabel("Effet du masque"), "onChange", {
                target: { value: "solid" },
              }),
          ],
          ["repère", () => s.act(s.byLabel("Poser un repère de position"))],
          [
            "poignée",
            () =>
              s.fire(s.byLabel("Déplacer le masque"), "onKeyDown", {
                key: "ArrowRight",
                shiftKey: true,
              }),
          ],
        ];
        // Chaque geste repart du masque d'origine : un geste écrit à tort
        // est annulé, pour que le suivant soit jugé seul.
        const results: [string, number, string][] = [];
        for (const [name, run] of gestures) {
          await s.clearToast();
          const before = s.saves.length;
          await run();
          await s.saved();
          results.push([name, s.saves.length - before, s.toast()]);
          if (s.saves.length > before) await s.act(s.button("Annuler"));
          await s.saved();
        }
        expect(results).toEqual(
          gestures.map(([name]) => [name, 0, DEVERROUILLEZ]),
        );
        expect(plan(s.last()).masks).toEqual(plan(project.sequences[0]).masks);
      } finally {
        s.close();
      }
    });
    it("suivi du sujet par le panneau des masques", async () => {
      const { s } = await locked();
      const track = vi.fn(async () => ({ id: "job" }));
      videoApi().trackMask = track;
      try {
        await s.act(s.panel("Masques"));
        await s.act(s.byLabel("Suivre automatiquement le sujet"));
        await s.saved();
        expect(track).not.toHaveBeenCalled();
        expect(s.toast()).toContain(DEVERROUILLEZ);
      } finally {
        delete videoApi().trackMask;
        s.close();
      }
    });
    it("suivi du sujet par le pilote", async () => {
      const { s } = await locked();
      const track = vi.fn(async () => ({ id: "job" }));
      videoApi().trackMask = track;
      try {
        type Fiber = {
          type?: { name?: string };
          memoizedProps?: Record<string, unknown>;
          child?: Fiber | null;
          sibling?: Fiber | null;
        };
        const walk = (
          f: Fiber | null | undefined,
        ): Record<string, unknown> | undefined => {
          for (let n = f; n; n = n.sibling) {
            if (n.type?.name === "Pilot") return n.memoizedProps;
            const r = walk(n.child);
            if (r) return r;
          }
        };
        const pilot = walk(
          (fiberRoot(s.container) as unknown as { current: Fiber }).current,
        ) as {
          capture: () => Promise<unknown>;
          run: (plan: unknown, context: unknown) => Promise<string>;
        };
        await expect(
          pilot.run(
            {
              id: "t",
              text: "suis le masque",
              actions: [{ kind: "video.track" }],
              scope: "current",
              label: "",
              explanation: "",
              source: "text",
            },
            await pilot.capture(),
          ),
        ).rejects.toThrow(DEVERROUILLEZ);
        expect(track).not.toHaveBeenCalled();
      } finally {
        delete videoApi().trackMask;
        s.close();
      }
    });
    it("changer le plan de piste vers une piste verrouillée", async () => {
      const { s, count } = await locked("", { "1": { locked: true } });
      try {
        const select = s.find(
          (e) =>
            e.nodeName === "SELECT" &&
            !!e.parentNode &&
            e.parentNode.textContent.trim().startsWith("Piste"),
        );
        await s.fire(select, "onChange", { target: { value: "1" } });
        await s.saved();
        expect(s.saves.length).toBe(count);
        expect(s.toast()).toContain(DEVERROUILLEZ);
        // Vers une piste libre, le changement passe.
        await s.fire(select, "onChange", { target: { value: "2" } });
        await s.saved();
        expect(plan(s.last()).track).toBe(2);
      } finally {
        s.close();
      }
    });
    it("ajouter un média sur une piste verrouillée : bouton, glisser-déposer, son lié", async () => {
      const { s, count } = await locked();
      try {
        await s.act(s.byLabel("Ajouter Rush.mov"));
        await s.saved();
        expect(s.saves.length).toBe(count);
        expect(s.toast()).toContain(DEVERROUILLEZ);
        await s.clearToast();
        const v1 = s.find((e) => e.getAttribute("data-track") === "0");
        await s.fire(v1, "onDrop", {
          clientX: 300,
          dataTransfer: { getData: () => "rush" },
        });
        await s.saved();
        expect(s.saves.length).toBe(count);
        expect(s.toast()).toContain(DEVERROUILLEZ);
        // V1 libre, A1 verrouillée : le son du rush irait sur A1.
        await s.act(s.byLabel("Déverrouiller V1"));
        await s.act(s.byLabel("Verrouiller A1"));
        await s.saved();
        await s.clearToast();
        const after = s.saves.length;
        await s.act(s.byLabel("Ajouter Rush.mov"));
        await s.saved();
        expect(s.saves.length).toBe(after);
        expect(s.toast()).toContain(DEVERROUILLEZ);
      } finally {
        s.close();
      }
    });
    it("assembler les scènes, ajouter un passage de la transcription", async () => {
      const { s, count } = await locked();
      try {
        await s.act(
          s.find(
            (e) =>
              e.matches("button.vf-small-action") &&
              e.textContent.includes("scènes"),
          ),
        );
        await s.saved();
        expect(s.saves.length).toBe(count);
        expect(s.toast()).toBe(DEVERROUILLEZ);
        await s.clearToast();
        await s.act(s.panel("Texte & IA"));
        await s.act(s.byLabel("Ajouter ce passage"));
        await s.saved();
        expect(s.saves.length).toBe(count);
        expect(s.toast()).toBe(DEVERROUILLEZ);
      } finally {
        s.close();
      }
    });
    it("dissocier l'image et le son d'un plan verrouillé", async () => {
      const { s, count } = await locked();
      try {
        await s.act(s.button("Dissocier"));
        await s.saved();
        expect(s.saves.length).toBe(count);
        expect(s.toast()).toContain(DEVERROUILLEZ);
      } finally {
        s.close();
      }
    });
    it("recadrer : le plan verrouillé n'est pas relevé", async () => {
      const { s, count } = await locked();
      try {
        expect(
          s.titled("Cadrer les plans sur les visages, au format de la séquence")
            ?.attributes.has("disabled"),
        ).toBe(true);
        const select = s.find(
          (e) =>
            e.nodeName === "SELECT" &&
            !!e.parentNode &&
            e.parentNode.textContent.trim().startsWith("Cadrage automatique"),
        );
        await s.fire(select, "onChange", { target: { value: "couple" } });
        await s.saved();
        expect(s.toast()).toContain(DEVERROUILLEZ);
        expect(s.button("Recadrage")).toBeUndefined();
        expect(s.saves.length).toBe(count);
      } finally {
        s.close();
      }
    });
    it("Suppr sur un plan verrouillé : refus dit, rien d'enregistré", async () => {
      const { s, count } = await locked();
      try {
        await s.press("Delete");
        await s.saved();
        expect(s.saves.length).toBe(count);
        expect(s.toast()).toContain(DEVERROUILLEZ);
        expect(
          s.clips("Rush.mov", false)[0].getAttribute("class"),
        ).toContain("selected");
      } finally {
        s.close();
      }
    });
    it("ce qui reste permis : cadence de la séquence, annuler le verrou", async () => {
      const { s, count } = await locked();
      try {
        await s.act(s.titled("Réglages de séquence"));
        const cadence = s.find(
          (e) =>
            e.nodeName === "SELECT" &&
            !!e.parentNode &&
            e.parentNode.textContent.trim().startsWith("Cadence"),
        );
        await s.fire(cadence, "onChange", { target: { value: "50/1" } });
        await s.saved();
        expect(s.saves.length).toBe(count + 1);
        expect(plan(s.last()).duration).toBe(2 * frames);
        expect(s.toast()).toBe("");
        await s.act(s.button("Annuler"));
        await s.act(s.button("Annuler"));
        await s.saved();
        expect(s.last().tracks?.[0]?.locked).toBeFalsy();
      } finally {
        s.close();
      }
    });
  },
);

// ---------------------------------------------------------------------------
// Copies périmées, cadence, refus muets (30/09/2026).
//
// Défaut 1 : « Recadrer » rendait la copie de la séquence prise au clic avec
// les nouveaux cadres. Tout geste fait pendant le relevé des visages était
// défait sans un mot : un verrou posé pendant « Recadrage 1/1 » disparaissait,
// un plan retiré revenait, une échelle tapée à la main était écrasée.
//
// Défaut 2 : changer la cadence convertissait plans, titres et marqueurs, mais
// pas la tête : de 25 à 50 images/s, la tête à 12 s passait à 6 s.
//
// Défaut 3 : sur une piste verrouillée, « Dupliquer » (annulation vide et
// enregistrement), « Retirer N blancs » et glisser un plan ne disaient rien ;
// un refus répété disparaissait à l'échéance du premier.
//
// Défaut 4 : « Profil de la source » changeait le rendu des plans d'une piste
// verrouillée sans un mot.
//
// Relecture du 30/09/2026 (tests du recadrage) : les tests de
// video-corrections-montage.test.ts appelaient `reporterCadrage` à nu, et
// n'échouaient sur le code d'avant que parce que la fonction n'existait pas.
// Ils sont réécrits ici sur l'éditeur monté : « Recadrer » lancé, un geste
// fait pendant le relevé, puis ce qui est enregistré. La fonction existant
// désormais, video-corrections-montage.test.ts la teste de nouveau à nu sur
// ce que l'éditeur ne montre pas en entier (seul le cadre est reporté).
//
// Défaut 5 : annuler ou rétablir un changement de cadence PENDANT la lecture
// déplaçait la tête : la lecture comptait ses images depuis sa tête de départ,
// à l'ancienne cadence, et écrasait dès l'image suivante la tête convertie
// (à 13 s, ⌘Z sautait à la fin du film ; ⌘⇧Z reculait de 5 s).
//
// Défaut 6 : glisser un plan d'une piste libre sur une piste verrouillée était
// refusé sans un mot ; un plan lâché sur place (ou une poignée tirée sans
// bouger de côté) enregistrait une séquence inchangée et une annulation vide ;
// glisser tout droit un plan verrouillé vers une autre piste ne disait rien.

describe(
  "le recadrage se pose sur le montage d'aujourd'hui",
  { timeout: 30000 },
  () => {
    // filmVerrou : un plan vertical dans une séquence 16/9. Le relevé attend
    // qu'on le termine : le geste testé est fait pendant ce temps.
    async function pendant(geste: (s: Awaited<ReturnType<typeof openStudio>>) => Promise<void>) {
      const s = await openStudio(filmVerrou());
      let finir: (() => void) | undefined;
      releve.hook = () =>
        new Promise((r) => {
          finir = () => r({ echantillons: [], source: { w: 180, h: 320 } });
        });
      try {
        await s.act(s.clips("Rush.mov", false)[0]);
        await s.act(
          s.titled("Cadrer les plans sur les visages, au format de la séquence"),
        );
        expect(s.button("Recadrage")).toBeTruthy();
        expect(finir).toBeTruthy();
        await s.clearToast();
        await geste(s);
        await s.saved();
        finir!();
        for (let i = 0; i < 100 && s.button("Recadrage"); i++)
          await new Promise((r) => setTimeout(r, 5));
        await s.saved();
        expect(s.button("Recadrage")).toBeUndefined();
        return s;
      } catch (e) {
        s.close();
        throw e;
      } finally {
        releve.hook = null;
      }
    }
    const plan = (x: Sequence) => x.clips.find((c) => c.id === "plan");

    it("sans geste pendant le relevé : le plan est recadré (témoin)", async () => {
      const s = await pendant(async () => {});
      try {
        expect(plan(s.last())?.reframe).toBe("couple");
        expect(plan(s.last())?.scale).not.toBe(1);
        expect(s.toast()).toContain("1 plan recadré sur le couple.");
      } finally {
        s.close();
      }
    });
    it("un verrou posé pendant le relevé tient à la fin", async () => {
      const s = await pendant((s) => s.act(s.byLabel("Verrouiller A2")));
      try {
        expect(s.last().tracks?.[11]?.locked).toBe(true);
        expect(s.byLabel("Déverrouiller A2")).toBeTruthy();
        expect(plan(s.last())?.reframe).toBe("couple");
      } finally {
        s.close();
      }
    });
    it("un plan retiré pendant le relevé ne revient pas", async () => {
      const s = await pendant((s) => s.press("Delete"));
      try {
        expect(plan(s.last())).toBeUndefined();
        expect(s.clips("Rush.mov", false)).toEqual([]);
        expect(s.toast()).toBe(
          "Aucun plan recadré. 1 plan modifié, retiré ou verrouillé pendant le relevé n’a pas été touché.",
        );
      } finally {
        s.close();
      }
    });
    it("une échelle tapée pendant le relevé n'est pas écrasée", async () => {
      const s = await pendant((s) => s.fill("Échelle", "2"));
      try {
        expect(plan(s.last())?.scale).toBe(2);
        expect(plan(s.last())?.reframe).toBeUndefined();
      } finally {
        s.close();
      }
    });
    const nonTouche =
      "Aucun plan recadré. 1 plan modifié, retiré ou verrouillé pendant le relevé n’a pas été touché.";
    it("un verrou, un titre et un plan ajoutés pendant le relevé restent, et le plan relevé est recadré", async () => {
      const s = await pendant(async (s) => {
        await s.act(s.byLabel("Verrouiller A2"));
        await s.act(
          s.find((e) => e.nodeName === "BUTTON" && e.textContent.trim() === "Titre"),
        );
        await s.fire(
          s.find((e) => e.nodeName === "TEXTAREA"),
          "onChange",
          { target: { value: "Merci" } },
        );
        await s.act(s.button("Ajouter le titre"));
        await s.act(s.byLabel("Ajouter Rush.mov"));
      });
      try {
        const fin = s.last();
        expect(fin.tracks?.[11]?.locked).toBe(true);
        expect(fin.titles.map((t) => t.text)).toEqual(["Titre animé", "Merci"]);
        const images = fin.clips.filter((c) => c.component === "video");
        expect(images).toHaveLength(2);
        expect(plan(fin)?.reframe).toBe("couple");
        expect(plan(fin)?.scale).not.toBe(1);
        // Le plan ajouté pendant le relevé n'a pas été relevé : pas touché.
        expect(images.find((c) => c.id !== "plan")?.reframe).toBeUndefined();
        expect(s.toast()).toBe("1 plan recadré sur le couple.");
      } finally {
        s.close();
      }
    });
    it("un plan raccourci pendant le relevé garde sa durée et n'est pas recadré", async () => {
      const s = await pendant(async (s) => {
        const handle = all(s.clips("Rush.mov", false)[0], (e) =>
          e.matches(".vf-clip-handle.right"),
        )[0];
        await s.fire(handle, "onPointerDown", { clientX: 800 });
        // 100 px à 70 px par seconde et 25 images/s : 36 images de moins.
        await s.windowEvent("pointermove", { clientX: 700 });
        await s.windowEvent("pointerup", { clientX: 700 });
      });
      try {
        expect(plan(s.last())?.duration).toBe(frames - 36);
        expect(plan(s.last())?.reframe).toBeUndefined();
        expect(plan(s.last())?.scale).toBe(1);
        expect(s.toast()).toBe(nonTouche);
      } finally {
        s.close();
      }
    });
    it("la piste du plan verrouillée pendant le relevé : le verrou tient, le plan n'est pas touché", async () => {
      const s = await pendant((s) => s.act(s.byLabel("Verrouiller V1")));
      try {
        expect(s.last().tracks?.[0]?.locked).toBe(true);
        expect(s.byLabel("Déverrouiller V1")).toBeTruthy();
        expect(plan(s.last())?.reframe).toBeUndefined();
        expect(plan(s.last())?.scale).toBe(1);
        expect(s.toast()).toBe(nonTouche);
      } finally {
        s.close();
      }
    });
    it("seul le cadre est reporté : l'opacité réglée pendant le relevé reste", async () => {
      const s = await pendant((s) => s.fill("Opacité", "0.5"));
      try {
        expect(plan(s.last())?.opacity).toBe(0.5);
        expect(plan(s.last())?.reframe).toBe("couple");
        expect(plan(s.last())?.scale).not.toBe(1);
      } finally {
        s.close();
      }
    });
    // Relecture de la passe 9 : les images clés d'un autre champ que la
    // position venaient-elles du plan d'aujourd'hui ou de celui du clic ?
    // Aucun test ne le voyait (`{ ...fait.animation }` passait partout).
    it("seul le cadre est reporté : une image clé de volume posée pendant le relevé reste", async () => {
      let posee: unknown;
      const s = await pendant(async (s) => {
        const propriete = s.find(
          (e) =>
            e.nodeName === "SELECT" &&
            !!e.parentNode &&
            e.parentNode.textContent.trim().startsWith("Propriété"),
        );
        await s.fire(propriete, "onChange", { target: { value: "gain" } });
        await s.fire(s.byLabel("Valeur de l’image clé"), "onChange", {
          target: { value: "-6" },
        });
        await s.act(s.button("Placer au curseur"));
        await s.saved();
        posee = plan(s.last())?.animation?.gain;
      });
      try {
        // Posée sur le plan, au début, à -6 dB.
        expect(posee).toEqual([
          { frame: 0, value: Math.pow(10, -6 / 20), easing: "smooth" },
        ]);
        const fin = plan(s.last());
        expect(fin?.animation?.gain).toEqual(posee);
        // Le cadre, lui, est celui du relevé : fixe, sans les anciennes
        // images clés de position.
        expect(fin?.reframe).toBe("couple");
        expect(fin?.scale).not.toBe(1);
        expect(fin?.animation?.x).toBeUndefined();
        expect(fin?.animation?.y).toBeUndefined();
        expect(s.toast()).toBe("1 plan recadré sur le couple.");
      } finally {
        s.close();
      }
    });
    // Relecture de la passe 9 : relancer « Recadrer » sur des plans déjà
    // recadrés rend les mêmes cadres. Rien n'est à écrire, mais le bilan doit
    // être dit comme au premier passage ; sans cela le bouton tourne, puis
    // plus rien.
    it("un second « Recadrer » identique redit le bilan, sans rien écrire", async () => {
      const s = await openStudio(filmVerrou());
      releve.hook = async () => ({ echantillons: [], source: { w: 180, h: 320 } });
      const recadrer = async () => {
        await s.act(
          s.titled("Cadrer les plans sur les visages, au format de la séquence"),
        );
        for (let i = 0; i < 100 && s.button("Recadrage"); i++)
          await new Promise((r) => setTimeout(r, 5));
        await s.saved();
        expect(s.button("Recadrage")).toBeUndefined();
      };
      try {
        await s.clearToast();
        await recadrer();
        expect(s.toast()).toBe("1 plan recadré sur le couple.");
        const count = s.saves.length,
          cadre = plan(s.last());
        expect(cadre?.reframe).toBe("couple");
        expect(cadre?.scale).not.toBe(1);
        await s.clearToast();
        await recadrer();
        expect(s.toast()).toBe("1 plan recadré sur le couple.");
        expect(s.saves.length).toBe(count);
        expect(plan(s.last())).toEqual(cadre);
        // Ni enregistrement ni annulation vide : un seul « Annuler » défait le
        // recadrage.
        await s.act(s.button("Annuler"));
        await s.saved();
        expect(plan(s.last())?.reframe).toBeUndefined();
        expect(plan(s.last())?.scale).toBe(1);
      } finally {
        releve.hook = null;
        s.close();
      }
    });
    it("une cadence changée pendant le relevé : le relevé est écarté, et la cadence reste", async () => {
      const s = await pendant((s) => cadence(s, "50/1"));
      try {
        expect(s.last().fps).toEqual({ n: 50, d: 1 });
        expect(plan(s.last())?.duration).toBe(2 * frames);
        expect(plan(s.last())?.reframe).toBeUndefined();
        expect(s.toast()).toBe(
          "Recadrage abandonné : le format ou la cadence de la séquence a changé pendant le relevé des visages. Relancez « Recadrer ».",
        );
      } finally {
        s.close();
      }
    });
    it("une autre séquence ouverte pendant le relevé : le relevé est écarté, elle reste à l'écran", async () => {
      const s = await pendant((s) => s.act(s.button("Version verticale")));
      try {
        // La version verticale est la dernière écrite, et rien n'est venu
        // réécrire la séquence d'origine par-dessus.
        expect(s.last().id).not.toBe("s");
        expect(s.last().height).toBe(1920);
        expect(s.saves.filter((x) => x.id === "s")).toEqual([]);
        expect(s.toast()).toBe(
          "Recadrage abandonné : une autre séquence a été ouverte pendant le relevé des visages.",
        );
      } finally {
        s.close();
      }
    });
  },
);

describe(
  "changer la cadence garde la tête au même instant",
  { timeout: 30000 },
  () => {
    it("de 25 à 50 images/s à 12 s, puis annuler et rétablir", async () => {
      const s = await openStudio(filmCourt());
      try {
        await s.fire(
          s.find((e) => e.matches(".vf-ruler")),
          "onClick",
          { clientX: 92 + 12 * 70 },
        );
        expect(timecodeShown(s)).toBe("00:00:12:00");
        await cadence(s, "50/1");
        expect(s.last().fps).toEqual({ n: 50, d: 1 });
        expect(timecodeShown(s)).toBe("00:00:12:00");
        await s.act(s.button("Annuler"));
        expect(timecodeShown(s)).toBe("00:00:12:00");
        await s.act(s.byLabel("Rétablir"));
        expect(timecodeShown(s)).toBe("00:00:12:00");
      } finally {
        s.close();
      }
    });
    it("annuler puis rétablir la cadence pendant la lecture : la tête reste au même instant, la lecture s'arrête", async () => {
      // L'horloge de la lecture tenue en main : chaque image avance de 20 ms.
      const g = globalThis as unknown as Record<string, unknown>;
      const raf = g.requestAnimationFrame,
        caf = g.cancelAnimationFrame;
      const attente = new Map<number, (t: number) => void>();
      let suivant = 0,
        horloge = 1000;
      g.requestAnimationFrame = (f: (t: number) => void) => {
        attente.set(++suivant, f);
        return suivant;
      };
      g.cancelAnimationFrame = (n: number) => void attente.delete(n);
      const now = vi.spyOn(performance, "now").mockImplementation(() => horloge);
      const s = await openStudio(filmCourt());
      const avance = async (ms: number) => {
        for (let t = 0; t < ms; t += 20) {
          horloge += 20;
          const images = [...attente.values()];
          attente.clear();
          ReactDom.flushSync(() => images.forEach((f) => f(horloge)));
          await s.settle();
        }
      };
      const lecture = () =>
        s.find((e) => e.matches("button.vf-play"))?.getAttribute("aria-label");
      try {
        await s.fire(
          s.find((e) => e.matches(".vf-ruler")),
          "onClick",
          { clientX: 92 + 12 * 70 },
        );
        await cadence(s, "50/1");
        expect(timecodeShown(s)).toBe("00:00:12:00");
        // Lecture à 50 images/s, une seconde : 13 s.
        await s.act(s.byLabel("Lire le montage"));
        await avance(1000);
        expect(timecodeShown(s)).toBe("00:00:13:00");
        expect(lecture()).toBe("Mettre en pause");
        // ⌘Z pendant la lecture : retour à 25 images/s, toujours à 13 s.
        await s.press("z", { metaKey: true });
        await s.saved();
        expect(s.last().fps).toEqual({ n: 25, d: 1 });
        expect(timecodeShown(s)).toBe("00:00:13:00");
        // Une demi-seconde plus tard, la tête n'a pas sauté à la fin.
        await avance(500);
        expect(timecodeShown(s)).toBe("00:00:13:00");
        expect(lecture()).toBe("Lire le montage");
        // Relancée à 25 images/s, une seconde : 14 s ; ⌘⇧Z rétablit 50.
        await s.act(s.byLabel("Lire le montage"));
        await avance(1000);
        expect(timecodeShown(s)).toBe("00:00:14:00");
        await s.press("z", { metaKey: true, shiftKey: true });
        await s.saved();
        expect(s.last().fps).toEqual({ n: 50, d: 1 });
        expect(timecodeShown(s)).toBe("00:00:14:00");
        // Une demi-seconde plus tard, la tête n'a pas reculé.
        await avance(500);
        expect(timecodeShown(s)).toBe("00:00:14:00");
        expect(lecture()).toBe("Lire le montage");
      } finally {
        s.close();
        now.mockRestore();
        g.requestAnimationFrame = raf;
        g.cancelAnimationFrame = caf;
      }
    });
  },
);

describe(
  "piste verrouillée : les derniers refus muets",
  { timeout: 30000 },
  () => {
    // filmVerrou, le plan V1 sélectionné, V1 verrouillée (enregistrée).
    async function locked() {
      const s = await openStudio(filmVerrou());
      await s.act(s.clips("Rush.mov", false)[0]);
      await s.act(s.byLabel("Verrouiller V1"));
      await s.saved();
      expect(s.last().tracks?.[0]?.locked).toBe(true);
      await s.clearToast();
      return { s, count: s.saves.length };
    }
    it("Dupliquer : refus dit, ni annulation vide ni enregistrement", async () => {
      const { s, count } = await locked();
      try {
        await s.act(s.titled("Dupliquer le plan et son lien"));
        await s.saved();
        expect(s.saves.length).toBe(count);
        expect(s.toast()).toBe(DEVERROUILLEZ);
        // La seule chose à annuler est le verrou lui-même.
        await s.act(s.button("Annuler"));
        await s.saved();
        expect(s.last().tracks?.[0]?.locked).toBeFalsy();
      } finally {
        s.close();
      }
    });
    it("Retirer les blancs du son lié à un plan verrouillé : refus dit", async () => {
      const { s, count } = await locked();
      try {
        await s.act(s.panel("Son"));
        await s.act(s.clips("Rush.mov", true)[0]);
        await s.act(s.button("Retirer 1 blanc"));
        await s.saved();
        expect(s.saves.length).toBe(count);
        expect(s.toast()).toBe(DEVERROUILLEZ);
      } finally {
        s.close();
      }
    });
    it("glisser un plan verrouillé ou sa poignée : refus dit ; un clic seul ne dit rien", async () => {
      const { s, count } = await locked();
      try {
        const clip = s.clips("Rush.mov", false)[0];
        // Un clic, sans bouger.
        await s.fire(clip, "onPointerDown", { clientX: 500 });
        await s.windowEvent("pointerup", { clientX: 501 });
        expect(s.toast()).toBe("");
        // Un vrai glissement.
        await s.fire(clip, "onPointerDown", { clientX: 500 });
        await s.windowEvent("pointermove", { clientX: 520 });
        await s.windowEvent("pointermove", { clientX: 600 });
        await s.windowEvent("pointerup", { clientX: 600 });
        await s.saved();
        expect(s.toast()).toBe(DEVERROUILLEZ);
        await s.clearToast();
        // La poignée de fin.
        const handle = all(clip, (e) => e.matches(".vf-clip-handle.right"))[0];
        await s.fire(handle, "onPointerDown", { clientX: 800 });
        await s.windowEvent("pointermove", { clientX: 700 });
        await s.windowEvent("pointerup", { clientX: 700 });
        await s.saved();
        expect(s.toast()).toBe(DEVERROUILLEZ);
        expect(s.saves.length).toBe(count);
        // Rien ne reste à l'écoute après le geste.
        await s.clearToast();
        await s.windowEvent("pointermove", { clientX: 100 });
        expect(s.toast()).toBe("");
      } finally {
        s.close();
      }
    });
    it("glisser tout droit un plan verrouillé vers une autre piste : refus dit", async () => {
      const { s, count } = await locked();
      try {
        const clip = s.clips("Rush.mov", false)[0];
        await s.fire(clip, "onPointerDown", { clientX: 500, clientY: 100 });
        // Un tremblement de la main n'est pas un glissement.
        await s.windowEvent("pointermove", { clientX: 500, clientY: 102 });
        expect(s.toast()).toBe("");
        await s.windowEvent("pointermove", { clientX: 500, clientY: 150 });
        await s.windowEvent("pointerup", { clientX: 500, clientY: 150 });
        await s.saved();
        expect(s.toast()).toBe(DEVERROUILLEZ);
        expect(s.saves.length).toBe(count);
      } finally {
        s.close();
      }
    });
    it("glisser un plan d'une piste libre sur une piste verrouillée : refus dit, rien d'écrit, aucune annulation vide", async () => {
      const s = await openStudio(filmVerrou());
      try {
        await s.act(s.byLabel("Verrouiller A2"));
        await s.saved();
        await s.clearToast();
        const count = s.saves.length;
        // La souris arrive sur la piste A2 (verrouillée).
        const a2 = s.find((e) => e.getAttribute("data-track") === "11");
        expect(a2).toBeTruthy();
        (document as unknown as { elementFromPoint: () => unknown }).elementFromPoint =
          () => a2;
        const voix = s.clips("Rush.mov", true)[0];
        await s.fire(voix, "onPointerDown", { clientX: 500, clientY: 100 });
        await s.windowEvent("pointermove", { clientX: 500, clientY: 150 });
        await s.windowEvent("pointerup", { clientX: 500, clientY: 150 });
        await s.saved();
        expect(s.toast()).toBe(DEVERROUILLEZ);
        expect(s.saves.length).toBe(count);
        expect(s.last().clips.find((c) => c.id === "voix")?.track).toBe(10);
        // La seule chose à annuler est le verrou lui-même.
        await s.act(s.button("Annuler"));
        await s.saved();
        expect(s.last().tracks?.[11]?.locked).toBeFalsy();
      } finally {
        delete (document as unknown as { elementFromPoint?: unknown }).elementFromPoint;
        s.close();
      }
    });
    it("un plan lâché là où il était : rien d'écrit, aucune annulation vide", async () => {
      const s = await openStudio(filmVerrou());
      try {
        await s.act(s.byLabel("Verrouiller A2"));
        await s.saved();
        const count = s.saves.length;
        // Aller et retour : le plan revient à sa place avant le lâcher.
        const clip = s.clips("Rush.mov", false)[0];
        await s.fire(clip, "onPointerDown", { clientX: 500 });
        await s.windowEvent("pointermove", { clientX: 640 });
        await s.windowEvent("pointermove", { clientX: 500 });
        await s.windowEvent("pointerup", { clientX: 500 });
        await s.saved();
        expect(s.saves.length).toBe(count);
        expect(s.toast()).toBe("");
        // Annuler défait le verrou, et non un « rien ».
        await s.act(s.button("Annuler"));
        await s.saved();
        expect(s.last().tracks?.[11]?.locked).toBeFalsy();
        // Témoin : un vrai glissement est écrit.
        const again = s.clips("Rush.mov", false)[0];
        await s.fire(again, "onPointerDown", { clientX: 500 });
        await s.windowEvent("pointermove", { clientX: 640 });
        await s.windowEvent("pointerup", { clientX: 640 });
        await s.saved();
        expect(s.last().clips.find((c) => c.id === "plan")?.start).toBe(50);
      } finally {
        s.close();
      }
    });
    it("un refus répété reste affiché le temps plein depuis le dernier", async () => {
      const { s } = await locked();
      // Le délai d'affichage (9 s) ramené à 1,5 s pour le test.
      const real = globalThis.setTimeout;
      const spy = vi
        .spyOn(globalThis, "setTimeout")
        .mockImplementation(((fn: () => void, ms?: number, ...a: unknown[]) =>
          real(fn, ms === 9000 ? 1500 : ms, ...a)) as typeof setTimeout);
      const wait = (ms: number) => new Promise((r) => real(r, ms));
      try {
        // Suppr sur le plan verrouillé : un refus déjà dit avant la passe.
        await s.press("Delete");
        expect(s.toast()).toBe(DEVERROUILLEZ);
        await wait(1000);
        await s.press("Delete");
        await wait(1000);
        await s.settle();
        // 2 s après le premier refus, 1 s après le second : encore là.
        expect(s.toast()).toBe(DEVERROUILLEZ);
        await wait(1000);
        await s.settle();
        expect(s.toast()).toBe("");
      } finally {
        spy.mockRestore();
        s.close();
      }
    });
  },
);

describe(
  "profil de la source d'un média dont un plan est verrouillé",
  { timeout: 30000 },
  () => {
    let status: () => Promise<Record<string, unknown>>;
    beforeAll(() => {
      status = videoApi().status as typeof status;
      videoApi().status = async () => ({
        ...(await status()),
        spaces: [
          { id: "rec709", name: "Rec. 709" },
          { id: "slog3-cine", name: "Sony S-Log3" },
        ],
      });
    });
    afterAll(() => {
      videoApi().status = status;
    });
    async function couleur(lock: boolean) {
      const s = await openStudio(filmVerrou());
      const space = vi.fn(async () => ({ id: "job" }));
      videoApi().space = space;
      await s.act(s.clips("Rush.mov", false)[0]);
      if (lock) {
        await s.act(s.byLabel("Verrouiller V1"));
        await s.saved();
      }
      await s.act(s.panel("Couleur"));
      await s.clearToast();
      const select = () =>
        s.find(
          (e) =>
            e.nodeName === "SELECT" &&
            !!e.parentNode &&
            e.parentNode.textContent.trim().startsWith("Profil de la source"),
        );
      const alert = () =>
        s.find((e) => e.getAttribute("role") === "alert")?.textContent;
      const close = () => {
        delete videoApi().space;
        s.close();
      };
      return { s, space, select, alert, close };
    }
    it("piste verrouillée : rien n'est envoyé avant la confirmation, qui dit combien", async () => {
      const { s, space, select, alert, close } = await couleur(true);
      try {
        await s.fire(select(), "onChange", { target: { value: "slog3-cine" } });
        expect(space).not.toHaveBeenCalled();
        expect(alert()).toContain(
          "Ce réglage change aussi 1 plan sur une piste verrouillée.",
        );
        await s.act(s.button("Garder le profil actuel"));
        expect(alert()).toBeUndefined();
        expect(space).not.toHaveBeenCalled();
        await s.fire(select(), "onChange", { target: { value: "slog3-cine" } });
        await s.act(s.button("Passer en « Sony S-Log3 » quand même"));
        expect(space).toHaveBeenCalledTimes(1);
        expect(space).toHaveBeenCalledWith({
          projectId: "p-verrou",
          assetId: "rush",
          inputSpace: "slog3-cine",
        });
        expect(alert()).toBeUndefined();
      } finally {
        close();
      }
    });
    it("aucune piste verrouillée : le profil change tout de suite, comme avant", async () => {
      const { s, space, select, alert, close } = await couleur(false);
      try {
        await s.fire(select(), "onChange", { target: { value: "slog3-cine" } });
        expect(space).toHaveBeenCalledTimes(1);
        expect(alert()).toBeUndefined();
      } finally {
        close();
      }
    });
  },
);

// ---------------------------------------------------------------------------
// Autres copies périmées réécrites au retour d'une attente (30/09/2026).
//
// Le pilote : un geste fait pendant que le pilote enregistrait sa commande
// partait sur la séquence d'avant la commande. Refusé comme un conflit, il
// disparaissait de l'écran, et « Réessayer » l'enregistrait ensuite par-dessus
// la commande, défaite en base sans un mot pendant que l'écran la montrait.
//
// Un glissement dans la timeline, une LUT importée : le geste gardait la
// séquence de son début (pointeur enfoncé, fenêtre de fichier ouverte). Une
// version enregistrée reprise entre-temps (un suivi de masque terminé) était
// effacée par le lâcher ou par la LUT.

describe(
  "copies périmées : pilote, glissement, LUT",
  { timeout: 30000 },
  () => {
    // Un stockage qui sert les enregistrements dans l'ordre d'arrivée et
    // refuse une version attendue dépassée, comme electron/video/store.
    function stockage(s: Awaited<ReturnType<typeof openStudio>>) {
      let stored = structuredClone(project.sequences[0]);
      let queue: Promise<unknown> = Promise.resolve();
      const held: { release?: () => void } = {};
      type Save = { sequence: Sequence; expectedVersion?: number; command?: unknown };
      const serve = async (x: Save) => {
        if (x.command) await new Promise<void>((r) => (held.release = r));
        if ((x.expectedVersion ?? 1) !== (stored.version ?? 1))
          throw Error("Cette séquence a changé. Rechargez sa version avant de continuer.");
        stored = { ...structuredClone(x.sequence), version: (stored.version ?? 1) + 1 };
        s.saves.push(structuredClone(stored));
        return { version: stored.version, revision: 2 };
      };
      videoApi().saveSequence = (x: Save) => {
        const run = queue.then(() => serve(x));
        queue = run.catch(() => {});
        return run;
      };
      const original = videoApi().project;
      videoApi().project = async () => ({
        ...structuredClone(project),
        sequences: [structuredClone(stored)],
      });
      return {
        held,
        stored: () => stored,
        // Une tâche enregistre `next` (version suivante) sans passer par
        // l'éditeur, comme le suivi d'un masque.
        external: (next: Sequence) => {
          stored = structuredClone(next);
          project = { ...project, revision: project.revision + 5 };
        },
        restore: () => void (videoApi().project = original),
      };
    }
    function pilotOf(s: Awaited<ReturnType<typeof openStudio>>) {
      type Fiber = {
        type?: { name?: string };
        memoizedProps?: Record<string, unknown>;
        child?: Fiber | null;
        sibling?: Fiber | null;
      };
      const walk = (f: Fiber | null | undefined): Record<string, unknown> | undefined => {
        for (let n = f; n; n = n.sibling) {
          if (n.type?.name === "Pilot") return n.memoizedProps;
          const r = walk(n.child);
          if (r) return r;
        }
      };
      return walk((fiberRoot(s.container) as unknown as { current: Fiber }).current) as {
        capture: () => Promise<unknown>;
        run: (plan: unknown, context: unknown) => Promise<string>;
      };
    }
    // Une version plus récente de la séquence, enregistrée par une tâche (le
    // titre ne dure plus que 400 images), reprise par le rafraîchissement.
    async function reprise(
      s: Awaited<ReturnType<typeof openStudio>>,
      store: ReturnType<typeof stockage>,
    ) {
      const stored = store.stored();
      const next: Sequence = {
        ...structuredClone(stored),
        version: (stored.version ?? 1) + 1,
        name: "Film repris",
      };
      next.titles[0].duration = 400;
      store.external(next);
      const nom = () =>
        s.find((e) => e.matches(".vf-timeline-tools b span"))?.textContent;
      for (let i = 0; i < 200 && nom() !== "Film repris"; i++) {
        await new Promise((r) => setTimeout(r, 20));
        await s.settle();
      }
      expect(nom()).toBe("Film repris");
      return next;
    }

    it("un geste pendant l'enregistrement de la commande du pilote est refusé tout haut", async () => {
      const s = await openStudio(filmVerrou());
      const store = stockage(s);
      try {
        await s.act(s.clips("Rush.mov", false)[0]);
        const pilot = pilotOf(s);
        const running = pilot
          .run(
            {
              id: "x",
              text: "opacité 50",
              actions: [{ kind: "video.adjust", field: "opacity", value: 50, relative: false }],
              scope: "current",
              label: "opacité",
              explanation: "",
              source: "text",
            },
            await pilot.capture(),
          )
          .catch((e) => "ERREUR " + (e as Error).message);
        for (let i = 0; i < 100 && !store.held.release; i++)
          await new Promise((r) => setTimeout(r, 5));
        expect(store.held.release).toBeTruthy();
        await s.act(s.byLabel("Verrouiller A2"));
        await s.saved();
        store.held.release!();
        expect(await running).toBe(
          "Commande appliquée et enregistrée. Annulation disponible dans l’historique.",
        );
        await s.saved();
        // Aucun conflit, l'écran et la base disent la même chose, et le geste
        // a été refusé tout haut.
        expect(s.find((e) => e.matches(".vf-save-alert"))).toBeUndefined();
        expect(s.toast()).toBe(
          "Juno enregistre la commande du pilote. Refaites ce geste dans un instant.",
        );
        const plan = store.stored().clips.find((c) => c.id === "plan")!;
        expect(plan.opacity).toBe(0.5);
        expect(store.stored().tracks?.[11]?.locked).toBeFalsy();
        expect(s.byLabel("Verrouiller A2")).toBeTruthy();
        // Refait après, le geste passe, sur la séquence de la commande.
        await s.act(s.byLabel("Verrouiller A2"));
        await s.saved();
        expect(store.stored().tracks?.[11]?.locked).toBe(true);
        expect(store.stored().clips.find((c) => c.id === "plan")!.opacity).toBe(0.5);
      } finally {
        store.restore();
        s.close();
      }
    });
    it("témoin : une proposition du pilote préparée avant un geste est refusée, le geste reste", async () => {
      // L'IA locale et les confirmations gardent le contexte du moment de la
      // demande : appliquée après un geste, la commande est refusée (garde
      // déjà en place, vérifiée ici avec le stockage qui refuse les versions
      // dépassées).
      const s = await openStudio(filmVerrou());
      const store = stockage(s);
      try {
        await s.act(s.clips("Rush.mov", false)[0]);
        const pilot = pilotOf(s);
        const context = await pilot.capture();
        await s.act(s.byLabel("Verrouiller A2"));
        await s.saved();
        const count = s.saves.length;
        await expect(
          pilot.run(
            {
              id: "y",
              text: "opacité 50",
              actions: [{ kind: "video.adjust", field: "opacity", value: 50, relative: false }],
              scope: "current",
              label: "opacité",
              explanation: "",
              source: "text",
            },
            context,
          ),
        ).rejects.toThrow("La séquence a changé pendant la consigne.");
        await s.saved();
        expect(s.saves.length).toBe(count);
        expect(store.stored().tracks?.[11]?.locked).toBe(true);
        expect(store.stored().clips.find((c) => c.id === "plan")!.opacity).toBe(1);
        expect(s.byLabel("Déverrouiller A2")).toBeTruthy();
      } finally {
        store.restore();
        s.close();
      }
    });
    it("un glissement lâché après une reprise du montage ne la défait pas", async () => {
      const s = await openStudio(filmVerrou());
      const store = stockage(s);
      try {
        const clip = s.clips("Rush.mov", false)[0];
        await s.fire(clip, "onPointerDown", { clientX: 500 });
        await s.windowEvent("pointermove", { clientX: 640 });
        const count = s.saves.length;
        const adopted = await reprise(s, store);
        await s.windowEvent("pointermove", { clientX: 650 });
        await s.windowEvent("pointerup", { clientX: 650 });
        await s.saved();
        // La reprise tient : rien n'a été enregistré par-dessus.
        expect(s.saves.length).toBe(count);
        expect(store.stored().titles[0].duration).toBe(400);
        expect(s.toast()).toBe(
          "Le montage a été mis à jour pendant le glissement : rien n’a été déplacé. Refaites le geste.",
        );
        // Un nouveau glissement part du montage repris.
        const again = s.clips("Rush.mov", false)[0];
        await s.fire(again, "onPointerDown", { clientX: 500 });
        await s.windowEvent("pointermove", { clientX: 640 });
        await s.windowEvent("pointerup", { clientX: 640 });
        await s.saved();
        expect(s.last().titles[0].duration).toBe(adopted.titles[0].duration);
        expect(s.last().clips.find((c) => c.id === "plan")!.start).toBe(50);
      } finally {
        store.restore();
        s.close();
      }
    });
    it("une LUT choisie après une reprise du montage ne la défait pas", async () => {
      const s = await openStudio(filmVerrou());
      const store = stockage(s);
      let choose: ((l: unknown) => void) | undefined;
      videoApi().importLut = () => new Promise((r) => (choose = r));
      try {
        await s.act(s.clips("Rush.mov", false)[0]);
        await s.act(s.panel("Couleur"));
        await s.act(s.button("Importer une LUT .cube"));
        expect(choose).toBeTruthy();
        const adopted = await reprise(s, store);
        choose!({ id: "a".repeat(64), name: "Chaud" });
        for (let i = 0; i < 50 && s.saves.length === 0; i++)
          await new Promise((r) => setTimeout(r, 10));
        await s.saved();
        const plan = s.last().clips.find((c) => c.id === "plan")!;
        expect(plan.grade.lutId).toBe("a".repeat(64));
        expect(s.last().titles[0].duration).toBe(adopted.titles[0].duration);
      } finally {
        delete videoApi().importLut;
        store.restore();
        s.close();
      }
    });
  },
);

// Gardes du report du recadrage que la passe 9 avait laissées sans test
// (relecture contradictoire de la passe 10, prouvées par mutation).
describe("recadrage : gardes du relevé", { timeout: 30000 }, () => {
  const planDe = (x: Sequence) => x.clips.find((c) => c.id === "plan");
  const nonTouche =
    "Aucun plan recadré. 1 plan modifié, retiré ou verrouillé pendant le relevé n’a pas été touché.";
  // Comme `pendant`, sur un projet et avec un geste d'avant au choix.
  async function pendantSur(
    p: VideoProject,
    geste: (s: Awaited<ReturnType<typeof openStudio>>) => Promise<void>,
    avant?: (s: Awaited<ReturnType<typeof openStudio>>) => Promise<void>,
  ) {
    const s = await openStudio(p);
    let finir: (() => void) | undefined;
    try {
      if (avant) await avant(s);
      // Le premier relevé attend ; ceux d'après (autres plans) rendent aussitôt.
      let libre = false;
      const vide = { echantillons: [], source: { w: 180, h: 320 } };
      releve.hook = () =>
        libre
          ? Promise.resolve(vide)
          : new Promise((r) => {
              finir = () => {
                libre = true;
                r(vide);
              };
            });
      await s.act(s.clips("Rush.mov", false)[0]);
      await s.act(
        s.titled("Cadrer les plans sur les visages, au format de la séquence"),
      );
      expect(s.button("Recadrage")).toBeTruthy();
      expect(finir).toBeTruthy();
      await s.clearToast();
      await geste(s);
      await s.saved();
      finir!();
      for (let i = 0; i < 100 && s.button("Recadrage"); i++)
        await new Promise((r) => setTimeout(r, 5));
      await s.saved();
      expect(s.button("Recadrage")).toBeUndefined();
      return s;
    } catch (e) {
      s.close();
      throw e;
    } finally {
      releve.hook = null;
    }
  }
  const definition = async (s: Awaited<ReturnType<typeof openStudio>>, v: string) => {
    await s.act(s.titled("Réglages de séquence"));
    const select = s.find(
      (e) =>
        e.nodeName === "SELECT" &&
        !!e.parentNode &&
        e.parentNode.textContent.trim().startsWith("Définition"),
    );
    if (!select) throw Error("Définition absente");
    await s.fire(select, "onChange", { target: { value: v } });
    await s.saved();
  };
  const abandon =
    "Recadrage abandonné : le format ou la cadence de la séquence a changé pendant le relevé des visages. Relancez « Recadrer ».";
  it("définition changée pendant le relevé (320x180 vers carré) : relevé écarté", async () => {
    const s = await pendantSur(filmVerrou(), (s) => definition(s, "1080x1080"));
    try {
      expect([s.last().width, s.last().height]).toEqual([1080, 1080]);
      expect(planDe(s.last())?.reframe).toBeUndefined();
      expect(s.toast()).toBe(abandon);
    } finally {
      s.close();
    }
  });
  it("Full HD vers carré pendant le relevé (seule la largeur change) : relevé écarté", async () => {
    const p = filmVerrou();
    p.sequences[0].width = 1920;
    p.sequences[0].height = 1080;
    const s = await pendantSur(p, (s) => definition(s, "1080x1080"));
    try {
      expect([s.last().width, s.last().height]).toEqual([1080, 1080]);
      expect(planDe(s.last())?.reframe).toBeUndefined();
      expect(s.toast()).toBe(abandon);
    } finally {
      s.close();
    }
  });
  it("vertical vers carré pendant le relevé (seule la hauteur change) : relevé écarté", async () => {
    const p = filmVerrou();
    p.assets[0].width = 320;
    p.assets[0].height = 180;
    p.sequences[0].width = 1080;
    p.sequences[0].height = 1920;
    const s = await pendantSur(p, (s) => definition(s, "1080x1080"));
    try {
      expect([s.last().width, s.last().height]).toEqual([1080, 1080]);
      expect(planDe(s.last())?.reframe).toBeUndefined();
      expect(s.toast()).toBe(abandon);
    } finally {
      s.close();
    }
  });
  it("image clé de position posée pendant le relevé (propriété par défaut) : le plan n'est pas touché", async () => {
    let posee: unknown;
    const s = await pendantSur(filmVerrou(), async (s) => {
      await s.fire(s.byLabel("Valeur de l’image clé"), "onChange", {
        target: { value: "10" },
      });
      await s.act(s.button("Placer au curseur"));
      await s.saved();
      posee = planDe(s.last())?.animation?.x;
    });
    try {
      expect((posee as { frame: number; value: number }[])?.[0]).toMatchObject({ frame: 0, value: 0.1 });
      expect(planDe(s.last())?.animation?.x).toEqual(posee);
      expect(planDe(s.last())?.reframe).toBeUndefined();
      expect(s.toast()).toBe(nonTouche);
    } finally {
      s.close();
    }
  });
  it("image clé de position verticale posée pendant le relevé : le plan n'est pas touché", async () => {
    let posee: unknown;
    const s = await pendantSur(filmVerrou(), async (s) => {
      const propriete = s.find(
        (e) =>
          e.nodeName === "SELECT" &&
          !!e.parentNode &&
          e.parentNode.textContent.trim().startsWith("Propriété"),
      );
      await s.fire(propriete, "onChange", { target: { value: "y" } });
      await s.fire(s.byLabel("Valeur de l’image clé"), "onChange", {
        target: { value: "10" },
      });
      await s.act(s.button("Placer au curseur"));
      await s.saved();
      posee = planDe(s.last())?.animation?.y;
    });
    try {
      expect((posee as { frame: number; value: number }[])?.[0]).toMatchObject({ frame: 0, value: 0.1 });
      expect(planDe(s.last())?.animation?.y).toEqual(posee);
      expect(planDe(s.last())?.reframe).toBeUndefined();
      expect(s.toast()).toBe(nonTouche);
    } finally {
      s.close();
    }
  });
  it("position horizontale tapée pendant le relevé sur un plan sans images clés : le plan n'est pas touché", async () => {
    const p = filmVerrou();
    const c = p.sequences[0].clips.find((c) => c.id === "plan")!;
    delete c.animation;
    const s = await pendantSur(p, (s) => s.fill("Position horizontale", "0.3"));
    try {
      expect(planDe(s.last())?.x).toBe(0.3);
      expect(planDe(s.last())?.reframe).toBeUndefined();
      expect(s.toast()).toBe(nonTouche);
    } finally {
      s.close();
    }
  });
  it("position verticale tapée pendant le relevé sur un plan sans images clés : le plan n'est pas touché", async () => {
    const p = filmVerrou();
    const c = p.sequences[0].clips.find((c) => c.id === "plan")!;
    delete c.animation;
    const s = await pendantSur(p, (s) => s.fill("Position verticale", "0.3"));
    try {
      expect(planDe(s.last())?.y).toBe(0.3);
      expect(planDe(s.last())?.reframe).toBeUndefined();
      expect(s.toast()).toBe(nonTouche);
    } finally {
      s.close();
    }
  });
  it("deux plans, un seul modifié pendant le relevé : le bilan compte un plan recadré", async () => {
    const s = await pendantSur(
      filmVerrou(),
      (s) => s.fill("Échelle", "2"),
      async (s) => {
        await s.act(s.byLabel("Ajouter Rush.mov"));
        await s.saved();
        expect(s.last().clips.filter((c) => c.component === "video")).toHaveLength(2);
      },
    );
    try {
      const images = s.last().clips.filter((c) => c.component === "video");
      expect(images.filter((c) => c.reframe === "couple")).toHaveLength(1);
      expect(s.toast()).toBe(
        "1 plan recadré sur le couple. 1 plan modifié, retiré ou verrouillé pendant le relevé n’a pas été touché.",
      );
    } finally {
      s.close();
    }
  });
  it("second « Recadrer » identique avec une opacité réglée pendant le relevé : le bilan est dit", async () => {
    const s = await openStudio(filmVerrou());
    let finir: (() => void) | undefined;
    try {
      releve.hook = async () => ({ echantillons: [], source: { w: 180, h: 320 } });
      await s.act(s.clips("Rush.mov", false)[0]);
      await s.act(
        s.titled("Cadrer les plans sur les visages, au format de la séquence"),
      );
      for (let i = 0; i < 100 && s.button("Recadrage"); i++)
        await new Promise((r) => setTimeout(r, 5));
      await s.saved();
      expect(planDe(s.last())?.reframe).toBe("couple");
      releve.hook = () =>
        new Promise((r) => {
          finir = () => r({ echantillons: [], source: { w: 180, h: 320 } });
        });
      await s.act(
        s.titled("Cadrer les plans sur les visages, au format de la séquence"),
      );
      expect(finir).toBeTruthy();
      await s.clearToast();
      await s.fill("Opacité", "0.5");
      await s.saved();
      finir!();
      for (let i = 0; i < 100 && s.button("Recadrage"); i++)
        await new Promise((r) => setTimeout(r, 5));
      await s.saved();
      expect(planDe(s.last())?.opacity).toBe(0.5);
      expect(planDe(s.last())?.reframe).toBe("couple");
      expect(s.toast()).toBe("1 plan recadré sur le couple.");
    } finally {
      releve.hook = null;
      s.close();
    }
  });
});
