import {
  useWorkspaceLayout,
  WorkspaceControls,
  PanelResize,
} from "./workbench/WorkspaceLayout";
import WorkbenchHeader from "./workbench/WorkbenchHeader";
import MediaHub from "./workbench/MediaHub";
import { videoForPhoto } from "./workbench/project-context";
import {
  annonceImport,
  basculeOriginal,
  bilanImport,
  dateDuJour,
  etoilesDeTouche,
  photoAMontrer,
  type PlaceActive,
} from "./workbench/interface";
import { VERSION_JUNO } from "./workbench/version";
import AlbumAction from "./assistant/AlbumAction";
import ReviewPanel from "./review/ReviewPanel";
import AdvancedAdjustments from "./modules/AdvancedAdjustments";
import Pilot, { type PilotContext } from "./assistant/Pilot";
import {
  applyPhotoAction,
  PHOTO_FIELDS,
  type PhotoAction,
  type Plan,
} from "./assistant/commands";
import {
  photoHistory,
  photoTransaction,
  restoreCommand,
} from "./assistant/journal";
import Range from "./modules/NumericRange";
import ProjectMedia from "./modules/ProjectMedia";
import CommandMenu, { type CommandAction } from "./modules/CommandMenu";
import SystemPanel from "./modules/SystemPanel";
import { openUpdates } from './modules/UpdateCenter';
import { PhotoWriter, type PhotoUpdate } from "./modules/photo-writer";
import OriginalStatus from "./modules/OriginalStatus";
import JobPanel from "./modules/JobPanel";
import ComparePanel from "./modules/ComparePanel";
import PhotoThumbnail from "./modules/PhotoThumbnail";
import { enqueueJob, mesurerNiveaux, subscribeJobs } from "./modules/jobs";
import { correctionDe, VERSION_NIVEAU } from "./modules/level";
import {
  getPhoto,
  getPhotos,
  getThumbnail,
  hydratePhoto,
  subscribeCatalog,
  modifyPhoto,
} from "./db";
import { prefetchPhoto } from "./image";
import { useEffect, useRef, useState, useMemo } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CloudOff,
  Copy,
  FolderOpen,
  Grid2X2,
  Heart,
  HelpCircle,
  ImagePlus,
  Images,
  Info,
  Keyboard,
  Leaf,
  Loader2,
  Lock,
  Maximize2,
  Minus,
  MoreHorizontal,
  MessageSquare,
  Plus,
  RotateCcw,
  RotateCw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  Sun,
  Upload,
  WandSparkles,
  X,
  Eye,
  CheckCircle2,
  Flag,
  Camera,
  Clapperboard,
  Palette,
  FolderHeart,
  Command,
  Scissors,
  Image,
  Lightbulb,
  Wifi,
  WifiOff,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  DEFAULT,
  ADVANCED_DEFAULTS,
  replacePhotoAdjustments,
  STYLES,
  PROJECT_TYPES,
  chaptersFor,
  uid,
  editPhoto,
  undoPhoto,
  redoPhoto,
  resetPhoto,
  recoverPhoto,
  autoSettings,
  hamming,
  type Photo,
  type Project,
  type Adjustments,
} from "./model";
import {
  describeLearned,
  forgetProfile,
  learnWhenLeaving,
  readProfile,
} from "./modules/style-profile";
import { embedTexts, rank, semanticFailure } from "./modules/semantic";
import PeoplePanel from "./modules/PeoplePanel";
import {
  getOriginal,
  putOriginal,
  putPhoto,
  putPhotos,
  putProject,
} from "./db";
import { load } from "./bootstrap";
import {
  inspect,
  sourceBlob,
  renderPhoto,
  renderTiff,
  toBlob,
  fingerprint,
  download,
  analysePourAuto,
} from "./image";
import JSZip from "jszip";
import EditorPreview from "./modules/EditorPreview";
import LightroomPanel from "./modules/LightroomPanel";
import TeamPanel from "./modules/TeamPanel";
import { supportedPhoto } from "./modules/raster";
import {
  groupSuggestions,
  analyzeFaces,
  withFaces,
  rechoisirRafale,
} from "./modules/culling";
import { priorityPeople } from "./modules/people-store";
import { createAIMask } from "./modules/ai-mask";
import { restoreProject } from "./db";
type Filter = "all" | "keep" | "review" | "reject" | "star" | "suggested";
type Modal =
  | "new"
  | "settings"
  | "export"
  | "help"
  | "analysis"
  | "team"
  | "backup"
  | "versions"
  | "system"
  | "review-client"
  | "lightroom"
  | "abandon"
  | null;
