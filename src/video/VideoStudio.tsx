import ColorReference from "./ColorReference";
import {
  useWorkspaceLayout,
  WorkspaceControls,
  PanelResize,
} from "../workbench/WorkspaceLayout";
import VoiceEnhance from "./VoiceEnhance";
import AudioMixer from "./AudioMixer";
import { rasterTitle, captionRuns } from "./title-render";
import {
  recadrer,
  bilan,
  aRecadrer,
  modeDuPlan,
  reporterCadrage,
} from "./reframe-run";
import { extraits } from "./moments";
import type { Mode as CadrageMode } from "./reframe";
import { adoptTracked, maskCanvas, retimeMasks } from "./masks";
import { changeDefinition } from "./transform";
import MaskPanel from "./MaskPanel";
import WorkbenchHeader from "../workbench/WorkbenchHeader";
import {
  addKey,
  animatedClip,
  retimeAnimation,
  type AnimatedField,
} from "./animation";
import NumericRange from "../modules/NumericRange";
import Keyframes from "./Keyframes";
import ReviewPanel from "../review/ReviewPanel";
import type { ReviewAsset, ReviewThread } from "../review/types";
import { mapReviewFrame } from "../review/map-frame";
import JobPanel from "../modules/JobPanel";
import { nothingRestored, pilotRecord, pushHistory } from "./history";
import Pilot, { type PilotContext } from "../assistant/Pilot";
import type { Plan, VideoAction } from "../assistant/commands";
import type { CommandRecord } from "../assistant/records";
import {
  applyVideoActions,
  assembleVideo,
  captionsFromTranscript,
} from "../assistant/video-actions";
import CommandMenu, { type CommandAction } from "../modules/CommandMenu";
import SystemPanel from "../modules/SystemPanel";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Clapperboard,
  Crosshair,
  Download,
  Film,
  FolderPlus,
  Crop,
  Grid2X2,
  Image,
  Layers3,
  Maximize2,
  Loader2,
  MessageSquare,
  Music2,
  Palette,
  Pause,
  Play,
  Plus,
  RotateCcw,
  RotateCw,
  Save,
  Scissors,
  Settings2,
  SkipBack,
  SkipForward,
  Sparkles,
  ScanSearch,
  Trash2,
  Upload,
  Volume2,
  X,
} from "lucide-react";
import type {
  Asset,
  Clip,
  EngineStatus,
  Mask,
  Sequence,
  VideoJob,
  VideoProject,
} from "./types";
import {
  DENOISE_LEVELS,
  DUCKING_DEFAULT,
  LOUDNESS_TARGETS,
  TRANSITIONS,
} from "./types";
import {
  addClip,
  overwriteVideoTrack,
  expandAV,
  linkedClips,
  unlink,
  duplicateClip,
  BASE_GRADE,
  fitTransition,
  fitTransitions,
  fps,
  frame,
  length,
  remove,
  removeSilence,
  seconds,
  silenceCuts,
  split,
  srt,
  timecode,
} from "./edit";
import GenerationPanel from "./GenerationPanel";
import MulticamPanel from "./MulticamPanel";
import TitlesPanel from "./TitlesPanel";
import TranscriptPanel from "./TranscriptPanel";
import DerushView, { BandeDerush, mmss } from "./DerushView";
import { useClassementDesPlans } from "./derush-plans";
import {
  aDesMasques,
  ajouterUtiles,
  coupesInutilisables,
  passages,
  preMontage,
  raisonLue,
  resume as resumeDerush,
  retirerInutilisables,
} from "./derush";
import Scopes from "./Scopes";
import { arrowStep, stepFrame } from "./playhead-state";
import Preview, { resumeAudio } from "./Preview";
import Timeline from "./Timeline";
import "./video.css";
const api = window.juno?.video;
const DEVERROUILLEZ = "Déverrouillez la piste avant de la modifier.";
const verrouillee = (s: Sequence, track: number) => !!s.tracks?.[track]?.locked;
/**
 * Vrai quand `next` touche une piste verrouillée dans `before` : un de ses
 * plans modifié, déplacé ou retiré, ou un plan posé dessus.
 *
 * C'est le filet de tous les gestes du montage. Chaque réglage du plan
 * vérifiait le verrou pour lui-même, mais les masques, le changement de piste,
 * l'ajout d'un média, l'assemblage des scènes, « Dissocier » ou un passage de
 * transcription l'ignoraient : la piste verrouillée changeait sans un mot, et
 * le message affiché restait celui du geste précédent.
 */
function touchesLocked(before: Sequence, next: Sequence): boolean {
  if (!Object.values(before.tracks ?? {}).some((t) => t?.locked)) return false;
  const old = new Map(before.clips.map((c) => [c.id, c])),
    kept = new Set<string>();
  for (const c of next.clips) {
    const o = old.get(c.id);
    if (o) kept.add(c.id);
    if (o === c) continue;
    if (!verrouillee(before, c.track) && !(o && verrouillee(before, o.track)))
      continue;
    if (!o || JSON.stringify(o) !== JSON.stringify(c)) return true;
  }
  return before.clips.some(
    (c) => verrouillee(before, c.track) && !kept.has(c.id),
  );
}
/**
 * Vrai quand `a` et `b` disent la même chose, même en objets neufs : un plan
 * lâché là où il était, ou sur une piste qui le refuse, rend une séquence
 * neuve au contenu inchangé. Tout ce qui est partagé (le même objet) est sauté
 * sans être parcouru, et la comparaison s'arrête au premier écart : sur un
 * long film, seuls les quelques plans recréés par le geste sont lus. Un champ
 * `undefined` compte comme absent, comme à l'enregistrement.
 */
function memeContenu(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length)
      return false;
    for (let i = 0; i < a.length; i++)
      if (!memeContenu(a[i], b[i])) return false;
    return true;
  }
  const x = a as Record<string, unknown>,
    y = b as Record<string, unknown>;
  let n = 0;
  for (const k in x) {
    if (x[k] === undefined) continue;
    n++;
    if (!memeContenu(x[k], y[k])) return false;
  }
  for (const k in y) if (y[k] !== undefined) n--;
  return n === 0;
}
type Panel =
  | "media"
  | "derush"
  | "color"
  | "audio"
  | "notes"
  | "transcript"
  | "titles"
  | "masks";
const styles = [
  ["original", "Original"],
  ["signature", "Juno Signature"],
  ["editorial", "Éditorial"],
  ["golden", "Golden Hour"],
  ["film", "Film doux"],
  ["mono", "Noir & blanc"],
];
function Range({
  label,
  value,
  min,
  max,
  step = 0.01,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => boolean | void;
}) {
  return (
    <div className="vf-range">
      <NumericRange
        label={label}
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={onChange}
      />
    </div>
  );
}

/**
 * La transition qui ouvre un plan. Elle se pose sur le plan entrant, pas
 * entre deux plans : c'est ce qui permet d'en avoir une même quand le plan
 * précédent est sur une autre piste.
 */
function TransitionPicker({
  clip,
  sequence,
  onPatch,
}: {
  clip: Clip;
  sequence: Sequence;
  onPatch: (p: Partial<Clip>) => void;
}) {
  const rate = fps(sequence),
    maximum = Math.min(240, clip.duration);
  const duration = Math.min(
    maximum,
    clip.transition?.duration || Math.round(rate),
  );
  return (
    <>
      <label className="vf-field">
        Transition d’entrée
        <select
          value={clip.transition?.kind || ""}
          onChange={(e) =>
            onPatch({
              transition: e.target.value
                ? { kind: e.target.value, duration }
                : undefined,
            })
          }
        >
          <option value="">Aucune</option>
          {TRANSITIONS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      {clip.transition && (
        <>
          <Range
            label={`Durée (${(duration / rate).toFixed(2)} s)`}
            min={1}
            max={maximum}
            step={1}
            value={duration}
            onChange={(d) =>
              onPatch({
                transition: { kind: clip.transition!.kind, duration: d },
              })
            }
          />
          <p className="vf-hint">
            Le plan précédent doit rester visible sous celui-ci pendant la
            transition : placez-les sur deux pistes qui se chevauchent.
          </p>
        </>
      )}
    </>
  );
}
/**
 * Débruitage, stabilisation et ralenti fluide d'un plan.
 * Chaque coût annoncé vient d'une mesure faite sur cette machine en 1080p,
 * pas d'une estimation : ces filtres peuvent multiplier le temps de rendu.
 */
function Cleanup({
  clip,
  onPatch,
}: {
  clip: Clip;
  onPatch: (p: Partial<Clip>) => void;
}) {
  const ralenti = clip.speed < 0.95;
  return (
    <>
      <label className="vf-field">
        Débruitage
        <select
          value={clip.denoise || "none"}
          onChange={(e) =>
            onPatch({ denoise: e.target.value as Clip["denoise"] })
          }
        >
          {DENOISE_LEVELS.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
              {d.detail ? " · " + d.detail : ""}
            </option>
          ))}
        </select>
      </label>
      <Range
        label="Stabilisation"
        min={0}
        max={1}
        value={clip.stabilise ?? 0}
        onChange={(stabilise) => onPatch({ stabilise })}
      />
      {(clip.stabilise ?? 0) > 0 && (
        <p className="vf-hint">
          La stabilisation recadre l’image pour compenser les secousses : les
          bords sont perdus, d’autant plus que le réglage est fort.
        </p>
      )}
      <label className="vf-check">
        <input
          type="checkbox"
          disabled={!ralenti}
          checked={!!clip.smoothSlow && ralenti}
          onChange={(e) => onPatch({ smoothSlow: e.target.checked })}
        />
        Ralenti fluide
      </label>
      <p className="vf-hint">
        {ralenti
          ? "Des images intermédiaires sont calculées au lieu de répéter les mêmes. Le rendu de ce plan devient environ seize fois plus long."
          : "Disponible seulement sous 1× de vitesse."}
      </p>
    </>
  );
}
/**
 * Retirer les blancs d'un discours, en montrant d'abord ce qui sera coupé.
 * Rien n'est appliqué tant que l'aperçu n'a pas été lu : une coupe de montage
 * ne doit jamais surprendre.
 */
function SilenceTrim({
  sequence,
  clip,
  assets,
  onChange,
  onDone,
}: {
  sequence: Sequence;
  clip: Clip;
  assets: Asset[];
  onChange: (s: Sequence) => boolean | void;
  onDone: (message: string) => void;
}) {
  const [minSilence, setMin] = useState(0.6);
  const asset = assets.find((a) => a.id === clip.assetId);
  const analysed = Array.isArray(asset?.analysis?.silences);
  const cuts = analysed
    ? silenceCuts(sequence, clip, asset, { minSilence })
    : [];
  const total = cuts.reduce((sum, c) => sum + c.duration, 0);
  if (!analysed)
    return (
      <p className="vf-hint">
        Analysez ce média pour pouvoir retirer ses blancs.
      </p>
    );
  return (
    <>
      <Range
        label="Blanc minimum à retirer (s)"
        min={0.2}
        max={4}
        value={minSilence}
        onChange={setMin}
      />
      <button
        disabled={!cuts.length}
        onClick={() => {
          // Refus dit tout haut : sur une piste verrouillée, le bouton
          // annonçait des blancs à retirer et ne faisait rien, sans un mot.
          if (
            linkedClips(sequence, clip.id).some((c) =>
              verrouillee(sequence, c.track),
            )
          ) {
            onDone(DEVERROUILLEZ);
            return;
          }
          const r = removeSilence(sequence, clip.id, assets, { minSilence });
          if (!r.cuts || onChange(r.sequence) === false) return;
          onDone(
            `${r.cuts} blanc${r.cuts > 1 ? "s" : ""} retiré${
              r.cuts > 1 ? "s" : ""
            }, ${timecode(r.removed, sequence)} de moins.`,
          );
        }}
      >
        <Scissors size={16} />
        {cuts.length
          ? `Retirer ${cuts.length} blanc${cuts.length > 1 ? "s" : ""} (${timecode(total, sequence)})`
          : "Aucun blanc à retirer"}
      </button>
      <p className="vf-hint">
        Les morceaux se referment, et ce qui suit sur la piste est décalé
        d’autant. Une marge est gardée autour de chaque mot.
      </p>
    </>
  );
}
/**
 * Retirer d'un plan ses passages inutilisables (dérushage) : le pendant de
 * « Retirer les blancs », en une seule annulation. Rien n'est appliqué sans
 * le bouton ; le nombre et la durée des morceaux sont dits avant.
 */
function UnusableTrim({
  sequence,
  clip,
  assets,
  onChange,
  onDone,
}: {
  sequence: Sequence;
  clip: Clip;
  assets: Asset[];
  onChange: (s: Sequence) => boolean | void;
  onDone: (message: string) => void;
}) {
  const asset = assets.find((a) => a.id === clip.assetId);
  if (asset?.kind !== "video" || clip.track >= 10 || !asset.derush) return null;
  const cuts = coupesInutilisables(sequence, clip, asset);
  const total = cuts.reduce((sum, c) => sum + c.duration, 0);
  return (
    <>
      <button
        disabled={!cuts.length}
        onClick={() => {
          if (
            linkedClips(sequence, clip.id).some((c) =>
              verrouillee(sequence, c.track),
            )
          ) {
            onDone(DEVERROUILLEZ);
            return;
          }
          const r = retirerInutilisables(sequence, clip.id, assets);
          if (!r.cuts || onChange(r.sequence) === false) return;
          onDone(
            `${r.cuts} passage${r.cuts > 1 ? "s" : ""} inutilisable${r.cuts > 1 ? "s" : ""} retiré${r.cuts > 1 ? "s" : ""}, ${timecode(r.removed, sequence)} de moins.`,
          );
        }}
      >
        <ScanSearch size={16} />
        {cuts.length
          ? `Retirer ${cuts.length} passage${cuts.length > 1 ? "s" : ""} inutilisable${cuts.length > 1 ? "s" : ""} (${timecode(total, sequence)})`
          : "Aucun passage masqué dans ce plan"}
      </button>
      <p className="vf-hint">
        Les passages masqués par le dérushage (flou, bougé, noir) sortent du
        plan, et ce qui suit se referme. Revoyez-les dans l’onglet Dérush.
      </p>
    </>
  );
}
/**
 * L'atténuation automatique de la musique sous la voix.
 * Elle n'agit que sur les plans marqués « Musique », en s'appuyant sur les
 * plans marqués « Voix » : sans ce marquage, elle ne peut rien faire.
 */
