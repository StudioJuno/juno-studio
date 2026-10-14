import { useDock } from "../workbench/useDock";
import type { ReviewJob } from "../review/types";
import {
  isPreparing,
  preparePublication,
  stopPreparation,
} from "../review/prepare";
import type { VideoJob } from "../video/types";
import { useEffect, useRef, useState } from "react";
import {
  Activity,
  Pause,
  Play,
  X,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  RotateCcw,
  Download,
  FolderSearch,
  FileSearch,
} from "lucide-react";
import {
  subscribeJobs,
  startJobs,
  controlJob,
  type Job,
  remainingErrors,
  jobIssues,
  retryJobFailures,
  exportJobReport,
  type JobIssue,
} from "./jobs";
const labels = {
  queued: "En attente",
  running: "En cours",
  paused: "En pause",
  interrupted: "Interrompu · prêt à reprendre",
  done: "Terminé",
  failed: "À reprendre",
  cancelled: "Annulé",
};
function ImportIssues({ job }: { job: Job }) {
  const [issues, setIssues] = useState<JobIssue[]>([]),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [locations, setLocations] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    void jobIssues(job.id)
      .then((x) => {
        if (live) setIssues(x);
      })
      .catch((e) => {
        if (live) setMessage(e.message);
      });
    return () => {
      live = false;
    };
  }, [job.id, job.updated]);
  const run = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const [page, setPage] = useState(0);
  const unresolved = issues.filter((x) => !x.resolvedBy);
  return (
    <details className="import-issues">
      <summary>
        <AlertTriangle size={13} />
        {unresolved.length} fichier(s) à reprendre
        {job.resolvedCount ? ` · ${job.resolvedCount} récupéré(s)` : ""}
      </summary>
      {message && <p role="alert">{message}</p>}
      <div className="job-recovery-actions">
        {!!unresolved.length && (
          <button
            disabled={busy || ["running", "queued"].includes(job.state)}
            onClick={() => void run(() => retryJobFailures(job.id))}
          >
            <RotateCcw size={14} />
            Reprendre les fichiers échoués
          </button>
        )}
        <button
          disabled={busy}
          onClick={() => void run(() => exportJobReport(job.id))}
        >
          <Download size={14} />
          Exporter le diagnostic
        </button>
      </div>
      {issues.slice(page * 25, (page + 1) * 25).map((issue) => (
        <div className="import-issue" key={issue.index}>
          <b>{issue.name}</b>
          {issue.resolvedBy ? (
            <p className="import-recovered">
              Récupéré dans une reprise ultérieure.
            </p>
          ) : (
            <>
              <p>{issue.failure.message}</p>
              <small>
                Étape : {issue.failure.stage} · {issue.failure.code}
              </small>
              {locations[issue.id] && <p>{locations[issue.id]}</p>}
              <div className="job-recovery-actions">
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(() => retryJobFailures(job.id, issue.index))
                  }
                >
                  <RotateCcw size={13} />
                  Réessayer
                </button>
                {window.juno?.importSourceInfo && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const s = await window.juno!.importSourceInfo(issue.id);
                        setLocations((x) => ({
                          ...x,
                          [issue.id]: s.exists
                            ? `Fichier présent · ${s.managed ? "copie conservée par Juno" : "fichier externe"} · ${s.path}`
                            : `Original absent à son emplacement enregistré : ${s.path}`,
                        }));
                      })
                    }
                  >
                    <FileSearch size={13} />
                    Vérifier le fichier
                  </button>
                )}
                {window.juno?.locateImportSource && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const ok = await window.juno!.locateImportSource({
                          id: issue.id,
                          name: issue.name,
                          size: issue.size,
                          hash: issue.hash,
                        });
                        if (ok) {
                          setLocations((x) => ({
                            ...x,
                            [issue.id]:
                              "Original retrouvé. Reprise ajoutée aux tâches.",
                          }));
                          await retryJobFailures(job.id, issue.index);
                        }
                      })
                    }
                  >
                    <FolderSearch size={13} />
                    Retrouver l’original
                  </button>
                )}
              </div>
            </>
          )}
          <details>
            <summary>Détails techniques</summary>
            <p>{issue.failure.technical}</p>
            {issue.attempts.map((a, i) => (
              <p key={i}>
                Tentative {i + 1} · {a.failure?.code} · {a.failure?.stage} ·{" "}
                {a.failure?.elapsedMs
                  ? `${Math.round(a.failure.elapsedMs / 1000)} s`
                  : ""}
              </p>
            ))}
          </details>
        </div>
      ))}
      {issues.length > 25 && (
        <div className="job-actions">
          <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            Précédents
          </button>
          <span>
            {page * 25 + 1}–{Math.min(issues.length, (page + 1) * 25)} /{" "}
            {issues.length}
          </span>
          <button
            disabled={(page + 1) * 25 >= issues.length}
            onClick={() => setPage((p) => p + 1)}
          >
            Suivants
          </button>
        </div>
      )}
      <p className="micro-note">
        Le diagnostic contient les noms et emplacements des fichiers, aucune
        image ni clé API. Les tâches ayant des erreurs non résolues sont
        conservées.
      </p>
    </details>
  );
}
type Presentation = { hidden: string[]; archived: string[] };
const storageKey = "juno-job-presentation-v1";
function readPresentation(): Presentation {
  try {
    const p = JSON.parse(localStorage.getItem(storageKey) || "{}");
    return {
      hidden: Array.isArray(p.hidden)
        ? p.hidden.filter((x: unknown) => typeof x === "string")
        : [],
      archived: Array.isArray(p.archived)
        ? p.archived.filter((x: unknown) => typeof x === "string")
        : [],
    };
  } catch {
    return { hidden: [], archived: [] };
  }
}
export default function JobPanel({
  onVideoResult,
}: {
  onVideoResult?: (projectId: string, sequenceId: string) => Promise<unknown>;
} = {}) {
  const [reviewJobs, setReviewJobs] = useState<ReviewJob[]>([]);
  const [videoJobs, setVideoJobs] = useState<VideoJob[]>([]);
  const [videoNames, setVideoNames] = useState<Record<string, string>>({});
  const [photoJobs, setJobs] = useState<Job[]>([]),
    [open, setOpen] = useState(false),
    [error, setError] = useState("");
  const [presentation, setPresentation] = useState(readPresentation),
    [tab, setTab] = useState<"active" | "issues" | "history">("active"),
    [page, setPage] = useState(0),
    [undo, setUndo] = useState<Presentation>(),
    [message, setMessage] = useState("");
  const holder = useRef<HTMLDivElement>(null);
  useDock("activity", open, () => setOpen(false));
  useEffect(() => {
    const off = subscribeJobs(setJobs);
    const show = () => {
      setOpen(true);
      setTab("active");
    };
    window.addEventListener("juno-open-activity", show);
    void startJobs().catch((e) => setError(e.message));
    return () => {
      off();
      window.removeEventListener("juno-open-activity", show);
    };
  }, []);
  useEffect(() => {
    let live = true,
      pending = false;
    const refresh = async () => {
      if (!window.juno || pending) return;
      pending = true;
      try {
        const data = await window.juno.video.list();
        if (live) {
          setVideoJobs(data.jobs);
          setVideoNames(
            Object.fromEntries(data.projects.map((p) => [p.id, p.name])),
          );
        }
      } catch (e) {
        if (live) setError("Activité vidéo : " + (e as Error).message);
      } finally {
        pending = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 2500);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    let live = true,
      pending = false;
    const refresh = async () => {
      if (pending || !window.juno?.review) return;
      pending = true;
      try {
        const jobs = await window.juno.review.jobs();
        if (live) setReviewJobs(jobs);
      } catch {
        /* A disconnected portal is reported in Retours clients. */
      } finally {
        pending = false;
      }
    };
    const changed = () => void refresh();
    changed();
    const timer = setInterval(changed, 2500);
    window.addEventListener("juno-review-jobs", changed);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener("juno-review-jobs", changed);
    };
  }, []);
  const jobs: Job[] = [
    ...reviewJobs.map(
      (j): Job => ({
        id: j.id,
        kind: "export",
        label: "Publication · " + j.title,
        projectId: j.projectId,
        projectName: j.kind === "photo" ? "Relecture photo" : "Relecture vidéo",
        state:
          j.state === "preparing"
            ? isPreparing(j.id)
              ? "running"
              : j.errors.length
                ? "failed"
                : "interrupted"
            : j.state === "preparation-paused"
              ? "paused"
              : ["uploading", "publishing"].includes(j.state)
                ? "running"
                : (j.state as Job["state"]),
        total: j.total * 2,
        cursor: j.prepared + j.uploaded,
        created: j.created,
        updated: j.created,
        skipped: 0,
        errors: [
          ...j.errors.map((e, index) => ({
            index,
            name: e.logical_id,
            message: e.error,
          })),
          ...(j.error
            ? [{ index: -1, name: "Publication", message: j.error }]
            : []),
        ],
        errorCount: j.errors.length + (j.error ? 1 : 0),
        options: { review: j },
      }),
    ),
    ...photoJobs,
    ...videoJobs.map((j) => ({
      id: j.id,
      kind: "import" as const,
      label: j.label,
      projectId: j.projectId,
      projectName: videoNames[j.projectId] || "Projet vidéo",
      state: j.state,
      total: j.total,
      cursor: j.cursor,
      created: j.created,
      updated: j.created,
      errors: (j.errors || (j.error ? [j.error] : [])).map(
        (message, index) => ({ index, name: "Vidéo", message }),
      ),
      errorCount: j.unresolvedErrors ?? (j.errors?.length || (j.error ? 1 : 0)),
      skipped: 0,
      options: { video: j },
    })),
  ];
  const videoAction = async (action: () => Promise<unknown>) => {
    try {
      await action();
      const data = await window.juno!.video.list();
      setVideoJobs(data.jobs);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (open && !holder.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const group = (j: Job) =>
    ["running", "queued", "paused", "interrupted"].includes(j.state)
      ? "active"
      : presentation.archived.includes(j.id)
        ? "history"
        : remainingErrors(j) > 0 || j.state === "failed"
          ? "issues"
          : "history";
  const visible = (kind: typeof tab) =>
    jobs.filter(
      (j) => !presentation.hidden.includes(j.id) && group(j) === kind,
    );
  const list = visible(tab).sort((a, b) => b.created - a.created),
    lastPage = Math.max(0, Math.ceil(list.length / 30) - 1),
    currentPage = Math.min(page, lastPage);
  const working = jobs.filter((j) =>
    ["running", "queued"].includes(j.state),
  ).length;
  function store(next: Presentation, text: string, reversible = true) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      if (reversible) setUndo(presentation);
      setPresentation(next);
      setMessage(text);
      setError("");
    } catch {
      setError(
        "Impossible d’enregistrer l’affichage des tâches. Réessayez après avoir libéré de l’espace.",
      );
    }
  }
  const act = (id: string, action: "pause" | "resume" | "cancel") => {
    if (reviewJobs.some((j) => j.id === id)) {
      void (async () => {
        try {
          if (action !== "resume") stopPreparation(id);
          const job = await window.juno!.review.job({ id, action });
          if (action === "resume" && job.state === "preparing")
            void preparePublication(id).catch((e) => setError(e.message));
          setReviewJobs(await window.juno!.review.jobs());
          setError("");
        } catch (e) {
          setError((e as Error).message);
        }
      })();
    } else
      void (videoJobs.some((j) => j.id === id)
        ? videoAction(() => window.juno!.video.job({ id, action }))
        : controlJob(id, action).catch((e) => setError(e.message)));
  };
  function changeTab(next: typeof tab) {
    setTab(next);
    setPage(0);
  }
  return (
    <div
      className="activity-menu"
      ref={holder}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          setOpen(false);
          holder.current
            ?.querySelector<HTMLButtonElement>(".activity-toggle")
            ?.focus();
        }
      }}
    >
      <button
        className="activity-toggle"
        aria-expanded={open}
        aria-controls="photo-activity-content"
        onClick={() => {
          if (!open)
            changeTab(
              visible("active").length
                ? "active"
                : visible("issues").length
                  ? "issues"
                  : "history",
            );
          setOpen(!open);
        }}
      >
        <Activity size={16} /> Activité{working ? ` · ${working}` : ""}
        {visible("issues").length > 0 && (
          <span className="job-incident-badge">
            {visible("issues").length} à vérifier
          </span>
        )}
      </button>
      {open && (
        <section
          className="activity-popover"
          id="photo-activity-content"
          aria-label="Activité du studio"
        >
          <div className="activity-heading">
            <h2>Activité du studio</h2>
            <button
              aria-label="Fermer l’activité"
              onClick={() => setOpen(false)}
            >
              <X size={17} />
            </button>
          </div>
          <div className="activity-tabs">
            {(
              [
                ["active", "En cours"],
                ["issues", "À vérifier"],
                ["history", "Historique"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                aria-pressed={tab === key}
                onClick={() => changeTab(key)}
              >
                {label} <span>{visible(key).length}</span>
              </button>
            ))}
          </div>
          <div className="activity-toolbar">
            <span>{list.length} opération(s) · tous les projets</span>
            {tab === "history" && list.length > 0 && (
              <button
                onClick={() =>
                  store(
                    {
                      ...presentation,
                      hidden: [
                        ...new Set([
                          ...presentation.hidden,
                          ...list.map((j) => j.id),
                        ]),
                      ],
                    },
                    "Historique retiré. Aucun fichier supprimé.",
                  )
                }
              >
                Vider l’historique
              </button>
            )}
          </div>
          {error && (
            <p className="activity-feedback" role="alert">
              {error}
            </p>
          )}
          {message && (
            <div className="activity-feedback" role="status">
              <span>{message}</span>
              {undo && (
                <button
                  onClick={() => {
                    store(
                      undo,
                      "Affichage rétabli. Aucun traitement relancé.",
                      false,
                    );
                    setUndo(undefined);
                  }}
                >
                  Annuler cette action
                </button>
              )}
            </div>
          )}
          <div className="activity-list">
            {!list.length && (
              <p className="activity-empty">
                {tab === "active"
                  ? "Aucune opération en cours."
                  : tab === "issues"
                    ? "Aucun incident à vérifier."
                    : "Historique vide. Vos fichiers sont conservés."}
              </p>
            )}
            {list.slice(currentPage * 30, (currentPage + 1) * 30).map((j) => (
              <article className="job-card" key={j.id}>
                <div>
                  <b>{j.label}</b>
                  <span>
                    {j.options.review
                      ? "Retours clients"
                      : j.options.video
                        ? "Vidéo"
                        : "Photo"}{" "}
                    · {j.projectName}
                  </span>
                </div>
                <small>
                  {presentation.archived.includes(j.id)
                    ? "Incident archivé"
                    : labels[j.state]}{" "}
                  · {j.cursor} / {j.total}
                  {j.kind === "album" ? " étapes" : ""}
                  {remainingErrors(j)
                    ? ` · ${remainingErrors(j)} fichier(s) à reprendre`
                    : ""}
                  {j.skipped ? ` · ${j.skipped} ignoré(s)` : ""}
                </small>
                {group(j) === "active" && (
                  <progress max={Math.max(1, j.total)} value={j.cursor} />
                )}
                <div className="job-actions">
                  {["running", "queued"].includes(j.state) && (
                    <button onClick={() => act(j.id, "pause")}>
                      <Pause size={14} /> Suspendre
                    </button>
                  )}
                  {["paused", "interrupted", "failed"].includes(j.state) && (
                    <button onClick={() => act(j.id, "resume")}>
                      <Play size={14} /> Reprendre
                    </button>
                  )}
                  {group(j) === "active" && (
                    <button onClick={() => act(j.id, "cancel")}>
                      <X size={14} /> Arrêter
                    </button>
                  )}
                  {group(j) === "issues" && (
                    <button
                      onClick={() =>
                        store(
                          {
                            ...presentation,
                            archived: [...presentation.archived, j.id],
                          },
                          "Incident archivé ; diagnostic conservé dans l’historique.",
                        )
                      }
                    >
                      Archiver l’incident
                    </button>
                  )}
                  {group(j) === "history" && (
                    <button
                      onClick={() =>
                        store(
                          {
                            ...presentation,
                            hidden: [...presentation.hidden, j.id],
                          },
                          "Tâche retirée de l’historique. Aucun fichier supprimé.",
                        )
                      }
                    >
                      Retirer
                    </button>
                  )}
                  {presentation.archived.includes(j.id) && (
                    <button
                      onClick={() =>
                        store(
                          {
                            ...presentation,
                            archived: presentation.archived.filter(
                              (id) => id !== j.id,
                            ),
                          },
                          "Incident remis dans « À vérifier ».",
                        )
                      }
                    >
                      Remettre à vérifier
                    </button>
                  )}
                </div>
                {j.options.video && (
                  <VideoActions
                    job={j.options.video}
                    run={videoAction}
                    onResult={onVideoResult}
                  />
                )}
                {j.options.review && (
                  <button
                    onClick={() => {
                      setOpen(false);
                      window.dispatchEvent(new Event("juno-open-review"));
                    }}
                  >
                    Ouvrir les retours clients
                  </button>
                )}
                {!j.options.video &&
                !j.options.review &&
                j.kind === "import" &&
                !!j.errorCount ? (
                  <ImportIssues job={j} />
                ) : (
                  !!j.errors.length && (
                    <details>
                      <summary>
                        <AlertTriangle size={13} />
                        {j.errorCount || j.errors.length} erreur(s)
                      </summary>
                      {j.errors.slice(0, 30).map((e, i) => (
                        <p key={i}>
                          {e.name} · {e.message}
                        </p>
                      ))}
                    </details>
                  )
                )}
              </article>
            ))}
          </div>
          {lastPage > 0 && (
            <div className="activity-toolbar">
              <button
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                Précédent
              </button>
              <span>
                Page {currentPage + 1} / {lastPage + 1}
              </span>
              <button
                disabled={currentPage === lastPage}
                onClick={() => setPage(currentPage + 1)}
              >
                Suivant
              </button>
            </div>
          )}
          <p className="activity-footer">
            Les tâches continuent quand ce panneau est fermé. Retirer une tâche
            conserve les fichiers et le diagnostic.
          </p>
        </section>
      )}
    </div>
  );
}