const FMT = new Intl.NumberFormat("fr-FR");
function IconButton({
  children,
  label,
  onClick,
  active = false,
  disabled = false,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      className={`icon-button ${active ? "active" : ""}`}
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function ModalBox({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const old = document.activeElement as HTMLElement;
    const focusable = () =>
      ref.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled),input,select,textarea,[tabindex="0"]',
      );
    focusable()?.[0]?.focus();
    const listener = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const f = focusable();
        if (!f?.length) return;
        const first = f[0],
          last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", listener);
    return () => {
      document.removeEventListener("keydown", listener);
      old?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <IconButton label="Fermer" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}
export default function App({ onVideo }: { onVideo?: () => void }) {
  useEffect(() => {
    const show = () => setModal("review-client");
    window.addEventListener("juno-open-review", show);
    return () => window.removeEventListener("juno-open-review", show);
  }, []);
  const workspaceLayout = useWorkspaceLayout("photo");
  const focusMode = workspaceLayout.layout.focus;
  const setFocusMode = (update: boolean | ((v: boolean) => boolean)) =>
    workspaceLayout.patch({
      focus: typeof update === "function" ? update(focusMode) : update,
    });
  const [drawer, setDrawer] = useState(false),
    [mediaHub, setMediaHub] = useState(
      () => sessionStorage.getItem("juno-open-media") === "true",
    );
  useEffect(() => {
    sessionStorage.removeItem("juno-open-media");
  }, []);
  const [projects, setProjects] = useState<Project[]>([]),
    [photos, setPhotos] = useState<Photo[]>([]),
    [projectId, setProjectId] = useState(
      () => localStorage.getItem("juno-project") || "demo-wedding",
    ),
    [activeId, setActiveId] = useState(""),
    [ready, setReady] = useState(false);
  const [filter, setFilter] = useState<Filter>("all"),
    [chapter, setChapter] = useState("Tout le projet"),
    [search, setSearch] = useState(""),
    // La recherche par le sens : une phrase, résumée en vecteur, comparée aux
    // photos indexées. Vide tant qu'aucune phrase n'a été validée.
    [meaning, setMeaning] = useState<{
      phrase: string;
      scores: Map<string, number>;
    } | null>(null),
    [meaningBusy, setMeaningBusy] = useState(false),
    [meaningError, setMeaningError] = useState(""),
    [view, setView] = useState<"grid" | "editor" | "compare">("grid"),
    [panel, setPanel] = useState<"adjust" | "styles" | "ai">("adjust");
  const [modal, setModal] = useState<Modal>(null),
    [toast, setToast] = useState(""),
    [busy, setBusy] = useState(""),
    [progress, setProgress] = useState(0),
    [saved, setSaved] = useState(true),
    // Le message de l'écriture qui a échoué ; vide tant que tout s'enregistre.
    [saveError, setSaveError] = useState(""),
    [pendingSaves, setPendingSaves] = useState(0),
    [blockedId, setBlockedId] = useState(""),
    [blockedCount, setBlockedCount] = useState(1),
    // Une reprise a déjà échoué : on propose alors d'abandonner l'entrée fautive.
    [retryFailed, setRetryFailed] = useState(false),
    [writeRevision, setWriteRevision] = useState(0),
    [before, setBefore] = useState(false),
    [zoom, setZoom] = useState(false),
    [page, setPage] = useState(0),
    [dense, setDense] = useState(
      () => localStorage.getItem("juno-dense") === "true",
    ),
    [inspectorOpen, setInspectorOpen] = useState(false),
    [commandsOpen, setCommandsOpen] = useState(false),
    [projectSearch, setProjectSearch] = useState(""),
    [sort, setSort] = useState("date"),
    [selection, setSelection] = useState<Set<string>>(new Set());
  const [online, setOnline] = useState(navigator.onLine),
    [keyReady, setKeyReady] = useState(false),
    [imageBudget, setImageBudget] = useState<Awaited<
      ReturnType<NonNullable<Window["juno"]>["imageBudget"]>
    > | null>(null),
    [budgetError, setBudgetError] = useState(""),
    [apiKey, setApiKey] = useState(""),
    [prompt, setPrompt] = useState(""),
    [aiMode, setAiMode] = useState<"edit" | "generate">("edit"),
    [aiConsent, setAiConsent] = useState(false),
    [aiResult, setAiResult] = useState<{
      blob: Blob;
      url: string;
      prompt: string;
      projectId: string;
      parentId?: string;
      chapter: string;
    } | null>(null);
  useEffect(() => {
    let live = true;
    setImageBudget(null);
    setBudgetError("");
    void window.juno
      ?.imageBudget(projectId)
      .then((value) => {
        if (live) setImageBudget(value);
      })
      .catch((e) => {
        if (live) setBudgetError(e.message);
      });
    return () => {
      live = false;
    };
  }, [projectId]);
  const [newName, setNewName] = useState(""),
    [newDate, setNewDate] = useState(dateDuJour),
    [newPlace, setNewPlace] = useState("");
  const [newKind, setNewKind] = useState("Projet libre");
  const [exportMenu, setExportMenu] = useState(false);
  // Oublier le style appris des corrections se confirme d'un second clic.
  const [oubliStyle, setOubliStyle] = useState(false);
  const [exportScope, setExportScope] = useState("keep"),
    [exportSize, setExportSize] = useState("0"),
    [exportQuality, setExportQuality] = useState(100),
    [exportFormat, setExportFormat] = useState("jpeg");
  const [faceAnalysis, setFaceAnalysis] = useState(true),
    [aiReference, setAiReference] = useState<Blob | null>(null),
    [referenceName, setReferenceName] = useState(""),
    [versionName, setVersionName] = useState("");
  const [fileImportReport, setFileImportReport] = useState<string[]>([]);
  const [analysisResult, setAnalysisResult] = useState<{
    review: number;
    similar: number;
  } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null),
    cancel = useRef(false),
    importLock = useRef(false),
    aiLock = useRef(false);
  const writer = useRef<PhotoWriter | null>(null);
  if (!writer.current)
    writer.current = new PhotoWriter(
      ({ pending, error, blockedId, blocked }) => {
        setSaved(!pending && !error);
        setSaveError(error);
        setPendingSaves(pending);
        setBlockedId(blockedId || "");
        setBlockedCount(blocked || 1);
        setWriteRevision((n) => n + 1);
      },
      () => {},
      undefined,
      (savedPhotos) => {
        const changed = new Map(savedPhotos.map((p) => [p.id, p]));
        setPhotos((ps) =>
          ps.map((p) => {
            const next = changed.get(p.id);
            return next && (p.revision || 0) <= (next.revision || 0) ? next : p;
          }),
        );
      },
    );
  const notify = (message: string) => setToast(message);
  useEffect(() => {
    load(localStorage.getItem("juno-project") || undefined)
      .then(async (d) => {
        setProjects(d.projects);
        setPhotos(d.photos);
        setProjectId(d.projectId);
        setActiveId(d.photos[0]?.id || "");
        const raw = sessionStorage.getItem("juno-review-open");
        if (raw)
          try {
            const request = JSON.parse(raw);
            if (request.asset?.kind === "photo") {
              sessionStorage.removeItem("juno-review-open");
              const target = d.projects.find(
                (p) =>
                  p.id === request.asset.metadata.projectId ||
                  p.remoteId === request.asset.metadata.projectId,
              );
              if (!target)
                throw Error(
                  "Le projet de ce retour est absent du catalogue local.",
                );
              const list = await getPhotos(target.id),
                photo = list.find(
                  (p) =>
                    p.id === request.asset.metadata.sourceId ||
                    p.remotePhotoId === request.asset.logical_id,
                );
              if (!photo)
                throw Error(
                  "La photo de ce retour est absente du catalogue local.",
                );
              setProjectId(target.id);
              setPhotos(list);
              setActiveId(photo.id);
              setView("editor");
              if (request.instruction)
                setTimeout(
                  () =>
                    window.dispatchEvent(
                      new CustomEvent("juno-pilot-propose", {
                        detail: {
                          text: request.instruction,
                          domain: "photo",
                          projectId: target.id,
                        },
                      }),
                    ),
                  200,
                );
            }
          } catch (error) {
            notify((error as Error).message);
          }
        setReady(true);
      })
      .catch((e) => {
        notify("Impossible d’ouvrir le catalogue : " + e.message);
        setReady(true);
      });
    window.juno
      ?.keyStatus()
      .then(setKeyReady)
      .catch(() => {});
    const listener = () => setOnline(navigator.onLine);
    window.addEventListener("online", listener);
    window.addEventListener("offline", listener);
    return () => {
      window.removeEventListener("online", listener);
      window.removeEventListener("offline", listener);
    };
  }, []);
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (!saved || busy) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [saved, busy]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 6500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (!saveError) setRetryFailed(false);
  }, [saveError]);
  useEffect(() => {
    // Une fenêtre ouverte depuis le tiroir passait sous son voile : le premier
    // clic ne faisait que fermer le tiroir.
    if (modal) setDrawer(false);
    // La date proposée est celle du jour où l'on crée, pas celle du lancement.
    if (modal === "new") setNewDate(dateDuJour());
  }, [modal]);
  // Le bilan réel d'un import (doublons ignorés, échecs) n'est connu qu'à la
  // fin de la tâche : on le donne à ce moment-là.
  const importsSuivis = useRef(new Set<string>());
  useEffect(
    () =>
      subscribeJobs((jobs) => {
        for (const job of jobs) {
          if (!importsSuivis.current.has(job.id)) continue;
          const bilan = bilanImport(job);
          if (!bilan) continue;
          importsSuivis.current.delete(job.id);
          notify(bilan);
        }
      }),
    [],
  );
  useEffect(() => {
    setPage(0);
  }, [filter, chapter, search, projectId]);
  useEffect(() => {
    if (ready) localStorage.setItem("juno-project", projectId);
  }, [projectId, ready]);
  const activeProjectRef = useRef(projectId);
  activeProjectRef.current = projectId;
  useEffect(() => {
    if (!ready) return;
    let live = true;
    void getPhotos(projectId)
      .then((ps) => {
        if (live) {
          setPhotos(ps);
          setActiveId((id) =>
            ps.some((p) => p.id === id) ? id : ps[0]?.id || "",
          );
        }
      })
      .catch((e) => notify(e.message));
    return () => {
      live = false;
    };
  }, [projectId, ready]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pending = new Map<string, Photo>();
    const off = subscribeCatalog((event) => {
      for (const p of event.photos)
        if (p.projectId === activeProjectRef.current) pending.set(p.id, p);
      if (!timer)
        timer = setTimeout(() => {
          timer = undefined;
          const updates = new Map(pending);
          pending.clear();
          setPhotos((old) => {
            const map = new Map(
              old
                .filter((p) => p.projectId === activeProjectRef.current)
                .map((p) => [p.id, p]),
            );
            for (const p of updates.values())
              if (
                p.projectId === activeProjectRef.current &&
                (p.revision || 0) >= (map.get(p.id)?.revision || 0)
              )
                map.set(p.id, p);
            return [...map.values()].sort((a, b) => a.created - b.created);
          });
        }, 40);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    const fn = () =>
      notify(
        "Fermez les autres fenêtres Juno pour terminer la migration du catalogue.",
      );
    window.addEventListener("juno-database-blocked", fn);
    return () => window.removeEventListener("juno-database-blocked", fn);
  }, []);
  const project = projects.find((p) => p.id === projectId);
  const items = useMemo(
    () => photos.filter((p) => p.projectId === projectId),
    [photos, projectId],
  );
  useEffect(() => {
    const ranked = items.filter((p) => p.analysis?.groupId);
    if (ranked.length)
      setAnalysisResult({
        review: items.filter((p) => p.analysis?.advice === "review").length,
        similar:
          ranked.length - new Set(ranked.map((p) => p.analysis!.groupId)).size,
      });
    else setAnalysisResult(null);
  }, [items]);
  const kept = items.filter((p) => p.status === "keep").length,
    rejected = items.filter((p) => p.status === "reject").length;
  // Un espace dans la recherche : c'est une phrase, pas un nom de fichier.
  const phraseEnCours = !meaning && search.trim().includes(" ");
  const filtered = useMemo(
    () =>
      items
        .filter(
          (p) =>
            (filter === "all" ||
              (filter === "keep" && p.status === "keep") ||
              (filter === "reject" && p.status === "reject") ||
              (filter === "review" && p.analysis?.advice === "review") ||
              (filter === "star" && p.stars > 0) ||
              (filter === "suggested" &&
                !!p.analysis?.suggested &&
                p.status !== "reject")) &&
            (chapter === "Tout le projet" || p.chapter === chapter) &&
            (meaning
              ? meaning.scores.has(p.id)
              : // Une phrase n'est pas un nom de fichier : tant qu'elle n'est
                // pas validée, l'album reste entier plutôt que de se vider.
                phraseEnCours
                ? true
                : p.name
                    .toLocaleLowerCase()
                    .includes(search.toLocaleLowerCase())),
        )
        .sort((a, b) =>
          // Une recherche par le sens impose son ordre : le plus proche
          // d'abord. Le tri choisi reprend la main dès qu'elle est effacée.
          meaning
            ? (meaning.scores.get(b.id) ?? 0) - (meaning.scores.get(a.id) ?? 0)
            : sort === "name"
              ? a.name.localeCompare(b.name, "fr", { numeric: true })
              : sort === "stars"
                ? b.stars - a.stars || a.created - b.created
                : (a.capturedAt || a.created) - (b.capturedAt || b.created),
        ),
    [items, filter, chapter, search, sort, meaning, phraseEnCours],
  );
  // Quand la photo active sort du filtre, sa voisine prend sa place (et non la
  // première du filtre) : il faut savoir où elle était, et dans quel filtre.
  const cleFiltre = [
    projectId,
    filter,
    chapter,
    search,
    meaning?.phrase ?? "",
    sort,
  ].join("\n");
  const placeActive = useRef<PlaceActive | undefined>(undefined);
  const montree = photoAMontrer(
    filtered,
    items,
    activeId,
    cleFiltre,
    placeActive.current,
  );
  const persistedCurrent = montree.photo;
  useEffect(() => {
    if (!montree.photo) return;
    if (montree.voisine) {
      setActiveId(montree.photo.id);
      setPage(Math.floor(montree.index / 60));
    } else if (montree.index >= 0 && montree.photo.id === activeId)
      placeActive.current = {
        cle: cleFiltre,
        id: activeId,
        index: montree.index,
      };
  });
  const current = useMemo(
    () =>
      persistedCurrent ? writer.current!.project(persistedCurrent) : undefined,
    [persistedCurrent, writeRevision],
  );
  useEffect(() => {
    setSelection(new Set());
  }, [projectId]);
  // Leaving a photo that Juno had proposed settings for is the moment to learn:
  // the photographer has finished arbitrating, and only the final state counts.
  // Seul l'identifiant de la photo quittée est gardé : la photo telle qu'elle
  // était à son ouverture ne portait aucune des corrections faites depuis, et
  // Juno n'apprenait rien. learnWhenLeaving relit son état enregistré.
  const leaving = useRef<string | undefined>(undefined);
  useEffect(() => {
    const previous = leaving.current;
    leaving.current = current?.id;
    if (!previous || previous === current?.id) return;
    void learnWhenLeaving(previous, {
      flush: () => writer.current!.flush(),
      read: getPhoto,
      modify: modifyPhoto,
    });
  }, [current?.id]);
  useEffect(() => {
    if (modal !== "settings") setOubliStyle(false);
  }, [modal]);
  useEffect(() => {
    localStorage.setItem("juno-dense", String(dense));
  }, [dense]);
  const lastPage = Math.max(0, Math.ceil(filtered.length / 60) - 1);
  const displayPage = Math.min(page, lastPage);
  const visible = filtered.slice(displayPage * 60, (displayPage + 1) * 60);
  useEffect(() => {
    if (page > lastPage) setPage(lastPage);
  }, [page, lastPage]);
  useEffect(() => {
    if (view !== "editor" || !current) return;
    const index = filtered.findIndex((p) => p.id === current.id),
      next = filtered[index + 1];
    if (!next) return;
    const timer = setTimeout(() => void prefetchPhoto(next), 450);
    return () => clearTimeout(timer);
  }, [current?.id, view]);
  async function save(id: string, update: PhotoUpdate, group?: string) {
    try {
      await writer.current!.write(id, update, group);
    } catch (e) {
      notify(
        "Enregistrement impossible. Vos changements sont conservés en attente : " +
          (e as Error).message,
      );
    }
  }
  async function saveBatch(ids: string[], update: PhotoUpdate) {
    await Promise.all(ids.map((id) => writer.current!.write(id, update)));
  }
  async function retrySaves() {
    try {
      await writer.current!.retry();
      notify("Tous les changements ont été enregistrés.");
    } catch (e) {
      setRetryFailed(true);
      notify("Enregistrement toujours impossible : " + (e as Error).message);
    }
  }
  // Seulement après confirmation : l'entrée fautive est perdue, les autres
  // changements en attente repartent dans leur ordre.
  async function abandonBlockedSave() {
    setModal(null);
    try {
      await writer.current!.abandon();
      notify(
        "Changement abandonné. Les autres changements en attente sont enregistrés.",
      );
    } catch (e) {
      setRetryFailed(true);
      notify("Enregistrement toujours impossible : " + (e as Error).message);
    }
  }
  // Ouvrir un projet repart d'une vue neutre : le filtre, la collection et la
  // recherche de l'ancien projet n'ont pas de sens dans le nouveau (une
  // collection « Cérémonie » n'existe pas dans un projet Portrait).
  function openProject(id: string, focus?: string) {
    setProjectId(id);
    setView("grid");
    setFilter("all");
    setChapter("Tout le projet");
    setSearch("");
    setMeaning(null);
    setMeaningError("");
    setAnalysisResult(null);
    if (focus !== undefined) setActiveId(focus);
    else if (id !== projectId) setActiveId("");
  }
  // Ouvrir une photo précise (Médias) : si le filtre en cours la cache, on le
  // retire, sinon l'atelier ouvrirait une autre photo que celle demandée.
  function showPhoto(id: string) {
    if (!filtered.some((p) => p.id === id)) {
      setFilter("all");
      setChapter("Tout le projet");
      setSearch("");
      setMeaning(null);
      setMeaningError("");
    }
    setActiveId(id);
  }
  function adjust(patch: Partial<Adjustments>, group?: string) {
    setBefore(false);
    if (current)
      void save(
        current.id,
        (latest) => {
          let next = latest;
          for (const [field, value] of Object.entries(patch))
            next =
              typeof value === "number" && PHOTO_FIELDS[field]
                ? applyPhotoAction(
                    next,
                    { kind: "photo.adjust", field, value, relative: false },
                    group,
                  )
                : editPhoto(next, { [field]: value }, group);
          return next;
        },
        group,
      );
  }
  /**
   * « Auto » : exposition, hautes lumières et ombres visées sur ce que Juno
   * exporte. Un RAW sans mesure de son rendu est développé une fois, à la
   * demande, et la mesure reste au catalogue pour la passe d'album.
   */
  async function autoLumiere() {
    const photo = current;
    if (!photo?.analysis) return;
    let lue: Awaited<ReturnType<typeof analysePourAuto>>;
    try {
      lue = await analysePourAuto(photo);
    } catch (e) {
      return notify(
        "Auto n’a pas pu développer ce RAW pour mesurer son rendu : " +
          (e as Error).message,
      );
    }
    if (!lue) return;
    const { analysis, mesure } = lue;
    if (mesure)
      void modifyPhoto(photo.id, (latest) =>
        latest.analysis
          ? { ...latest, analysis: { ...latest.analysis, rendu: mesure } }
          : latest,
      ).catch(() => {});
    adjust(autoSettings(analysis));
  }
  /**
   * « Redresser » : l'angle mesuré sur les lignes, proposition comprise. Une
   * photo importée avant qu'on sache le mesurer l'est à ce moment-là.
   */
  async function redresserAuto() {
    if (!current) return;
    let level = current.analysis?.level;
    if (level?.version !== VERSION_NIVEAU)
      try {
        await writer.current!.flush();
        await mesurerNiveaux([current.id]);
        level = (await getPhoto(current.id))?.analysis?.level;
      } catch {
        // L'original manque : rien à mesurer, le message ci-dessous suffit.
      }
    const t = correctionDe(level, ["auto", "suggest", "level"]);
    if (t === undefined)
      return notify(
        "Pas assez de lignes fiables pour redresser cette photo. Réglez le redressement à la main.",
      );
    adjust({ straighten: t });
    notify(
      t
        ? `Redressée de ${Math.abs(t).toFixed(1).replace(".", ",")}° vers la ${t > 0 ? "droite" : "gauche"}.`
        : "Cette photo est déjà droite.",
    );
  }
  async function capturePilot(): Promise<PilotContext> {
    const id = projectId,
      active = current?.id,
      picked = [...selection],
      label = project?.name || "Projet";
    await writer.current!.flush();
    const all = await getPhotos(id);
    return {
      domain: "photo",
      projectId: id,
      label,
      ids: {
        current: active ? [active] : [],
        selection: picked,
        album: all.map((p) => p.id),
        kept: all.filter((p) => p.status === "keep").map((p) => p.id),
      },
      revisions: Object.fromEntries(all.map((p) => [p.id, p.revision || 0])),
    };
  }
  async function runPilot(plan: Plan, context: PilotContext): Promise<string> {
    const ids = context.ids[plan.scope];
    if (plan.actions.every((a) => a.kind.startsWith("photo."))) {
      await writer.current!.flush();
      // « redresse » pose l'angle mesuré : les photos analysées avant qu'on
      // sache le mesurer le sont maintenant, une fois pour toutes.
      const auto = plan.actions.some((a) => a.kind === "photo.autostraighten");
      const mesurees = auto ? await mesurerNiveaux(ids) : {};
      const result = await photoTransaction(
        {
          id: plan.id,
          projectId: context.projectId,
          ids,
          label: plan.label,
          source: plan.source,
          expected: { ...context.revisions, ...mesurees },
        },
        (p) =>
          (plan.actions as PhotoAction[]).reduce(
            (photo, action) => applyPhotoAction(photo, action, plan.id),
            p,
          ),
      );
      setBefore(false);
      if (
        auto &&
        !result.count &&
        !(await getPhotos(context.projectId)).some(
          (p) =>
            ids.includes(p.id) &&
            correctionDe(p.analysis?.level, ["auto", "suggest", "level"]) !==
              undefined,
        )
      )
        return ids.length > 1
          ? "Aucune de ces photos n’avait de lignes assez fiables pour être redressée. Réglez « Redresser » à la main dans Cadrage & finition."
          : "Pas assez de lignes fiables pour redresser cette photo. Réglez « Redresser » à la main dans Cadrage & finition.";
      return `${result.count} photo(s) modifiée(s) et enregistrée(s). Vous pouvez annuler cette commande dans l’historique.`;
    }
    const a = plan.actions[0];
    if (a.kind === "history.undo" || a.kind === "history.redo") {
      await writer.current!.flush();
      const redo = a.kind === "history.redo";
      const journal = await photoHistory(context.projectId);
      // « annule » : la dernière commande encore entièrement appliquée. Une
      // annulation partielle se termine depuis l'historique ; la viser ici
      // butait sur le même conflit à chaque « annule » (29/09/2026).
      // « rétablis » : la dernière commande annulée, en tout ou en partie, et
      // seulement si aucune commande nouvelle n'a été lancée depuis.
      const candidate = redo
        ? journal.find((r) => r.state !== "done")
        : journal.find((r) => r.state === "done");
      const record =
        redo && candidate && journal.some((r) => r.created > candidate.updated)
          ? undefined
          : candidate;
      if (!record)
        return "Aucune commande à " + (redo ? "rétablir." : "annuler.");
      const result = await restoreCommand(record.id, redo);
      if (!result.count && result.conflicts)
        return `Rien n’a été ${redo ? "rétabli" : "annulé"} : ${result.conflicts} photo(s) retouchée(s) depuis gardent leurs réglages.`;
      return `${result.count} photo(s) ${redo ? "rétablie(s)" : "restaurée(s)"}. ${result.conflicts ? result.conflicts + " reprise(s) manuelle(s) conservée(s)." : ""}`;
    }
    if (a.kind === "view.original" || a.kind === "view.edit") {
      setView("editor");
      setBefore(a.kind === "view.original");
      return a.kind === "view.original"
        ? "Affichage de l’original. Vos réglages restent conservés."
        : "Affichage de la retouche.";
    }
    if (a.kind === "media.search") {
      setSearch(a.query);
      return "Recherche par nom : " + a.query;
    }
    if (a.kind === "import.open") {
      await addFiles();
      return "Les fichiers choisis rejoignent la file d’importation.";
    }
    if (a.kind === "lightroom.open") {
      setModal("lightroom");
      return "Choisissez ce que vous envoyez à Lightroom, puis vérifiez le bilan avant d’envoyer.";
    }
    if (a.kind === "export.open") {
      setModal("export");
      return "Choisissez le format et la destination dans la fenêtre d’export.";
    }
    if (a.kind === "album.process") {
      if (
        !project ||
        project.id !== context.projectId ||
        !context.ids.album.length
      )
        throw Error("Importez des photos dans ce projet.");
      await enqueueJob(
        "album",
        project,
        context.ids.album.map((id) => ({ id })),
        { style: a.style, faces: true },
      );
      return "Première passe locale lancée : analyse des variantes puis lumière et style Juno. Aucun envoi en ligne, 0 € consommé. Les corrections génératives restent individuelles.";
    }
    throw Error("Cette commande ne s’applique pas à l’espace photo.");
  }
  function rate(p: Photo, status: Photo["status"]) {
    if (p.protected && status === "reject") {
      notify("Cette photo est protégée. Retirez le cadenas pour l’écarter.");
      return;
    }
    void save(p.id, (latest) =>
      latest.protected && status === "reject"
        ? latest
        : { ...latest, status: latest.status === status ? "pending" : status },
    );
    // Le choix de la rafale suit la note : écarter la proposée fait proposer
    // la suivante, garder une autre image en fait le choix. Sans cela,
    // « Comparer les rafales » et « Voir les propositions » désignaient deux
    // images différentes (relecture du 29/09/2026). Pas d'entrée d'historique :
    // la proposition n'est pas un réglage.
    const groupe = p.analysis?.groupId;
    if (!groupe) return;
    const nouveau = p.status === status ? "pending" : status;
    const rafale = items
      .filter((q) => q.analysis?.groupId === groupe)
      .map((q) => (q.id === p.id ? { ...q, status: nouveau } : q));
    for (const q of rechoisirRafale(
      rafale,
      p.id,
      priorityPeople(p.projectId).map((x) => x.id),
    ))
      void save(q.id, (latest) =>
        latest.analysis
          ? {
              ...latest,
              analysis: {
                ...latest.analysis,
                suggested: q.analysis!.suggested,
                verdict: q.analysis!.verdict,
                reasons: q.analysis!.reasons,
                advice: q.analysis!.advice,
              },
            }
          : latest,
      );
  }
  function move(n: number) {
    const idx = filtered.findIndex((p) => p.id === current?.id);
    const next = filtered[Math.max(0, Math.min(filtered.length - 1, idx + n))];
    if (next) {
      setActiveId(next.id);
      setPage(Math.floor(filtered.indexOf(next) / 60));
    }
  }
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.closest(
          'input:not([type="range"]),textarea,select,dialog,[contenteditable="true"]',
        ) ||
        modal ||
        commandsOpen ||
        busy ||
        // Dans Médias, la photo active n'est pas visible : un X l'écarterait
        // sans que rien ne le montre.
        mediaHub
      )
        return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && current) {
        e.preventDefault();
        void save(current.id, e.shiftKey ? redoPhoto : undoPhoto);
        return;
      }
      if (target.closest('input[type="range"]') || e.metaKey || e.ctrlKey)
        return;
      // Original / retouche : seulement dans l'atelier, où il se voit. Dans
      // la grille, il ouvrait ensuite l'atelier sur l'original sans le dire.
      if (view === "editor" && basculeOriginal(e)) {
        setBefore((b) => !b);
        return;
      }
      if (e.altKey) return;
      const etoiles = etoilesDeTouche(e);
      if ((e.key === " " || e.key === "Enter") && target.closest("button"))
        return;
      if (e.key.toLowerCase() === "f") {
        setFocusMode((v) => !v);
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        move(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        move(-1);
      } else if (e.key.toLowerCase() === "c")
        setView((v) => (v === "compare" ? "grid" : "compare"));
      else if (e.key.toLowerCase() === "p" && current) rate(current, "keep");
      else if (e.key.toLowerCase() === "x" && current) rate(current, "reject");
      else if (e.key === " " && current) {
        e.preventDefault();
        setView((v) => (v === "grid" ? "editor" : "grid"));
      } else if (etoiles !== undefined && current)
        void save(current.id, (latest) => ({
          ...latest,
          stars: etoiles,
        }));
      else if (e.key === "Escape") {
        setView("grid");
        setBefore(false);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [current, filtered, modal, commandsOpen, busy, mediaHub, focusMode]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === "k" &&
        !busy &&
        !modal
      ) {
        e.preventDefault();
        setCommandsOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [busy, modal]);
  function toggleSelection(id: string) {
    setSelection((old) => {
      const next = new Set(old);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  async function selectBatch(action: "keep" | "reject" | "protect") {
    const ids = items.filter((p) => selection.has(p.id)).map((p) => p.id);
    try {
      await saveBatch(ids, (latest) =>
        action === "protect"
          ? { ...latest, protected: true }
          : latest.protected && action === "reject"
            ? latest
            : { ...latest, status: action },
      );
      notify(
        `${ids.length} photo(s) traitée(s). Les photos protégées restent conservées.`,
      );
      setSelection(new Set());
    } catch (e) {
      notify("Changements en attente : " + (e as Error).message);
    }
  }
  async function addFiles(files?: FileList | File[]) {
    if (importLock.current) return;
    importLock.current = true;
    try {
      let target = project;
      if (!target) throw Error("Créez d’abord un projet.");
      let inputs: any[] = [];
      if (files && window.juno?.registerDroppedMedia)
        inputs = await window.juno.registerDroppedMedia(Array.from(files));
      else if (files)
        inputs = Array.from(files).map((f) => ({
          id: uid(),
          name: f.name,
          size: f.size,
          source: "idb",
          blob: f,
          kind: f.type.startsWith("audio/")
            ? "audio"
            : f.type.startsWith("video/")
              ? "video"
              : undefined,
        }));
      else if (window.juno) inputs = await window.juno.pickImages();
      else {
        fileInput.current?.click();
        return;
      }
      if (!inputs.length) return;
      if (target.demo) {
        target = {
          id: uid(),
          name: "Mon premier projet",
          kind: newKind,
          date: dateDuJour(),
          location: "",
          demo: false,
          created: Date.now(),
        };
        await putProject(target);
        setProjects((ps) => [...ps, target!]);
        openProject(target.id);
      }
      const photos = inputs.filter(
        (i) => i.kind === "photo" || (!i.kind && supportedPhoto(i.name)),
      );
      const media = inputs.filter((i) => !photos.includes(i));
      // A browser has no native video engine: retain unsupported entries as explicit errors.
      const photoItems = window.juno ? photos : inputs;
      if (photoItems.length)
        importsSuivis.current.add(
          await enqueueJob("import", target, photoItems, { kind: target.kind }),
        );
      let mediaProject: string | undefined;
      if (media.length && window.juno) {
        const result = await window.juno.video.importRegistered({
          ids: media.map((i) => i.id),
          photoProjectId: target.id,
          name: target.name,
        });
        mediaProject = result.projectId;
        localStorage.setItem("juno-video-project", result.projectId);
      }

      setView("grid");
      setFilter("all");
      setChapter("Tout le projet");
      // Rien n'est encore ajouté à ce stade : des doublons peuvent être
      // ignorés, des fichiers échouer. Le bilan réel suit en fin de tâche.
      notify(annonceImport(photoItems.length, window.juno ? media.length : 0));
      if (mediaProject && !photoItems.length) onVideo?.();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      importLock.current = false;
    }
  }
  async function createProject() {
    if (!newName.trim()) return;
    try {
      const p: Project = {
        id: uid(),
        name: newName.trim(),
        date: newDate,
        location: newPlace.trim(),
        demo: false,
        kind: newKind,
        created: Date.now(),
      };
      await putProject(p);
      setProjects((ps) => [...ps, p]);
      openProject(p.id);
      setModal(null);
      setNewName("");
      setNewPlace("");
      notify("Votre projet est prêt. Importez vos premières photos.");
    } catch (e) {
      notify((e as Error).message);
    }
  }
  async function analyze() {
    if (!project || !items.length) return;
    setModal(null);
    try {
      await enqueueJob(
        "analyze",
        project,
        items.map((p) => ({ id: p.id, name: p.name })),
        { faces: faceAnalysis },
      );
      notify(
        "Analyse ajoutée aux tâches. Vos décisions de tri restent modifiables.",
      );
    } catch (e) {
      notify((e as Error).message);
    }
  }
  async function acceptSuggestions() {
    const selected = items.filter(
      (p) => p.analysis?.suggested && p.status === "pending",
    );
    try {
      await saveBatch(
        selected.map((p) => p.id),
        (latest) => ({ ...latest, status: "keep" }),
      );
      notify(
        `${selected.length} proposition(s) ajoutée(s) aux photos gardées.`,
      );
    } catch (e) {
      notify((e as Error).message);
    }
  }
  async function backupProject() {
    if (!window.juno || !project) return;
    cancel.current = false;
    setModal(null);
    setBusy("Préparation de la sauvegarde");
    let token: string | null = null;
    try {
      token = await window.juno.beginExport();
      if (!token) return;
      const backed = [];
      for (let i = 0; i < items.length; i++) {
        if (cancel.current)
          throw Error(
            "Sauvegarde interrompue. Le dossier partiel ne peut pas être restauré.",
          );
        const p = items[i];
        if (p.previewOnly)
          throw Error("Reliez les originaux avant de sauvegarder ce projet.");
        setBusy(`Sauvegarde des originaux · ${i + 1} / ${items.length}`);
        setProgress(((i + 1) / items.length) * 100);
        const originalFile = `${String(i + 1).padStart(5, "0")}_${p.id}.${
          p.name
            .split(".")
            .pop()
            ?.replace(/[^a-z0-9]/gi, "") || "bin"
        }`;
        const bytes = p.source.startsWith("juno://image/")
          ? undefined
          : await (await sourceBlob(p)).arrayBuffer();
        const check = await window.juno.copyOriginal(
          token,
          originalFile,
          p.source,
          bytes,
        );
        if (check.sha256 !== p.hash)
          throw Error("Le fichier original a changé : " + p.name);
        backed.push({ ...(await hydratePhoto(p)), originalFile });
      }
      const manifest = {
        schema: 2,
        created: new Date().toISOString(),
        project,
        photos: backed,
      };
      await window.juno.writeExport(
        token,
        "juno-backup.json",
        new TextEncoder().encode(JSON.stringify(manifest)).buffer,
      );
      notify(
        `Sauvegarde complète · ${backed.length} originaux vérifiés. Conservez ce dossier sur un autre disque.`,
      );
    } catch (e) {
      notify((e as Error).message);
    } finally {
      if (token) await window.juno.finishExport(token);
      setBusy("");
    }
  }
  async function restoreBackup() {
    if (!window.juno) return;
    setBusy("Vérification et restauration de la sauvegarde");
    setModal(null);
    try {
      const data = await window.juno.restoreBackup();
      if (data) {
        await restoreProject(data.project, data.photos);
        setProjects((ps) => [...ps, data.project]);
        setPhotos(data.photos.map((p) => ({ ...p, thumbnail: "" })));
        openProject(data.project.id, data.photos[0]?.id);
        notify("Sauvegarde restaurée dans un nouveau projet.");
      }
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function relink() {
    if (!window.juno) return;
    setBusy("Vérification des originaux");
    try {
      const result = await window.juno.relinkOriginals(
        items.map((p) => ({ id: p.id, hash: p.hash })),
      );
      const linked = new Map(result.map((p) => [p.id, p.source]));
      await saveBatch(
        items.filter((p) => linked.has(p.id)).map((p) => p.id),
        (latest) => ({
          ...latest,
          source: linked.get(latest.id)!,
          previewOnly: false,
        }),
      );
      notify(`${result.length} original(aux) relié(s) par empreinte exacte.`);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function applySeries() {
    if (!current) return;
    const scope = items.filter((p) => p.status === "keep");
    if (!scope.length) {
      notify(
        "Gardez au moins une photo pour appliquer les réglages à la sélection.",
      );
      return;
    }
    try {
      // La géométrie est propre à chaque photo, redressement compris : chacune
      // penche à sa façon.
      const { localEdits, cropRect, crop, rotation, straighten, ...global } =
        current.adjustments;
      await saveBatch(
        scope.map((p) => p.id),
        (latest) => editPhoto(latest, { ...ADVANCED_DEFAULTS, ...global }),
      );
      notify(`Réglages appliqués aux ${scope.length} photos gardées.`);
    } catch (e) {
      notify((e as Error).message);
    }
  }
  async function balanceSeries() {
    if (!project) return;
    const scope = items.filter((p) => p.status === "keep");
    if (!scope.length) {
      notify("Gardez des photos avant d’équilibrer la série.");
      return;
    }
    try {
      await enqueueJob(
        "balance",
        project,
        scope.map((p) => ({
          id: p.id,
          name: p.name,
          adjustments: JSON.stringify(p.adjustments),
        })),
      );
      notify(
        "Équilibrage ajouté aux tâches. Les photos modifiées entre-temps seront ignorées.",
      );
    } catch (e) {
      notify((e as Error).message);
    }
  }
  async function exportImages() {
    if (!project) return;
    const list =
      exportScope === "all"
        ? items.filter((p) => p.status !== "reject")
        : exportScope === "current" && current
          ? [current]
          : items.filter((p) => p.status === "keep");
    if (!list.length) {
      notify("Aucune photo dans cette sélection.");
      return;
    }
    if (!window.juno && list.length > 100) {
      notify("Dans le navigateur, exportez 100 photos maximum par lot.");
      return;
    }
    let folder: string | null = null;
    try {
      if (window.juno) {
        folder = await window.juno.beginExport();
        if (!folder) return;
      }
      await enqueueJob(
        "export",
        project,
        list.map((p) => ({ ...p, thumbnail: "" })),
        {
          folder,
          format: exportFormat,
          size: Number(exportSize),
          quality: exportQuality / 100,
        },
      );
      setModal(null);
      notify(
        "Export ajouté aux tâches. Il conserve les réglages choisis à cet instant.",
      );
    } catch (e) {
      if (folder) await window.juno?.finishExport(folder);
      notify((e as Error).message);
    }
  }
  async function exportProject() {
    try {
      const data = {
        schema: 1,
        project,
        photos: items.map(({ thumbnail, ...p }) => p),
      };
      const b = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      if (window.juno)
        await window.juno.saveFile(
          "juno-catalogue.json",
          await b.arrayBuffer(),
        );
      else await download(b, "juno-catalogue.json");
      notify("Catalogue exporté. Conservez aussi vos fichiers originaux.");
    } catch (e) {
      notify((e as Error).message);
    }
  }
  async function runAI() {
    if (aiLock.current) return;
    if (!window.juno) {
      notify("Ouvrez l’application de bureau pour connecter le service IA.");
      return;
    }
    if (!keyReady) {
      setModal("settings");
      return;
    }
    if (!online) {
      notify("Une connexion Internet est nécessaire pour la génération IA.");
      return;
    }
    if (!aiConsent || prompt.trim().length < 3) return;
    if (!imageBudget?.canRun) {
      notify(
        budgetError || "Le budget IA du projet ne permet pas un nouvel appel.",
      );
      return;
    }
    aiLock.current = true;
    setBusy("Création IA · cela peut prendre quelques minutes");
    try {
      const canvas =
        aiMode === "edit" && current
          ? await renderPhoto(current, current.adjustments, 1536)
          : null;
      const image = canvas
        ? await (await toBlob(canvas, "image/png")).arrayBuffer()
        : undefined;
      const mask =
        canvas && current
          ? await createAIMask(current, canvas.width, canvas.height)
          : undefined;
      const reference = aiReference
        ? await aiReference.arrayBuffer()
        : undefined;
      const result = await window.juno.editAI({
        projectId,
        prompt,
        image,
        mask,
        reference,
        mode: aiMode,
      });
      const blob = new Blob([new Uint8Array(result.bytes)], {
        type: "image/png",
      });
      const url = URL.createObjectURL(blob);
      setAiResult({
        blob,
        url,
        prompt,
        projectId: projectId,
        parentId: aiMode === "edit" ? current?.id : undefined,
        chapter: current?.chapter || chaptersFor(project?.kind)[1],
      });
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy("");
      aiLock.current = false;
      void window.juno
        .imageBudget(projectId)
        .then((value) => {
          if (activeProjectRef.current === projectId) setImageBudget(value);
        })
        .catch((e) => {
          if (activeProjectRef.current === projectId) setBudgetError(e.message);
        });
    }
  }
  async function acceptAI() {
    if (!aiResult || !project) return;
    try {
      const id = uid(),
        meta = await inspect(aiResult.blob);
      const p: Photo = {
        id,
        projectId: aiResult.projectId,
        name: `Juno_IA_${Date.now()}.png`,
        source: "idb",
        ...meta,
        size: aiResult.blob.size,
        hash: await fingerprint(aiResult.blob),
        status: "pending",
        stars: 0,
        protected: false,
        chapter: aiResult.chapter,
        adjustments: { ...DEFAULT },
        history: [],
        created: Date.now(),
        generated: true,
        parentId: aiResult.parentId,
        prompt: aiResult.prompt,
      };
      await putOriginal(id, aiResult.blob);
      await putPhoto(p);
      setPhotos((ps) => [...ps, p]);
      setProjectId(aiResult.projectId);
      // La création n'est pas dans le filtre en cours : l'ouvrir comme une
      // photo demandée, sinon l'atelier montrait la première du filtre.
      showPhoto(id);
      URL.revokeObjectURL(aiResult.url);
      setAiResult(null);
      notify("La création est enregistrée comme une nouvelle photo.");
    } catch (e) {
      notify((e as Error).message);
    }
  }
  const commands: CommandAction[] = [
    {
      id: "import",
      label: "Importer des médias",
      detail: "Photos, vidéos et sons",
      run: () => void addFiles(),
    },
    { id: "new", label: "Nouveau projet", run: () => setModal("new") },
    {
      id: "export",
      label: "Exporter les photos",
      disabled: !items.length,
      run: () => setModal("export"),
    },
    {
      id: "lightroom",
      label: "Envoyer le tri à Lightroom",
      detail: "Étoiles, couleurs et mots-clés dans des fichiers .xmp",
      disabled: !items.length,
      run: () => setModal("lightroom"),
    },
    {
      id: "compare",
      label: "Comparer les photos",
      keys: "C",
      disabled: !items.length,
      run: () => setView("compare"),
    },
    {
      id: "styles",
      label: "Appliquer un style Juno",
      disabled: !current,
      run: () => {
        setView("editor");
        setPanel("styles");
      },
    },
    {
      id: "analyze",
      label: "Analyser le tri",
      disabled: !items.length,
      run: () => setModal("analysis"),
    },
    {
      id: "select",
      label: "Sélectionner les photos affichées",
      detail: `${filtered.length} photos dans le filtre actuel`,
      disabled: !filtered.length,
      run: () => setSelection(new Set(filtered.map((p) => p.id))),
    },
    {
      id: "backup",
      label: "Sauvegarder ou restaurer",
      run: () => setModal("backup"),
    },
    { id: "settings", label: "Paramètres", run: () => setModal("settings") },
    ...(window.juno?.updates ? [{ id: 'updates', label: 'Mises à jour de Juno', run: () => { setModal(null); openUpdates(); } }] : []),
    {
      id: "system",
      label: "État du studio et codecs",
      detail: "Ressources, formats et diagnostic",
      run: () => setModal("system"),
    },
    { id: "team", label: "Équipe Juno", run: () => setModal("team") },
    {
      id: "focus",
      label: "Mode concentration",
      keys: "F",
      run: () => setFocusMode((v) => !v),
    },
    ...projects.map((p) => ({
      id: "project-" + p.id,
      label: p.name,
      detail: "Ouvrir le projet",
      disabled: !saved,
      run: () => openProject(p.id),
    })),
  ];
  // La bande de vignettes et le compteur de l'atelier suivent le filtre, comme
  // les flèches : une vignette hors filtre ouvrait une autre photo qu'elle.
  const bande =
    current && filtered.some((p) => p.id === current.id) ? filtered : items;
  const rangBande = current ? bande.findIndex((p) => p.id === current.id) : -1;
  const blockedName = photos.find((p) => p.id === blockedId)?.name;
  if (!ready)
    return (
      <div className="splash">
        <div className="wordmark">
          juno<span>STUDIO</span>
        </div>
        <Loader2 className="spin" />
        <p>Votre studio prend place…</p>
      </div>
    );
  return (
    <div
      className={`app refined workbench ${drawer ? "drawer-open" : ""} ${view === "editor" && !mediaHub ? "photo-editing" : ""} ${focusMode ? "focus-mode layout-focus" : ""} ${!workspaceLayout.layout.inspector ? "settings-hidden" : ""} ${!workspaceLayout.layout.filmstrip ? "filmstrip-hidden" : ""}`}
      style={workspaceLayout.style}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files.length && !busy)
          void addFiles(e.dataTransfer.files);
      }}
    >
      {commandsOpen && (
        <CommandMenu
          actions={commands}
          onClose={() => setCommandsOpen(false)}
        />
      )}
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) void addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {drawer && (
        <button
          className="drawer-backdrop"
          aria-label="Fermer la navigation"
          onClick={() => setDrawer(false)}
        />
      )}
      <aside
        className="sidebar"
        aria-label="Navigation du studio"
        inert={!drawer || !!busy}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest(".project-link,.nav-item")) {
            setDrawer(false);
            setMediaHub(false);
          }
        }}
      >
        <button
          className="brand"
          onClick={() => {
            setView("grid");
          }}
          aria-label="Juno Studio, accueil"
        >
          <span className="brand-symbol">j.</span>
          <span className="wordmark">
            juno<span>STUDIO</span>
          </span>
        </button>
        <div className="workspace-switch" aria-label="Espace de travail">
          <button className="active" aria-pressed="true">
            <Camera size={16} /> Photo
          </button>
          {onVideo && (
            <button onClick={onVideo} disabled={!!busy || !saved}>
              <Clapperboard size={16} /> Vidéo
            </button>
          )}
        </div>
        <button className="quick-access" onClick={() => setCommandsOpen(true)}>
          <Search size={15} /> Accès rapide{" "}
          <kbd>
            {navigator.platform.toLowerCase().includes("mac")
              ? "⌘ K"
              : "Ctrl K"}
          </kbd>
        </button>
        <div className="workspace-label">
          ESPACE PHOTOGRAPHE <span className="beta">ALPHA</span>
        </div>
        <button
          className="nav-item selected"
          onClick={() => {
            setView("grid");
          }}
        >
          <FolderHeart size={18} /> Mes projets{" "}
          <span className="nav-count">{projects.length}</span>
        </button>
        <button
          className="nav-item"
          onClick={() => {
            if (current) {
              setView("editor");
              setPanel("styles");
            } else notify("Importez une photo pour découvrir les styles.");
          }}
        >
          <Palette size={18} /> Styles Juno <span className="tiny-dot" />
        </button>
        <button className="nav-item" onClick={() => setModal("team")}>
          <FolderOpen size={18} /> Équipe Juno
        </button>
        <div className="section-label">
          MES PROJETS{" "}
          <button
            aria-label="Nouveau projet"
            title="Nouveau projet"
            onClick={() => setModal("new")}
          >
            <Plus size={16} />
          </button>
        </div>
        <label className="project-search">
          <Search size={14} />
          <input
            aria-label="Rechercher un projet"
            placeholder="Rechercher un projet"
            value={projectSearch}
            onChange={(e) => setProjectSearch(e.target.value)}
          />
        </label>
        <div className="project-list">
          {projects
            .filter((p) =>
              p.name
                .toLocaleLowerCase()
                .includes(projectSearch.toLocaleLowerCase()),
            )
            .map((p) => (
              <button
                key={p.id}
                className={`project-link ${p.id === projectId ? "active" : ""}`}
                onClick={() =>
                  openProject(
                    p.id,
                    photos.find((q) => q.projectId === p.id)?.id || "",
                  )
                }
              >
                <span className="project-monogram">{p.name.charAt(0)}</span>
                <span>
                  <b>{p.name}</b>
                  <small>
                    {p.demo
                      ? "Projet de démonstration"
                      : p.date
                        ? new Date(p.date + "T12:00:00").toLocaleDateString(
                            "fr-FR",
                            { day: "numeric", month: "short", year: "numeric" },
                          )
                        : "Nouveau projet"}
                  </small>
                </span>
                <ChevronRight size={14} />
              </button>
            ))}
        </div>
        <button className="new-project" onClick={() => setModal("new")}>
          <Plus size={16} /> Nouveau projet
        </button>
        <div className="sidebar-bottom">
          <div className="local-card">
            <span className="local-icon">
              <ShieldCheck size={18} />
            </span>
            <div>
              <b>Votre travail reste ici.</b>
              <p>Retouchez même hors ligne.</p>
            </div>
          </div>
          <button className="nav-item" onClick={() => setModal("backup")}>
            <ShieldCheck size={17} /> Sauvegardes
          </button>
          <button className="nav-item" onClick={() => setModal("settings")}>
            <Settings2 size={17} /> Paramètres
          </button>
          <button className="nav-item" onClick={() => setModal("system")}>
            <SlidersHorizontal size={17} /> État du studio
          </button>
          <button className="nav-item" onClick={() => setModal("help")}>
            <HelpCircle size={17} /> Aide & raccourcis
          </button>
          <div className="profile">
            <span className="avatar">J</span>
            <div>
              <b>Photographe Juno</b>
              <small>Studio local</small>
            </div>
            <span className="status-dot" />
          </div>
        </div>
      </aside>
      <div className="workspace" inert={!!busy}>
        <WorkbenchHeader
          domain={mediaHub ? "media" : "photo"}
          project={project?.name || ""}
          drawer={drawer}
          onDrawer={() => setDrawer((v) => !v)}
          disabled={!!busy || !saved}
          onMedia={() => {
            setMediaHub(true);
            setDrawer(false);
          }}
          onPhotos={() => {
            setMediaHub(false);
            setView("grid");
          }}
          onVideo={() => {
            if (project)
              void videoForPhoto(project.id, project.name)
                .then(() => onVideo?.())
                .catch((e) => notify(e.message));
          }}
          onReview={() => setModal("review-client")}
          viewControls={
            <WorkspaceControls
              workspace={workspaceLayout}
              domain="photo"
              inspectorVisible={
                view === "grid"
                  ? inspectorOpen
                  : workspaceLayout.layout.inspector
              }
              onInspector={(visible) => {
                workspaceLayout.patch({ inspector: visible, focus: false });
                if (view === "grid") setInspectorOpen(visible);
              }}
              onCommands={() => setCommandsOpen(true)}
            />
          }
        >
          <Pilot
            domain="photo"
            projectId={projectId}
            // La portée par défaut vise la photo active, pas la sélection
            // cochée : l'en-tête annonçait « N photo(s) sélectionnée(s) »
            // alors que la commande frappait la photo active (29/09/2026).
            label={`${project?.name || "Projet"} · ${current?.name || "Aucune photo active"}${selection.size ? ` · ${selection.size} photo(s) cochée(s)` : ""}`}
            capture={capturePilot}
            run={runPilot}
            history={() => photoHistory(projectId)}
            restore={async (record, redo) => {
              await writer.current!.flush();
              const r = await restoreCommand(record.id, redo);
              return `${r.count} photo(s) restaurée(s). ${r.conflicts ? r.conflicts + " reprise(s) manuelle(s) conservée(s)." : ""}`;
            }}
          />
          <JobPanel />
        </WorkbenchHeader>
        {toast && (
          <div className="workspace-status" role="status">
            <Info size={17} />
            <span>{toast}</span>
            <button
              aria-label="Fermer la notification"
              onClick={() => setToast("")}
            >
              <X size={15} />
            </button>
          </div>
        )}

        {saveError && (
          <div className="save-alert" role="alert">
            <CloudOff size={17} />
            <p>
              <b>Vos derniers changements ne sont pas enregistrés.</b>{" "}
              {saveError} Ils restent en attente sur cet ordinateur.
            </p>
            <button
              className="button primary"
              onClick={() => void retrySaves()}
            >
              <RotateCcw size={15} /> Réessayer l’enregistrement
            </button>
            {retryFailed && (
              <button
                className="button secondary"
                onClick={() => setModal("abandon")}
              >
                Abandonner le changement bloqué…
              </button>
            )}
          </div>
        )}
        {mediaHub && (
          <MediaHub
            projectId={projectId}
            photos={items}
            onImport={() => void addFiles()}
            onPhoto={(id) => {
              showPhoto(id);
              setView("editor");
              setMediaHub(false);
            }}
            onVideo={() => {
              if (project)
                void videoForPhoto(project.id, project.name)
                  .then(() => onVideo?.())
                  .catch((e) => notify(e.message));
            }}
          />
        )}
        <main className="main-area" hidden={mediaHub}>
          {project && !project.demo && (
            <ProjectMedia projectId={project.id} onOpen={onVideo} />
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {project?.demo
                  ? "VOTRE PREMIER REGARD · DÉMONSTRATION"
                  : `VOTRE PROJET · ${(project?.kind || "Projet libre").toUpperCase()}`}{" "}
              </div>
              <h1>{project?.name || "Votre prochaine histoire"}</h1>
              <p>
                {project?.date
                  ? new Date(project.date + "T12:00:00").toLocaleDateString(
                      "fr-FR",
                      { day: "numeric", month: "long", year: "numeric" },
                    )
                  : "Une nouvelle histoire à créer"}{" "}
                {project?.location && (
                  <>
                    {" "}
                    <span>·</span> {project.location}
                  </>
                )}{" "}
                <span>·</span> {FMT.format(items.length)} photos
              </p>
            </div>
            <div className="heading-actions">
              <button
                className="button secondary"
                disabled={!project}
                onClick={() => setModal("review-client")}
              >
                <MessageSquare size={16} /> Retours clients
              </button>
              <button
                className="button secondary"
                onClick={() => void addFiles()}
                disabled={!!busy}
              >
                <Plus size={16} /> Importer
              </button>
              <div
                className="export-menu"
                onBlur={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node))
                    setExportMenu(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setExportMenu(false);
                }}
              >
                <button
                  className="button primary"
                  aria-haspopup="menu"
                  aria-expanded={exportMenu}
                  onClick={() => setExportMenu(!exportMenu)}
                  disabled={!items.length || !!busy}
                >
                  <ArrowDownToLine size={16} /> Exporter{" "}
                  <ChevronDown size={14} />
                </button>
                {exportMenu && (
                  <div className="export-menu-list" role="menu">
                    <button
                      role="menuitem"
                      onClick={() => {
                        setExportMenu(false);
                        setModal("export");
                      }}
                    >
                      Exporter les photos…
                      <small>JPEG, PNG ou TIFF retouchés</small>
                    </button>
                    <button
                      role="menuitem"
                      onClick={() => {
                        setExportMenu(false);
                        setModal("lightroom");
                      }}
                    >
                      Envoyer le tri à Lightroom…
                      <small>
                        Étoiles, couleurs et mots-clés dans des fichiers .xmp
                      </small>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="project-actions">
            <nav className="view-switch" aria-label="Vue du projet">
              {[
                ["grid", "Photos"],
                ["compare", "Comparer"],
                ["editor", "Retoucher"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  aria-pressed={view === value}
                  disabled={!items.length && value !== "grid"}
                  onClick={() => setView(value as typeof view)}
                >
                  {label}
                </button>
              ))}
            </nav>
            <div className="project-actions-right">
              <AlbumAction
                compact
                projectId={projectId}
                disabled={!!busy || !photos.length}
                run={async (style) => {
                  if (!project) throw Error("Ouvrez un projet.");
                  await writer.current!.flush();
                  await enqueueJob(
                    "album",
                    project,
                    photos.map((p) => ({ id: p.id })),
                    { style, faces: true },
                  );
                }}
              />
              {analysisResult && (
                <button
                  className="text-button"
                  onClick={() => {
                    setView("grid");
                    setFilter("suggested");
                  }}
                >
                  Voir les propositions
                </button>
              )}
              {view === "grid" && (
                <button
                  className="icon-button"
                  title="Informations et outils du projet"
                  aria-label="Informations du projet"
                  aria-pressed={inspectorOpen}
                  onClick={() => setInspectorOpen((v) => !v)}
                >
                  <Info size={17} />
                </button>
              )}
            </div>
          </div>
          {selection.size > 0 && (
            <div
              className="batch-selection"
              role="region"
              aria-label="Actions groupées"
            >
              <b>{selection.size} sélectionnée(s)</b>
              <button onClick={() => void selectBatch("keep")}>
                <Check size={15} /> Garder
              </button>
              <button onClick={() => void selectBatch("reject")}>
                <X size={15} /> Écarter
              </button>
              <button onClick={() => void selectBatch("protect")}>
                <Lock size={15} /> Protéger
              </button>
              <button
                onClick={() => setSelection(new Set(filtered.map((p) => p.id)))}
              >
                Tout sélectionner ({filtered.length})
              </button>
              <button
                aria-label="Annuler la sélection"
                onClick={() => setSelection(new Set())}
              >
                <X size={15} />
              </button>
            </div>
          )}
          {fileImportReport.length > 0 && (
            <div className="report">
              <details>
                <summary>
                  {fileImportReport.length} fichier(s) à vérifier
                </summary>
                {fileImportReport.map((m, i) => (
                  <p key={i}>{m}</p>
                ))}
              </details>
              <button
                aria-label="Masquer le rapport"
                onClick={() => setFileImportReport([])}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {!items.length ? (
            <div className="empty-project">
              <div className="upload-illustration">
                <ImagePlus size={42} />
              </div>
              <div className="eyebrow">CHAQUE HISTOIRE COMMENCE ICI</div>
              <h2>Faites entrer les souvenirs.</h2>
              <p>
                Glissez vos photos, vidéos et sons ici.
                <br />
                Vos originaux restent intacts, votre regard fait le reste.
              </p>
              <button
                className="button primary"
                onClick={() => void addFiles()}
              >
                <Plus size={17} /> Importer des médias
              </button>
              <small>
                RAW, JPEG, TIFF, HEIC, vidéos et sons · Originaux conservés
              </small>
            </div>
          ) : (
            <div
              className={`studio-body ${view === "editor" ? "editing" : view === "compare" ? "comparing" : ""} ${view === "grid" && !inspectorOpen ? "inspector-hidden" : ""}`}
            >
              <section className="photo-workspace">
                {view === "compare" ? (
                  <ComparePanel
                    photos={items}
                    currentId={current?.id}
                    onRate={rate}
                    onProtect={(p) =>
                      void save(p.id, (latest) => ({
                        ...latest,
                        protected: !latest.protected,
                      }))
                    }
                    onClose={() => setView("grid")}
                  />
                ) : view === "grid" ? (
                  <>
                    <div className="collection-toolbar">
                      <div
                        className="filters"
                        role="tablist"
                        aria-label="Filtrer les photos"
                      >
                        {(
                          [
                            {
                              key: "all",
                              label: "Toutes",
                              count: items.length,
                            },
                            { key: "keep", label: "Gardées", count: kept },
                            {
                              key: "review",
                              label: "À vérifier",
                              count: items.filter(
                                (p) => p.analysis?.advice === "review",
                              ).length,
                            },
                            {
                              key: "reject",
                              label: "Écartées",
                              count: rejected,
                            },
                          ] as { key: Filter; label: string; count: number }[]
                        ).map((f) => (
                          <button
                            role="tab"
                            aria-selected={filter === f.key}
                            key={f.key}
                            className={filter === f.key ? "active" : ""}
                            onClick={() => setFilter(f.key)}
                          >
                            {f.key === "keep" && <Heart size={13} />} {f.label}
                            <span>{f.count}</span>
                          </button>
                        ))}
                      </div>
                      <div className="view-options">
                        <IconButton
                          label="Afficher les favoris"
                          active={filter === "star"}
                          onClick={() =>
                            setFilter(filter === "star" ? "all" : "star")
                          }
                        >
                          <Star size={16} />
                        </IconButton>
                        <IconButton
                          label="Changer la taille des vignettes"
                          active={dense}
                          onClick={() => setDense(!dense)}
                        >
                          <Grid2X2 size={16} />
                        </IconButton>
                      </div>
                    </div>
                    <div className="collection-subbar">
                      <div className="chapter-select">
                        <FolderOpen size={14} />
                        <select
                          aria-label="Collection du projet"
                          value={chapter}
                          onChange={(e) => setChapter(e.target.value)}
                        >
                          {chaptersFor(project?.kind).map((c) => (
                            <option key={c}>{c}</option>
                          ))}
                        </select>
                      </div>
                      <label className="search">
                        <Search size={14} />
                        <input
                          placeholder="Nom du fichier, ou décrivez ce que vous cherchez"
                          aria-label="Rechercher une photo"
                          value={search}
                          onChange={(e) => {
                            setSearch(e.target.value);
                            if (meaning) setMeaning(null);
                            setMeaningError("");
                          }}
                          onKeyDown={async (e) => {
                            if (e.key !== "Enter") return;
                            const phrase = search.trim();
                            if (phrase.length < 3) return;
                            const indexed = items.filter((p) => p.semantic);
                            if (!indexed.length) {
                              setMeaningError(
                                "Aucune photo n’est encore indexée. Lancez « Préparer l’album » : la recherche par le sens s’y construit.",
                              );
                              return;
                            }
                            setMeaningBusy(true);
                            setMeaningError("");
                            try {
                              const [vector] = await embedTexts([phrase]);
                              if (!vector)
                                throw Error("Recherche indisponible.");
                              const found = rank(
                                vector,
                                indexed.map((p) => ({
                                  id: p.id,
                                  vector: Array.from(p.semantic!),
                                })),
                              );
                              if (!found.length) {
                                setMeaningError(
                                  `Rien qui ressemble à « ${phrase} » parmi les ${indexed.length} photos indexées.`,
                                );
                                return;
                              }
                              setMeaning({
                                phrase,
                                scores: new Map(
                                  found.map((f) => [f.id, f.score]),
                                ),
                              });
                            } catch (error) {
                              setMeaningError(
                                semanticFailure() || (error as Error).message,
                              );
                            } finally {
                              setMeaningBusy(false);
                            }
                          }}
                        />
                        {meaningBusy && <Loader2 size={14} className="spin" />}
                      </label>
                      {phraseEnCours && !meaningBusy && (
                        <span className="micro-note">
                          Entrée pour chercher « {search.trim()} » dans vos
                          photos
                        </span>
                      )}
                      {meaning && (
                        <button
                          className="meaning-chip"
                          onClick={() => {
                            setMeaning(null);
                            setSearch("");
                          }}
                        >
                          {meaning.scores.size} photos pour « {meaning.phrase} »
                          <X size={12} />
                        </button>
                      )}
                      {meaningError && (
                        <p role="status" className="micro-note">
                          {meaningError}
                        </p>
                      )}
                    </div>
                    <div className="grid-options">
                      <button
                        onClick={() =>
                          setSelection(new Set(visible.map((p) => p.id)))
                        }
                        disabled={!visible.length}
                      >
                        Sélectionner cette page
                      </button>
                      <label>
                        Trier par{" "}
                        <select
                          aria-label="Ordre des photos"
                          value={sort}
                          onChange={(e) => {
                            setSort(e.target.value);
                            setPage(0);
                          }}
                        >
                          <option value="date">Date de prise de vue</option>
                          <option value="name">Nom du fichier</option>
                          <option value="stars">Étoiles</option>
                        </select>
                      </label>
                    </div>
                    <div className={`photo-grid ${dense ? "dense" : ""}`}>
                      {visible.map((p, i) => (
                        <article
                          key={p.id}
                          className={`photo-card ${current?.id === p.id ? "focused" : ""} ${p.status === "reject" ? "rejected" : ""}`}
                          onClick={() => setActiveId(p.id)}
                          onDoubleClick={() => {
                            setActiveId(p.id);
                            setView("editor");
                            setPanel("adjust");
                          }}
                          tabIndex={0}
                          aria-label={p.name}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              setActiveId(p.id);
                              setView("editor");
                            }
                          }}
                        >
                          <div className="photo-image">
                            <PhotoThumbnail
                              photo={p}
                              alt={`${p.chapter} · ${p.name}`}
                              loading="lazy"
                              draggable={false}
                            />
                            <span className="photo-index">
                              {String(page * 60 + i + 1).padStart(2, "0")}
                            </span>
                            {p.protected && (
                              <span className="protected-badge">
                                <Lock size={12} />
                              </span>
                            )}
                            {p.generated && (
                              <span className="generated-badge">
                                <Sparkles size={11} /> IA
                              </span>
                            )}
                            <div className="photo-over-actions">
                              <button
                                className={p.status === "keep" ? "chosen" : ""}
                                aria-label={`Garder ${p.name}`}
                                title="Garder · P"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  rate(p, "keep");
                                }}
                              >
                                <Check size={16} />
                              </button>
                              <button
                                className={
                                  p.status === "reject" ? "rejected" : ""
                                }
                                aria-label={`Écarter ${p.name}`}
                                title="Écarter · X"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  rate(p, "reject");
                                }}
                              >
                                <X size={15} />
                              </button>
                            </div>
                            {p.status === "keep" && (
                              <span className="kept-marker">
                                <Check size={12} /> Gardée
                              </span>
                            )}
                            {p.status === "reject" && (
                              <span className="reject-marker">Écartée</span>
                            )}
                          </div>
                          <div className="photo-meta">
                            <button
                              className={`photo-select ${selection.has(p.id) ? "selected" : ""}`}
                              role="checkbox"
                              aria-checked={selection.has(p.id)}
                              aria-label={`Sélectionner ${p.name}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleSelection(p.id);
                              }}
                            >
                              <Check size={12} />
                            </button>
                            <span title={p.analysis?.verdict || p.name}>
                              {p.name}
                            </span>
                            <div>
                              {p.stars > 0 ? (
                                <>
                                  <Star size={11} fill="currentColor" />
                                  {p.stars}
                                </>
                              ) : p.analysis?.advice === "review" ? (
                                <span
                                  className="review-dot"
                                  title="À vérifier"
                                />
                              ) : (
                                <span className="meta-dash">·</span>
                              )}
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                    {!filtered.length && (
                      <div className="empty-filter">
                        <Search size={25} />
                        <h3>Aucune photo ici, pour l’instant.</h3>
                        <p>Modifiez vos filtres pour retrouver votre projet.</p>
                        <button
                          className="button secondary"
                          onClick={() => {
                            setFilter("all");
                            setChapter("Tout le projet");
                            setSearch("");
                          }}
                        >
                          Voir toutes les photos
                        </button>
                      </div>
                    )}
                    {filtered.length > 60 && (
                      <div className="pagination">
                        <button
                          disabled={page === 0}
                          onClick={() => setPage(page - 1)}
                        >
                          <ChevronLeft size={16} /> Précédent
                        </button>
                        <span>
                          {page + 1} / {Math.ceil(filtered.length / 60)}
                        </span>
                        <button
                          disabled={(page + 1) * 60 >= filtered.length}
                          onClick={() => setPage(page + 1)}
                        >
                          Suivant <ChevronRight size={16} />
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  current && (
                    <>
                      <div className="editor-toolbar">
                        <button
                          className="text-button"
                          onClick={() => {
                            setView("grid");
                          }}
                        >
                          <ArrowLeft size={15} /> Toutes les photos
                        </button>
                        <span>
                          {current.name}
                          <small className="color-badge">
                            {current.color?.profile || "Profil à vérifier"} →
                            sRGB
                          </small>
                        </span>
                        <div>
                          <IconButton
                            label="Comparer à l’original"
                            active={before}
                            onClick={() => setBefore(!before)}
                          >
                            <Copy size={16} />
                          </IconButton>
                          <IconButton
                            label="Afficher les pixels à 100 %"
                            active={zoom}
                            onClick={() => setZoom(!zoom)}
                          >
                            <Maximize2 size={16} />
                          </IconButton>
                        </div>
                      </div>
                      <div
                        className="editor-history-bar"
                        aria-label="Historique des retouches"
                      >
                        <button
                          disabled={!current.history.length}
                          onClick={() => void save(current.id, undoPhoto)}
                          title="Annuler le dernier réglage · ⌘/Ctrl Z"
                        >
                          <RotateCcw size={15} /> Annuler
                        </button>
                        <button
                          disabled={!current.future?.length}
                          onClick={() => void save(current.id, redoPhoto)}
                          title="Rétablir · ⌘/Ctrl Maj Z"
                        >
                          <RotateCw size={15} /> Rétablir
                        </button>
                        <button
                          aria-pressed={before}
                          onClick={() => setBefore(!before)}
                        >
                          <Eye size={15} />{" "}
                          {before ? "Voir la retouche" : "Voir l’original"}
                        </button>
                        <button onClick={() => setModal("versions")}>
                          Versions · {current.versions?.length || 0}
                        </button>
                        <span
                          className={saveError ? "save-warning" : ""}
                          role="status"
                        >
                          {saveError
                            ? "Non enregistré · réessayer en haut"
                            : saved
                              ? "Enregistré sur cet ordinateur"
                              : "Enregistrement…"}
                        </span>
                      </div>
                      <EditorPreview
                        photo={current}
                        before={before}
                        zoom={zoom}
                        onError={notify}
                        onAdjust={adjust}
                      />
                      <div className="editor-bottom">
                        <div>
                          <IconButton
                            label="Photo précédente"
                            onClick={() => move(-1)}
                          >
                            <ChevronLeft size={18} />
                          </IconButton>
                          <IconButton
                            label="Photo suivante"
                            onClick={() => move(1)}
                          >
                            <ChevronRight size={18} />
                          </IconButton>
                          <span>
                            {Math.max(1, rangBande + 1)} / {bande.length}
                          </span>
                        </div>
                        <div className="rating-stars">
                          {[1, 2, 3, 4, 5].map((s) => (
                            <button
                              key={s}
                              aria-label={`${s} étoile${s > 1 ? "s" : ""}`}
                              onClick={() =>
                                void save(current.id, (latest) => ({
                                  ...latest,
                                  stars: latest.stars === s ? 0 : s,
                                }))
                              }
                            >
                              <Star
                                size={17}
                                fill={
                                  current.stars >= s ? "currentColor" : "none"
                                }
                              />
                            </button>
                          ))}
                        </div>
                        <div>
                          <button
                            className={`decision ${current.status === "reject" ? "no" : ""}`}
                            onClick={() => rate(current, "reject")}
                          >
                            <X size={15} /> Écarter
                          </button>
                          <button
                            className={`decision ${current.status === "keep" ? "yes" : ""}`}
                            onClick={() => rate(current, "keep")}
                          >
                            <Check size={15} /> Garder
                          </button>
                        </div>
                      </div>
                      <div className="filmstrip">
                        {bande
                          .slice(
                            Math.max(0, rangBande - 7),
                            Math.max(0, rangBande - 7) + 20,
                          )
                          .map((p) => (
                            <button
                              key={p.id}
                              className={p.id === current.id ? "active" : ""}
                              onClick={() => setActiveId(p.id)}
                              aria-label={`Ouvrir ${p.name}`}
                            >
                              <PhotoThumbnail photo={p} alt="" />
                              {p.status === "keep" && <Check size={11} />}
                            </button>
                          ))}
                      </div>
                    </>
                  )
                )}
                <div className="workspace-footer">
                  <span>
                    <ShieldCheck size={13} /> Originaux préservés
                  </span>
                  <span>
                    {view === "grid"
                      ? `${filtered.length} photos`
                      : "Réglages réversibles"}
                    <span className="footer-dot">·</span>
                    <button onClick={() => setModal("help")}>
                      <Keyboard size={14} /> Raccourcis
                    </button>
                  </span>
                </div>
              </section>
              <aside className="inspector">
                <PanelResize
                  width={workspaceLayout.layout.inspectorWidth}
                  onChange={(width) =>
                    workspaceLayout.patch({ inspectorWidth: width })
                  }
                />
                {view === "grid" ? (
                  <>
                    <div className="assistant-header">
                      <span className="spark-icon">
                        <Leaf size={19} />
                      </span>
                      <div>
                        <h3>Outils de l’album</h3>
                        <p>Tri, progression et photo sélectionnée.</p>
                      </div>
                    </div>
                    <div className="assistant-card">
                      <div className="pill small">
                        <span className="status-dot" /> SUR VOTRE ORDINATEUR
                      </div>
                      <h2>
                        Moins de tri.
                        <br />
                        Plus d’émotion.
                      </h2>
                      <p>
                        Une première passe sur l’album, puis vos finitions photo
                        par photo.
                      </p>
                      <button
                        className="button full"
                        onClick={() => setModal("analysis")}
                        disabled={!!busy}
                      >
                        <SlidersHorizontal size={16} /> Analyser seulement
                      </button>
                    </div>
                    {analysisResult && (
                      <div className="analysis-summary">
                        <CheckCircle2 size={17} />
                        <div>
                          <b>Analyse terminée</b>
                          <p>
                            {analysisResult.review} à vérifier ·{" "}
                            {analysisResult.similar} rapprochements possibles
                          </p>
                        </div>
                      </div>
                    )}
                    <div className="suggestion-actions">
                      <button
                        className="button secondary full"
                        disabled={
                          !items.some(
                            (p) =>
                              p.analysis?.suggested && p.status !== "reject",
                          )
                        }
                        onClick={() => setFilter("suggested")}
                      >
                        Voir les propositions (
                        {
                          items.filter(
                            (p) =>
                              p.analysis?.suggested && p.status !== "reject",
                          ).length
                        }
                        )
                      </button>
                      <button
                        className="text-button"
                        disabled={!items.some((p) => p.analysis?.suggested)}
                        onClick={() => void acceptSuggestions()}
                      >
                        Garder les propositions non décidées
                      </button>
                    </div>
                    <div className="inspector-section">
                      <div className="section-title">
                        <h3>Votre sélection</h3>
                        <span>
                          {items.length
                            ? Math.round(
                                ((kept + rejected) / items.length) * 100,
                              )
                            : 0}{" "}
                          % parcourus
                        </span>
                      </div>
                      <div className="selection-progress">
                        <div
                          style={{
                            width: `${items.length ? (kept / items.length) * 100 : 0}%`,
                          }}
                        />
                        <span
                          style={{
                            width: `${items.length ? (rejected / items.length) * 100 : 0}%`,
                          }}
                        />
                      </div>
                      <div className="selection-stat">
                        <span>
                          <i className="green" /> Gardées <b>{kept}</b>
                        </span>
                        <span>
                          <i /> À décider{" "}
                          <b>{items.length - kept - rejected}</b>
                        </span>
                      </div>
                    </div>
                    {current && (
                      <div className="inspector-section current-info">
                        <div className="section-title">
                          <h3>Photo active</h3>
                          <IconButton
                            label={
                              current.protected
                                ? "Déprotéger la photo"
                                : "Protéger la photo"
                            }
                            active={current.protected}
                            onClick={() =>
                              void save(current.id, (latest) => ({
                                ...latest,
                                protected: !latest.protected,
                              }))
                            }
                          >
                            <Lock size={14} />
                          </IconButton>
                        </div>
                        <PhotoThumbnail
                          className="current-mini"
                          photo={current}
                          alt="Photo active"
                        />
                        <b className="filename">{current.name}</b>
                        <OriginalStatus photo={current} />
                        <label className="photo-collection">
                          Collection
                          <select
                            aria-label="Collection de la photo"
                            value={current.chapter}
                            onChange={(e) =>
                              void save(current.id, (latest) => ({
                                ...latest,
                                chapter: e.target.value,
                              }))
                            }
                          >
                            {chaptersFor(project?.kind)
                              .slice(1)
                              .map((c) => (
                                <option key={c}>{c}</option>
                              ))}
                          </select>
                        </label>
                        <p>
                          {current.width} × {current.height} px <span>·</span>{" "}
                          {(current.size / 1024 / 1024).toFixed(1)} Mo
                        </p>
                        <div className="inline-decisions">
                          <button
                            className={
                              current.status === "keep" ? "active" : ""
                            }
                            onClick={() => rate(current, "keep")}
                          >
                            <Check size={16} /> Garder
                          </button>
                          <button onClick={() => rate(current, "reject")}>
                            <X size={16} /> Écarter
                          </button>
                        </div>
                        <button
                          className="button secondary full"
                          onClick={() => {
                            setView("editor");
                            setPanel("adjust");
                          }}
                        >
                          <SlidersHorizontal size={15} /> Ouvrir dans l’atelier{" "}
                          <ArrowRight size={15} />
                        </button>
                        {current.analysis?.verdict && (
                          <p className="reason verdict">
                            <Info size={12} />
                            {current.analysis.verdict}
                          </p>
                        )}
                        {project && (
                          <PeoplePanel projectId={project.id} photo={current} />
                        )}
                        {current.analysis?.reasons.map((r) => (
                          <p className="reason" key={r}>
                            <Info size={12} />
                            {r}
                          </p>
                        ))}
                      </div>
                    )}
                    <div className="gentle-note">
                      <Heart size={16} />
                      <p>
                        Une photo imparfaite peut raconter le plus beau moment.
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="panel-tabs">
                      <button
                        className={panel === "adjust" ? "active" : ""}
                        onClick={() => setPanel("adjust")}
                      >
                        <SlidersHorizontal size={16} />
                        Réglages
                      </button>
                      <button
                        className={panel === "styles" ? "active" : ""}
                        onClick={() => setPanel("styles")}
                      >
                        <Palette size={16} />
                        Styles
                      </button>
                      <button
                        className={panel === "ai" ? "active" : ""}
                        onClick={() => setPanel("ai")}
                      >
                        <Sparkles size={16} />
                        IA
                      </button>
                    </div>
                    {current && panel === "adjust" && (
                      <div className="adjust-panel">
                        <div className="section-title">
                          <h3>Lumière & couleur</h3>
                          <button
                            className="text-button"
                            title="Équilibrage selon la luminosité moyenne, sans IA"
                            onClick={() => void autoLumiere()}
                          >
                            <WandSparkles size={13} /> Auto
                          </button>
                        </div>
                        <Range
                          label="Exposition"
                          value={current.adjustments.exposure}
                          min={-4}
                          max={4}
                          step={0.01}
                          unit="IL"
                          onChange={(v, group) =>
                            adjust({ exposure: v }, group)
                          }
                        />
                        <Range
                          label="Contraste"
                          value={current.adjustments.contrast}
                          onChange={(v, group) =>
                            adjust({ contrast: v }, group)
                          }
                        />
                        <Range
                          label="Hautes lumières"
                          value={current.adjustments.highlights}
                          onChange={(v, group) =>
                            adjust({ highlights: v }, group)
                          }
                        />
                        <Range
                          label="Ombres"
                          value={current.adjustments.shadows}
                          onChange={(v, group) => adjust({ shadows: v }, group)}
                        />
                        <div className="control-divider" />
                        <Range
                          label="Chaleur"
                          value={current.adjustments.warmth}
                          onChange={(v, group) => adjust({ warmth: v }, group)}
                        />
                        <Range
                          label="Teinte"
                          value={current.adjustments.tint}
                          onChange={(v, group) => adjust({ tint: v }, group)}
                        />
                        <Range
                          label="Saturation"
                          value={current.adjustments.saturation}
                          onChange={(v, group) =>
                            adjust({ saturation: v }, group)
                          }
                        />
                        <div className="control-divider" />
                        <AdvancedAdjustments
                          key={current.id}
                          adjustments={current.adjustments}
                          onAdjust={adjust}
                        />
                        <div className="section-title">
                          <h3>Cadrage & finition</h3>
                          <div className="section-tools">
                            <button
                              className="text-button"
                              title="Redresser d’après les lignes de la photo : horizon, murs, colonnes"
                              onClick={() => void redresserAuto()}
                            >
                              <WandSparkles size={13} /> Redresser
                            </button>
                            <IconButton
                              label="Pivoter de 90 degrés"
                              onClick={() =>
                                adjust({
                                  rotation:
                                    (current.adjustments.rotation + 90) % 360,
                                })
                              }
                            >
                              <RotateCw size={15} />
                            </IconButton>
                          </div>
                        </div>
                        <Range
                          label="Redressement"
                          value={current.adjustments.straighten ?? 0}
                          min={-45}
                          max={45}
                          step={0.1}
                          unit="°"
                          onChange={(v, group) =>
                            adjust({ straighten: v }, group)
                          }
                        />
                        {(() => {
                          // Les lignes suggèrent un angle sans le garantir :
                          // on le propose, sans le poser.
                          const t = correctionDe(current.analysis?.level, [
                            "suggest",
                          ]);
                          if (!t || current.adjustments.straighten) return null;
                          return (
                            <button
                              className="level-suggestion"
                              onClick={() => adjust({ straighten: t })}
                            >
                              Redresser de{" "}
                              {Math.abs(t).toFixed(1).replace(".", ",")}° vers
                              la {t > 0 ? "droite" : "gauche"} ?
                              <small>
                                À vérifier : les lignes le suggèrent sans le
                                garantir.
                              </small>
                            </button>
                          );
                        })()}
                        <Range
                          label="Recadrage centré"
                          value={current.adjustments.crop}
                          min={0}
                          max={40}
                          onChange={(v, group) => adjust({ crop: v }, group)}
                        />
                        <Range
                          label="Vignettage"
                          value={current.adjustments.vignette}
                          min={0}
                          onChange={(v, group) =>
                            adjust({ vignette: v }, group)
                          }
                        />
                        <Range
                          label="Noirs adoucis"
                          value={current.adjustments.fade}
                          min={0}
                          max={100}
                          onChange={(v, group) => adjust({ fade: v }, group)}
                        />
                        <Range
                          label="Grain"
                          value={current.adjustments.grain}
                          min={0}
                          onChange={(v, group) => adjust({ grain: v }, group)}
                        />
                        <div className="history-actions">
                          <button
                            onClick={() => void save(current.id, resetPhoto)}
                          >
                            Revenir à l’original
                          </button>
                          {current.originalRecovery && (
                            <button
                              onClick={() =>
                                void save(current.id, recoverPhoto)
                              }
                            >
                              Rétablir la retouche
                            </button>
                          )}
                        </div>
                        <button
                          className="button secondary full"
                          onClick={() => void applySeries()}
                        >
                          <Copy size={14} /> Copier sur les photos gardées
                        </button>
                        <button
                          className="button secondary full"
                          onClick={() => setModal("versions")}
                        >
                          Versions enregistrées ·{" "}
                          {current.versions?.length || 0}
                        </button>
                        <p className="micro-note">
                          Réglages locaux réversibles. Aucun original modifié.
                        </p>
                      </div>
                    )}
                    {current && panel === "styles" && (
                      <div className="styles-panel">
                        <div className="eyebrow">LA SIGNATURE JUNO</div>
                        <h2>Un style. Votre regard.</h2>
                        <p>
                          Une palette de départ, à adapter à votre histoire.
                        </p>
                        <div className="style-list">
                          {STYLES.map((s) => (
                            <button
                              key={s.id}
                              className={
                                current.adjustments.style === s.id
                                  ? "active"
                                  : ""
                              }
                              onClick={() => adjust({ style: s.id })}
                            >
                              <span
                                className={`style-swatch ${s.id}`}
                                style={{ backgroundColor: s.color }}
                              >
                                <PhotoThumbnail photo={current} alt="" />
                              </span>
                              <span>
                                <b>{s.name}</b>
                                <small>{s.desc}</small>
                              </span>
                              {current.adjustments.style === s.id && (
                                <CheckCircle2 size={17} />
                              )}
                            </button>
                          ))}
                        </div>
                        <Range
                          label="Intensité du style"
                          min={0}
                          max={100}
                          value={current.adjustments.intensity}
                          onChange={(v, group) =>
                            adjust({ intensity: v }, group)
                          }
                        />
                        <button
                          className="button primary full"
                          onClick={() => void applySeries()}
                        >
                          <Copy size={15} /> Appliquer aux photos gardées
                        </button>
                        <button
                          className="button secondary full"
                          onClick={() => void balanceSeries()}
                        >
                          <Sun size={15} /> Équilibrer la lumière du lot
                        </button>
                        <p className="micro-note">
                          Styles de départ v0.1 à valider par Juno.
                          L’équilibrage local utilise la luminosité, sans modèle
                          IA.
                        </p>
                      </div>
                    )}
                    {panel === "ai" && (
                      <div className="ai-panel">
                        <span className="pill purple">
                          <Sparkles size={12} /> ATELIER CRÉATIF
                        </span>
                        <h2>Imaginez la suite.</h2>
                        <p>
                          Décrivez votre idée. L’original reste intact, une
                          nouvelle version prend forme.
                        </p>
                        <div className="segmented">
                          <button
                            className={aiMode === "edit" ? "active" : ""}
                            onClick={() => setAiMode("edit")}
                          >
                            Modifier la photo
                          </button>
                          <button
                            className={aiMode === "generate" ? "active" : ""}
                            onClick={() => setAiMode("generate")}
                          >
                            Créer une image
                          </button>
                        </div>
                        <label className="prompt-label" htmlFor="prompt">
                          Que souhaitez-vous changer ?
                        </label>
                        <textarea
                          id="prompt"
                          value={prompt}
                          onChange={(e) => setPrompt(e.target.value)}
                          maxLength={4000}
                          placeholder={
                            aiMode === "edit"
                              ? "Retire les éléments distrayants et conserve le sujet à l’identique…"
                              : "Un décor de studio chaleureux, lumière naturelle, matières brutes…"
                          }
                        />
                        <div className="prompt-chips">
                          {[
                            {
                              name: "Enlever",
                              icon: Scissors,
                              text: "Retire les éléments distrayants de l’arrière-plan, conserve les sujets à l’identique.",
                            },
                            {
                              name: "Peau naturelle",
                              icon: Heart,
                              text: "Atténue les petites imperfections de peau en conservant la texture, l’identité et les traits.",
                            },
                            {
                              name: "Expression",
                              icon: Eye,
                              text: "Corrige les yeux fermés en utilisant la photo de référence de la même personne. Préserve strictement son identité et les autres détails.",
                            },
                            {
                              name: "Fond",
                              icon: Image,
                              text: "Remplace le fond par un décor sobre et harmonieux, en conservant le sujet, les cheveux et la lumière.",
                            },
                            {
                              name: "Lumière",
                              icon: Sun,
                              text: "Ajoute une lumière chaude et douce venant de la gauche. Préserve les sujets et leur identité.",
                            },
                            {
                              name: "FX créatifs",
                              icon: Sparkles,
                              text: "Crée une ambiance cinématographique subtile avec un léger halo lumineux et des couleurs de film.",
                            },
                          ].map((a) => (
                            <button
                              key={a.name}
                              onClick={() => setPrompt(a.text)}
                            >
                              <a.icon size={13} />
                              {a.name}
                            </button>
                          ))}
                        </div>
                        <label className="reference-upload">
                          Image de référence (facultative)
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                try {
                                  const b = await createImageBitmap(file);
                                  const c = document.createElement("canvas");
                                  const scale = Math.min(
                                    1,
                                    1536 / Math.max(b.width, b.height),
                                  );
                                  c.width = Math.round(b.width * scale);
                                  c.height = Math.round(b.height * scale);
                                  c.getContext("2d")!.drawImage(
                                    b,
                                    0,
                                    0,
                                    c.width,
                                    c.height,
                                  );
                                  b.close();
                                  setAiReference(await toBlob(c, "image/png"));
                                  setReferenceName(file.name);
                                } catch (error) {
                                  notify((error as Error).message);
                                }
                              }
                              e.target.value = "";
                            }}
                          />
                          {referenceName && (
                            <span>
                              {referenceName}
                              <button
                                onClick={() => {
                                  setAiReference(null);
                                  setReferenceName("");
                                }}
                              >
                                Retirer
                              </button>
                            </span>
                          )}
                        </label>
                        <div className="ai-connection">
                          <span
                            className={`status-dot ${keyReady ? "" : "amber"}`}
                          />
                          <span>
                            {!window.juno
                              ? "Disponible dans l’application de bureau"
                              : keyReady
                                ? "Clé OpenAI enregistrée"
                                : "Service IA à connecter"}
                          </span>
                          <button onClick={() => setModal("settings")}>
                            <Settings2 size={14} />
                          </button>
                        </div>
                        <div className="ai-budget-summary" role="status">
                          <b>
                            Budget IA ·{" "}
                            {imageBudget
                              ? `${imageBudget.remainingEuro.toFixed(2)} € disponibles sur 5 €`
                              : "Vérification…"}
                          </b>
                          <p>
                            1 € réservé avant chaque appel en ligne, y compris
                            si la réponse est incertaine. Montant prudent,
                            distinct de la facture fournisseur. La passe locale
                            de l’album coûte 0 €.
                          </p>
                          {budgetError && <p role="alert">{budgetError}</p>}
                        </div>
                        <label className="consent">
                          <input
                            type="checkbox"
                            checked={aiConsent}
                            onChange={(e) => setAiConsent(e.target.checked)}
                          />
                          <span>
                            {aiMode === "edit"
                              ? "J’autorise l’envoi de cette photo et des références choisies à OpenAI."
                              : "J’autorise l’envoi de cette description à OpenAI."}{" "}
                            Ce traitement est facturé sur le compte API.
                          </span>
                        </label>
                        <button
                          className="button ai-button full"
                          onClick={() => void runAI()}
                          disabled={
                            !!busy ||
                            !aiConsent ||
                            !imageBudget?.canRun ||
                            prompt.trim().length < 3 ||
                            !online
                          }
                        >
                          <Sparkles size={16} />
                          {keyReady
                            ? "Générer une proposition"
                            : "Connecter et créer"}
                        </button>
                        <p className="micro-note">
                          GPT Image 1.5 · image d’entrée limitée à 1 536 px ·
                          sortie selon le modèle. Vérifiez les détails avant
                          impression. Les zones peintes avec « Masque pour l’IA
                          » limitent la demande de retouche. Le modèle peut
                          aussi modifier des détails voisins.
                        </p>
                      </div>
                    )}
                  </>
                )}
              </aside>
            </div>
          )}
        </main>
      </div>
      {busy && (
        <div className="task-progress" role="status">
          <Loader2 size={18} className="spin" />
          <div>
            <b>{busy}</b>
            <div className="task-track">
              <span style={{ width: `${progress}%` }} />
            </div>
          </div>
          {!busy.startsWith("Création IA") &&
            !busy.startsWith("Vérification") && (
              <button
                onClick={() => {
                  cancel.current = true;
                  notify("Arrêt après le fichier en cours.");
                }}
              >
                Arrêter
              </button>
            )}
        </div>
      )}
      {modal === "new" && (
        <ModalBox title="Une nouvelle histoire" onClose={() => setModal(null)}>
          <p className="modal-intro">
            Créez l’espace de votre prochain projet.
          </p>
          <label className="field">
            Type de projet
            <select
              value={newKind}
              onChange={(e) => setNewKind(e.target.value)}
            >
              {PROJECT_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Nom du projet
            <input
              autoFocus
              placeholder="Campagne été, portraits équipe…"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void createProject();
              }}
            />
          </label>
          <div className="field-row">
            <label className="field">
              Date
              <input
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
              />
            </label>
            <label className="field">
              Lieu
              <input
                placeholder="Studio, lieu…"
                value={newPlace}
                onChange={(e) => setNewPlace(e.target.value)}
              />
            </label>
          </div>
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setModal(null)}>
              Annuler
            </button>
            <button
              className="button primary"
              disabled={!newName.trim()}
              onClick={() => void createProject()}
            >
              Créer le projet <ArrowRight size={15} />
            </button>
          </div>
        </ModalBox>
      )}
      {modal === "analysis" && (
        <ModalBox
          title="Un second regard sur votre projet"
          onClose={() => setModal(null)}
        >
          <div className="modal-hero-icon">
            <Leaf size={28} />
          </div>
          <p className="modal-intro">
            L’analyse reste sur votre ordinateur. Elle repère les problèmes de
            lumière, le manque de détails et les images visuellement proches.
          </p>
          <label className="team-consent">
            <input
              type="checkbox"
              checked={faceAnalysis}
              onChange={(e) => setFaceAnalysis(e.target.checked)}
            />{" "}
            Analyser aussi les visages avec le modèle IA local
          </label>
          <ul className="feature-list">
            <li>
              <Check size={16} /> Aucune photo supprimée ou écartée
              automatiquement.
            </li>
            <li>
              <Check size={16} /> Vos choix et vos photos protégées sont
              conservés.
            </li>
            <li>
              <Info size={16} /> Les yeux fermés sont une estimation : profils,
              petits visages ou lunettes peuvent tromper le modèle.
            </li>
          </ul>
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setModal(null)}>
              Plus tard
            </button>
            <button className="button primary" onClick={() => void analyze()}>
              Analyser {items.length} photos <ArrowRight size={15} />
            </button>
          </div>
        </ModalBox>
      )}
      {modal === "export" && (
        <ModalBox
          title="Prêt à livrer votre projet ?"
          onClose={() => setModal(null)}
        >
          <p className="modal-intro">
            Les réglages sont appliqués à de nouveaux fichiers. Vos originaux
            restent intacts.
          </p>
          <label className="field">
            Photos à exporter
            <select
              value={exportScope}
              onChange={(e) => setExportScope(e.target.value)}
            >
              <option value="keep">Les photos gardées ({kept})</option>
              <option value="all">
                Toutes sauf les écartées ({items.length - rejected})
              </option>
              <option value="current">La photo active</option>
            </select>
          </label>
          <div className="field-row">
            <label className="field">
              Dimensions
              <select
                aria-label="Dimensions d’export"
                value={exportSize}
                onChange={(e) => setExportSize(e.target.value)}
              >
                <option value="2400">Web · bord long de 2 400 px</option>
                <option value="4000">Grand format · 4 000 px</option>
                <option value="0">Résolution d’origine</option>
              </select>
            </label>
            <label className="field">
              Format
              <select
                aria-label="Format d’export"
                value={exportFormat}
                onChange={(e) => setExportFormat(e.target.value)}
              >
                <option value="jpeg">JPEG</option>
                <option value="png">PNG</option>
                <option value="tiff">TIFF · 16 bits</option>
              </select>
            </label>
          </div>
          {exportFormat === "jpeg" && (
            <Range
              label="Qualité JPEG"
              min={50}
              max={100}
              value={exportQuality}
              onChange={setExportQuality}
            />
          )}
          <div className="notice">
            <Info size={16} />
            <p>
              Rendu sRGB, sans métadonnées EXIF/GPS. Le TIFF conserve la
              précision 16 bits des RAW et TIFF compatibles ; une source 8 bits
              ne gagne pas de détails.{" "}
              {window.juno
                ? "Choisissez un nouveau dossier de livraison."
                : "Les photos seront réunies dans un ZIP (100 maximum dans l’aperçu navigateur)."}{" "}
              Le fichier des réglages sera inclus.
            </p>
          </div>
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setModal(null)}>
              Annuler
            </button>
            <button
              className="button primary"
              disabled={!items.length}
              onClick={() => void exportImages()}
            >
              <ArrowDownToLine size={16} /> Exporter les photos
            </button>
          </div>
        </ModalBox>
      )}
      {modal === "lightroom" && project && (
        <ModalBox
          title="Envoyer le tri à Lightroom Classic"
          onClose={() => setModal(null)}
        >
          <LightroomPanel
            photos={items}
            selection={[...selection]}
            projectId={project.id}
            onClose={() => setModal(null)}
            notify={notify}
          />
        </ModalBox>
      )}
      {modal === "settings" && (
        <ModalBox
          title="Votre studio, vos préférences"
          onClose={() => setModal(null)}
        >
          {window.juno?.updates && <div className="settings-block"><h3>Mises à jour de Juno</h3><p>Recherchez une nouvelle version, consultez ses nouveautés et installez-la quand vous êtes prêt.</p><button className="button secondary" onClick={() => { setModal(null); openUpdates(); }}>Ouvrir les mises à jour</button></div>}
          <div className="settings-block">
            <h3>
              <ShieldCheck size={18} /> Un studio local
            </h3>
            <p>
              Vos projets sont enregistrés sur cet appareil. Dans l’application
              de bureau, les nouveaux originaux sont copiés et vérifiés dans
              Juno. Les anciens imports peuvent encore dépendre de leur dossier
              source. Conservez aussi une sauvegarde sur un autre disque.
            </p>
            <button
              className="button secondary"
              onClick={() => void exportProject()}
            >
              <ArrowDownToLine size={15} /> Exporter le catalogue de ce projet
            </button>
          </div>
          <div className="settings-block">
            <h3>
              <Palette size={18} /> Ce que Juno apprend de vos corrections
            </h3>
            <p>
              Après une passe d’album, Juno retient ce que vous corrigez sur
              chaque photo et l’ajoute aux propositions des passes suivantes,
              par-dessus sa mesure de l’image et votre style Lightroom. Tout
              reste sur cet appareil.
            </p>
            <p className="micro-note" data-testid="style-appris">
              {describeLearned(readProfile())}
            </p>
            {!!readProfile()?.samples &&
              (oubliStyle ? (
                <div role="group" aria-label="Confirmer l’oubli">
                  <p className="micro-note">
                    Juno repartira de zéro : les prochaines passes d’album ne
                    porteront plus ce style. Vos photos déjà retouchées ne
                    changent pas.
                  </p>
                  <div className="settings-actions">
                    <button
                      className="button primary"
                      onClick={() => {
                        forgetProfile();
                        setOubliStyle(false);
                        notify(
                          "Juno a oublié ce qu’il avait appris de vos corrections.",
                        );
                      }}
                    >
                      Oui, tout oublier
                    </button>
                    <button
                      className="text-button"
                      onClick={() => setOubliStyle(false)}
                    >
                      Annuler
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  className="button secondary"
                  onClick={() => setOubliStyle(true)}
                >
                  <RotateCcw size={15} /> Oublier ce que Juno a appris de mes
                  corrections
                </button>
              ))}
          </div>
          <div className="settings-block">
            <h3>
              <Sparkles size={18} /> Connexion IA · OpenAI
            </h3>
            <p>
              La génération requiert Internet et un compte API facturé
              séparément. La clé est chiffrée par le système et n’est jamais
              enregistrée dans le catalogue.
            </p>
            <label className="field">
              Clé API
              <input
                type="password"
                autoComplete="off"
                placeholder={keyReady ? "Une clé est déjà enregistrée" : "sk-…"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                disabled={!window.juno}
              />
            </label>
            <div className="settings-actions">
              <button
                className="button primary"
                disabled={!window.juno || !apiKey.trim()}
                onClick={async () => {
                  try {
                    await window.juno!.saveKey(apiKey.trim());
                    setKeyReady(true);
                    setApiKey("");
                    notify("Clé enregistrée de façon chiffrée.");
                  } catch (e) {
                    notify((e as Error).message);
                  }
                }}
              >
                Enregistrer la clé
              </button>
              {keyReady && (
                <button
                  className="text-button"
                  onClick={async () => {
                    try {
                      await window.juno!.saveKey("");
                      setKeyReady(false);
                      notify("Clé supprimée.");
                    } catch (e) {
                      notify((e as Error).message);
                    }
                  }}
                >
                  Déconnecter
                </button>
              )}
            </div>
            {!window.juno && (
              <p className="micro-note">
                La connexion IA se configure dans l’application de bureau.
              </p>
            )}
          </div>
          <div className="notice">
            <Info size={16} />
            <p>
              Juno Studio{VERSION_JUNO && ` ${VERSION_JUNO}`} · Version de
              travail. Développement RAW local, TIFF 16 bits, pinceaux, calques,
              tri de visages et partage de catalogues. La couleur, les boîtiers
              et la fiabilité en production restent à valider sur vos projets
              réels.
            </p>
          </div>
        </ModalBox>
      )}
      {modal === "team" && (
        <ModalBox title="L’équipe Juno" wide onClose={() => setModal(null)}>
          <TeamPanel
            project={project}
            photos={items}
            current={current}
            onProject={(p) =>
              setProjects((ps) => ps.map((q) => (q.id === p.id ? p : q)))
            }
            onRestore={(p, ps) => {
              setProjects((old) => [...old, p]);
              setPhotos(ps.map((p) => ({ ...p, thumbnail: "" })));
              openProject(p.id, ps[0]?.id);
            }}
          />
        </ModalBox>
      )}
      {modal === "review-client" && (
        <ModalBox title="Retours clients" wide onClose={() => setModal(null)}>
          <ReviewPanel
            target={
              project
                ? {
                    id: project.remoteId || project.id,
                    name: project.name,
                    kind: "photo",
                    photos: items,
                    selection: [...selection],
                    capturePhotos: async () => {
                      await writer.current!.flush();
                      return getPhotos(project.id);
                    },
                  }
                : undefined
            }
            onOpenSource={async (asset, anchor, instruction) => {
              if (asset.kind === "video") {
                sessionStorage.setItem(
                  "juno-review-open",
                  JSON.stringify({ asset, anchor, instruction }),
                );
                localStorage.setItem(
                  "juno-video-project",
                  asset.metadata.projectId,
                );
                if (!onVideo)
                  throw Error("Ouvrez ce retour dans l’espace vidéo de Juno.");
                setModal(null);
                onVideo();
                return;
              }
              await writer.current!.flush();
              const target = projects.find(
                (p) =>
                  p.id === asset.metadata.projectId ||
                  p.remoteId === asset.metadata.projectId,
              );
              if (!target)
                throw Error(
                  "Ce projet n’est pas présent sur cet ordinateur. Ouvrez-le depuis Équipe Juno.",
                );
              const list = await getPhotos(target.id),
                photo = list.find(
                  (p) =>
                    p.id === asset.metadata.sourceId ||
                    p.remotePhotoId === asset.logical_id,
                );
              if (!photo)
                throw Error(
                  "La source de cette photo est absente du catalogue local.",
                );
              openProject(target.id, photo.id);
              setPhotos(list);
              setView("editor");
              setModal(null);
              if (instruction)
                setTimeout(
                  () =>
                    window.dispatchEvent(
                      new CustomEvent("juno-pilot-propose", {
                        detail: {
                          text: instruction,
                          domain: "photo",
                          projectId: target.id,
                        },
                      }),
                    ),
                  150,
                );
            }}
            onSelectPhotos={async (ids, name, sourceProject) => {
              await writer.current!.flush();
              const target = projects.find(
                (p) => p.id === sourceProject || p.remoteId === sourceProject,
              );
              if (!target)
                throw Error(
                  "Ce projet n’est pas présent sur cet ordinateur. Ouvrez-le depuis Équipe Juno.",
                );
              const list = await getPhotos(target.id),
                wanted = new Set(ids),
                found = list
                  .filter(
                    (p) =>
                      wanted.has(p.id) ||
                      (!!p.remotePhotoId && wanted.has(p.remotePhotoId)),
                  )
                  .map((p) => p.id);
              openProject(target.id);
              setPhotos(list);
              setSelection(new Set(found));
              setModal(null);
              notify(
                `${name} · ${found.length} photo(s) sélectionnée(s), tri conservé.`,
              );
            }}
          />
        </ModalBox>
      )}
      {modal === "backup" && (
        <ModalBox
          title="Vos photos, en sécurité"
          onClose={() => setModal(null)}
        >
          <p className="modal-intro">
            Une sauvegarde complète contient les originaux, les réglages, les
            calques et les versions de ce projet. Conservez-la sur un disque
            indépendant.
          </p>
          <div className="backup-actions">
            <button
              className="button primary full"
              disabled={!window.juno || !!busy || !items.length}
              onClick={() => void backupProject()}
            >
              <ShieldCheck size={16} /> Sauvegarder ce projet et ses originaux
            </button>
            <button
              className="button secondary full"
              disabled={!window.juno || !!busy}
              onClick={() => void restoreBackup()}
            >
              <FolderOpen size={16} /> Restaurer une sauvegarde complète
            </button>
            <button
              className="button secondary full"
              disabled={!window.juno || !!busy || !items.length}
              onClick={() => void relink()}
            >
              <Copy size={16} /> Relier des originaux déplacés ou partagés
            </button>
            <button
              className="text-button"
              onClick={() => void exportProject()}
            >
              Exporter les réglages seuls (JSON)
            </button>
          </div>
          <div className="notice">
            <Info size={16} />
            <p>
              La restauration vérifie chaque original puis crée un nouveau
              projet. Le catalogue existant est conservé.{" "}
              {window.juno
                ? "Choisissez le fichier juno-backup.json pour restaurer."
                : "Les sauvegardes complètes sont disponibles dans l’application de bureau."}
            </p>
          </div>
        </ModalBox>
      )}
      {modal === "versions" && current && (
        <ModalBox title="Versions de la photo" onClose={() => setModal(null)}>
          <p className="modal-intro">
            Conservez plusieurs rendus avec leurs réglages, leur cadrage et
            leurs calques.
          </p>
          <label className="field">
            Nom de la version
            <input
              value={versionName}
              onChange={(e) => setVersionName(e.target.value)}
              maxLength={80}
              placeholder="Éditorial, noir et blanc, livraison…"
            />
          </label>
          <button
            className="button primary"
            disabled={
              !versionName.trim() || (current.versions?.length || 0) >= 20
            }
            onClick={() => {
              const name = versionName.trim(),
                id = uid(),
                created = Date.now();
              void save(current.id, (latest) => ({
                ...latest,
                versions: [
                  ...(latest.versions || []),
                  {
                    id,
                    name,
                    created,
                    adjustments: structuredClone(latest.adjustments),
                  },
                ].slice(-20),
              }));
              setVersionName("");
            }}
          >
            Enregistrer ce rendu
          </button>
          {current.versions?.map((v) => (
            <div className="team-row" key={v.id}>
              <span>
                <b>{v.name}</b>
                <small>{new Date(v.created).toLocaleString("fr-FR")}</small>
              </span>
              <button
                onClick={() => {
                  setBefore(false);
                  void save(current.id, (latest) =>
                    replacePhotoAdjustments(latest, v.adjustments),
                  );
                  setModal(null);
                }}
              >
                Appliquer
              </button>
              <button
                onClick={() =>
                  void save(current.id, (latest) => ({
                    ...latest,
                    versions: latest.versions?.filter((x) => x.id !== v.id),
                  }))
                }
              >
                Supprimer
              </button>
            </div>
          ))}
        </ModalBox>
      )}
      {modal === "abandon" && (
        <ModalBox
          title="Abandonner le changement bloqué ?"
          onClose={() => setModal(null)}
        >
          <p className="modal-intro">
            {blockedName
              ? `Le changement de « ${blockedName} »`
              : "Un changement sur une photo absente du catalogue"}{" "}
            ne peut pas être enregistré : {saveError}
          </p>
          <p>
            {blockedCount > 1
              ? `Les ${blockedCount} changements de cette photo sont abandonnés, et perdus.`
              : "S’il est abandonné, il est perdu."}{" "}
            {pendingSaves > blockedCount
              ? `Les ${pendingSaves - blockedCount} autre(s) changement(s) en attente sont conservés et enregistrés dans leur ordre.`
              : "Aucun autre changement n’est en attente."}
          </p>
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setModal(null)}>
              Garder en attente
            </button>
            <button
              className="button primary"
              onClick={() => void abandonBlockedSave()}
            >
              Abandonner ce changement
            </button>
          </div>
        </ModalBox>
      )}
      {modal === "system" && (
        <ModalBox title="État du studio" onClose={() => setModal(null)}>
          <SystemPanel />
        </ModalBox>
      )}
      {modal === "help" && (
        <ModalBox
          title="Le studio au bout des doigts"
          onClose={() => setModal(null)}
        >
          <p className="modal-intro">
            Importez, sélectionnez, ajustez et exportez. Double-cliquez sur une
            photo pour ouvrir l’atelier.
          </p>
          <div className="shortcut-list">
            {[
              ["P", "Garder une photo"],
              ["X", "Écarter une photo"],
              [
                "0 à 5",
                "Attribuer des étoiles (rangée du haut, avec ou sans Maj)",
              ],
              ["← →", "Photo précédente / suivante"],
              ["Espace", "Ouvrir / fermer l’atelier"],
              ["Y ou \\", "Afficher / masquer l’original"],
              ["Échap", "Revenir au projet"],
            ].map(([k, l]) => (
              <div key={k}>
                <span>{l}</span>
                <kbd>{k}</kbd>
              </div>
            ))}
          </div>
          <div className="notice">
            <ShieldCheck size={16} />
            <p>
              Écarter une photo ne supprime jamais son original. Les photos de
              démonstration proviennent d’Unsplash et ne sont pas des
              réalisations Juno.
            </p>
          </div>
        </ModalBox>
      )}
      {aiResult && (
        <ModalBox
          title="Votre proposition IA"
          wide
          onClose={() => {
            URL.revokeObjectURL(aiResult.url);
            setAiResult(null);
          }}
        >
          <p className="modal-intro">
            Vérifiez les visages et les détails. Accepter crée une nouvelle
            photo, sans modifier l’original.
          </p>
          <img
            className="ai-result"
            src={aiResult.url}
            alt="Proposition générée par IA"
          />
          <div className="modal-actions">
            <button
              className="button secondary"
              onClick={() => {
                URL.revokeObjectURL(aiResult.url);
                setAiResult(null);
              }}
            >
              Ne pas conserver
            </button>
            <button className="button primary" onClick={() => void acceptAI()}>
              <Check size={16} /> Conserver cette version
            </button>
          </div>
        </ModalBox>
      )}
    </div>
  );
}