function Ducking({
  sequence,
  onChange,
}: {
  sequence: Sequence;
  onChange: (s: Sequence) => void;
}) {
  const d = sequence.ducking ?? DUCKING_DEFAULT,
    on = sequence.ducking?.enabled ?? false;
  const set = (patch: Partial<typeof DUCKING_DEFAULT>) =>
    onChange({ ...sequence, ducking: { ...d, ...patch } });
  const voix = sequence.clips.filter((c) => c.audioRole === "voice").length,
    musique = sequence.clips.filter((c) => c.audioRole === "music").length;
  return (
    <>
      <label className="vf-check">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => set({ enabled: e.target.checked })}
        />
        Baisser la musique sous la voix
      </label>
      {on && (
        <>
          <Range
            label={
              "Profondeur (" +
              (d.depth >= 1
                ? "silence"
                : "-" + (-20 * Math.log10(1 - d.depth)).toFixed(0) + " dB") +
              ")"
            }
            min={0}
            max={0.95}
            value={d.depth}
            onChange={(depth) => set({ depth })}
          />
          <Range
            label="Temps de descente (s)"
            min={0.05}
            max={2}
            value={d.attack}
            onChange={(attack) => set({ attack })}
          />
          <Range
            label="Temps de remontée (s)"
            min={0.1}
            max={5}
            value={d.release}
            onChange={(release) => set({ release })}
          />
          <Range
            label="Maintien après la voix (s)"
            min={0}
            max={3}
            value={d.hold}
            onChange={(hold) => set({ hold })}
          />
          <p className="vf-hint">
            {!voix || !musique
              ? "Marquez au moins un plan « Voix » et un plan « Musique » dans « Nature du son » : sans cela, rien ne sera atténué."
              : `${musique} plan${musique > 1 ? "s" : ""} de musique ${
                  musique > 1 ? "baissent" : "baisse"
                } sous ${voix} plan${voix > 1 ? "s" : ""} de voix. Analysez les médias pour que l’atténuation suive les silences du discours plutôt que la durée du plan.`}
          </p>
        </>
      )}
    </>
  );
}
function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog className="vf-dialog" ref={ref} onCancel={onClose}>
      <header>
        <h2>{title}</h2>
        <button onClick={onClose} aria-label="Fermer">
          <X size={18} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