function VideoActions({
  job: j,
  run,
  onResult,
}: {
  job: VideoJob;
  run: (action: () => Promise<unknown>) => Promise<void>;
  onResult?: (projectId: string, sequenceId: string) => Promise<unknown>;
}) {
  const api = window.juno?.video;
  if (!api) return null;
  return (
    <div className="job-actions job-video-actions">
      {j.kind === "import" && !!j.errors?.length && (
        <>
          {!!j.unresolvedErrors && ["done", "failed"].includes(j.state) && (
            <button onClick={() => void run(() => api.retryImport(j.id))}>
              Reprendre les fichiers échoués
            </button>
          )}
          <button onClick={() => void run(() => api.importReport(j.id))}>
            Exporter le diagnostic
          </button>
          {!!j.unresolvedErrors &&
            j.failures?.map((f) => (
              <button
                key={f.index}
                onClick={() =>
                  void run(() => api.locateImport({ id: j.id, index: f.index }))
                }
              >
                Retrouver {f.name}
              </button>
            ))}
        </>
      )}
      {j.result && j.kind === "autocolor" && onResult && (
        <button
          onClick={() => void run(() => onResult(j.projectId, j.result!))}
        >
          Ouvrir la version
        </button>
      )}
      {j.result && ["export", "generate"].includes(j.kind) && (
        <button onClick={() => void run(() => api.revealJob(j.id))}>
          Afficher le fichier
        </button>
      )}
      {j.kind === "generate" &&
        ["running", "paused", "interrupted"].includes(j.state) && (
          <small>
            Suspendre ou arrêter concerne le suivi local ; le traitement distant
            peut continuer.
          </small>
        )}
    </div>
  );
}
