import { draftStorage } from "./storage";
import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Film,
  Heart,
  Image,
  Loader2,
  LockKeyhole,
  MessageSquare,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { api, APIError, mediaURL, shareId, date } from "./api";
import type { Asset, Draft, Manifest, Submission, Thread } from "./types";
import Viewer from "./Viewer";
import Dialog from "./Dialog";
import "./style.css";

type Saved = {
  comments: Draft[];
  selection: string[];
  selectionRevision: number;
  pending?: Submission;
  updated: number;
};
function stored(key: string): Saved | null {
  try {
    const raw = draftStorage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (
      !Array.isArray(value.comments) ||
      value.comments.length > 200 ||
      !Array.isArray(value.selection) ||
      value.selection.length > 10000
    )
      return null;
    return value;
  } catch {
    return null;
  }
}
function App() {
  const [phase, setPhase] = useState<"loading" | "access" | "ready" | "error">(
      "loading",
    ),
    [code, setCode] = useState(""),
    [name, setName] = useState(""),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const [manifest, setManifest] = useState<Manifest | null>(null),
    [assets, setAssets] = useState<Asset[]>([]),
    [offset, setOffset] = useState(0),
    [total, setTotal] = useState(0),
    [busy, setBusy] = useState(false),
    [galleryBusy, setGalleryBusy] = useState(false),
    [filter, setFilter] = useState("all"),
    [query, setQuery] = useState(""),
    [search, setSearch] = useState("");
  const [selection, setSelection] = useState<Set<string>>(new Set()),
    [selectionRevision, setSelectionRevision] = useState(0),
    [drafts, setDrafts] = useState<Draft[]>([]),
    [pending, setPending] = useState<Submission>(),
    [active, setActive] = useState<Asset | null>(null),
    [sendOpen, setSendOpen] = useState(false),
    [approveOpen, setApproveOpen] = useState(false),
    [generalOpen, setGeneralOpen] = useState(false),
    [generalBody, setGeneralBody] = useState(""),
    [albumThreads, setAlbumThreads] = useState<Thread[]>([]),
    [refreshKey, setRefreshKey] = useState(0),
    [connected, setConnected] = useState(navigator.onLine),
    [saveFailed, setSaveFailed] = useState(false);
  const token = useRef(location.hash.slice(1)),
    draftKey = useRef(""),
    manifestGeneration = useRef(0),
    galleryGeneration = useRef(0),
    locked = useRef(false);
  const selectedIds = useMemo(() => [...selection], [selection]);
  const selectedChanged =
    !!manifest &&
    (selection.size !== manifest.selection.length ||
      manifest.selection.some((id) => !selection.has(id)));
  const dirty = drafts.length > 0 || selectedChanged || !!pending;
  async function loadManifest(revision?: string, reset = false) {
    const generation = ++manifestGeneration.current;
    const data = await api<Manifest>(
      "manifest" + (revision ? "?revision=" + revision : ""),
    );
    if (generation !== manifestGeneration.current) return;
    const key =
      "juno-review-draft:" +
      shareId +
      ":" +
      data.viewer.id +
      ":" +
      data.revision.id;
    if (key !== draftKey.current || reset) {
      const saved = reset ? null : stored(key);
      draftKey.current = key;
      setDrafts(saved?.comments || []);
      setSelection(new Set(saved?.selection || data.selection));
      setSelectionRevision(saved?.selectionRevision ?? data.selectionRevision);
      setPending(saved?.pending);
      setOffset(0);
      setActive(null);
    }
    setManifest(data);
    setName(data.viewer.name);
    setPhase("ready");
  }
  async function enter(useCode = false) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      if (!shareId)
        throw Error("Ouvrez le lien privé transmis par votre équipe Juno.");
      await api("access", "POST", {
        token: token.current,
        code: useCode ? code : undefined,
      });
      history.replaceState(null, "", location.pathname);
      token.current = "";
      await loadManifest();
    } catch (e) {
      setError((e as Error).message);
      setPhase(e instanceof APIError && e.status === 403 ? "access" : "error");
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    void (async () => {
      if (!shareId) {
        setPhase("error");
        setError("Ouvrez le lien privé transmis par votre équipe Juno.");
        return;
      }
      try {
        await loadManifest();
        history.replaceState(null, "", location.pathname);
      } catch (e) {
        if (e instanceof APIError && e.status === 401 && token.current)
          await enter();
        else {
          setPhase("error");
          setError((e as Error).message);
        }
      }
    })();
  }, []);
  useEffect(() => {
    const on = () => setConnected(navigator.onLine);
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", on);
    };
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query.trim());
      setOffset(0);
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    if (!manifest || !draftKey.current) return;
    const value: Saved = {
      comments: drafts,
      selection: selectedIds,
      selectionRevision,
      pending,
      updated: Date.now(),
    };
    try {
      setSaveFailed(
        !draftStorage.setItem(draftKey.current, JSON.stringify(value)),
      );
    } catch {
      setSaveFailed(true);
    }
  }, [drafts, selectedIds, selectionRevision, pending, manifest?.revision.id]);
  useEffect(() => {
    if (!manifest) return;
    const generation = ++galleryGeneration.current;
    setGalleryBusy(true);
    const params = new URLSearchParams({
      revision: manifest.revision.id,
      cursor: String(filter === "selection" ? 0 : offset),
      limit: "60",
    });
    if (filter === "photo" || filter === "video") params.set("kind", filter);
    if (search && filter !== "selection") params.set("q", search);
    if (filter === "selection") {
      const ids = selectedIds.slice(offset, offset + 60);
      if (!ids.length) {
        setAssets([]);
        setTotal(0);
        setGalleryBusy(false);
        return;
      }
      params.set("ids", ids.join(","));
    }
    void api<{ items: Asset[]; total: number }>("assets?" + params)
      .then((data) => {
        if (generation !== galleryGeneration.current) return;
        setAssets(data.items);
        setTotal(filter === "selection" ? selectedIds.length : data.total);
      })
      .catch((e) => {
        if (generation === galleryGeneration.current) setError(e.message);
      })
      .finally(() => {
        if (generation === galleryGeneration.current) setGalleryBusy(false);
      });
    return () => {
      galleryGeneration.current++;
    };
  }, [
    manifest?.revision.id,
    filter,
    offset,
    search,
    filter === "selection" ? selectedIds.join(",") : "",
  ]);
  useEffect(() => {
    if (!manifest) return;
    let active = true;
    const poll = () =>
      api<Manifest>("manifest?revision=" + manifest.revision.id)
        .then((value) => {
          if (active)
            setManifest((old) =>
              old && old.revision.id === value.revision.id
                ? {
                    ...old,
                    currentRevision: value.currentRevision,
                    versions: value.versions,
                    decision: value.decision,
                    downloads: value.downloads,
                    ownDecision: value.ownDecision,
                  }
                : old,
            );
        })
        .catch((e) => {
          if (
            active &&
            e instanceof APIError &&
            [401, 404].includes(e.status)
          ) {
            setError(e.message);
            setActive(null);
            setPhase("error");
          }
        });
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine)
        void poll();
    }, 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [manifest?.revision.id]);
  async function changeVersion(id: string) {
    setError("");
    try {
      await loadManifest(id);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function choose(id: string) {
    if (pending || busy) return;
    setSelection((old) => {
      const next = new Set(old);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  async function submit() {
    if (!manifest || locked.current || !name.trim()) return;
    locked.current = true;
    setBusy(true);
    setError("");
    let sent = false;
    try {
      await api("identify", "POST", { name: name.trim() });
      const operation = pending || {
        opId: crypto.randomUUID(),
        revisionId: manifest.revision.id,
        comments: drafts.map(({ assetId, body, anchor }) => ({
          assetId,
          body,
          anchor,
        })),
        selection: selectedIds,
        selectionRevision,
      };
      const saved: Saved = {
        comments: drafts,
        selection: selectedIds,
        selectionRevision,
        pending: operation,
        updated: Date.now(),
      };
      draftStorage.setItem(draftKey.current, JSON.stringify(saved));
      setPending(operation);
      const result = await api<{
        selectionRevision: number;
        receivedAt: number;
      }>("submit", "POST", operation);
      sent = true;
      setPending(undefined);
      setDrafts([]);
      setSelectionRevision(result.selectionRevision);
      setManifest((old) =>
        old
          ? {
              ...old,
              selection: [...operation.selection],
              selectionRevision: result.selectionRevision,
              viewer: { ...old.viewer, name: name.trim() },
            }
          : old,
      );
      draftStorage.setItem(
        draftKey.current,
        JSON.stringify({
          ...saved,
          comments: [],
          pending: undefined,
          selectionRevision: result.selectionRevision,
        }),
      );
      setSendOpen(false);
      setRefreshKey((k) => k + 1);
      setMessage(
        "Retours reçus par Juno le " + date(result.receivedAt) + ". Merci !",
      );
    } catch (e) {
      if (e instanceof APIError && e.status === 409) {
        setError(
          e.message +
            " Vos brouillons sont conservés. Rechargez la sélection du serveur avant de réessayer.",
        );
        setPending(undefined);
      } else {
        if (e instanceof APIError && [400, 403, 404, 413].includes(e.status))
          setPending(undefined);
        setError(
          sent
            ? "Vos retours ont été reçus. Le stockage des brouillons sur cet appareil est indisponible."
            : (e as Error).message,
        );
      }
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function refreshSelection() {
    if (!manifest) return;
    try {
      const data = await api<Manifest>(
        "manifest?revision=" + manifest.revision.id,
      );
      setSelectionRevision(data.selectionRevision);
      setSelection(new Set(data.selection));
      setManifest(data);
      setPending(undefined);
      setError("");
      setMessage(
        "Sélection du serveur chargée. Vos commentaires en brouillon sont conservés.",
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function approve(decision: "approved" | "changes" | "withdrawn") {
    if (!manifest || locked.current || !name.trim()) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      await api("identify", "POST", { name: name.trim() });
      const key =
        "juno-review-approval:" + shareId + ":" + manifest.revision.id;
      const old = draftStorage.getItem(key);
      let operation = {
        opId: crypto.randomUUID(),
        revisionId: manifest.revision.id,
        decision,
      };
      if (old) {
        const previous = JSON.parse(old);
        if (previous.decision === decision) operation = previous;
      }
      draftStorage.setItem(key, JSON.stringify(operation));
      await api("approve", "POST", operation);
      draftStorage.removeItem(key);
      await loadManifest(manifest.revision.id);
      setApproveOpen(false);
      setMessage(
        decision === "approved"
          ? "Votre validation de cette version a été enregistrée."
          : decision === "changes"
            ? "Votre demande de correction a été enregistrée."
            : "Votre validation a été retirée.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function general() {
    setGeneralOpen(true);
    if (manifest)
      try {
        const data = await api<{ items: Thread[] }>(
          "threads?general=1&revision=" + manifest.revision.id,
        );
        setAlbumThreads(data.items.filter((t) => !t.asset_id));
      } catch (e) {
        setError((e as Error).message);
      }
  }
  const logo = (
    <div className="brand">
      <span className="brand-icon">j.</span>
      <span>
        juno<small>STUDIO</small>
      </span>
    </div>
  );
  if (phase !== "ready" || !manifest)
    return (
      <main className="access-page">
        {logo}
        <div className="access-card">
          <LockKeyhole size={28} />
          <span className="eyebrow">VOTRE ESPACE PRIVÉ</span>
          <h1>
            {phase === "loading"
              ? "Vos images arrivent."
              : phase === "access"
                ? "Un code, et vous y êtes."
                : "Votre lien Juno."}
          </h1>
          {phase === "loading" ? (
            <Loader2 className="spin" />
          ) : phase === "access" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void enter(true);
              }}
            >
              <p>Votre équipe a protégé cet espace avec un code.</p>
              <label htmlFor="access-code">Code d’accès</label>
              <input
                id="access-code"
                type="password"
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="current-password"
              />
              <button className="button" disabled={busy || !code}>
                {busy ? <Loader2 className="spin" size={17} /> : null} Découvrir
                mes images
              </button>
            </form>
          ) : (
            <p>
              Ce lien ne peut pas être ouvert pour le moment. Vérifiez que vous
              utilisez le lien complet transmis par Juno.
            </p>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {phase === "error" && (
            <button className="quiet" onClick={() => location.reload()}>
              Réessayer
            </button>
          )}
        </div>
        <p className="access-footer">Vos histoires. Votre regard.</p>
      </main>
    );
  return (
    <>
      <header className="site-header">
        {logo}
        <div className="private-badge">
          <LockKeyhole size={14} /> Espace privé <span>·</span>{" "}
          {manifest.viewer.name || "Retours clients"}
        </div>
      </header>
      <main className="gallery-page">
        <section className="welcome">
          <div>
            <span className="eyebrow">VOTRE REGARD COMPTE</span>
            <h1>{manifest.delivery.title}</h1>
            <p>
              {manifest.delivery.message ||
                "Prenez le temps de découvrir vos images. Sélectionnez vos préférées et dites-nous ce que vous souhaitez ajuster."}
            </p>
            <div className="project-meta">
              <span>{manifest.revision.count} médias</span>
              <span>·</span>
              <label>
                Version{" "}
                <select
                  aria-label="Version de la livraison"
                  value={manifest.revision.id}
                  onChange={(e) => void changeVersion(e.target.value)}
                >
                  {manifest.versions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.number}
                      {v.id === manifest.currentRevision ? " · actuelle" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <span
                className={
                  "status " +
                  (manifest.decision.state === "approved" ? "approved" : "")
                }
              >
                {manifest.decision.state === "approved"
                  ? "Version validée"
                  : manifest.decision.state === "changes"
                    ? "Corrections demandées"
                    : "À votre rythme"}
              </span>
            </div>
          </div>
          <div className="welcome-mark">
            <MessageSquare strokeWidth={1.1} size={52} />
            <span>
              Un détail, une idée,
              <br />
              un dernier ajustement.
            </span>
          </div>
        </section>
        {manifest.currentRevision !== manifest.revision.id && (
          <div className="notice">
            Vous consultez une ancienne version. Vos commentaires restent
            attachés à celle-ci.
            <button
              className="quiet"
              onClick={() => void changeVersion(manifest.currentRevision)}
            >
              Voir la dernière version
            </button>
          </div>
        )}
        {!connected && (
          <div className="notice">
            Connexion interrompue. Vos brouillons restent sur cet appareil ;
            leur envoi attend le retour d’Internet.
          </div>
        )}
        {saveFailed && (
          <div className="error" role="alert">
            Le navigateur ne permet pas de sauvegarder vos brouillons. Gardez
            cette page ouverte jusqu’à leur envoi.
          </div>
        )}
        {error && (
          <div className="error alert" role="alert">
            <span>{error}</span>
            <button
              className="icon"
              aria-label="Fermer le message"
              onClick={() => setError("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {message && (
          <div className="success" role="status">
            <CheckCircle2 size={18} />
            {message}
            <button
              className="icon"
              aria-label="Fermer la confirmation"
              onClick={() => setMessage("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        <div className="gallery-toolbar">
          <nav aria-label="Médias affichés">
            {[
              ["all", "Tout"],
              ["photo", "Photos"],
              ["video", "Vidéos"],
              ["selection", "Ma sélection"],
            ].map(([value, label]) => (
              <button
                key={value}
                className={filter === value ? "active" : ""}
                aria-pressed={filter === value}
                onClick={() => {
                  setFilter(value);
                  setOffset(0);
                }}
              >
                {label}
                {value === "selection" && <span>{selection.size}</span>}
              </button>
            ))}
          </nav>
          <div className="gallery-search">
            <Search size={17} />
            <input
              aria-label="Rechercher un média"
              placeholder="Rechercher une image…"
              value={query}
              disabled={filter === "selection"}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <button className="quiet" onClick={() => void general()}>
            <MessageSquare size={17} /> Remarque générale
          </button>
        </div>
        <div className="gallery-caption">
          <span>
            {galleryBusy
              ? "Chargement…"
              : total
                ? `${offset + 1}–${Math.min(offset + assets.length, total)} sur ${total}`
                : "Aucun média dans cette vue"}
          </span>
          <span>Ouvrez une image pour commenter un détail.</span>
        </div>
        <section
          className={"gallery " + (galleryBusy ? "loading" : "")}
          aria-label="Galerie de relecture"
          aria-busy={galleryBusy}
        >
          {assets.map((a) => (
            <article
              className={"asset-card " + (selection.has(a.id) ? "chosen" : "")}
              key={a.id}
            >
              <button
                className="asset-open"
                aria-label={"Ouvrir " + a.name}
                onClick={() => setActive(a)}
              >
                <img
                  src={mediaURL(a.id, true)}
                  alt={a.name}
                  loading="lazy"
                  decoding="async"
                  style={{ aspectRatio: String(a.width / a.height) }}
                />
                {a.kind === "video" && (
                  <span className="video-badge">
                    <Film size={15} /> {Math.floor((a.duration || 0) / 60)}:
                    {Math.floor((a.duration || 0) % 60)
                      .toString()
                      .padStart(2, "0")}
                  </span>
                )}
                {drafts.some((d) => d.assetId === a.id) && (
                  <span className="draft-dot" title="Remarque en brouillon">
                    <MessageSquare size={13} />
                  </span>
                )}
              </button>
              <div className="asset-caption">
                <span title={a.name}>{a.name}</span>
                {a.kind === "photo" ? (
                  <button
                    className={
                      "icon " + (selection.has(a.id) ? "selected" : "")
                    }
                    aria-label={
                      (selection.has(a.id) ? "Retirer " : "Sélectionner ") +
                      a.name
                    }
                    aria-pressed={selection.has(a.id)}
                    onClick={() => choose(a.id)}
                    disabled={!!pending || busy}
                  >
                    <Heart
                      size={19}
                      fill={selection.has(a.id) ? "currentColor" : "none"}
                    />
                  </button>
                ) : (
                  <Film size={17} />
                )}
              </div>
            </article>
          ))}
        </section>
        {!galleryBusy && !assets.length && (
          <div className="empty-gallery">
            <Image size={32} />
            <h2>
              {filter === "selection"
                ? "Vos préférées, juste ici."
                : "Aucun résultat."}
            </h2>
            <p>
              {filter === "selection"
                ? "Cliquez sur le cœur d’une photo pour la retrouver dans votre sélection."
                : "Essayez un autre filtre ou une autre recherche."}
            </p>
          </div>
        )}
        {total > 60 && (
          <nav className="pagination" aria-label="Pages de la galerie">
            <button
              className="quiet"
              disabled={offset === 0 || galleryBusy}
              onClick={() => setOffset(Math.max(0, offset - 60))}
            >
              <ChevronLeft size={17} /> Précédent
            </button>
            <span>
              Page {Math.floor(offset / 60) + 1} / {Math.ceil(total / 60)}
            </span>
            <button
              className="quiet"
              disabled={offset + 60 >= total || galleryBusy}
              onClick={() => setOffset(offset + 60)}
            >
              Suivant <ChevronRight size={17} />
            </button>
          </nav>
        )}
        <footer className="page-footer">
          <ShieldCheck size={16} /> Cet espace est réservé à votre projet.
          <span>Juno Studio · Vos histoires. Votre regard.</span>
        </footer>
      </main>
      <div className="review-bar">
        <div>
          <strong>
            {selection.size} photo{selection.size > 1 ? "s" : ""} sélectionnée
            {selection.size > 1 ? "s" : ""}
          </strong>
          <span>
            {drafts.length} remarque{drafts.length > 1 ? "s" : ""} en brouillon
            {pending
              ? " · envoi à confirmer"
              : dirty
                ? " · enregistré sur cet appareil"
                : " · synchronisé"}
          </span>
        </div>
        <button
          className="button secondary"
          onClick={() => setSendOpen(true)}
          disabled={busy}
        >
          <Send size={17} />
          {pending ? "Réessayer l’envoi" : "Envoyer mes retours"}
        </button>
        {manifest.canApprove && (
          <button
            className="button"
            onClick={() => setApproveOpen(true)}
            disabled={busy || manifest.revision.id !== manifest.currentRevision}
          >
            <Check size={18} />
            {manifest.ownDecision?.state === "approved"
              ? "Ma validation"
              : "Valider cette version"}
          </button>
        )}
      </div>
      {active && (
        <Viewer
          key={active.id}
          asset={active}
          manifest={manifest}
          selected={selection.has(active.id)}
          drafts={drafts}
          onSelect={() => choose(active.id)}
          onDraft={(d) => setDrafts((old) => [...old, d])}
          onClose={() => setActive(null)}
          onNavigate={(step) => {
            const index = assets.findIndex((a) => a.id === active.id);
            const next = assets[index + step];
            if (next) setActive(next);
          }}
          refreshKey={refreshKey}
          locked={busy || !!pending}
          onError={setError}
        />
      )}
      {sendOpen && (
        <Dialog
          title="Envoyer mes retours"
          onClose={() => !busy && setSendOpen(false)}
        >
          <p>
            Juno recevra{" "}
            <strong>
              {drafts.length} remarque{drafts.length > 1 ? "s" : ""}
            </strong>{" "}
            et votre sélection de{" "}
            <strong>
              {selection.size} photo{selection.size > 1 ? "s" : ""}
            </strong>{" "}
            pour la version {manifest.revision.number}.
          </p>
          <label className="field">
            Votre nom
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              autoComplete="name"
              placeholder="Pour que votre équipe sache qui répond"
              disabled={busy}
            />
          </label>
          <div className="draft-list">
            {drafts.map((d) => (
              <article key={d.id}>
                <div>
                  <strong>{d.name}</strong>
                  <p>{d.body}</p>
                </div>
                <button
                  className="icon"
                  aria-label="Retirer cette remarque"
                  disabled={!!pending || busy}
                  onClick={() =>
                    setDrafts((old) => old.filter((x) => x.id !== d.id))
                  }
                >
                  <Trash2 size={17} />
                </button>
              </article>
            ))}
          </div>
          {!drafts.length && (
            <p className="hint">
              Vous pouvez transmettre votre sélection sans commentaire.
            </p>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {error.includes("autre onglet") && (
            <button className="quiet" onClick={() => void refreshSelection()}>
              Recharger la sélection du serveur
            </button>
          )}
          <div className="dialog-actions">
            <button
              className="quiet"
              disabled={busy}
              onClick={() => setSendOpen(false)}
            >
              Continuer ma visite
            </button>
            <button
              className="button"
              disabled={busy || !name.trim() || !connected}
              onClick={() => void submit()}
            >
              {busy ? (
                <Loader2 size={17} className="spin" />
              ) : (
                <Send size={17} />
              )}
              Confirmer l’envoi
            </button>
          </div>
          <small>
            Envoyer des retours ne vaut pas validation de la livraison.
          </small>
        </Dialog>
      )}
      {approveOpen && (
        <Dialog
          title={
            manifest.ownDecision?.state === "approved"
              ? "Votre validation"
              : "Valider la version " + manifest.revision.number
          }
          onClose={() => !busy && setApproveOpen(false)}
        >
          {manifest.ownDecision?.state === "approved" ? (
            <>
              <p>
                Cette version a été validée par {manifest.ownDecision.author} le{" "}
                {date(manifest.ownDecision.created)}.
              </p>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void approve("withdrawn")}
              >
                Retirer ma validation
              </button>
            </>
          ) : (
            <>
              <p>
                Vous confirmez votre accord sur les{" "}
                <strong>
                  {manifest.revision.count} médias de la version{" "}
                  {manifest.revision.number}
                </strong>
                . Une nouvelle version devra être validée à nouveau.
              </p>
              {dirty ? (
                <div className="notice">
                  Des retours restent à envoyer.
                  <button
                    className="quiet"
                    onClick={() => {
                      setApproveOpen(false);
                      setSendOpen(true);
                    }}
                  >
                    Les transmettre d’abord
                  </button>
                </div>
              ) : null}
              <label className="field">
                Votre nom
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={100}
                  autoComplete="name"
                />
              </label>
              <div className="dialog-actions">
                <button
                  className="button secondary"
                  disabled={busy || !name.trim() || dirty}
                  onClick={() => void approve("changes")}
                >
                  Corrections demandées
                </button>
                <button
                  className="button"
                  disabled={busy || !name.trim() || dirty}
                  onClick={() => void approve("approved")}
                >
                  {busy ? (
                    <Loader2 className="spin" size={17} />
                  ) : (
                    <CheckCircle2 size={18} />
                  )}
                  Je valide cette version
                </button>
              </div>
            </>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <small>
            Votre nom est déclaré, sans vérification d’identité par email.
          </small>
        </Dialog>
      )}
      {generalOpen && (
        <Dialog
          title="À propos de l’ensemble"
          onClose={() => setGeneralOpen(false)}
        >
          <label className="field">
            Votre remarque générale
            <textarea
              value={generalBody}
              onChange={(e) => setGeneralBody(e.target.value)}
              maxLength={4000}
              rows={4}
              placeholder="Une préférence de rendu, un souhait pour le montage…"
              disabled={!!pending}
            />
          </label>
          <button
            className="button"
            disabled={!generalBody.trim() || !!pending || drafts.length >= 200}
            onClick={() => {
              setDrafts((old) => [
                ...old,
                {
                  id: crypto.randomUUID(),
                  name: "Ensemble de la livraison",
                  body: generalBody.trim(),
                  anchor: {},
                },
              ]);
              setGeneralBody("");
              setGeneralOpen(false);
              setMessage(
                "Remarque ajoutée à vos brouillons. Envoyez vos retours quand vous avez terminé.",
              );
            }}
          >
            Ajouter à mes retours
          </button>
          <div className="thread-list">
            {albumThreads.map((t) => (
              <article className="thread" key={t.id}>
                {t.comments.map((c) => (
                  <div className="message" key={c.id}>
                    <strong>{c.author}</strong>
                    <p>{c.body}</p>
                  </div>
                ))}
              </article>
            ))}
          </div>
        </Dialog>
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