export default function VideoStudio({ onPhoto }: { onPhoto: () => void }) {
  const workspaceLayout = useWorkspaceLayout("video");
  const libraryOpen = workspaceLayout.layout.library;
  const setLibraryOpen = (update: boolean | ((v: boolean) => boolean)) =>
    workspaceLayout.patch({
      library: typeof update === "function" ? update(libraryOpen) : update,
    });
  const [drawer, setDrawer] = useState(false);
  const [engine, setEngine] = useState<EngineStatus | null>(null),
    [projects, setProjects] = useState<
      { id: string; name: string; count: number; revision?: number }[]
    >([]),
    [project, setProject] = useState<VideoProject | null>(null),
    [sequence, setSequence] = useState<Sequence | null>(null),
    [jobs, setJobs] = useState<VideoJob[]>([]),
    [selected, setSelected] = useState(""),
    [playhead, setPlayhead] = useState(0),
    [playing, setPlaying] = useState(false),
    [panel, setPanel] = useState<Panel>("media"),
    [search, setSearch] = useState(""),
    [mediaFilter, setMediaFilter] = useState("all"),
    [mediaPage, setMediaPage] = useState(0),
    [message, setMessage] = useState(""),
    [saving, setSaving] = useState(false),
    [exportError, setExportError] = useState(""),
    [cadrage, setCadrage] = useState<
      { fait: number; total: number; nom: string } | undefined
    >(),
    [snapshots, setSnapshots] = useState<
      {
        revision: number;
        updated: number;
        sequences: { id: string; name: string }[];
        illisible?: boolean;
      }[]
    >([]),
    [saveError, setSaveError] = useState(""),
    // Le rush à ouvrir dans l'onglet Dérush (lien d'une carte de la
    // bibliothèque).
    [derushFocus, setDerushFocus] = useState(""),
    [dialog, setDialog] = useState<
      | "new"
      | "settings"
      | "title"
      | "export"
      | "multicam"
      | "history"
      | "generate"
      | "system"
      | "review-client"
      | null
    >(null),
    [name, setName] = useState(""),
    [titleText, setTitleText] = useState(""),
    [titleSelection, setTitleSelection] = useState(""),
    [maskSelection, setMaskSelection] = useState(""),
    [trackingMask, setTrackingMask] = useState(""),
    [comment, setComment] = useState(""),
    [codec, setCodec] = useState("h264"),
    [loudness, setLoudness] = useState<string>("reseaux"),
    [exportBusy, setExportBusy] = useState(false),
    [commandsOpen, setCommandsOpen] = useState(false),
    [filmSearch, setFilmSearch] = useState(""),
    [spaceChoice, setSpaceChoice] = useState<{
      assetId: string;
      inputSpace: string;
      name: string;
      locked: number;
    } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [fullScreen, setFullScreen] = useState(false),
    [colorStrength, setColorStrength] = useState(65),
    [beforeColor, setBeforeColor] = useState(false),
    [verticalQuality, setVerticalQuality] = useState<1080 | 2160>(1080);
  useEffect(() => {
    const changed = () =>
      setFullScreen(document.fullscreenElement === stageRef.current);
    document.addEventListener("fullscreenchange", changed);
    const off = window.juno?.onWindowFullscreen?.((value) => {
      if (!value) setFullScreen(false);
    });
    return () => {
      document.removeEventListener("fullscreenchange", changed);
      off?.();
      void window.juno?.windowFullscreen?.(false).catch(() => {});
    };
  }, []);
  useEffect(() => {
    if (!fullScreen) return;
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.fullscreenElement) {
        e.preventDefault();
        setFullScreen(false);
        void window.juno?.windowFullscreen?.(false).catch(() => {});
      }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [fullScreen]);
  const expandPreview = () => {
    if (window.juno?.windowFullscreen) {
      const value = !fullScreen;
      setFullScreen(value);
      void window.juno
        .windowFullscreen(value)
        .catch(() =>
          notify(
            "Le plein écran natif est indisponible ; l’aperçu reste agrandi.",
          ),
        );
      return;
    }
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    if (fullScreen) {
      setFullScreen(false);
      return;
    }
    setFullScreen(true);
    void stageRef.current?.requestFullscreen().catch(() => {});
  };
  const previousActive = useRef(0),
    previousIssues = useRef(0);
  useEffect(() => {
    const active = jobs.filter((j) =>
      ["running", "queued"].includes(j.state),
    ).length;
    const issues = jobs.reduce(
      (n, j) => n + (j.unresolvedErrors ?? j.errors?.length ?? 0),
      0,
    );
    if (active > previousActive.current || issues > previousIssues.current)
      window.dispatchEvent(new Event("juno-open-activity"));
    previousActive.current = active;
    previousIssues.current = issues;
  }, [jobs]);
  const pRef = useRef(project),
    refreshBusy = useRef(false),
    openToken = useRef(0),
    aliveRef = useRef(true),
    sRef = useRef(sequence),
    versions = useRef<Record<string, number>>({}),
    pending = useRef<{ projectId: string; sequence: Sequence } | null>(null),
    working = useRef(false),
    // Vrai pendant que le pilote enregistre sa commande puis la montre.
    pilotSaving = useRef(false),
    history = useRef<Sequence[]>([]),
    future = useRef<Sequence[]>([]),
    playRef = useRef(playhead);
  pRef.current = project;
  sRef.current = sequence;
  playRef.current = playhead;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  /**
   * Affiche un message neuf secondes. Le délai repart à chaque message, même
   * identique au précédent : un effet qui suivait le texte ne voyait pas un
   * second refus pareil au premier, qui disparaissait alors à l'échéance du
   * premier, parfois aussitôt affiché. Le délai vit ici et non dans un effet :
   * aucun rendu de plus.
   */
  const notify = (e: unknown) => {
    setMessage(e instanceof Error ? e.message : String(e));
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setMessage(""), 9000);
  };
  async function refresh() {
    if (!api || refreshBusy.current || !aliveRef.current) return;
    refreshBusy.current = true;
    try {
      const data = await api.list();
      if (!aliveRef.current) return;
      setProjects((old) =>
        JSON.stringify(old) === JSON.stringify(data.projects)
          ? old
          : data.projects,
      );
      setJobs((old) =>
        JSON.stringify(old) === JSON.stringify(data.jobs) ? old : data.jobs,
      );
      const p = pRef.current;
      if (
        p &&
        !working.current &&
        !pending.current &&
        data.projects.find((q) => q.id === p.id)?.revision !== p.revision
      ) {
        const latest = await api.project(p.id);
        if (
          aliveRef.current &&
          !working.current &&
          !pending.current &&
          pRef.current?.id === p.id
        ) {
          setProject((current) =>
            current?.id === p.id && current.revision < latest.revision
              ? latest
              : current,
          );
          adoptStored(latest);
        }
      }
    } catch (e) {
      notify(e);
    } finally {
      refreshBusy.current = false;
    }
  }
  /**
   * Montre `next` et garde la tête dans le film.
   *
   * Tout ce qui raccourcit le film passe par ici : annuler, rétablir, retirer
   * ou raccourcir un plan, retirer les blancs, le pilote, une autre séquence,
   * une version récupérée, un suivi repris. Sans cela, annuler l'ajout d'un
   * plan en fin de film laissait la tête après la dernière image : le moniteur
   * disait « Placez vos médias sur la timeline. » sur un film qui a des plans.
   * La tête est bornée ici, là où le film change, et jamais dans un effet : un
   * effet qui suivrait la tête programmerait un rendu de plus à chaque image
   * (erreur React 185, playhead-state.ts). Le rendu où la séquence change est
   * aussi celui où la tête est ramenée : aucun rendu de plus.
   *
   * La même séquence à une autre cadence (changer la cadence, l'annuler ou
   * la rétablir) garde la tête au même instant, arrondie comme les plans :
   * de 25 à 50 images/s, la tête à 12 s restait sur l'image 300, soit 6 s.
   * La lecture s'arrête alors, comme au choix de la cadence : elle compte ses
   * images depuis sa tête de départ, à l'ancienne cadence, et écrasait dès
   * l'image suivante la tête convertie (annuler à 13 s sautait à la fin).
   */
  function show(next: Sequence) {
    const before = sRef.current,
      ratio =
        before && before.id === next.id && fps(before) !== fps(next)
          ? fps(next) / fps(before)
          : 1;
    if (ratio !== 1) setPlaying(false);
    sRef.current = next;
    setSequence(next);
    const last = Math.max(0, length(next) - 1);
    setPlayhead((f) =>
      stepFrame(ratio === 1 ? f : Math.round(f * ratio), 0, last),
    );
  }
  /**
   * Reprend la séquence ouverte quand une tâche l'a enregistrée entre-temps.
   *
   * Le suivi d'un masque écrit ses repères sur la séquence enregistrée et en
   * change la version. Sans cette reprise, l'interface gardait l'ancienne
   * version : le suivi n'apparaissait pas, et la retouche suivante était
   * refusée comme un conflit. N'agit que sans modification en attente.
   */
  function adoptStored(latest: VideoProject) {
    const open = sRef.current;
    if (!open || working.current || pending.current) return;
    const known = versions.current[open.id] ?? open.version ?? 1,
      stored = latest.sequences.find((x) => x.id === open.id);
    for (const x of latest.sequences)
      if ((x.version || 1) > (versions.current[x.id] ?? 0))
        versions.current[x.id] = x.version || 1;
    if (!stored || (stored.version || 1) <= known) return;
    const next = expandAV(stored, latest.assets);
    pushHistory(history.current, open);
    future.current = [];
    pRef.current = latest;
    show(next);
  }
  async function openProject(id: string) {
    if (!api || working.current || pending.current) return;
    const token = ++openToken.current;
    setPlaying(false);
    const p = await api.project(id);
    if (
      token !== openToken.current ||
      !aliveRef.current ||
      working.current ||
      pending.current
    )
      return;
    let s = expandAV(p.sequences[0], p.assets);
    // Recover into a separate sequence so a stale draft cannot overwrite a newer edit.
    const draftKey = "juno-video-draft-" + id;
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const draft = JSON.parse(raw) as Sequence;
        const recovered = {
          ...draft,
          id: crypto.randomUUID(),
          name: draft.name.slice(0, 165) + " · Montage récupéré",
          version: 1,
        };
        await api.saveSequence({
          projectId: id,
          sequence: recovered,
          expectedVersion: 0,
        });
        p.sequences.push(recovered);
        s = recovered;
        localStorage.removeItem(draftKey);
        notify(
          "Votre montage interrompu a été récupéré dans une nouvelle version.",
        );
      }
    } catch (e) {
      notify("Brouillon conservé mais non récupéré : " + String(e));
    }
    if (token !== openToken.current || !aliveRef.current) return;
    versions.current = Object.fromEntries(
      p.sequences.map((s) => [s.id, s.version || 1]),
    );
    setProject(p);
    pRef.current = p;
    show(s);
    setPlayhead(0);
    setSelected("");
    history.current = [];
    future.current = [];
    localStorage.setItem("juno-video-project", id);
  }
  useEffect(() => {
    if (!api) return;
    aliveRef.current = true;
    let alive = true;
    void api
      .status()
      .then((s) => alive && setEngine(s))
      .catch(notify);
    void api
      .list()
      .then(async (data) => {
        if (!alive) return;
        setProjects(data.projects);
        setJobs(data.jobs);
        const id = localStorage.getItem("juno-video-project");
        const p = data.projects.find((p) => p.id === id) || data.projects[0];
        if (p) await openProject(p.id);
      })
      .catch(notify);
    const timer = setInterval(() => void refresh(), 1200);
    return () => {
      alive = false;
      aliveRef.current = false;
      openToken.current++;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (working.current || pending.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, []);
  async function drain() {
    if (working.current || !api) return;
    working.current = true;
    setSaving(true);
    setSaveError("");
    let inFlight: { projectId: string; sequence: Sequence } | null = null;
    try {
      while (pending.current) {
        let item = pending.current;
        inFlight = item;
        pending.current = null;
        let result;
        try {
          result = await api.saveSequence({
            ...item,
            expectedVersion: versions.current[item.sequence.id] ?? 1,
          });
        } catch (e) {
          // Un suivi de masque terminé pendant la retouche : ses repères sont
          // repris dans la retouche, qui repart sur la version enregistrée.
          const merged = /Cette séquence a changé/.test(String(e))
            ? await withTracking(item)
            : null;
          if (!merged) throw e;
          item = inFlight = merged.item;
          // Une retouche faite pendant ce rattrapage reçoit aussi les repères.
          // La lecture passe par une variable typée : TypeScript croit encore
          // pending.current vide depuis la ligne qui l'a vidé.
          const later = pending.current as typeof item | null;
          const also = later && adoptTracked(later.sequence, item.sequence);
          if (later && also) pending.current = { ...later, sequence: also };
          const shown =
            (pending.current as typeof item | null)?.sequence ?? item.sequence;
          show(shown);
          result = await api.saveSequence({
            ...item,
            expectedVersion: merged.version,
          });
        }
        versions.current[item.sequence.id] = result.version;
        setProject((p) =>
          p?.id === item.projectId
            ? {
                ...p,
                // Une révision sautée veut dire qu'autre chose a été
                // enregistré entre-temps (un import qui se termine, un
                // suivi) : garder l'ancienne laisse le rafraîchissement
                // recharger le projet. Prendre la nouvelle masquait pour
                // toujours le média importé pendant une retouche.
                revision:
                  result.revision === p.revision + 1
                    ? result.revision
                    : p.revision,
                // Une séquence neuve (pré-montage, copie de secours) entre
                // dans la liste : sans cela, elle n'y apparaissait qu'au
                // prochain chargement du projet, et on ne pouvait plus y
                // revenir après en avoir choisi une autre.
                sequences: p.sequences.some((s) => s.id === item.sequence.id)
                  ? p.sequences.map((s) =>
                      s.id === item.sequence.id
                        ? { ...item.sequence, version: result.version }
                        : s,
                    )
                  : [
                      ...p.sequences,
                      { ...item.sequence, version: result.version },
                    ],
              }
            : p,
        );
        if (!pending.current)
          localStorage.removeItem("juno-video-draft-" + item.projectId);
        inFlight = null;
      }
    } catch (e) {
      if (!pending.current && inFlight) pending.current = inFlight;
      setSaveError(e instanceof Error ? e.message : String(e));
      notify(e);
    } finally {
      working.current = false;
      setSaving(false);
    }
  }
  /** La retouche en attente, avec les repères d'un suivi enregistré entre-temps. */
  async function withTracking(item: { projectId: string; sequence: Sequence }) {
    if (!api) return null;
    const p = await api.project(item.projectId),
      stored = p.sequences.find((x) => x.id === item.sequence.id);
    if (!stored) return null;
    const merged = adoptTracked(item.sequence, stored);
    return merged
      ? {
          item: { ...item, sequence: merged },
          version: stored.version || 1,
        }
      : null;
  }
  async function selectSequence(sequenceId: string, projectId = project?.id) {
    if (!api || !projectId || working.current || pending.current) return;
    const token = ++openToken.current;
    const p = await api.project(projectId);
    if (
      working.current ||
      pending.current ||
      token !== openToken.current ||
      !aliveRef.current
    )
      return;
    const stored = p.sequences.find((s) => s.id === sequenceId);
    const s = stored ? expandAV(stored, p.assets) : undefined;
    if (!s) throw Error("Version introuvable");
    versions.current = Object.fromEntries(
      p.sequences.map((s) => [s.id, s.version || 1]),
    );
    setProject(p);
    pRef.current = p;
    show(s);
    setSelected("");
    seek(0);
    history.current = [];
    future.current = [];
    localStorage.setItem("juno-video-project", p.id);
  }
  function saveAsCopy() {
    if (!sRef.current || !project) return;
    const s = {
      ...structuredClone(sRef.current),
      id: crypto.randomUUID(),
      version: 1,
      name: sRef.current.name.slice(0, 165) + " · Copie de secours",
    };
    versions.current[s.id] = 0;
    change(s, false);
  }
  /**
   * Recadrer pour le format de la séquence.
   *
   * Sans cela, un plan 16/9 posé dans une séquence verticale part en bandes
   * noires et les mariés sont minuscules. On relève les visages sur quelques
   * images, on en tire un cadre, et on le pose dans `scale`, `x` et `y`, qui
   * existaient déjà.
   */
  async function lancerCadrage(
    mode: CadrageMode | typeof modeDuPlan,
    cibles?: string[],
  ) {
    const s = sRef.current;
    if (!s || !project || cadrage) return;
    // Une piste verrouillée garde son cadre : « Recadrer » passe ses plans, et
    // le cadrage d'un seul plan y est refusé avant le relevé des visages.
    const libres = new Set(
      s.clips.filter((c) => !verrouillee(s, c.track)).map((c) => c.id),
    );
    if (cibles && !cibles.some((id) => libres.has(id))) {
      notify(DEVERROUILLEZ);
      return;
    }
    const choisis =
      cibles || libres.size < s.clips.length
        ? (cibles ?? [...libres]).filter((id) => libres.has(id))
        : undefined;
    setPlaying(false);
    setCadrage({ fait: 0, total: 0, nom: "" });
    try {
      const { sequence: recadree, notes } = await recadrer(
        s,
        project.assets,
        mode,
        choisis,
        (fait, total, nom) => setCadrage({ fait, total, nom }),
      );
      if (!notes.length) {
        notify(bilan(notes));
        return;
      }
      // Le montage a pu changer pendant le relevé : les cadres sont posés
      // sur la séquence d'aujourd'hui, jamais sur la copie du clic.
      const live = sRef.current;
      if (!live) return;
      const r = reporterCadrage(live, s, recadree, notes);
      if ("abandon" in r) {
        notify(r.abandon);
        return;
      }
      const ecartes = r.ecartes
        ? ` ${r.ecartes} plan${r.ecartes > 1 ? "s" : ""} modifié${r.ecartes > 1 ? "s" : ""}, retiré${r.ecartes > 1 ? "s" : ""} ou verrouillé${r.ecartes > 1 ? "s" : ""} pendant le relevé ${r.ecartes > 1 ? "n’ont" : "n’a"} pas été ${r.ecartes > 1 ? "touchés" : "touché"}.`
        : "";
      if (!r.notes.length) {
        notify("Aucun plan recadré." + ecartes);
        return;
      }
      // Des cadres déjà posés et recalculés à l'identique n'écrivent rien,
      // mais le bilan est dit comme avant.
      if (memeContenu(live, r.sequence) || change(r.sequence))
        notify(bilan(r.notes) + ecartes);
    } catch (e) {
      notify(e);
    } finally {
      setCadrage(undefined);
    }
  }
  /**
   * Applique un geste de montage. Rend `false` quand il est refusé (et
   * signalé) : un champ numérique reprend alors la vraie valeur.
   *
   * `record` à faux : annuler, rétablir ou une copie de secours, qui rendent
   * un état déjà vu, verrous compris. `allTracks` : un changement de cadence,
   * qui convertit toute la séquence, pistes verrouillées comprises, sans rien
   * déplacer dans le temps.
   */
  function change(next: Sequence, record = true, allTracks = false) {
    if (!project) return false;
    // Comparé avant la mise en forme ci-dessous, qui peut réécrire un plan
    // ancien (son séparé de l'image) que le geste n'a pas touché.
    const before = sRef.current;
    // Rien à faire : pas d'annulation vide, pas d'enregistrement. Un geste
    // qui rend une séquence neuve au même contenu (plan lâché sur place ou
    // sur une piste verrouillée) est aussi un « rien ». Annuler et rétablir ne
    // sont jugés que sur l'objet : une étape d'historique identique à l'écran
    // est franchie, et non rejouée sans fin.
    if (next === before || (record && before && memeContenu(before, next)))
      return false;
    if (pilotSaving.current) {
      notify(
        "Juno enregistre la commande du pilote. Refaites ce geste dans un instant.",
      );
      return false;
    }
    if (
      record &&
      !allTracks &&
      before?.id === next.id &&
      touchesLocked(before, next)
    ) {
      notify(DEVERROUILLEZ);
      return false;
    }
    try {
      // Filet commun à tous les gestes : une transition plus longue que son
      // plan bloquerait l'enregistrement de tout ce qui suit.
      next = fitTransitions(expandAV(next, project.assets));
    } catch (e) {
      notify(e);
      return false;
    }
    if (
      [next.clips, next.titles, next.captions, next.markers].some(
        (items) => items.length > 20000,
      )
    ) {
      notify(
        "Cette séquence atteint la limite de 20 000 éléments par catégorie. Créez une nouvelle séquence pour continuer.",
      );
      return false;
    }
    if (record && sRef.current) {
      pushHistory(history.current, sRef.current);
      future.current = [];
    }
    show(next);
    pending.current = { projectId: project.id, sequence: next };
    try {
      localStorage.setItem(
        "juno-video-draft-" + project.id,
        JSON.stringify(next),
      );
    } catch {
      notify(
        "Le brouillon de secours n’a pas pu être écrit. Enregistrement du projet en cours.",
      );
    }
    void drain();
    return true;
  }
  // Un retour refusé (le pilote enregistre sa commande) laisse les deux piles
  // comme avant : l'état n'est ni perdu ni rejoué deux fois.
  function undo() {
    const previous = history.current.pop();
    if (previous && sRef.current) {
      pushHistory(future.current, sRef.current);
      if (!change(previous, false)) {
        future.current.pop();
        history.current.push(previous);
      }
    }
  }
  function redo() {
    const next = future.current.pop();
    if (next && sRef.current) {
      pushHistory(history.current, sRef.current);
      if (!change(next, false)) {
        history.current.pop();
        future.current.push(next);
      }
    }
  }
  useEffect(() => {
    if (!playing || !sequence) return;
    resumeAudio();
    const start = performance.now(),
      initial = playRef.current,
      rate = fps(sequence),
      end = length(sequence);
    let raf = 0;
    const tick = (now: number) => {
      const live = sRef.current || sequence;
      // Autre cadence (annuler ou rétablir pendant la lecture, par le pilote
      // aussi) : show() a converti la tête et arrête la lecture. Une image
      // passée avant ce rendu ne la déplace pas.
      if (fps(live) !== rate) {
        setPlaying(false);
        return;
      }
      const at = initial + Math.floor(((now - start) / 1000) * rate);
      if (at >= length(live)) {
        setPlayhead(Math.max(0, length(live) - 1));
        setPlaying(false);
        return;
      }
      setPlayhead(at);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, sequence?.id]);
  // La dernière image du film. La tête ne va pas au-delà, comme la lecture
  // qui s'y arrête : après, le moniteur n'a rien à montrer et affichait
  // « Placez vos médias sur la timeline. » alors que le film a des plans.
  const lastFrame = () =>
    sRef.current ? Math.max(0, length(sRef.current) - 1) : 0;
  /** Place la tête (dans le film) et rend l'image où elle est placée. */
  function seek(at: number) {
    setPlaying(false);
    const placed = stepFrame(at, 0, lastFrame());
    setPlayhead(placed);
    return placed;
  }
  // Une image (ou dix) de plus ou de moins, à partir de la position laissée
  // par la touche précédente et non de celle du dernier rendu : une rafale de
  // flèches arrive exactement là où elle envoie la tête.
  function step(delta: number) {
    setPlaying(false);
    const last = lastFrame();
    setPlayhead((f) => stepFrame(f, delta, last));
  }
  const clip = sequence?.clips.find((c) => c.id === selected),
    asset = project?.assets.find((a) => a.id === clip?.assetId),
    total = sequence ? length(sequence) : 0;
  const deliveryAssets = new Set(dialog === "export" ? sequence?.clips.map((c) => c.assetId) || [] : []);
  const unconfirmedDelivery =
    dialog === "export"
      ? project?.assets.filter(
          (a) =>
            a.kind === "video" && !a.spaceConfirmed && deliveryAssets.has(a.id),
        ) || []
      : [];
  const checkDeliveryColor = () => {
    const c = sequence?.clips.find(
      (c) =>
        c.track < 10 && unconfirmedDelivery.some((a) => a.id === c.assetId),
    );
    setDialog(null);
    setPanel("color");
    if (c) {
      setSelected(c.id);
      seek(c.start);
    }
  };
  // Le `patch` et la sélection du dernier rendu, pour un geste qui se termine
  // après une attente.
  const dernierRendu = useRef({ patch, selected });
  dernierRendu.current = { patch, selected };
  /** Rend `false` quand la modification est refusée (et signalée). */
  function patch(p: Partial<Clip>): boolean {
    if (!sequence || !clip) return false;
    try {
      if (sequence.tracks?.[clip.track]?.locked)
        throw Error("Déverrouillez la piste avant de la modifier.");
      if (
        p.speed !== undefined &&
        clip.linkId &&
        sequence.clips.some(
          (c) => c.linkId === clip.linkId && sequence.tracks?.[c.track]?.locked,
        )
      )
        throw Error("La piste liée est verrouillée.");
      let next = { ...clip, ...p };
      // Retoucher à la main un plan recadré automatiquement : il devient
      // « réglé à la main », pour que « Recadrer » ne défasse plus ce geste.
      if (
        (p.scale !== undefined || p.x !== undefined || p.y !== undefined) &&
        (clip.reframe === "couple" || clip.reframe === "tous") &&
        p.reframe === undefined
      )
        next.reframe = "main";
      if (!p.animation)
        for (const field of ["x", "y", "gain"] as AnimatedField[])
          if (p[field] !== undefined && clip.animation?.[field]?.length)
            next = addKey(
              next,
              field,
              playhead - clip.start,
              p[field]!,
              clip.animation[field]?.find(
                (k) => k.frame === playhead - clip.start,
              )?.easing || "linear",
            );
      return change({
        ...sequence,
        clips: sequence.clips.map((c) => {
          if (c.id === clip.id) return next;
          if (p.speed !== undefined && clip.linkId && c.linkId === clip.linkId)
            return {
              ...c,
              speed: p.speed,
              duration: Math.max(
                1,
                Math.round((c.duration * c.speed) / p.speed),
              ),
              animation: retimeAnimation(c.animation, 0, c.speed / p.speed),
              masks: retimeMasks(
                c,
                0,
                c.speed / p.speed,
                Math.max(1, Math.round((c.duration * c.speed) / p.speed)),
              ),
              fadeIn: 0,
              fadeOut: 0,
            };
          return c;
        }),
      });
    } catch (error) {
      notify(error);
      return false;
    }
  }
  function doSplit() {
    if (sequence && selected) {
      try {
        change(
          applyVideoActions(
            sequence,
            [{ kind: "video.split" }],
            [selected],
            playhead,
            project?.assets || [],
          ),
        );
      } catch (error) {
        notify(error);
      }
    }
  }
  function doRemove() {
    if (sequence && selected) {
      // Refus dit tout haut : le plan restait sans un mot, désélectionné, et
      // une annulation vide entrait dans l'historique.
      if (
        linkedClips(sequence, selected).some((c) =>
          verrouillee(sequence, c.track),
        )
      ) {
        notify(DEVERROUILLEZ);
        return;
      }
      if (change(remove(sequence, selected))) setSelected("");
    }
  }
  async function flushPilot() {
    if (saveError)
      throw Error(
        "Reprenez l’enregistrement du montage avant une nouvelle commande.",
      );
    await drain();
    for (let i = 0; i < 100 && (working.current || pending.current); i++)
      await new Promise((r) => setTimeout(r, 20));
    if (working.current || pending.current)
      throw Error(
        "L’enregistrement est encore en cours. Relancez la commande dans un instant.",
      );
  }
  async function capturePilot(): Promise<PilotContext> {
    const projectId = pRef.current?.id,
      sequenceId = sRef.current?.id;
    await flushPilot();
    const p = pRef.current,
      s = sRef.current;
    if (!p || !s || p.id !== projectId || s.id !== sequenceId)
      throw Error("Ouvrez la séquence à modifier.");
    return {
      domain: "video",
      projectId: p.id,
      label: p.name + " · " + s.name,
      ids: {
        current: selected ? [selected] : [],
        selection: selected ? [selected] : [],
        album: s.clips.map((c) => c.id),
        kept: [],
      },
      sequence: {
        ...structuredClone(s),
        version: versions.current[s.id] || s.version || 1,
      },
      assets: structuredClone(p.assets),
      frame: playRef.current,
    };
  }
  async function showPilotSequence(projectId: string, next: Sequence) {
    if (!api || pRef.current?.id !== projectId) return;
    const p = await api.project(projectId);
    const saved = p.sequences.find((s) => s.id === next.id) || next;
    versions.current = Object.fromEntries(
      p.sequences.map((s) => [s.id, s.version || 1]),
    );
    setProject(p);
    pRef.current = p;
    if (sRef.current) pushHistory(history.current, sRef.current);
    future.current = [];
    show(saved);
    setSelected((id) => (saved.clips.some((c) => c.id === id) ? id : ""));
    setPlaying(false);
  }
  async function restorePilot(
    record: CommandRecord,
    redo: boolean,
  ): Promise<string> {
    await flushPilot();
    const id = pRef.current?.id;
    if (!api || !id) throw Error("Projet introuvable.");
    pilotSaving.current = true;
    try {
      const result = await api.restoreCommand({
        projectId: id,
        id: record.id,
        redo,
      });
      await showPilotSequence(id, result.sequence);
    } finally {
      pilotSaving.current = false;
    }
    return redo
      ? "Commande rétablie et enregistrée."
      : "Commande annulée et enregistrée.";
  }
  async function runPilot(plan: Plan, context: PilotContext): Promise<string> {
    if (!api || !context.sequence || !context.assets)
      throw Error("Ouvrez une séquence vidéo.");
    const s = context.sequence,
      assets = context.assets,
      a = plan.actions[0];
    if (a.kind === "history.undo" || a.kind === "history.redo") {
      const redo = a.kind === "history.redo";
      const record = pilotRecord(
        await api.commandHistory({
          projectId: context.projectId,
          sequenceId: s.id,
        }),
        redo,
      );
      if (!record)
        return "Aucune commande à " + (redo ? "rétablir." : "annuler.");
      try {
        return await restorePilot(record, redo);
      } catch (error) {
        // Le montage a été repris depuis : rien n'a changé, et le pilote le dit.
        if (error instanceof Error && nothingRestored(error.message))
          return error.message;
        throw error;
      }
    }
    if (a.kind === "video.seek") {
      if (!Number.isFinite(a.seconds) || a.seconds < 0 || a.seconds > 7200)
        throw Error("Précisez une position entre 0 seconde et 2 heures.");
      const wanted = Math.round(a.seconds * fps(s));
      if (seek(wanted) < wanted) {
        const live = sRef.current ?? s,
          total = length(live);
        return total
          ? "Le film dure " +
              (total / fps(live)).toFixed(1) +
              " s : curseur placé sur sa dernière image."
          : "Le montage est vide : curseur placé au début.";
      }
      return "Curseur déplacé à " + a.seconds + " s.";
    }
    if (a.kind === "media.search") {
      setSearch(a.query);
      setPanel("media");
      return "Recherche par nom : " + a.query;
    }
    if (a.kind === "export.open") {
      setDialog("export");
      return "Choisissez le format et la destination dans l’export.";
    }
    if (a.kind === "import.open") {
      await api.import(context.projectId);
      await refresh();
      return "Importation ajoutée aux tâches.";
    }
    if (a.kind === "video.analyze" || a.kind === "video.transcribe") {
      const clipIds = context.ids[plan.scope];
      const ids =
        plan.scope === "album"
          ? assets.map((a) => a.id)
          : [
              ...new Set(
                s.clips
                  .filter((c) => clipIds.includes(c.id))
                  .map((c) => c.assetId),
              ),
            ];
      if (!ids.length)
        throw Error(
          "Choisissez Tout le projet ou sélectionnez un plan à analyser.",
        );
      if (a.kind === "video.analyze")
        await api.analyze({ projectId: context.projectId, ids });
      else
        await api.transcribe({
          projectId: context.projectId,
          ids,
          language: "fr",
        });
      await refresh();
      return "Traitement local ajouté à l’activité. Vous pouvez continuer le montage.";
    }
    if (a.kind === "video.derush") {
      const ids = assets.filter((x) => x.kind === "video").map((x) => x.id);
      if (!ids.length) throw Error("Importez d’abord des rushes vidéo.");
      await api.derush({ projectId: context.projectId, ids });
      await refresh();
      setPanel("derush");
      return "Dérushage lancé : les rushes déjà dérushés ne sont pas relus. Les résultats arrivent dans l’onglet Dérush.";
    }
    if (a.kind === "video.premontage") {
      const rushes = assets.filter((x) => x.kind === "video");
      if (!rushes.some((x) => x.derush))
        throw Error(
          "Aucun rush n’est encore dérushé : le pré-montage prendrait les rushes entiers. Attendez la fin du dérushage, ou dites « dérushe les rushes ».",
        );
      const fait = preMonter(rushes);
      if (!fait)
        throw Error(
          "Le pré-montage n’a pas été créé : voyez le message affiché.",
        );
      return fait;
    }
    if (a.kind === "video.autocolor") {
      await api.autoColor({ projectId: context.projectId, sequence: s });
      await refresh();
      return "Harmonisation lancée dans une nouvelle version de la séquence.";
    }
    if (a.kind === "video.track") {
      // Tracking reads the stored clip, so the mask must already be saved.
      const id = context.ids[plan.scope][0];
      const clip = s.clips.find((c) => c.id === id);
      const mask = clip?.masks?.[0];
      if (!clip || !mask)
        throw Error("Ajoutez d’abord un masque sur le plan à suivre.");
      if (verrouillee(s, clip.track)) throw Error(DEVERROUILLEZ);
      await flushPilot();
      await api.trackMask({
        projectId: context.projectId,
        clipId: clip.id,
        maskId: mask.id,
        sequence: structuredClone(s),
      });
      await refresh();
      return "Suivi du masque lancé. Juno remplira ses repères dans l’activité.";
    }
    let next: Sequence;
    if (a.kind === "video.assemble")
      next = assembleVideo(s, assets, a.seconds, a.vertical);
    else if (a.kind === "video.duplicate")
      next = {
        ...structuredClone(s),
        id: crypto.randomUUID(),
        version: 1,
        name: s.name.slice(0, 160) + " · Variante",
        created: Date.now(),
      };
    else if (a.kind === "video.caption")
      next = captionsFromTranscript(s, assets);
    else if (plan.actions.every((a) => a.kind.startsWith("video.")))
      next = applyVideoActions(
        s,
        plan.actions as VideoAction[],
        context.ids[plan.scope],
        context.frame || 0,
        assets,
      );
    else throw Error("Cette commande ne s’applique pas à l’espace vidéo.");
    next = fitTransitions(next);
    await flushPilot();
    if (next.id === s.id && versions.current[s.id] !== s.version)
      throw Error(
        "La séquence a changé pendant la consigne. Vos modifications sont conservées ; relancez-la.",
      );
    // Du dernier contrôle à l'affichage du résultat, aucun geste n'est pris :
    // fait sur la séquence d'avant la commande, il était refusé comme un
    // conflit, disparaissait de l'écran, et « Réessayer » l'enregistrait
    // ensuite par-dessus la commande, défaite sans un mot.
    pilotSaving.current = true;
    try {
      const result = await api.saveSequence({
        projectId: context.projectId,
        sequence: next,
        expectedVersion: next.id === s.id ? s.version || 1 : 0,
        command: { id: plan.id, label: plan.label, source: plan.source },
      });
      next.version = result.version;
      await showPilotSequence(context.projectId, next);
    } finally {
      pilotSaving.current = false;
    }
    return a.kind === "video.assemble"
      ? `Nouvel assemblage éditable : ${(length(next) / fps(next)).toFixed(1)} s. Les plans disponibles ont été répartis ; la narration et le cadrage restent à affiner.`
      : "Commande appliquée et enregistrée. Annulation disponible dans l’historique.";
  }
  /**
   * Pose un média dans le montage. Un rush dérushé n'apporte que ses
   * morceaux utiles (ses passages masqués restent dans le rush, à un clic) ;
   * `entier` le pose en entier, comme Maj + clic dans la bibliothèque.
   */
  function append(id: string, start?: number, track?: number, entier = false) {
    const a = pRef.current?.assets.find((a) => a.id === id),
      base = sRef.current;
    if (base && a) {
      const at = start ?? length(base),
        piste = track ?? (a.kind === "audio" ? 10 : 0),
        r = entier
          ? { sequence: addClip(base, a, at, piste), plans: 1, laisse: 0 }
          : ajouterUtiles(base, a, at, piste);
      const pourquoi = [
        ...new Set(
          passages(a.derush)
            .filter((p) => p.etat === "masque")
            .flatMap((p) => p.raisons),
        ),
      ]
        .map((r) => raisonLue(r).toLocaleLowerCase("fr"))
        .join(", ");
      if (!r.plans) {
        notify(
          `Ce rush est entièrement masqué (${pourquoi}) : rien n’a été ajouté. Maj + clic le pose quand même, ou revoyez-le dans l’onglet Dérush.`,
        );
        return;
      }
      const addedId = r.sequence.clips[base.clips.length]?.id;
      const incoming = r.sequence.clips
        .slice(base.clips.length)
        .filter((c) => c.track < 10 && c.component !== "audio")
        .map((c) => c.id);
      let next: Sequence;
      try {
        next = overwriteVideoTrack(r.sequence, incoming);
      } catch (error) {
        notify(error);
        return;
      }
      if (!change(next)) return;
      const added = next.clips.find((c) => c.id === addedId);
      if (added) {
        setSelected(added.id);
        setPlayhead(added.start);
      }
      if (r.laisse > 0)
        notify(
          `${r.plans} passage${r.plans > 1 ? "s" : ""} ajouté${r.plans > 1 ? "s" : ""}, ${mmss(r.laisse)} laissée${r.laisse >= 2 ? "s" : ""} de côté (${pourquoi}). Maj + clic pose le rush entier.`,
        );
    }
  }
  /** Depuis le dérush : un passage, ou les morceaux utiles, au bout du montage. */
  function ajouterDuDerush(a: Asset, morceau?: { debut: number; fin: number }) {
    const base = sRef.current;
    if (!base) return;
    if (!morceau) {
      append(a.id);
      return;
    }
    const next = addClip(base, a, length(base));
    const images = Math.max(
      1,
      Math.floor((morceau.fin - morceau.debut) * fps(base) + 1e-6),
    );
    for (const c of next.clips.slice(base.clips.length)) {
      c.inUs = Math.round(morceau.debut * 1e6);
      c.duration = images;
    }
    if (change(next))
      notify(
        `Passage ajouté au bout du montage (${mmss(morceau.fin - morceau.debut)}).`,
      );
  }
  /**
   * Le pré-montage : une nouvelle séquence avec les morceaux utiles des
   * rushes donnés, dans l'ordre de la journée. La séquence en cours ne bouge
   * pas ; elle reste dans la liste des séquences.
   */
  function preMonter(assets: Asset[]): string | null {
    const courante = sRef.current;
    if (!courante || !project) return null;
    // Comme pour changer de séquence : jamais pendant un enregistrement, qui
    // perdrait le dernier geste du montage ouvert.
    if (working.current || pending.current || saveError) {
      notify(
        saveError
          ? "Le montage ouvert n’est pas enregistré : réglez l’enregistrement avant de pré-monter."
          : "Votre montage s’enregistre : refaites « Pré-monter » dans un instant.",
      );
      return null;
    }
    if (project.sequences.length >= 100) {
      notify(
        "Ce projet a déjà 100 séquences : retirez-en une pour pré-monter.",
      );
      return null;
    }
    // Le format du film, pas celui d'une version verticale ouverte par hasard.
    const base =
      courante.width >= courante.height
        ? courante
        : (project.sequences.find((x) => x.width >= x.height) ?? courante);
    const s = preMontage(
      base,
      assets,
      "Pré-montage · " + new Date().toLocaleDateString("fr-FR"),
    );
    if (!s.clips.length) {
      notify("Rien à pré-monter : aucun passage utile dans ces rushes.");
      return null;
    }
    versions.current[s.id] = 0;
    if (!change(s, false)) return null;
    // Une autre séquence s'ouvre : l'annulation repart de zéro, comme quand
    // on en choisit une dans la liste.
    history.current = [];
    future.current = [];
    setSelected("");
    setPanel("media");
    seek(0);
    const plans = s.clips.filter(
        (c) => c.track < 10 && c.component !== "audio",
      ).length,
      entiers = assets.filter(
        (a) => a.kind === "video" && a.status === "ready" && !a.derush,
      ).length;
    const message =
      `Pré-montage créé : ${plans} plan${plans > 1 ? "s" : ""}, ${mmss(length(s) / fps(s))}, dans l’ordre de la journée. Votre montage précédent est gardé dans la liste des séquences.` +
      (entiers
        ? ` ${entiers} rush${entiers > 1 ? "es" : ""} pas encore dérushé${entiers > 1 ? "s y sont" : " y est"} en entier.`
        : "");
    notify(message);
    return message;
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      // Dans l'onglet Dérush, la timeline n'est pas l'objet du travail :
      // espace, flèches, couper, supprimer, annuler n'y agissent pas (le
      // lecteur de passage a ses propres touches).
      if (panel === "derush") return;
      if (
        (e.target as HTMLElement)?.closest(
          "input,textarea,select,dialog,[contenteditable]",
        )
      )
        return;
      if (
        (e.key === " " || e.key === "Enter") &&
        (e.target as HTMLElement)?.closest("button")
      )
        return;
      if (e.code === "Space") {
        e.preventDefault();
        if (sequence && length(sequence)) {
          resumeAudio();
          if (playhead >= length(sequence) - 1) setPlayhead(0);
          setPlaying((p) => !p);
        }
      }
      const delta = arrowStep(e);
      if (delta) {
        e.preventDefault();
        step(delta);
      }
      if (e.key.toLowerCase() === "s" && !e.metaKey && !e.ctrlKey) doSplit();
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        doRemove();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [sequence, selected, playhead, panel]);
  async function create() {
    if (!api || !name.trim()) return;
    const p = await api.create({
      name: name.trim(),
      photoProjectId: localStorage.getItem("juno-project") || undefined,
    });
    setDialog(null);
    setName("");
    await refresh();
    await openProject(p.id);
  }
  async function duplicateSequence(vertical = false) {
    if (!sequence || !project || !api || working.current || pending.current)
      return;
    // Les titres suivent la nouvelle définition, comme au changement de
    // définition : sinon un grand titre 6K bloquait la copie verticale.
    const s = {
      ...changeDefinition(
        structuredClone(sequence),
        vertical ? verticalQuality : sequence.width,
        vertical ? Math.round((verticalQuality * 16) / 9) : sequence.height,
      ),
      id: crypto.randomUUID(),
      name: sequence.name + (vertical ? " · Vertical" : " · Version"),
      version: 1,
    };
    await api.saveSequence({
      projectId: project.id,
      sequence: s,
      expectedVersion: 0,
    });
    versions.current[s.id] = 1;
    setProject(await api.project(project.id));
    show(s);
    history.current = [];
    future.current = [];
    seek(0);
  }
  async function prepareOverlays(s: Sequence) {
    if (!api || !project) return [];
    const out = [];
    let total = s.titles.length;
    for (const c of s.captions) {
      total += captionRuns(c, s).length;
      if (total > 20000)
        throw Error(
          "Trop d’étapes de sous-titres pour un seul export. Divisez le film en plusieurs séquences.",
        );
    }
    await document.fonts.ready;
    function* elements() {
      yield* s.titles;
      for (const c of s.captions) yield* captionRuns(c, s);
    }
    for (const t of elements()) {
      if (out.length >= 20000)
        throw Error(
          "Trop d’étapes de sous-titres pour un seul export. Divisez le film en plusieurs séquences.",
        );
      const { canvas, placement } = rasterTitle(t, s);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(Error("Titre non rendu"))),
          "image/png",
        ),
      );
      const id = await api.overlay({
        projectId: project.id,
        bytes: await blob.arrayBuffer(),
      });
      out.push({
        id,
        start: t.start,
        duration: t.duration,
        placement,
        motionOrigin: t.motionOrigin,
      });
    }
    return out;
  }
  /** Each mask ships the shape Juno drew for it, alpha included. */
  async function prepareMaskImages(s: Sequence) {
    const images: Record<string, string> = {};
    if (!api || !project) return images;
    for (const clip of s.clips)
      for (const mask of clip.masks || []) {
        const blob = await new Promise<Blob>((resolve, reject) =>
          maskCanvas(mask, s).toBlob(
            (b) => (b ? resolve(b) : reject(Error("Masque non rendu"))),
            "image/png",
          ),
        );
        images[mask.id] = await api.overlay({
          projectId: project.id,
          bytes: await blob.arrayBuffer(),
        });
      }
    return images;
  }
  /**
   * Les masques d'un plan, depuis le panneau ou la poignée du moniteur. Rend
   * `false` quand ils sont refusés : le champ reprend la vraie valeur.
   */
  function changeMasks(clipId: string, masks: Mask[]): boolean {
    if (!sequence) return false;
    const target = sequence.clips.find((c) => c.id === clipId);
    if (target && verrouillee(sequence, target.track)) {
      notify(DEVERROUILLEZ);
      return false;
    }
    return change({
      ...sequence,
      clips: sequence.clips.map((c) =>
        c.id === clipId ? { ...c, masks: masks.length ? masks : undefined } : c,
      ),
    });
  }
  /**
   * Les plans de ce média posés sur une piste verrouillée, dans toutes les
   * séquences du film : le profil de la source appartient au média, et il
   * change le rendu de chacun de ses plans.
   */
  function lockedUses(assetId: string) {
    const live = sRef.current;
    let n = 0;
    for (const s of [
      live,
      ...(pRef.current?.sequences ?? []).filter((x) => x.id !== live?.id),
    ])
      for (const c of s?.clips ?? [])
        if (
          s &&
          c.assetId === assetId &&
          c.component !== "audio" &&
          c.track < 10 &&
          verrouillee(s, c.track)
        )
          n++;
    return n;
  }
  /**
   * « Profil de la source » : un réglage du média, partagé par tous ses plans.
   * Il reste permis (il corrige la lecture du fichier, pas un geste de
   * montage), mais quand l'un de ces plans est sur une piste verrouillée,
   * rien n'est envoyé avant une confirmation qui dit combien. Sans elle, le
   * rendu d'un plan verrouillé changeait sans un mot.
   */
  function chooseSpace(a: Asset, inputSpace: string, confirmed = false) {
    if (!api || !project) return;
    const locked = lockedUses(a.id);
    if (locked && !confirmed) {
      setSpaceChoice({ assetId: a.id, inputSpace, name: a.name, locked });
      return;
    }
    setSpaceChoice(null);
    void api
      .space({ projectId: project.id, assetId: a.id, inputSpace })
      .then(refresh)
      .catch(notify);
  }
  /** The tracker reads the real media, so it runs as a job like transcription. */
  async function trackMask(target: Clip, mask: Mask) {
    if (!api || !project || !sequence) return;
    // Le suivi écrit ses repères sur le plan enregistré, sans repasser par le
    // montage : une piste verrouillée ne le lance pas.
    const live = sRef.current ?? sequence,
      current = live.clips.find((c) => c.id === target.id) ?? target;
    if (verrouillee(live, current.track)) {
      notify(DEVERROUILLEZ);
      return;
    }
    setTrackingMask(target.id);
    try {
      await drain();
      const job = await api.trackMask({
        projectId: project.id,
        clipId: target.id,
        maskId: mask.id,
        sequence: structuredClone(sRef.current ?? sequence),
      });
      notify(
        "Suivi lancé. Juno remplira les repères du masque et vous préviendra.",
      );
      await refresh();
      void job;
    } catch (e) {
      notify(e);
    } finally {
      setTrackingMask("");
    }
  }
  async function exportFilm() {
    if (!api || !project || !sequence) return;
    setExportBusy(true);
    setExportError("");
    try {
      const frozen = structuredClone(sequence),
        overlays = await prepareOverlays(frozen),
        maskImages = await prepareMaskImages(frozen);
      const job = await api.export({
        projectId: project.id,
        sequence: frozen,
        codec,
        overlays,
        maskImages,
        loudness: loudness || null,
      });
      if (job) {
        setDialog(null);
        window.dispatchEvent(new Event("juno-open-activity"));
        await refresh();
        notify("Export ajouté aux tâches. Vous pouvez continuer le montage.");
      }
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e));
      notify(e);
    } finally {
      setExportBusy(false);
    }
  }
  async function openReviewSource(
    asset: ReviewAsset,
    anchor: ReviewThread["anchor"],
    instruction?: string,
  ) {
    if (asset.kind === "photo") {
      sessionStorage.setItem(
        "juno-review-open",
        JSON.stringify({ asset, anchor, instruction }),
      );
      localStorage.setItem("juno-project", asset.metadata.projectId);
      setDialog(null);
      onPhoto();
      return;
    }
    await drain();
    if (pending.current || working.current)
      throw Error(
        "Enregistrez les changements du montage avant d’ouvrir ce retour.",
      );
    await selectSequence(asset.metadata.sourceId, asset.metadata.projectId);
    const current = sRef.current,
      published = asset.metadata.snapshot?.sequence as Sequence | undefined;
    if (!current) throw Error("Montage source introuvable.");
    if (anchor.frame != null) {
      const mapped = published?.clips
        ? mapReviewFrame(published, current, anchor.frame)
        : null;
      if (mapped == null)
        notify(
          "Le montage a changé : consultez la version publiée pour retrouver exactement ce passage.",
        );
      else seek(mapped);
    }
    setDialog(null);
    if (instruction)
      setTimeout(
        () =>
          window.dispatchEvent(
            new CustomEvent("juno-pilot-propose", {
              detail: {
                text: instruction,
                domain: "video",
                projectId: asset.metadata.projectId,
              },
            }),
          ),
        150,
      );
  }
  useEffect(() => {
    if (!project || working.current || pending.current) return;
    const raw = sessionStorage.getItem("juno-review-open");
    if (!raw) return;
    try {
      const value = JSON.parse(raw);
      if (value.asset?.kind === "video") {
        sessionStorage.removeItem("juno-review-open");
        void openReviewSource(
          value.asset,
          value.anchor || {},
          value.instruction,
        ).catch(notify);
      }
    } catch {
      sessionStorage.removeItem("juno-review-open");
    }
  }, [project?.id, saving]);
  useEffect(() => {
    const show = () => setDialog("review-client");
    window.addEventListener("juno-open-review", show);
    return () => window.removeEventListener("juno-open-review", show);
  }, []);
  function changeRate(value: string) {
    if (!sequence) return;
    // La lecture compte ses images depuis la tête de départ, à l'ancienne
    // cadence : elle s'arrête, et la tête est convertie par show().
    setPlaying(false);
    const [n, d] = value.split("/").map(Number),
      ratio = n / d / fps(sequence),
      convert = (v: number) => Math.round(v * ratio);
    const converted: Sequence = {
      ...sequence,
      fps: { n, d },
      clips: sequence.clips.map((c) => {
        const duration = Math.max(1, convert(c.duration));
        return {
          ...c,
          start: convert(c.start),
          duration,
          fadeIn: Math.min(duration, convert(c.fadeIn)),
          fadeOut: Math.min(duration, convert(c.fadeOut)),
          animation: retimeAnimation(c.animation, 0, ratio),
          masks: retimeMasks(c, 0, ratio, duration),
          // Une transition garde sa durée en secondes, bornée par son plan.
          transition: c.transition
            ? fitTransition(
                {
                  ...c.transition,
                  duration: Math.max(1, convert(c.transition.duration)),
                },
                duration,
              )
            : undefined,
        };
      }),
      titles: sequence.titles.map((t) => ({
        ...t,
        motion: retimeAnimation(t.motion, 0, ratio),
        start: convert(t.start),
        duration: Math.max(1, convert(t.duration)),
      })),
      captions: sequence.captions.map((t) => ({
        ...t,
        words: t.words
          ?.map((w) => ({ ...w, start: convert(w.start), end: convert(w.end) }))
          .filter((w) => w.end > w.start),
        start: convert(t.start),
        duration: Math.max(1, convert(t.duration)),
      })),
      markers: sequence.markers.map((m) => ({ ...m, frame: convert(m.frame) })),
    };
    change(converted, true, true);
  }
  function assembleScenes(a: Asset) {
    if (!sequence) return;
    const cuts = [0, ...(a.analysis?.scenes || []), a.duration].filter(
      (t, i, arr) => i === 0 || t - arr[i - 1] > 0.15,
    );
    let s = sequence;
    for (let i = 0; i < cuts.length - 1; i++) {
      const next = addClip(s, a, length(s));
      for (const c of next.clips.slice(s.clips.length)) {
        c.inUs = Math.round(cuts[i] * 1e6);
        c.duration = Math.max(1, frame(cuts[i + 1] - cuts[i], s));
      }
      s = next;
    }
    if (change(s))
      notify("Plans ajoutés à partir des changements de scène détectés.");
  }
  /**
   * Monter les moments forts entendus dans un rush.
   *
   * Chaque extrait commence un peu avant le pic : on applaudit après le
   * baiser, et c'est le baiser qu'on veut voir.
   */
  function assembleMoments(a: Asset) {
    if (!sequence) return;
    const morceaux = extraits(a.analysis?.moments || [], a.duration);
    if (!morceaux.length) return;
    let s = sequence;
    for (const e of morceaux) {
      const next = addClip(s, a, length(s));
      for (const c of next.clips.slice(s.clips.length)) {
        c.inUs = Math.round(e.start * 1e6);
        c.duration = Math.max(1, frame(e.end - e.start, s));
      }
      s = next;
    }
    if (!change(s)) return;
    notify(
      morceaux.length > 1
        ? `${morceaux.length} moments forts ajoutés, chacun pris un peu avant le pic sonore pour montrer ce qui l’a provoqué.`
        : "Moment fort ajouté, pris un peu avant le pic sonore pour montrer ce qui l’a provoqué.",
    );
  }
  // Le type de plan des rushes dérushés, relevé en fond (visages).
  const plansAClasser = useClassementDesPlans(project ?? undefined, api);
  const media = useMemo(
    () =>
      project?.assets.filter(
        (a) =>
          a.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()) &&
          (mediaFilter === "all" || a.kind === mediaFilter),
      ) || [],
    [project?.assets, search, mediaFilter],
  );
  useEffect(() => setMediaPage(0), [project?.id, search, mediaFilter]);
  const mediaLastPage = Math.max(0, Math.ceil(media.length / 80) - 1);
  const mediaDisplayPage = Math.min(mediaPage, mediaLastPage);
  const commands: CommandAction[] = [
    { id: "new", label: "Nouveau film", run: () => setDialog("new") },
    {
      id: "import",
      label: "Importer des médias",
      disabled: !project || !api,
      run: () => void api?.import(project!.id).then(refresh).catch(notify),
    },
    {
      id: "export",
      label: "Exporter le film",
      disabled: !sequence?.clips.length || saving || !!saveError,
      run: () => setDialog("export"),
    },
    {
      id: "multicam",
      label: "Montage multicaméra",
      disabled: !project?.assets.length,
      run: () => setDialog("multicam"),
    },
    {
      id: "color",
      label: "Couleur et styles Juno",
      run: () => setPanel("color"),
    },
    { id: "sound", label: "Son et mixage", run: () => setPanel("audio") },
    {
      id: "system",
      label: "État du studio et codecs",
      run: () => setDialog("system"),
    },
    {
      id: "photo",
      label: "Ouvrir le studio photo",
      disabled: saving || !!saveError,
      run: onPhoto,
    },
    ...projects.map((p) => ({
      id: "project-" + p.id,
      label: p.name,
      detail: "Ouvrir le film",
      disabled: saving || !!saveError,
      run: () => void openProject(p.id).catch(notify),
    })),
  ];
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k" && !dialog) {
        e.preventDefault();
        setCommandsOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [dialog]);
  return (
    <div
      className={`vf-app vf-refined workbench ${panel === "titles" ? "titles-open" : ""} ${drawer ? "drawer-open" : ""} ${libraryOpen ? "library-open" : ""} ${!workspaceLayout.layout.inspector ? "settings-hidden" : ""} ${workspaceLayout.layout.focus ? "layout-focus" : ""}`}
      style={workspaceLayout.style}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (!project || !e.dataTransfer.files.length || !window.juno) return;
        void window.juno
          .registerDroppedMedia(Array.from(e.dataTransfer.files))
          .then((items) =>
            api!.importRegistered({
              ids: items.map((i) => i.id),
              projectId: project.id,
            }),
          )
          .then(refresh)
          .catch(notify);
      }}
    >
      {commandsOpen && (
        <CommandMenu
          dark
          actions={commands}
          onClose={() => setCommandsOpen(false)}
        />
      )}
      {dialog === "system" && (
        <Dialog title="État du studio" onClose={() => setDialog(null)}>
          <SystemPanel />
        </Dialog>
      )}
      {drawer && (
        <button
          className="drawer-backdrop"
          aria-label="Fermer la navigation"
          onClick={() => setDrawer(false)}
        />
      )}
      <aside
        className="vf-sidebar"
        inert={!drawer}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest(".vf-projects button"))
            setDrawer(false);
        }}
      >
        <button
          className="vf-brand"
          onClick={onPhoto}
          disabled={saving || !!saveError}
        >
          <span>j.</span>
          <div>
            juno<small>STUDIO VIDÉO</small>
          </div>
        </button>
        <div className="workspace-switch" aria-label="Espace de travail">
          <button onClick={onPhoto} disabled={saving || !!saveError}>
            Photo
          </button>
          <button className="active" aria-pressed="true">
            Vidéo
          </button>
        </div>
        <button className="quick-access" onClick={() => setCommandsOpen(true)}>
          Accès rapide{" "}
          <kbd>
            {navigator.platform.toLowerCase().includes("mac")
              ? "⌘ K"
              : "Ctrl K"}
          </kbd>
        </button>
        <div className="vf-side-title">
          MES FILMS
          <button
            aria-label="Nouveau film"
            disabled={saving || !!saveError}
            onClick={() => setDialog("new")}
          >
            <Plus size={16} />
          </button>
        </div>
        <input
          className="vf-project-search"
          aria-label="Rechercher un film"
          placeholder="Rechercher un film"
          value={filmSearch}
          onChange={(e) => setFilmSearch(e.target.value)}
        />
        <div className="vf-projects">
          {projects
            .filter((p) =>
              p.name
                .toLocaleLowerCase()
                .includes(filmSearch.toLocaleLowerCase()),
            )
            .map((p) => (
              <button
                key={p.id}
                className={p.id === project?.id ? "active" : ""}
                disabled={saving || !!saveError}
                onClick={() => void openProject(p.id).catch(notify)}
              >
                <Film size={17} />
                <span>
                  {p.name}
                  <small>
                    {p.count} média{p.count !== 1 ? "s" : ""}
                  </small>
                </span>
              </button>
            ))}
        </div>
        <button
          className="vf-new"
          onClick={() => setDialog("new")}
          disabled={!api || saving || !!saveError}
        >
          <FolderPlus size={16} />
          Nouveau film
        </button>
        <button
          className="vf-back"
          disabled={!api || saving || !!saveError}
          onClick={() =>
            void api
              ?.restore()
              .then(async (p) => {
                if (p) {
                  await refresh();
                  await openProject(p.id);
                }
              })
              .catch(notify)
          }
        >
          <Upload size={15} />
          Ouvrir un projet vidéo
        </button>
        <button className="vf-back" onClick={() => setDialog("system")}>
          État du studio et codecs
        </button>
        <div className="vf-local">
          <span className="vf-dot" />
          Montage local<small>Vos originaux restent sur vos disques.</small>
        </div>
        <button
          className="vf-back"
          disabled={!project || saving || !!saveError}
          onClick={() =>
            project &&
            void api
              ?.backup(project.id)
              .then(
                (ok) =>
                  ok &&
                  notify(
                    "Copie du projet enregistrée. Les originaux restent à leur emplacement.",
                  ),
              )
              .catch(notify)
          }
        >
          <Save size={15} />
          Copie du projet
        </button>
      </aside>
      {dialog === "multicam" && project && sequence && (
        <MulticamPanel
          project={project}
          sequence={sequence}
          onClose={() => setDialog(null)}
          onRefresh={refresh}
          onError={notify}
          onSequence={(s) => {
            versions.current[s.id] = s.version || 1;
            show(s);
            setSelected("");
            seek(0);
            history.current = [];
            future.current = [];
          }}
        />
      )}
      {dialog === "history" && project && (
        <Dialog title="Versions enregistrées" onClose={() => setDialog(null)}>
          <p>Récupérez une ancienne séquence dans une nouvelle version.</p>
          <div className="vf-history-list">
            {snapshots.length === 0 && (
              <p>Aucune version antérieure pour le moment.</p>
            )}
            {snapshots.map((item) => (
              <article key={item.revision}>
                <small>
                  {item.illisible
                    ? `Révision ${item.revision} · fichier abîmé`
                    : `${new Date(item.updated).toLocaleString("fr-FR")} · révision ${item.revision}`}
                </small>
                {item.illisible && (
                  <p className="micro-note">
                    Cette version ne peut pas être relue. Les autres restent
                    utilisables.
                  </p>
                )}
                {item.sequences.map((s) => (
                  <button
                    key={s.id}
                    onClick={() =>
                      void api
                        ?.history({
                          projectId: project.id,
                          revision: item.revision,
                          sequenceId: s.id,
                        })
                        .then(async (r) => {
                          if (r.sequence) {
                            await refresh();
                            versions.current[r.sequence.id] =
                              r.sequence.version || 1;
                            show(r.sequence);
                            setSelected("");
                            seek(0);
                            history.current = [];
                            future.current = [];
                            setDialog(null);
                          }
                        })
                        .catch(notify)
                    }
                  >
                    {s.name} · Récupérer
                  </button>
                ))}
              </article>
            ))}
          </div>
        </Dialog>
      )}
      {dialog === "generate" && project && (
        <GenerationPanel
          projectId={project.id}
          onClose={() => setDialog(null)}
          onQueued={async () => {
            window.dispatchEvent(new Event("juno-open-activity"));
            await refresh();
          }}
        />
      )}
      <main className="vf-main">
        <WorkbenchHeader
          domain="video"
          viewControls={
            <WorkspaceControls
              workspace={workspaceLayout}
              domain="video"
              onCommands={() => setCommandsOpen(true)}
            />
          }
          project={project?.name || ""}
          drawer={drawer}
          onDrawer={() => setDrawer((v) => !v)}
          disabled={saving || !!saveError}
          onPhotos={() => {
            if (project?.photoProjectId)
              localStorage.setItem("juno-project", project.photoProjectId);
            onPhoto();
          }}
          onMedia={() => {
            if (project?.photoProjectId) {
              localStorage.setItem("juno-project", project.photoProjectId);
              sessionStorage.setItem("juno-open-media", "true");
              onPhoto();
            } else setLibraryOpen((v) => !v);
          }}
          onVideo={() => setPanel("media")}
          onReview={() => setDialog("review-client")}
        >
          <JobPanel
            onVideoResult={(projectId, sequenceId) =>
              selectSequence(sequenceId, projectId)
            }
          />
          <Pilot
            domain="video"
            projectId={project?.id || ""}
            label={
              project
                ? `${project.name} · ${sequence?.name || "Séquence"} · ${selected ? "1 plan sélectionné" : "aucun plan sélectionné"}`
                : "Aucun projet ouvert"
            }
            capture={capturePilot}
            run={runPilot}
            onListen={() => setPlaying(false)}
            history={() =>
              api && project
                ? api.commandHistory({
                    projectId: project.id,
                    sequenceId: sequence?.id,
                  })
                : Promise.resolve([])
            }
            restore={restorePilot}
          />
        </WorkbenchHeader>
        {message && (
          <div className="workspace-status" role="status">
            {message}
            <button
              aria-label="Fermer la notification"
              onClick={() => setMessage("")}
            >
              <X size={15} />
            </button>
          </div>
        )}

        <header className="vf-header">
          <div>
            <span className="vf-eyebrow">VOTRE HISTOIRE, EN MOUVEMENT</span>
            <h1>{project?.name || "Le studio vidéo."}</h1>
          </div>
          <span className="vf-saved" role="status">
            {saving ? (
              <Loader2 size={13} className="spin" />
            ) : (
              <Check size={13} />
            )}{" "}
            {saveError ? (
              <button
                className="vf-warning"
                title={saveError}
                onClick={() => void drain()}
              >
                Échec d’enregistrement · Réessayer
              </button>
            ) : saving ? (
              "Enregistrement…"
            ) : (
              "Enregistré localement"
            )}
          </span>
          <button
            disabled={!project || !engine?.available}
            onClick={() =>
              project &&
              void api?.import(project.id).then(refresh).catch(notify)
            }
          >
            <Upload size={16} />
            Importer
          </button>
          <button disabled={!project} onClick={() => setDialog("generate")}>
            <Sparkles size={16} />
            Génération IA
          </button>
          <button
            disabled={!project}
            onClick={() => setDialog("review-client")}
          >
            <MessageSquare size={16} /> Retours clients
          </button>
          <button
            className="vf-primary"
            disabled={!sequence || !total || !engine?.available}
            onClick={() => {
              setExportError("");
              setDialog("export");
            }}
          >
            <Download size={16} />
            Exporter
          </button>
        </header>
        <nav className="vf-steps">
          <button
            aria-pressed={libraryOpen}
            onClick={() => setLibraryOpen((v) => !v)}
          >
            <Film size={16} /> Bibliothèque
          </button>
          {(
            [
              ["media", Film, "Médias & montage"],
              ["derush", ScanSearch, "Dérush"],
              ["color", Palette, "Couleur"],
              ["audio", Volume2, "Son"],
              ["transcript", Sparkles, "Texte & IA"],
              ["titles", Layers3, "Motion design"],
              ["masks", Crosshair, "Masques"],
              ["notes", MessageSquare, "Notes"],
            ] as const
          ).map(([p, Icon, label]) => (
            <button
              key={p}
              className={panel === p ? "active" : ""}
              onClick={() => setPanel(p)}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
          <span>VIDÉO · ALPHA</span>
        </nav>
        {saveError && (
          <div className="vf-save-alert" role="alert">
            <span>{saveError}</span>
            <button onClick={saveAsCopy}>
              Conserver dans une nouvelle version
            </button>
          </div>
        )}
        {engine?.error && (
          <div className="vf-save-alert" role="alert">
            {engine.error}
          </div>
        )}
        {!api ? (
          <div className="vf-empty">
            <Clapperboard size={46} />
            <h2>Ouvrez Juno Studio sur votre ordinateur.</h2>
            <p>
              Le montage vidéo utilise le moteur local de l’application Mac et
              Windows.
            </p>
          </div>
        ) : !project || !sequence ? (
          <div className="vf-empty">
            <Clapperboard size={46} />
            <h2>Un film commence ici.</h2>
            <p>
              Réunissez vos vidéos, vos images et vos sons.
              <br />
              Montez à votre rythme, même sans connexion.
            </p>
            <button
              className="vf-primary"
              disabled={saving || !!saveError}
              onClick={() => setDialog("new")}
            >
              <Plus size={17} />
              Créer mon premier film
            </button>
            {engine && !engine.available && (
              <p className="vf-warning">
                Le moteur vidéo n’est pas installé pour cette plateforme.
              </p>
            )}
          </div>
        ) : (
          <>
            {panel === "derush" ? (
              <DerushView
                project={project}
                jobs={jobs}
                api={api}
                plansAClasser={plansAClasser}
                focus={derushFocus}
                onAjouter={ajouterDuDerush}
                onPreMonter={preMonter}
                onNotify={notify}
                onRefresh={refresh}
              />
            ) : (
              <div className="vf-workspace">
                <section
                  className={`vf-library ${["titles", "transcript", "notes", "masks"].includes(panel) ? "specialized-library" : ""}`}
                >
                  <PanelResize
                    side="left"
                    width={workspaceLayout.layout.libraryWidth}
                    onChange={(width) =>
                      workspaceLayout.patch({ libraryWidth: width })
                    }
                  />
                  <div className="vf-panel-heading">
                    <h2>
                      {panel === "notes"
                        ? "Notes de montage"
                        : panel === "titles"
                          ? "Motion design"
                          : panel === "masks"
                            ? "Masques"
                            : panel === "transcript"
                              ? "Transcription"
                              : "Bibliothèque"}
                    </h2>
                    <span>{media.length}</span>
                  </div>
                  {panel === "masks" ? (
                    clip &&
                    asset &&
                    asset.kind !== "audio" &&
                    clip.track < 10 ? (
                      <MaskPanel
                        clip={clip}
                        sequence={sequence}
                        playhead={playhead}
                        selected={maskSelection}
                        onSelect={setMaskSelection}
                        tracking={trackingMask === clip.id}
                        onError={notify}
                        onChange={(masks) => changeMasks(clip.id, masks)}
                        onTrack={(mask) => void trackMask(clip, mask)}
                      />
                    ) : (
                      <div className="vf-inspector-empty">
                        <Crosshair size={26} />
                        <p>
                          Sélectionnez un plan vidéo dans la timeline pour y
                          cacher une zone.
                        </p>
                      </div>
                    )
                  ) : panel === "titles" ? (
                    <TitlesPanel
                      focusId={titleSelection}
                      onSelect={setTitleSelection}
                      sequence={sequence}
                      playhead={playhead}
                      onChange={change}
                      onSeek={seek}
                      onError={notify}
                    />
                  ) : panel === "transcript" ? (
                    <TranscriptPanel
                      onListen={() => setPlaying(false)}
                      assets={project.assets}
                      clip={clip}
                      sequence={sequence}
                      available={!!engine?.transcription}
                      onTranscribe={(id, language) =>
                        void api
                          .transcribe({
                            projectId: project.id,
                            ids: [id],
                            language,
                          })
                          .then(refresh)
                          .catch(notify)
                      }
                      onAdd={(a, start, end) => {
                        const next = addClip(sequence, a);
                        const c = next.clips[sequence.clips.length];
                        for (const member of next.clips.slice(
                          sequence.clips.length,
                        )) {
                          member.inUs = Math.round(start * 1e6);
                          member.duration = Math.max(
                            1,
                            frame(end - start, sequence),
                          );
                        }
                        if (!change(next)) return;
                        setSelected(c.id);
                        seek(c.start);
                      }}
                      onCaptions={(captions) =>
                        change({ ...sequence, captions })
                      }
                      onEdit={(a, segments) =>
                        void api
                          .transcript({
                            projectId: project.id,
                            assetId: a.id,
                            segments,
                          })
                          .then(refresh)
                          .catch(notify)
                      }
                    />
                  ) : panel === "notes" ? (
                    <>
                      <textarea
                        placeholder="Une note à ce timecode…"
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                      />
                      <button
                        className="vf-primary"
                        disabled={!comment.trim()}
                        onClick={() =>
                          void api
                            .comment({
                              projectId: project.id,
                              sequenceId: sequence.id,
                              frame: playhead,
                              text: comment.trim(),
                            })
                            .then(() => {
                              setComment("");
                              return refresh();
                            })
                            .catch(notify)
                        }
                      >
                        Ajouter à {timecode(playhead, sequence)}
                      </button>
                      <div className="vf-notes">
                        {project.comments
                          .filter((c) => c.sequenceId === sequence.id)
                          .map((c) => (
                            <button key={c.id} onClick={() => seek(c.frame)}>
                              <small>{timecode(c.frame, sequence)}</small>
                              {c.text}
                            </button>
                          ))}
                      </div>
                    </>
                  ) : (
                    <>
                      <input
                        className="vf-search"
                        aria-label="Rechercher un média"
                        placeholder="Rechercher un média…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                      <div
                        className="vf-media-filters"
                        aria-label="Types de médias"
                      >
                        {[
                          ["all", "Tous"],
                          ["video", "Vidéos"],
                          ["audio", "Sons"],
                          ["image", "Images"],
                        ].map(([value, label]) => (
                          <button
                            key={value}
                            aria-pressed={mediaFilter === value}
                            onClick={() => setMediaFilter(value)}
                          >
                            {label}
                          </button>
                        ))}
                        <small>{media.length}</small>
                      </div>
                      <div className="vf-media-grid">
                        {media
                          .slice(
                            mediaDisplayPage * 80,
                            (mediaDisplayPage + 1) * 80,
                          )
                          .map((a) => (
                            <div
                              key={a.id}
                              className="vf-media"
                              draggable
                              onDragStart={(e) =>
                                e.dataTransfer.setData("juno-video-asset", a.id)
                              }
                              onDoubleClick={(e) => {
                                if (
                                  !(e.target as HTMLElement).closest("button")
                                )
                                  append(
                                    a.id,
                                    undefined,
                                    undefined,
                                    e.shiftKey,
                                  );
                              }}
                            >
                              <button
                                className="vf-media-picture"
                                aria-label={"Ajouter " + a.name}
                                title={"Ajouter " + a.name}
                                onClick={(e) => {
                                  if (e.detail <= 1)
                                    append(
                                      a.id,
                                      undefined,
                                      undefined,
                                      e.shiftKey,
                                    );
                                }}
                              >
                                {a.thumbnail ? (
                                  <img src={a.thumbnail} loading="lazy" />
                                ) : a.kind === "audio" ? (
                                  <Music2 size={30} />
                                ) : (
                                  <Film size={30} />
                                )}
                                <span>
                                  {Math.floor(a.duration / 60)}:
                                  {String(Math.floor(a.duration) % 60).padStart(
                                    2,
                                    "0",
                                  )}
                                </span>
                                <i>
                                  <Plus size={15} />
                                </i>
                              </button>
                              {a.kind === "video" && a.derush && (
                                <BandeDerush asset={a} compacte />
                              )}
                              <b title={a.name}>{a.name}</b>
                              {a.status === "error" && (
                                <>
                                  <small className="vf-warning">
                                    Original indisponible
                                  </small>
                                  <button
                                    title={a.error}
                                    onClick={() =>
                                      void api
                                        .relink({
                                          projectId: project.id,
                                          assetId: a.id,
                                        })
                                        .then(refresh)
                                        .catch(notify)
                                    }
                                  >
                                    Retrouver le fichier
                                  </button>
                                </>
                              )}
                              <small>
                                {a.kind === "audio"
                                  ? "Audio"
                                  : `${a.width} × ${a.height}`}{" "}
                                · {a.kind === "image" ? "Image" : a.codec}
                              </small>
                              {a.kind === "video" && !a.spaceConfirmed && (
                                <em>Profil couleur à confirmer</em>
                              )}
                              {a.kind === "video" &&
                                a.derush &&
                                aDesMasques(a) && (
                                  <button
                                    className="vf-small-action vf-derush-lien"
                                    title="Revoir les passages masqués et à vérifier"
                                    onClick={() => {
                                      setDerushFocus(a.id);
                                      setPanel("derush");
                                    }}
                                  >
                                    {mmss(
                                      a.duration -
                                        resumeDerush(a.derush).masque,
                                    )}{" "}
                                    utiles · dérush
                                  </button>
                                )}
                              {a.analysis?.scenes?.length ? (
                                <button
                                  className="vf-small-action"
                                  onClick={() => assembleScenes(a)}
                                >
                                  {a.analysis.scenes.length + 1} scènes ·
                                  assembler
                                </button>
                              ) : null}
                              {a.analysis?.moments?.length ? (
                                <button
                                  className="vf-small-action"
                                  title="Les passages où le son ressort nettement : applaudissements, cris, rires, entrée de la musique"
                                  onClick={() => assembleMoments(a)}
                                >
                                  {a.analysis.moments.length} moment
                                  {a.analysis.moments.length > 1
                                    ? "s"
                                    : ""}{" "}
                                  fort
                                  {a.analysis.moments.length > 1 ? "s" : ""} ·
                                  assembler
                                </button>
                              ) : null}
                            </div>
                          ))}
                      </div>
                      {media.length > 80 && (
                        <div className="vf-media-pages">
                          <button
                            disabled={!mediaDisplayPage}
                            onClick={() => setMediaPage(mediaDisplayPage - 1)}
                          >
                            Précédent
                          </button>
                          <span>
                            {mediaDisplayPage + 1} / {mediaLastPage + 1}
                          </span>
                          <button
                            disabled={mediaDisplayPage >= mediaLastPage}
                            onClick={() => setMediaPage(mediaDisplayPage + 1)}
                          >
                            Suivant
                          </button>
                        </div>
                      )}
                      {!media.length && (
                        <div className="vf-library-empty">
                          <Upload size={27} />
                          <p>
                            {project.assets.length
                              ? "Aucun média ne correspond à ces filtres."
                              : "Importez vos premiers médias."}
                          </p>
                          <small>
                            Glissez ensuite les plans sur la timeline.
                          </small>
                        </div>
                      )}
                      <button
                        className="vf-analyze"
                        disabled={!project.assets.length}
                        onClick={() =>
                          void api
                            .analyze({ projectId: project.id })
                            .then(refresh)
                            .catch(notify)
                        }
                      >
                        <Sparkles size={15} />
                        Analyser scènes, silences & moments forts
                      </button>
                    </>
                  )}
                </section>
                <section className="vf-viewer">
                  <div className="vf-viewer-toolbar">
                    <select
                      aria-label="Séquence active"
                      value={sequence.id}
                      disabled={saving || !!saveError}
                      onChange={(e) =>
                        void selectSequence(e.target.value).catch(notify)
                      }
                    >
                      {project.sequences.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                    <button
                      title="Réglages de séquence"
                      onClick={() => setDialog("settings")}
                    >
                      <Settings2 size={16} />
                    </button>
                    <span>Aperçu proxy · SDR</span>
                    <button
                      aria-label="Afficher en plein écran"
                      title="Plein écran de l’aperçu"
                      onClick={expandPreview}
                    >
                      <Maximize2 size={16} />
                    </button>
                  </div>
                  <div
                    className={`vf-stage ${fullScreen ? "vf-stage-expanded" : ""}`}
                    ref={stageRef}
                    onDoubleClick={expandPreview}
                  >
                    {panel === "color" && (
                      <ColorReference
                        key={project.id}
                        clipId={
                          clip?.track !== undefined && clip.track < 10
                            ? clip.id
                            : undefined
                        }
                        label={asset?.name || "Aucun plan"}
                      />
                    )}
                    <Preview
                      sequence={sequence}
                      assets={project.assets}
                      frame={playhead}
                      playing={playing}
                      beforeColor={beforeColor}
                      selectedTitle={
                        panel === "titles" ? titleSelection : undefined
                      }
                      selectedMask={
                        panel === "masks" && clip
                          ? {
                              clipId: clip.id,
                              maskId: clip.masks?.some(
                                (m) => m.id === maskSelection,
                              )
                                ? maskSelection
                                : (clip.masks?.[0]?.id ?? ""),
                            }
                          : undefined
                      }
                      onMaskChange={(clipId, mask) =>
                        changeMasks(
                          clipId,
                          (
                            sequence.clips.find((c) => c.id === clipId)
                              ?.masks ?? []
                          ).map((m) => (m.id === mask.id ? mask : m)),
                        )
                      }
                      onMaskError={notify}
                      onTitleChange={(t) =>
                        change({
                          ...sequence,
                          titles: sequence.titles.map((x) =>
                            x.id === t.id ? t : x,
                          ),
                        })
                      }
                    />
                    {fullScreen && (
                      <button
                        className="vf-fullscreen-exit"
                        onClick={expandPreview}
                      >
                        Quitter le plein écran · Échap
                      </button>
                    )}
                  </div>
                  <div className="vf-transport">
                    <span>{timecode(playhead, sequence)}</span>
                    <div>
                      <button title="Début" onClick={() => seek(0)}>
                        <SkipBack size={18} />
                      </button>
                      <button title="Image précédente" onClick={() => step(-1)}>
                        <ArrowLeft size={16} />
                      </button>
                      <button
                        className="vf-play"
                        aria-label={
                          playing ? "Mettre en pause" : "Lire le montage"
                        }
                        disabled={!total}
                        onClick={() => {
                          resumeAudio();
                          if (playhead >= total - 1) setPlayhead(0);
                          setPlaying((v) => !v);
                        }}
                      >
                        {playing ? (
                          <Pause size={21} fill="currentColor" />
                        ) : (
                          <Play size={21} fill="currentColor" />
                        )}
                      </button>
                      <button title="Image suivante" onClick={() => step(1)}>
                        <SkipForward size={17} />
                      </button>
                    </div>
                    <span>{timecode(total, sequence)}</span>
                  </div>
                  <div className="vf-viewer-actions">
                    <button
                      aria-pressed={beforeColor}
                      title="Comparer la colorimétrie avec l’original"
                      onClick={() => setBeforeColor((v) => !v)}
                    >
                      <Palette size={15} />
                      {beforeColor
                        ? "Avant · original"
                        : "Avant / après couleur"}
                    </button>
                    <button
                      disabled={saving || !!saveError}
                      title="Versions enregistrées"
                      onClick={() =>
                        void api
                          .history({ projectId: project.id })
                          .then((r) => {
                            setSnapshots(r.items || []);
                            setDialog("history");
                          })
                          .catch(notify)
                      }
                    >
                      <RotateCcw size={15} />
                      Versions
                    </button>
                    <button
                      disabled={
                        saving ||
                        !!saveError ||
                        project.assets.filter((a) => a.kind === "video")
                          .length < 2
                      }
                      onClick={() => {
                        setPlaying(false);
                        setDialog("multicam");
                      }}
                    >
                      <Grid2X2 size={15} />
                      Multicaméra
                    </button>
                    <button
                      title="Cadrer les plans sur les visages, au format de la séquence"
                      disabled={
                        saving ||
                        !!saveError ||
                        !!cadrage ||
                        !sequence?.clips.some((c) => {
                          const a = project.assets.find(
                            (x) => x.id === c.assetId,
                          );
                          return (
                            a &&
                            sequence &&
                            !verrouillee(sequence, c.track) &&
                            aRecadrer(c, a, sequence) &&
                            modeDuPlan(c) !== null
                          );
                        })
                      }
                      onClick={() => void lancerCadrage(modeDuPlan)}
                    >
                      {cadrage ? (
                        <Loader2 size={15} className="spin" />
                      ) : (
                        <Crop size={15} />
                      )}
                      {cadrage
                        ? cadrage.total
                          ? `Recadrage ${cadrage.fait}/${cadrage.total}`
                          : "Recadrage…"
                        : "Recadrer"}
                    </button>
                    <button onClick={undo} disabled={!history.current.length}>
                      <RotateCcw size={15} />
                      Annuler
                    </button>
                    <button
                      aria-label="Rétablir"
                      title="Rétablir"
                      onClick={redo}
                      disabled={!future.current.length}
                    >
                      <RotateCw size={15} />
                    </button>
                    <button
                      onClick={() => {
                        setTitleText("");
                        setDialog("title");
                      }}
                    >
                      <Plus size={15} />
                      Titre
                    </button>
                    <button
                      onClick={() => void duplicateSequence(true).catch(notify)}
                    >
                      <Layers3 size={15} />
                      Version verticale
                    </button>
                    <select
                      aria-label="Qualité de la version verticale"
                      value={verticalQuality}
                      onChange={(e) =>
                        setVerticalQuality(
                          Number(e.target.value) as 1080 | 2160,
                        )
                      }
                      title="Définition de la nouvelle version verticale"
                    >
                      <option value={1080}>Vertical · 1080p</option>
                      <option value={2160}>Vertical · 4K</option>
                    </select>
                  </div>
                </section>
                <aside className="vf-inspector">
                  <PanelResize
                    width={workspaceLayout.layout.inspectorWidth}
                    onChange={(width) =>
                      workspaceLayout.patch({ inspectorWidth: width })
                    }
                  />
                  <div className="vf-panel-heading">
                    <h2>
                      {panel === "color"
                        ? "Étalonnage"
                        : panel === "audio"
                          ? "Réglages du son"
                          : "Réglages du plan"}
                    </h2>
                  </div>
                  {panel === "audio" && (
                    <AudioMixer sequence={sequence} onChange={change} />
                  )}
                  {!clip || !asset ? (
                    <div className="vf-inspector-empty">
                      <Scissors size={26} />
                      <p>Sélectionnez un plan dans la timeline.</p>
                    </div>
                  ) : (
                    <>
                      <div className="vf-selected-name">
                        {asset.name}
                        <small>
                          {seconds(clip.duration, sequence).toFixed(2)} s ·{" "}
                          {asset.kind === "audio"
                            ? `${asset.sampleRate / 1000} kHz · ${asset.audioChannels} ${asset.audioChannels > 1 ? "canaux" : "canal"}`
                            : `${asset.bits} bits source`}
                        </small>
                      </div>
                      {panel === "color" &&
                      asset.kind !== "audio" &&
                      clip.track < 10 ? (
                        <>
                          <label className="vf-field">
                            Profil de la source
                            <select
                              value={asset.inputSpace}
                              onChange={(e) =>
                                chooseSpace(asset, e.target.value)
                              }
                            >
                              {engine?.spaces.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          {spaceChoice?.assetId === asset.id && (
                            <>
                              <p className="vf-hint vf-warning" role="alert">
                                {`Ce réglage change aussi ${spaceChoice.locked} plan${spaceChoice.locked > 1 ? "s" : ""} sur une piste verrouillée. Le profil appartient au média « ${spaceChoice.name} » : tous ses plans le suivent.`}
                              </p>
                              <button
                                className="vf-warning-button"
                                onClick={() =>
                                  chooseSpace(
                                    asset,
                                    spaceChoice.inputSpace,
                                    true,
                                  )
                                }
                              >
                                {"Passer en « " +
                                  (engine?.spaces.find(
                                    (x) => x.id === spaceChoice.inputSpace,
                                  )?.name ?? spaceChoice.inputSpace) +
                                  " » quand même"}
                              </button>
                              <button onClick={() => setSpaceChoice(null)}>
                                Garder le profil actuel
                              </button>
                            </>
                          )}
                          {!asset.spaceConfirmed && (
                            <button
                              className="vf-warning-button"
                              onClick={() =>
                                void api
                                  .space({
                                    projectId: project.id,
                                    assetId: asset.id,
                                    inputSpace: asset.inputSpace,
                                  })
                                  .then(refresh)
                                  .catch(notify)
                              }
                            >
                              Confirmer cette interprétation
                            </button>
                          )}
                          <div className="vf-style-grid">
                            {styles.map(([id, label]) => (
                              <button
                                key={id}
                                className={
                                  clip.grade.style === id ? "active" : ""
                                }
                                onClick={() =>
                                  patch({ grade: { ...clip.grade, style: id } })
                                }
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                          <label className="vf-field">
                            LUT créative
                            <select
                              value={clip.grade.lutId || ""}
                              onChange={(e) =>
                                patch({
                                  grade: {
                                    ...clip.grade,
                                    lutId: e.target.value || undefined,
                                    lutIntensity: 1,
                                  },
                                })
                              }
                            >
                              <option value="">Aucune LUT</option>
                              {engine?.luts?.map((l) => (
                                <option key={l.id} value={l.id}>
                                  {l.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <button
                            onClick={() => {
                              const target = clip.id;
                              void api
                                .importLut()
                                .then(async (l) => {
                                  if (!l) return;
                                  setEngine(await api.status());
                                  // La fenêtre de fichier a pu rester ouverte
                                  // longtemps (un suivi de masque terminé entre-
                                  // temps a changé la séquence) : le plan est relu
                                  // maintenant, pas dans la copie du clic.
                                  const now = sRef.current?.clips.find(
                                    (c) => c.id === target,
                                  );
                                  if (
                                    !now ||
                                    dernierRendu.current.selected !== target
                                  ) {
                                    notify(
                                      "LUT importée. Choisissez-la dans « LUT créative » pour l’appliquer.",
                                    );
                                    return;
                                  }
                                  dernierRendu.current.patch({
                                    grade: {
                                      ...now.grade,
                                      lutId: l.id,
                                      lutIntensity: 1,
                                    },
                                  });
                                })
                                .catch(notify);
                            }}
                          >
                            Importer une LUT .cube
                          </button>
                          {clip.grade.lutId && (
                            <Range
                              label="Intensité LUT"
                              value={clip.grade.lutIntensity ?? 1}
                              min={0}
                              max={1}
                              onChange={(v) =>
                                patch({
                                  grade: { ...clip.grade, lutIntensity: v },
                                })
                              }
                            />
                          )}
                          <Range
                            label="Intensité du style"
                            value={clip.grade.intensity}
                            min={0}
                            max={1}
                            onChange={(v) =>
                              patch({ grade: { ...clip.grade, intensity: v } })
                            }
                          />
                          {(
                            [
                              ["exposure", "Exposition", -3, 3],
                              ["contrast", "Contraste", 0.4, 1.8],
                              ["saturation", "Saturation", 0, 2],
                              ["warmth", "Température", -0.3, 0.3],
                              ["tint", "Teinte", -0.3, 0.3],
                              ["fade", "Noirs adoucis", 0, 0.15],
                            ] as const
                          ).map(([key, label, min, max]) => (
                            <Range
                              key={key}
                              label={label}
                              min={min}
                              max={max}
                              value={clip.grade[key]}
                              onChange={(v) =>
                                patch({ grade: { ...clip.grade, [key]: v } })
                              }
                            />
                          ))}
                          <button
                            onClick={() => patch({ grade: { ...BASE_GRADE } })}
                          >
                            <RotateCcw size={14} />
                            Réinitialiser le rendu
                          </button>
                          <Range
                            label="Intensité de l’harmonisation"
                            value={colorStrength}
                            min={0}
                            max={100}
                            onChange={setColorStrength}
                          />
                          <button
                            onClick={() =>
                              void api
                                .autoColor({
                                  projectId: project.id,
                                  sequence,
                                  strength: colorStrength / 100,
                                })
                                .then(refresh)
                                .catch(notify)
                            }
                          >
                            <Sparkles size={14} />
                            Équilibrer la séquence
                          </button>
                          <button
                            onClick={() =>
                              void api
                                .autoColor({
                                  projectId: project.id,
                                  sequence,
                                  referenceAssetId: asset.id,
                                  strength: colorStrength / 100,
                                })
                                .then(refresh)
                                .catch(notify)
                            }
                          >
                            Harmoniser selon ce plan
                          </button>
                          <p className="vf-hint">
                            Une nouvelle version est créée avec des corrections
                            d’exposition et de dominante mesurées sur les
                            aperçus. Contrôlez les choix artistiques dans le
                            sélecteur de séquence.
                          </p>
                          <p className="vf-hint">
                            Styles Juno de départ. Les profils Aftershoot ne
                            sont pas encore importés.
                          </p>
                          <Scopes clipId={clip.id} />
                        </>
                      ) : panel === "audio" && clip.component === "video" ? (
                        <button
                          onClick={() => {
                            const sound = sequence.clips.find(
                              (c) =>
                                c.linkId === clip.linkId &&
                                c.component === "audio",
                            );
                            if (sound) setSelected(sound.id);
                          }}
                          disabled={
                            !sequence.clips.some(
                              (c) =>
                                clip.linkId &&
                                c.linkId === clip.linkId &&
                                c.component === "audio",
                            )
                          }
                        >
                          Sélectionner le son lié à ce plan
                        </button>
                      ) : panel === "audio" ||
                        asset.kind === "audio" ||
                        clip.track >= 10 ? (
                        <>
                          <label className="vf-field">
                            Nature du son
                            <select
                              value={clip.audioRole || "music"}
                              onChange={(e) =>
                                patch({
                                  audioRole: e.target
                                    .value as Clip["audioRole"],
                                })
                              }
                            >
                              <option value="voice">Voix</option>
                              <option value="music">Musique</option>
                              <option value="ambience">Ambiance</option>
                              <option value="effect">Effet</option>
                            </select>
                          </label>
                          <Range
                            label="Volume du plan"
                            min={0}
                            max={2}
                            value={animatedClip(clip, playhead).gain}
                            onChange={(gain) => patch({ gain })}
                          />
                          <label className="vf-check">
                            <input
                              type="checkbox"
                              checked={clip.muted}
                              onChange={(e) =>
                                patch({ muted: e.target.checked })
                              }
                            />
                            Couper le son de ce plan
                          </label>
                          <Range
                            label="Fondu d’entrée (images)"
                            min={0}
                            max={Math.min(
                              clip.duration,
                              Math.round(fps(sequence) * 3),
                            )}
                            step={1}
                            value={clip.fadeIn}
                            onChange={(fadeIn) => patch({ fadeIn })}
                          />
                          <Range
                            label="Fondu de sortie (images)"
                            min={0}
                            max={Math.min(
                              clip.duration,
                              Math.round(fps(sequence) * 3),
                            )}
                            step={1}
                            value={clip.fadeOut}
                            onChange={(fadeOut) => patch({ fadeOut })}
                          />
                          <VoiceEnhance
                            key={clip.id}
                            projectId={project.id}
                            clip={clip}
                            assets={project.assets}
                            jobs={jobs}
                            onPatch={patch}
                            onQueued={refresh}
                            onError={notify}
                          />
                          <SilenceTrim
                            sequence={sequence}
                            clip={clip}
                            assets={project.assets}
                            onChange={change}
                            onDone={notify}
                          />
                          <Range
                            label="Volume général"
                            min={0}
                            max={2}
                            value={sequence.masterGain}
                            onChange={(masterGain) =>
                              change({ ...sequence, masterGain })
                            }
                          />
                          <Ducking sequence={sequence} onChange={change} />
                          <p className="vf-hint">
                            Mixage stéréo. Le rendu final inclut un limiteur de
                            crête.
                          </p>
                        </>
                      ) : (
                        <>
                          <label className="vf-field">
                            Piste
                            <select
                              value={clip.track}
                              onChange={(e) =>
                                patch({ track: Number(e.target.value) })
                              }
                            >
                              {[0, 1, 2, 3, 10, 11, 12].map((t) => (
                                <option key={t} value={t}>
                                  {t < 10
                                    ? "Vidéo " + (t + 1)
                                    : "Audio " + (t - 9)}
                                </option>
                              ))}
                            </select>
                          </label>
                          {sequence && aRecadrer(clip, asset, sequence) && (
                            <label className="vf-field">
                              Cadrage automatique
                              <select
                                disabled={!!cadrage}
                                value={clip.reframe || ""}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  if (v === "main") patch({ reframe: "main" });
                                  else if (v)
                                    void lancerCadrage(v as CadrageMode, [
                                      clip.id,
                                    ]);
                                }}
                              >
                                {!clip.reframe && (
                                  <option value="">Pas encore recadré</option>
                                )}
                                <option value="couple">Sur le couple</option>
                                <option value="tous">Sur tout le monde</option>
                                <option value="main">Réglé à la main</option>
                              </select>
                            </label>
                          )}
                          <Range
                            label="Échelle"
                            min={0.1}
                            max={5}
                            value={clip.scale}
                            onChange={(scale) => patch({ scale })}
                          />
                          <Range
                            label="Position horizontale"
                            min={-1}
                            max={1}
                            value={animatedClip(clip, playhead).x}
                            onChange={(x) => patch({ x })}
                          />
                          <Range
                            label="Position verticale"
                            min={-1}
                            max={1}
                            value={animatedClip(clip, playhead).y}
                            onChange={(y) => patch({ y })}
                          />
                          <Range
                            label="Rotation"
                            min={-180}
                            max={180}
                            step={1}
                            value={clip.rotation}
                            onChange={(rotation) => patch({ rotation })}
                          />
                          <Range
                            label="Opacité"
                            min={0}
                            max={1}
                            value={clip.opacity}
                            onChange={(opacity) => patch({ opacity })}
                          />
                          <label className="vf-field">
                            Vitesse
                            <select
                              value={clip.speed}
                              onChange={(e) => {
                                const speed = Number(e.target.value);
                                try {
                                  change(
                                    applyVideoActions(
                                      sequence,
                                      [
                                        {
                                          kind: "video.adjust",
                                          field: "speed",
                                          value: speed,
                                          relative: false,
                                        },
                                      ],
                                      [clip.id],
                                      playhead,
                                      project?.assets || [],
                                    ),
                                  );
                                } catch (error) {
                                  notify(error);
                                }
                              }}
                            >
                              {[0.25, 0.5, 1, 1.5, 2, 4].map((v) => (
                                <option key={v} value={v}>
                                  {v}×
                                </option>
                              ))}
                            </select>
                          </label>
                          <TransitionPicker
                            clip={clip}
                            sequence={sequence}
                            onPatch={patch}
                          />
                          <Cleanup clip={clip} onPatch={patch} />
                          <UnusableTrim
                            sequence={sequence}
                            clip={clip}
                            assets={project.assets}
                            onChange={change}
                            onDone={notify}
                          />
                          <Keyframes
                            clip={clip}
                            sequence={sequence}
                            at={playhead}
                            onSeek={seek}
                            onChange={(next) => patch(next)}
                          />
                          <button onClick={doSplit}>
                            <Scissors size={14} />
                            Couper au curseur
                          </button>
                        </>
                      )}
                    </>
                  )}
                </aside>
              </div>
            )}
            <Timeline
              onTitleSelect={(id) => {
                setTitleSelection(id);
                setPanel("titles");
              }}
              sequence={sequence}
              assets={project.assets}
              playhead={playhead}
              selected={selected}
              onSelect={setSelected}
              onSeek={seek}
              onChange={change}
              onAdd={append}
              onSplit={doSplit}
              onRemove={doRemove}
              onError={notify}
            />
          </>
        )}
      </main>
      {dialog === "new" && (
        <Dialog title="Nouveau film" onClose={() => setDialog(null)}>
          <p>Un projet pour vos vidéos, photos et sons.</p>
          <label className="vf-field">
            Nom du projet
            <input
              autoFocus
              value={name}
              placeholder="Campagne · Maison Aube"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" && void create().catch(notify)
              }
            />
          </label>
          <button
            className="vf-primary"
            disabled={!name.trim()}
            onClick={() => void create().catch(notify)}
          >
            Créer le film
          </button>
        </Dialog>
      )}
      {dialog === "title" && sequence && (
        <Dialog title="Ajouter un titre" onClose={() => setDialog(null)}>
          <label className="vf-field">
            Texte
            <textarea
              autoFocus
              value={titleText}
              onChange={(e) => setTitleText(e.target.value)}
              placeholder="Votre titre…"
            />
          </label>
          <p>
            Affiché cinq secondes à partir de {timecode(playhead, sequence)}.
          </p>
          <button
            className="vf-primary"
            disabled={!titleText.trim()}
            onClick={() => {
              change({
                ...sequence,
                titles: [
                  ...sequence.titles,
                  {
                    id: crypto.randomUUID(),
                    text: titleText.trim(),
                    start: playhead,
                    duration: frame(5, sequence),
                    size: Math.round(sequence.width * 0.04),
                    y: 0.5,
                    color: "#ffffff",
                  },
                ],
              });
              setDialog(null);
            }}
          >
            Ajouter le titre
          </button>
        </Dialog>
      )}
      {dialog === "settings" && sequence && (
        <Dialog title="Réglages de séquence" onClose={() => setDialog(null)}>
          <label className="vf-field">
            Nom
            <input
              value={sequence.name}
              onChange={(e) => change({ ...sequence, name: e.target.value })}
            />
          </label>
          <label className="vf-field">
            Définition
            <select
              value={sequence.width + "x" + sequence.height}
              onChange={(e) => {
                const [width, height] = e.target.value.split("x").map(Number);
                change(changeDefinition(sequence, width, height));
              }}
            >
              {[
                ["1920x1080", "Full HD · 16:9"],
                ["3840x2160", "4K UHD · 16:9"],
                ["6144x3456", "6K · 16:9"],
                ["1080x1920", "Vertical · 9:16"],
                ["2160x3840", "Vertical 4K · 9:16"],
                ["1080x1080", "Carré · 1:1"],
              ].map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="vf-field">
            Cadence
            <select
              value={sequence.fps.n + "/" + sequence.fps.d}
              onChange={(e) => changeRate(e.target.value)}
            >
              {[
                ["24000/1001", "23,976"],
                ["24/1", "24"],
                ["25/1", "25"],
                ["30000/1001", "29,97"],
                ["30/1", "30"],
                ["50/1", "50"],
                ["60000/1001", "59,94"],
                ["60/1", "60"],
              ].map(([v, t]) => (
                <option key={v} value={v}>
                  {t} images/s
                </option>
              ))}
            </select>
          </label>
          <p>
            Sortie Rec.709 SDR. L’affichage du timecode utilise la numérotation
            non-drop-frame.
          </p>
          <button onClick={() => void duplicateSequence().catch(notify)}>
            Créer une version du montage
          </button>
          <button className="vf-primary" onClick={() => setDialog(null)}>
            Terminer
          </button>
        </Dialog>
      )}
      {dialog === "export" && sequence && (
        <Dialog
          title="Exporter le film"
          onClose={() => !exportBusy && setDialog(null)}
        >
          <p>
            {sequence.name} · {sequence.width} × {sequence.height} ·{" "}
            {timecode(total, sequence)}
          </p>
          <label className="vf-field">
            Format
            <select value={codec} onChange={(e) => setCodec(e.target.value)}>
              {engine?.exports
                ?.filter((profile) => profile.available)
                .map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.label}
                  </option>
                ))}
            </select>
          </label>
          <label className="vf-field">
            Niveau sonore livré
            <select
              value={loudness}
              onChange={(e) => setLoudness(e.target.value)}
            >
              <option value="">Ne pas normaliser</option>
              {LOUDNESS_TARGETS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label} · {t.detail}
                </option>
              ))}
            </select>
          </label>
          <p>
            {loudness
              ? "Le film est mesuré en entier, puis ramené au niveau de la cible. Deux passes, à la fin du rendu."
              : "Le niveau livré sera celui du montage, tel quel."}
          </p>
          <p>
            Le rendu utilise les originaux et une copie des réglages actuels. Il
            continue en arrière-plan.
          </p>
          {sequence.captions.length > 0 && (
            <button
              onClick={() =>
                void window.juno?.saveFile(
                  sequence.name + ".srt",
                  new TextEncoder().encode(srt(sequence)).buffer as ArrayBuffer,
                )
              }
            >
              Enregistrer les sous-titres SRT
            </button>
          )}
          {unconfirmedDelivery.length > 0 && (
            <div className="export-warning" role="alert">
              <p>
                Confirmez le profil couleur de {unconfirmedDelivery.length}{" "}
                média(s) avant de livrer :{" "}
                {unconfirmedDelivery
                  .slice(0, 3)
                  .map((a) => a.name)
                  .join(", ")}
                {unconfirmedDelivery.length > 3 ? "…" : ""}.
              </p>
              <button onClick={checkDeliveryColor}>
                Vérifier les profils couleur
              </button>
            </div>
          )}
          {exportError && (
            <p className="export-warning" role="alert">
              {exportError}
            </p>
          )}
          <button
            className="vf-primary"
            disabled={exportBusy || unconfirmedDelivery.length > 0}
            onClick={() => void exportFilm()}
          >
            {exportBusy ? (
              <Loader2 size={16} className="spin" />
            ) : (
              <Download size={16} />
            )}
            Choisir le fichier et exporter
          </button>
        </Dialog>
      )}
      {dialog === "review-client" && project && (
        <Dialog title="Retours clients" onClose={() => setDialog(null)}>
          <ReviewPanel
            target={{
              id: project.photoProjectId || project.id,
              name: project.name,
              kind: "video",
              prepareVideo: async () => {
                if (!api || !sRef.current) throw Error("Ouvrez un montage.");
                await drain();
                if (pending.current || working.current)
                  throw Error("Terminez l’enregistrement du montage.");
                const frozen = structuredClone(sRef.current),
                  overlays = await prepareOverlays(frozen),
                  maskImages = await prepareMaskImages(frozen),
                  job = await api.export({
                    projectId: project.id,
                    sequence: frozen,
                    codec: "h264",
                    overlays,
                    maskImages,
                    review: true,
                  });
                if (!job) throw Error("Préparation annulée.");
                await refresh();
                return { jobId: job.id, projectId: project.id };
              },
            }}
            onOpenSource={openReviewSource}
          />
        </Dialog>
      )}
    </div>
  );
}
