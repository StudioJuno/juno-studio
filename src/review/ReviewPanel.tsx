import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Globe,
  Heart,
  Link,
  Loader2,
  Lock,
  MessageSquare,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Send,
  Settings2,
  Share2,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { Photo } from "../model";
import type {
  ReviewAsset,
  ReviewDelivery,
  ReviewJob,
  ReviewStatus,
  ReviewThread,
} from "./types";
import { isPreparing, preparePublication, stopPreparation } from "./prepare";
import "./review.css";
/**
 * Ce qui part vers la préparation d'une relecture : de quoi rendre la photo
 * (prepare.ts, exportPhoto) et remplir la fiche de la livraison. La fiche
 * complète, résumé de sens et empreinte de rafale compris, pesait 26 à 33 ko
 * par photo : au-delà d'environ 1 130 photos, la sélection était refusée
 * alors que le portail en annonce 10 000.
 */
export function ficheDeRelecture(p: Photo): Photo {
  const fiche: Partial<Photo> = {
    id: p.id,
    projectId: p.projectId,
    name: p.name,
    source: p.source,
    hash: p.hash,
    revision: p.revision,
    width: p.width,
    height: p.height,
    previewOnly: p.previewOnly,
    adjustments: p.adjustments,
  };
  return fiche as Photo;
}
export type ReviewTarget = {
  id: string;
  name: string;
  kind: "photo" | "video";
  photos?: Photo[];
  selection?: string[];
  capturePhotos?: () => Promise<Photo[]>;
  prepareVideo?: () => Promise<{ jobId: string; projectId: string }>;
};
type Props = {
  target?: ReviewTarget;
  onOpenSource?: (
    asset: ReviewAsset,
    anchor: ReviewThread["anchor"],
    instruction?: string,
  ) => Promise<void> | void;
  onSelectPhotos?: (
    ids: string[],
    name: string,
    projectId: string,
  ) => void | Promise<void>;
  onClose?: () => void;
};
const states: Record<string, string> = {
  preparing: "Préparation des rendus",
  queued: "En attente d’envoi",
  "preparation-paused": "Préparation suspendue",
  uploading: "Envoi des rendus",
  publishing: "Vérification et publication",
  done: "Disponible",
  paused: "Envoi suspendu",
  failed: "À reprendre",
  cancelled: "Annulée",
};
const threadStates: Record<string, string> = {
  open: "À traiter",
  working: "En cours",
  clarify: "À clarifier",
  done: "Traité",
  declined: "Non retenu",
};
export default function ReviewPanel({
  target,
  onOpenSource,
  onSelectPhotos,
}: Props) {
  const native = window.juno?.review;
  const [status, setStatus] = useState<ReviewStatus | null>(null),
    [tab, setTab] = useState<"deliveries" | "publish" | "connection">(
      "deliveries",
    ),
    [deliveries, setDeliveries] = useState<ReviewDelivery[]>([]),
    [jobs, setJobs] = useState<ReviewJob[]>([]),
    [selected, setSelected] = useState<ReviewDelivery | null>(null),
    [allProjects, setAllProjects] = useState(false),
    [revision, setRevision] = useState(""),
    [threads, setThreads] = useState<ReviewThread[]>([]),
    [threadPage, setThreadPage] = useState<number | null>(null),
    [threadFilter, setThreadFilter] = useState("all"),
    [assetMap, setAssetMap] = useState<Record<string, ReviewAsset>>({}),
    [replies, setReplies] = useState<Record<string, string>>({}),
    [internal, setInternal] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [cached, setCached] = useState(false),
    [title, setTitle] = useState(target?.name || ""),
    [welcome, setWelcome] = useState(
      "Découvrez vos images et partagez vos souhaits. Votre regard garde le dernier mot.",
    ),
    [clientName, setClientName] = useState("Client"),
    [code, setCode] = useState(""),
    [downloads, setDownloads] = useState(false),
    [expiryDays, setExpiryDays] = useState("90"),
    [scope, setScope] = useState(
      target?.selection?.length
        ? "selection"
        : target?.photos?.some((p) => p.status === "keep")
          ? "kept"
          : "all",
    ),
    [targetDelivery, setTargetDelivery] = useState(""),
    [remoteURL, setRemoteURL] = useState(""),
    [remoteToken, setRemoteToken] = useState(""),
    [shareName, setShareName] = useState(""),
    [newShareCode, setNewShareCode] = useState(""),
    [newShareApprove, setNewShareApprove] = useState(false),
    [newLink, setNewLink] = useState("");
  const [feedbackRefresh, setFeedbackRefresh] = useState(0);
  const alive = useRef(true),
    lock = useRef(false),
    detailGeneration = useRef(0),
    threadGeneration = useRef(0),
    listGeneration = useRef(0),
    pendingReplies = useRef(
      new Map<string, { opId: string; body: string; internal: boolean }>(),
    );
  async function request<T>(route: string, method = "GET", body?: unknown) {
    if (!native) throw Error("Ouvrez Juno Studio sur votre ordinateur.");
    const result = await native.request<T>({ route, method, body });
    if (alive.current) setCached(result.cached);
    return result.data;
  }
  async function action(fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function refresh() {
    if (!native) return;
    const generation = ++listGeneration.current;
    const data = await request<ReviewDelivery[]>(
      "/api/admin/deliveries" +
        (!allProjects && target ? "?projectId=" + target.id : ""),
    );
    if (alive.current && generation === listGeneration.current)
      setDeliveries(data);
  }
  async function refreshJobs() {
    if (!native) return;
    try {
      const data = await native.jobs();
      if (alive.current)
        setJobs(
          data.filter(
            (j) => allProjects || !target || j.projectId === target.id,
          ),
        );
    } catch {
      /* Connection status carries initialization failures. */
    }
  }
  useEffect(() => {
    alive.current = true;
    void native?.status().then((s) => {
      if (alive.current) {
        setStatus(s);
        if (s.mode === "remote") setRemoteURL(s.url);
        if (!s.available) setError(s.error || "Portail indisponible.");
      }
    });
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    void action(refresh);
    void refreshJobs();
    const timer = setInterval(() => void refreshJobs(), 1800),
      listener = () => void refreshJobs();
    window.addEventListener("juno-review-jobs", listener);
    return () => {
      clearInterval(timer);
      window.removeEventListener("juno-review-jobs", listener);
      listGeneration.current++;
    };
  }, [target?.id, allProjects, status?.url]);
  useEffect(() => {
    if (tab !== "deliveries") return;
    const timer = setInterval(() => {
      if (!lock.current) void refresh().catch(() => {});
    }, 15000);
    return () => clearInterval(timer);
  }, [tab, allProjects, target?.id]);
  async function detail(id: string) {
    const generation = ++detailGeneration.current;
    const data = await request<ReviewDelivery>("/api/admin/deliveries/" + id);
    if (generation !== detailGeneration.current || !alive.current) return;
    setSelected(data);
    setRevision(data.active_revision || data.revisions?.[0]?.id || "");
    setNewLink("");
    setThreadFilter("all");
    setFeedbackRefresh((n) => n + 1);
  }
  async function loadThreads(version: string, cursor = 0) {
    const generation = ++threadGeneration.current;
    const data = await request<{
      items: ReviewThread[];
      nextCursor: number | null;
    }>(
      "/api/admin/revisions/" +
        version +
        "/threads?limit=50&cursor=" +
        cursor +
        (threadFilter === "all" ? "" : "&status=" + threadFilter),
    );
    if (generation !== threadGeneration.current || !alive.current) return;
    setThreads((old) => (cursor ? [...old, ...data.items] : data.items));
    setThreadPage(data.nextCursor);
    const ids = [
      ...new Set(data.items.flatMap((t) => (t.asset_id ? [t.asset_id] : []))),
    ];
    const values = await Promise.all(
      ids.map((id) => request<ReviewAsset>("/api/admin/assets/" + id)),
    );
    if (generation === threadGeneration.current && alive.current)
      setAssetMap((old) => ({
        ...old,
        ...Object.fromEntries(values.map((v) => [v.id, v])),
      }));
  }
  useEffect(() => {
    if (!revision) {
      setThreads([]);
      return;
    }
    setThreads([]);
    setAssetMap({});
    void action(() => loadThreads(revision));
    return () => {
      threadGeneration.current++;
    };
  }, [revision, threadFilter, feedbackRefresh]);
  useEffect(() => {
    const done = jobs
      .filter((j) => j.state === "done")
      .map((j) => j.id)
      .join(",");
    if (done) void refresh().catch(() => {});
  }, [
    jobs
      .filter((j) => j.state === "done")
      .map((j) => j.id)
      .join(","),
  ]);
  function prepare(id: string) {
    setMessage(
      "Les rendus se préparent en arrière-plan. Vous pouvez continuer votre travail.",
    );
    void preparePublication(id)
      .catch((e) => {
        if (alive.current && e.name !== "AbortError") setError(e.message);
      })
      .finally(() => void refreshJobs());
  }
  async function publish() {
    if (!target || !native) return;
    const photos =
      target.kind === "photo"
        ? (await target.capturePhotos?.()) || target.photos || []
        : [];
    const chosen = photos.filter((p) =>
      scope === "selection"
        ? target.selection?.includes(p.id)
        : scope === "kept"
          ? p.status === "keep"
          : p.status !== "reject",
    );
    if (target.kind === "photo" && !chosen.length)
      throw Error("Cette sélection ne contient aucune photo.");
    if (code && code.length < 4)
      throw Error("Choisissez un code d’au moins quatre caractères.");
    let video;
    if (target.kind === "video") {
      if (!target.prepareVideo)
        throw Error("Ouvrez un montage pour préparer sa relecture.");
      video = await target.prepareVideo();
    }
    const job = await native.begin({
      projectId: target.id,
      projectName: target.name,
      title,
      message: welcome,
      kind: target.kind,
      photos: chosen.map(ficheDeRelecture),
      targetDeliveryId: targetDelivery || undefined,
      clientName,
      code,
      downloads,
      expires: expiryDays ? Date.now() + Number(expiryDays) * 86400000 : null,
      ...(video
        ? { videoProjectId: video.projectId, videoJobId: video.jobId }
        : {}),
    });
    setTab("deliveries");
    await refreshJobs();
    prepare(job.id);
  }
  async function jobAction(
    job: ReviewJob,
    which: "pause" | "resume" | "cancel" | "hide",
  ) {
    if (!native) return;
    if (which === "pause" || which === "cancel") stopPreparation(job.id);
    const value = await native.job({ id: job.id, action: which });
    if (which === "resume" && value.state === "preparing") prepare(job.id);
    await refreshJobs();
  }
  async function copy(text: string) {
    await navigator.clipboard.writeText(text);
    setMessage("Lien copié.");
  }
  async function reply(thread: ReviewThread) {
    const body = replies[thread.id]?.trim();
    if (!body) return;
    const previous = pendingReplies.current.get(thread.id),
      operation =
        previous &&
        previous.body === body &&
        previous.internal === !!internal[thread.id]
          ? previous
          : {
              opId: crypto.randomUUID(),
              body,
              internal: !!internal[thread.id],
            };
    pendingReplies.current.set(thread.id, operation);
    await request(
      "/api/admin/threads/" + thread.id + "/reply",
      "POST",
      operation,
    );
    pendingReplies.current.delete(thread.id);
    setReplies((old) => ({ ...old, [thread.id]: "" }));
    await loadThreads(revision);
  }
  async function resolve(thread: ReviewThread, value: string) {
    await request("/api/admin/threads/" + thread.id, "PATCH", {
      status: value,
      revision: thread.revision,
      assignedTo: thread.assigned_to,
    });
    await loadThreads(revision);
    await refresh();
  }
  async function open(thread: ReviewThread, pilot = false) {
    const asset = thread.asset_id ? assetMap[thread.asset_id] : null;
    if (!asset)
      throw Error(
        "Ce retour concerne la livraison entière. Choisissez les éléments à corriger dans votre projet.",
      );
    if (!onOpenSource)
      throw Error("Ouvrez le projet concerné pour reprendre sa source.");
    await onOpenSource(
      asset,
      thread.anchor,
      pilot
        ? thread.comments
            .filter((c) => !c.internal)
            .map((c) => c.body)
            .join("\n")
        : undefined,
    );
  }
  async function clientSelection() {
    const rows = await request<
      { asset_id: string; sourceId: string; logicalId: string }[]
    >("/api/admin/revisions/" + revision + "/selections");
    await onSelectPhotos?.(
      [...new Set(rows.map((r) => r.sourceId || r.logicalId))],
      selected?.title || "Sélection client",
      selected!.project_id,
    );
    setMessage(
      rows.length
        ? "Sélection client ouverte dans le projet."
        : "Les clients n’ont pas encore transmis de sélection.",
    );
  }
  const revisionInfo = selected?.revisions?.find((v) => v.id === revision);
  return (
    <div className="jr-panel">
      <div className="jr-top">
        <div>
          <span className="jr-kicker">
            UNE CONVERSATION AUTOUR DE VOS IMAGES
          </span>
          <p>Partagez. Écoutez. Affinez.</p>
        </div>
        <span
          className={
            "jr-connection " + (status?.mode === "remote" ? "remote" : "")
          }
        >
          <span />
          {status?.mode === "remote" ? "Portail connecté" : "Aperçu local"}
        </span>
      </div>
      <nav className="jr-tabs" aria-label="Retours clients">
        <button
          className={tab === "deliveries" ? "active" : ""}
          onClick={() => setTab("deliveries")}
        >
          <MessageSquare size={15} /> Retours et livraisons
        </button>
        <button
          className={tab === "publish" ? "active" : ""}
          disabled={!target}
          onClick={() => {
            setTab("publish");
            setTargetDelivery("");
            setTitle(target?.name || "");
          }}
        >
          <Share2 size={15} /> Partager au client
        </button>
        <button
          className={tab === "connection" ? "active" : ""}
          onClick={() => setTab("connection")}
        >
          <Settings2 size={15} /> Connexion
        </button>
      </nav>
      {status?.mode === "local" && (
        <div className="jr-local">
          <Globe size={17} />
          <span>
            <b>Test sur cet ordinateur.</b> Le lien local fonctionne tant que
            Juno reste ouvert. Connectez un portail hébergé pour vos clients.
          </span>
          <button onClick={() => setTab("connection")}>Configurer</button>
        </div>
      )}
      {cached && (
        <p className="jr-note">
          Retours conservés sur cet ordinateur. La connexion au portail est
          indisponible ; les actions attendent son retour.
        </p>
      )}
      {error && (
        <p className="jr-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="jr-success" role="status">
          {message}
        </p>
      )}
      {tab === "connection" && (
        <section className="jr-connect">
          <h3>Votre portail, toujours disponible.</h3>
          <p>
            Un portail hébergé reçoit les retours même lorsque Juno est fermé.
            Son adresse et votre clé sont fournis lors du déploiement.
          </p>
          <label>
            Adresse du portail
            <input
              type="url"
              placeholder="https://clients.studio-juno.fr"
              value={remoteURL}
              onChange={(e) => setRemoteURL(e.target.value)}
            />
          </label>
          <label>
            Votre clé personnelle
            <input
              type="password"
              autoComplete="off"
              placeholder="Saisie protégée sur cet ordinateur"
              value={remoteToken}
              onChange={(e) => setRemoteToken(e.target.value)}
            />
          </label>
          <div className="jr-actions">
            <button
              className="button primary"
              disabled={busy || !remoteURL || !remoteToken}
              onClick={() =>
                void action(async () => {
                  const s = await native!.connect({
                    url: remoteURL,
                    token: remoteToken,
                  });
                  setStatus(s);
                  setRemoteToken("");
                  setSelected(null);
                  setRevision("");
                  setMessage(
                    "Portail connecté. Chaque publication indiquera sa destination.",
                  );
                  await refresh();
                })
              }
            >
              Connecter le portail
            </button>
            <button
              className="button secondary"
              disabled={busy || status?.mode === "local"}
              onClick={() =>
                void action(async () => {
                  setStatus(await native!.connect({ local: true }));
                  setSelected(null);
                  setRevision("");
                  await refresh();
                })
              }
            >
              Utiliser le test local
            </button>
          </div>
          {status?.available && (
            <small>
              {status.url}
              <br />
              Stockage : {((status.storageBytes || 0) / 1024 ** 3).toFixed(
                2,
              )}{" "}
              Go / {((status.maxStorageBytes || 0) / 1024 ** 3).toFixed(0)} Go.
            </small>
          )}
          <p className="jr-note">
            La clé distante est conservée dans le stockage sécurisé du système.
            Aucun identifiant ne doit être envoyé dans une conversation.
          </p>
        </section>
      )}
      {tab === "publish" && target && (
        <section className="jr-publish">
          <div className="jr-publish-heading">
            <span className="jr-round">
              <Share2 size={23} />
            </span>
            <div>
              <h3>
                {targetDelivery
                  ? "Une nouvelle version"
                  : "Une nouvelle livraison"}
              </h3>
              <p>Les clients verront une copie figée de vos retouches.</p>
            </div>
          </div>
          <div className="jr-fields">
            <label>
              Titre de la livraison
              <input
                value={title}
                maxLength={180}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label>
              Destinataire ou groupe
              <input
                value={clientName}
                maxLength={100}
                onChange={(e) => setClientName(e.target.value)}
              />
            </label>
            {target.kind === "photo" && (
              <label>
                Photos à présenter
                <select
                  value={scope}
                  onChange={(e) => setScope(e.target.value)}
                >
                  <option value="kept">
                    Photos gardées (
                    {target.photos?.filter((p) => p.status === "keep").length ||
                      0}
                    )
                  </option>
                  <option value="selection">
                    Ma sélection ({target.selection?.length || 0})
                  </option>
                  <option value="all">
                    Toutes, sauf les écartées (
                    {target.photos?.filter((p) => p.status !== "reject")
                      .length || 0}
                    )
                  </option>
                </select>
              </label>
            )}
            <label>
              Livraison
              <select
                value={targetDelivery}
                onChange={(e) => setTargetDelivery(e.target.value)}
              >
                <option value="">Créer une livraison</option>
                {deliveries
                  .filter((d) => d.project_id === target.id)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      Nouvelle version de « {d.title} »
                    </option>
                  ))}
              </select>
            </label>
            <label className="full">
              Message d’accueil
              <textarea
                value={welcome}
                maxLength={2000}
                rows={3}
                onChange={(e) => setWelcome(e.target.value)}
              />
            </label>
          </div>
          <details className="jr-options">
            <summary>
              <Lock size={15} /> Accès et téléchargement
            </summary>
            <div className="jr-fields">
              <label>
                Code d’accès · facultatif
                <input
                  type="password"
                  autoComplete="new-password"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Sans code"
                  maxLength={200}
                />
              </label>
              <label>
                Expiration du lien
                <select
                  value={expiryDays}
                  onChange={(e) => setExpiryDays(e.target.value)}
                >
                  <option value="30">Dans 30 jours</option>
                  <option value="90">Dans 90 jours</option>
                  <option value="180">Dans 180 jours</option>
                  <option value="">Sans expiration</option>
                </select>
              </label>
              <label className="jr-check full">
                <input
                  type="checkbox"
                  checked={downloads}
                  onChange={(e) => setDownloads(e.target.checked)}
                />{" "}
                Autoriser le téléchargement des rendus de relecture
              </label>
            </div>
            <small>
              Les originaux restent dans Juno. Le nom du client est déclaré ; ce
              lien n’impose pas de vérification d’identité par email.
            </small>
          </details>
          {targetDelivery && (
            <p className="jr-note">
              Cette sélection constituera la nouvelle version complète. Les
              anciennes versions et leurs retours resteront conservés. Les liens
              actifs gardent leurs droits d’accès.
            </p>
          )}
          <div className="jr-publish-bottom">
            <span>
              <CheckCircle2 size={16} /> Retouches et originaux conservés
            </span>
            <button
              className="button primary"
              disabled={busy || !status?.available || !title.trim()}
              onClick={() => void action(publish)}
            >
              {busy ? (
                <Loader2 size={16} className="spin" />
              ) : (
                <Share2 size={16} />
              )}{" "}
              {status?.mode === "remote"
                ? "Publier pour le client"
                : "Préparer une relecture locale"}
            </button>
          </div>
        </section>
      )}
      {tab === "deliveries" && (
        <>
          <div className="jr-list-toolbar">
            <label className="jr-check">
              <input
                type="checkbox"
                checked={allProjects}
                onChange={(e) => {
                  setAllProjects(e.target.checked);
                  setSelected(null);
                  setRevision("");
                }}
              />{" "}
              Tous mes projets
            </label>
            <button
              className="jr-link"
              onClick={() =>
                void action(async () => {
                  await refresh();
                  if (selected) await detail(selected.id);
                })
              }
              disabled={busy}
            >
              <RefreshCw size={14} /> Actualiser
            </button>
          </div>
          {!!jobs.length && (
            <div className="jr-jobs">
              {jobs.map((job) => (
                <article key={job.id} className={"jr-job " + job.state}>
                  <div>
                    <b>{job.title}</b>
                    <span>
                      {states[job.state] || job.state} ·{" "}
                      {job.state === "preparing" ||
                      job.state === "preparation-paused"
                        ? `${job.prepared}/${job.total} rendus`
                        : `${job.uploaded}/${job.total} envoyés`}
                    </span>
                  </div>
                  <progress
                    max={Math.max(1, job.total * 2)}
                    value={job.prepared + job.uploaded}
                  />
                  <div className="jr-job-buttons">
                    {job.state === "preparing" && !isPreparing(job.id) && (
                      <button onClick={() => prepare(job.id)}>
                        <Play size={14} /> Préparer
                      </button>
                    )}
                    {(isPreparing(job.id) ||
                      ["uploading", "publishing"].includes(job.state)) && (
                      <button
                        onClick={() =>
                          void action(() => jobAction(job, "pause"))
                        }
                      >
                        <Pause size={14} /> Suspendre
                      </button>
                    )}
                    {["preparation-paused", "paused", "failed"].includes(
                      job.state,
                    ) && (
                      <button
                        onClick={() =>
                          void action(() => jobAction(job, "resume"))
                        }
                      >
                        <Play size={14} /> Reprendre
                      </button>
                    )}
                    {!["uploading", "publishing", "done", "cancelled"].includes(
                      job.state,
                    ) &&
                      !isPreparing(job.id) && (
                        <button
                          onClick={() =>
                            void action(() => jobAction(job, "cancel"))
                          }
                        >
                          Annuler
                        </button>
                      )}
                    {["done", "cancelled"].includes(job.state) && (
                      <button
                        onClick={() =>
                          void action(() => jobAction(job, "hide"))
                        }
                        title="Retirer cette tâche terminée"
                      >
                        <Trash2 size={14} /> Retirer
                      </button>
                    )}
                    {job.state === "done" && job.deliveryId && (
                      <button
                        onClick={() =>
                          void action(() => detail(job.deliveryId!))
                        }
                      >
                        Voir les retours
                      </button>
                    )}
                  </div>
                  {job.error && <p className="jr-error">{job.error}</p>}
                  {!!job.errors.length && (
                    <details>
                      <summary>
                        {job.errors.length} média(s) à reprendre
                      </summary>
                      {job.errors.slice(0, 30).map((e) => (
                        <p key={e.logical_id}>{e.error}</p>
                      ))}
                      <div className="jr-actions">
                        <button onClick={() => prepare(job.id)}>
                          Réessayer la préparation
                        </button>
                        <button
                          onClick={() =>
                            void action(async () => {
                              await native!.excludeFailed({ id: job.id });
                              await native!.start({ id: job.id });
                              await refreshJobs();
                            })
                          }
                        >
                          Publier uniquement les {job.prepared} rendus prêts
                        </button>
                      </div>
                    </details>
                  )}
                </article>
              ))}
            </div>
          )}
          {!selected ? (
            <div className="jr-deliveries">
              {!deliveries.length && (
                <div className="jr-empty">
                  <MessageSquare size={30} />
                  <h3>Le début d’un échange.</h3>
                  <p>
                    Partagez une sélection ou un montage. Les remarques de vos
                    clients se retrouveront ici, au bon endroit.
                  </p>
                  <button
                    className="button primary"
                    disabled={!target}
                    onClick={() => setTab("publish")}
                  >
                    <Plus size={16} /> Préparer une livraison
                  </button>
                </div>
              )}
              {deliveries.map((d) => (
                <button
                  className="jr-delivery"
                  key={d.id}
                  onClick={() => void action(() => detail(d.id))}
                >
                  <span className="jr-round">
                    <MessageSquare size={20} />
                  </span>
                  <span>
                    <b>{d.title}</b>
                    <small>
                      {d.version ? "Version " + d.version : "En préparation"} ·{" "}
                      {d.openCount || 0} retour(s) à traiter
                    </small>
                  </span>
                  <span className={"jr-badge " + d.decision.state}>
                    {d.archived
                      ? "Archivée"
                      : d.decision.state === "approved"
                        ? "Validée"
                        : d.decision.state === "changes"
                          ? "Corrections demandées"
                          : "En relecture"}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <section className="jr-detail">
              <div className="jr-detail-heading">
                <button
                  className="jr-link"
                  onClick={() => {
                    setSelected(null);
                    setRevision("");
                  }}
                >
                  ← Livraisons
                </button>
                <h3>{selected.title}</h3>
                <select
                  aria-label="Version des retours"
                  value={revision}
                  onChange={(e) => setRevision(e.target.value)}
                >
                  {selected.revisions?.map((v) => (
                    <option key={v.id} value={v.id}>
                      Version {v.number} ·{" "}
                      {v.state === "published" ? "publiée" : "en préparation"}
                    </option>
                  ))}
                </select>
              </div>
              <details className="jr-shares">
                <summary>
                  <Link size={15} /> Liens clients et accès (
                  {selected.shares?.length || 0})
                </summary>
                {selected.shares?.map((s) => (
                  <div className="jr-share-row" key={s.id}>
                    <div>
                      <b>{s.name}</b>
                      <small>
                        {s.revoked
                          ? "Révoqué"
                          : s.protected
                            ? "Code activé"
                            : "Lien privé sans code"}{" "}
                        ·{" "}
                        {s.can_approve
                          ? "Validation autorisée"
                          : "Commentaires et sélection"}
                      </small>
                    </div>
                    <button
                      disabled={!!s.revoked}
                      onClick={() =>
                        void action(async () =>
                          copy(await native!.link({ shareId: s.id })),
                        )
                      }
                      title="Copier le lien"
                    >
                      <Copy size={15} />
                    </button>
                    <button
                      disabled={!!s.revoked}
                      onClick={() =>
                        void action(async () => {
                          await native!.link({ shareId: s.id, open: true });
                        })
                      }
                      title="Voir comme le client"
                    >
                      <ExternalLink size={15} />
                    </button>
                    <label className="jr-check">
                      <input
                        type="checkbox"
                        checked={!!s.downloads}
                        onChange={(e) =>
                          void action(async () => {
                            await request(
                              "/api/admin/shares/" + s.id,
                              "PATCH",
                              { downloads: e.target.checked },
                            );
                            await detail(selected.id);
                          })
                        }
                      />
                      Télécharger
                    </label>
                    <button
                      onClick={() =>
                        void action(async () => {
                          await request("/api/admin/shares/" + s.id, "PATCH", {
                            revoked: !s.revoked,
                          });
                          await detail(selected.id);
                        })
                      }
                    >
                      {s.revoked ? "Réactiver" : "Révoquer"}
                    </button>
                  </div>
                ))}
                <div className="jr-new-share">
                  <label>
                    Un autre destinataire
                    <input
                      value={shareName}
                      maxLength={100}
                      onChange={(e) => setShareName(e.target.value)}
                      placeholder="Nom du client ou du relecteur"
                    />
                  </label>
                  <label>
                    Code facultatif
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={newShareCode}
                      maxLength={200}
                      onChange={(e) => setNewShareCode(e.target.value)}
                    />
                  </label>
                  <label className="jr-check">
                    <input
                      type="checkbox"
                      checked={newShareApprove}
                      onChange={(e) => setNewShareApprove(e.target.checked)}
                    />
                    Peut valider les prochaines versions
                  </label>
                  <button
                    className="button secondary"
                    disabled={!shareName.trim() || busy}
                    onClick={() =>
                      void action(async () => {
                        const link = await native!.createShare({
                          deliveryId: selected.id,
                          options: {
                            name: shareName,
                            code: newShareCode,
                            canApprove: newShareApprove,
                            required: newShareApprove,
                            expires: Date.now() + 90 * 86400000,
                          },
                        });
                        await detail(selected.id);
                        setNewLink(link.url);
                        setShareName("");
                        setNewShareCode("");
                      })
                    }
                  >
                    Créer un lien distinct
                  </button>
                  {newLink && (
                    <button
                      className="jr-link"
                      onClick={() => void action(() => copy(newLink))}
                    >
                      <Copy size={14} /> Copier le nouveau lien
                    </button>
                  )}
                </div>
              </details>
              <div className="jr-feedback-toolbar">
                <select
                  aria-label="Filtrer les retours"
                  value={threadFilter}
                  onChange={(e) => setThreadFilter(e.target.value)}
                >
                  <option value="all">Tous les retours</option>
                  {Object.entries(threadStates).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
                <button
                  className="jr-link"
                  onClick={() => void action(clientSelection)}
                  disabled={!revision || !onSelectPhotos}
                >
                  <Heart size={14} /> Voir les photos choisies
                </button>
                <button
                  className="jr-link"
                  disabled={!selected.active_revision || busy}
                  onClick={() =>
                    void action(async () => {
                      const data = await request(
                        "/api/admin/deliveries/" + selected.id + "/export",
                      );
                      await window.juno!.saveFile(
                        "Retours-" +
                          selected.title.replace(/[^a-zA-Z0-9_-]/g, "-") +
                          ".json",
                        new TextEncoder().encode(JSON.stringify(data, null, 2))
                          .buffer,
                      );
                    })
                  }
                >
                  <Download size={14} /> Exporter les échanges
                </button>
                {target?.id === selected.project_id && (
                  <button
                    className="jr-link"
                    onClick={() => {
                      setTargetDelivery(selected.id);
                      setTitle(selected.title);
                      setTab("publish");
                    }}
                  >
                    <Plus size={14} /> Nouvelle version
                  </button>
                )}
              </div>
              <p className="jr-note">
                Les remarques ci-dessous concernent la version{" "}
                {revisionInfo?.number}. « Traité » indique votre avancement ; la
                validation reste une décision du client.
              </p>
              {!threads.length && (
                <div className="jr-empty small">
                  <MessageSquare size={24} />
                  <p>
                    Aucun retour dans cette vue. Les réponses apparaîtront après
                    leur envoi par le client.
                  </p>
                </div>
              )}
              {threads.map((t) => (
                <article className="jr-thread" key={t.id}>
                  <header>
                    <div>
                      <b>
                        {t.asset_id
                          ? assetMap[t.asset_id]?.name || "Média"
                          : "Ensemble de la livraison"}
                      </b>
                      <span>
                        {t.visibility === "internal" ? "Note interne · " : ""}
                        {t.anchor.frame != null
                          ? "Image " +
                            (t.anchor.frame + 1) +
                            (t.anchor.endFrame != null
                              ? " à " + t.anchor.endFrame
                              : "")
                          : t.anchor.point
                            ? "Détail pointé"
                            : "Remarque générale"}
                      </span>
                    </div>
                    <select
                      aria-label="État de ce retour"
                      value={t.status}
                      onChange={(e) =>
                        void action(() => resolve(t, e.target.value))
                      }
                    >
                      {Object.entries(threadStates).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </header>
                  {t.comments.map((c) => (
                    <div
                      className={"jr-comment " + (c.internal ? "internal" : "")}
                      key={c.id}
                    >
                      <span>
                        <b>{c.author}</b>
                        {!!c.internal && (
                          <small>
                            <Lock size={11} /> Équipe uniquement
                          </small>
                        )}
                        <time>
                          {new Date(c.created).toLocaleString("fr-FR", {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </time>
                      </span>
                      <p>{c.body}</p>
                    </div>
                  ))}
                  {t.asset_id && (
                    <div className="jr-thread-actions">
                      <button onClick={() => void action(() => open(t))}>
                        Ouvrir dans l’atelier
                      </button>
                      <button onClick={() => void action(() => open(t, true))}>
                        <Sparkles size={14} /> Préparer une correction
                      </button>
                    </div>
                  )}
                  <form
                    className="jr-reply"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void action(() => reply(t));
                    }}
                  >
                    <select
                      aria-label="Visibilité de la réponse"
                      value={internal[t.id] ? "internal" : "external"}
                      onChange={(e) =>
                        setInternal((p) => ({
                          ...p,
                          [t.id]: e.target.value === "internal",
                        }))
                      }
                    >
                      <option value="external">Réponse au client</option>
                      <option value="internal">Note interne</option>
                    </select>
                    <textarea
                      disabled={busy}
                      value={replies[t.id] || ""}
                      onChange={(e) =>
                        setReplies((p) => ({ ...p, [t.id]: e.target.value }))
                      }
                      maxLength={4000}
                      rows={2}
                      placeholder={
                        internal[t.id]
                          ? "Visible uniquement par votre équipe…"
                          : "Votre réponse au client…"
                      }
                    />
                    <button
                      disabled={busy || !replies[t.id]?.trim()}
                      className="button secondary"
                    >
                      <Send size={14} />
                      {internal[t.id]
                        ? "Ajouter la note"
                        : "Envoyer la réponse"}
                    </button>
                  </form>
                </article>
              ))}
              {threadPage != null && (
                <button
                  className="button secondary"
                  onClick={() =>
                    void action(() => loadThreads(revision, threadPage))
                  }
                >
                  Charger les retours suivants
                </button>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
