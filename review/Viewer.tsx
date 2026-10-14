import { draftStorage } from "./storage";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  Heart,
  MapPin,
  Send,
  ZoomIn,
  ZoomOut,
  Columns2,
} from "lucide-react";
import type { Asset, Anchor, Draft, Manifest, Thread } from "./types";
import { api, mediaURL, date, time, shareId } from "./api";
const statuses: Record<string, string> = {
  open: "À traiter",
  working: "En cours",
  clarify: "À préciser",
  done: "Traité par Juno",
  declined: "Réponse de Juno",
};
export default function Viewer({
  asset,
  manifest,
  selected,
  drafts,
  onSelect,
  onDraft,
  onClose,
  onNavigate,
  refreshKey,
  locked,
  onError: reportError,
}: {
  asset: Asset;
  manifest: Manifest;
  selected: boolean;
  drafts: Draft[];
  onSelect: () => void;
  onDraft: (d: Draft) => void;
  onClose: () => void;
  onNavigate: (step: number) => void;
  refreshKey: number;
  locked: boolean;
  onError: (message: string) => void;
}) {
  const compositionKey = `juno-review-composition:${shareId}:${manifest.viewer.id}:${manifest.revision.id}:${asset.id}`;
  const [saved] = useState(() => {
    try {
      return JSON.parse(draftStorage.getItem(compositionKey) || "{}");
    } catch {
      return {};
    }
  });
  const [error, setError] = useState(""),
    [saveFailed, setSaveFailed] = useState(false);
  const root = useRef<HTMLElement>(null);
  function onError(message: string) {
    setError(message);
    reportError(message);
  }
  const [body, setBody] = useState<string>(saved.body || ""),
    [point, setPoint] = useState<Anchor["point"]>(saved.point),
    [pin, setPin] = useState(false),
    [frame, setFrame] = useState<number>(saved.frame || 0),
    [general, setGeneral] = useState<boolean>(!!saved.general),
    [range, setRange] = useState<boolean>(!!saved.range),
    [end, setEnd] = useState<number>(saved.end || 1),
    [zoom, setZoom] = useState(false);
  const [threads, setThreads] = useState<Thread[]>([]),
    [next, setNext] = useState<number | null>(null),
    [loading, setLoading] = useState(false),
    [focus, setFocus] = useState<Anchor | null>(null),
    [comparison, setComparison] = useState<Asset | null>(null),
    [compareOn, setCompareOn] = useState(false),
    [reply, setReply] = useState<Record<string, string>>({}),
    [replyBusy, setReplyBusy] = useState("");
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const video = useRef<HTMLVideoElement>(null),
    area = useRef<HTMLDivElement>(null),
    content = useRef<HTMLDivElement>(null),
    form = useRef<HTMLTextAreaElement>(null),
    currentFrame = useRef(saved.frame || 0),
    threadGeneration = useRef(0),
    previousFocus = useRef<HTMLElement | null>(null);
  const fps = asset.fps || { n: 25, d: 1 },
    mine = drafts.filter((d) => d.assetId === asset.id);
  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () =>
      Array.from(
        root.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled),video[controls]",
        ) || [],
      ).filter((el) => el.getClientRects().length);
    focusable()[0]?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const all = focusable(),
        first = all[0],
        last = all[all.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
      document.body.style.overflow = old;
      previousFocus.current?.focus();
    };
  }, []);
  useEffect(() => {
    const element = area.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setDimensions({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!body && !point) {
      draftStorage.removeItem(compositionKey);
      return;
    }
    setSaveFailed(
      !draftStorage.setItem(
        compositionKey,
        JSON.stringify({ body, point, frame, general, range, end }),
      ),
    );
  }, [compositionKey, body, point, frame, general, range, end]);
  useEffect(() => {
    const element = video.current;
    if (!element || !element.requestVideoFrameCallback) return;
    let handle = 0,
      active = true;
    const tick = (_now: number, metadata: VideoFrameCallbackMetadata) => {
      if (!active) return;
      const value = Math.min(
        (asset.frames || 1) - 1,
        Math.max(0, Math.round((metadata.mediaTime * fps.n) / fps.d)),
      );
      currentFrame.current = value;
      setFrame(value);
      handle = element.requestVideoFrameCallback(tick);
    };
    handle = element.requestVideoFrameCallback(tick);
    return () => {
      active = false;
      element.cancelVideoFrameCallback(handle);
    };
  }, [asset.id]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (pin) {
          setPin(false);
          return;
        }
        onClose();
      }
      if (
        ["INPUT", "TEXTAREA", "SELECT"].includes(
          (e.target as HTMLElement).tagName,
        )
      )
        return;
      if (e.key === "ArrowRight" && asset.kind === "photo") onNavigate(1);
      if (e.key === "ArrowLeft" && asset.kind === "photo") onNavigate(-1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [asset.id, pin, onClose, onNavigate]);
  async function load(cursor = 0) {
    const generation = ++threadGeneration.current;
    setLoading(true);
    try {
      const data = await api<{ items: Thread[]; nextCursor: number | null }>(
        "threads?revision=" +
          manifest.revision.id +
          "&asset=" +
          asset.id +
          "&cursor=" +
          cursor,
      );
      if (generation !== threadGeneration.current) return;
      setThreads((old) => (cursor ? [...old, ...data.items] : data.items));
      setNext(data.nextCursor);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      if (generation === threadGeneration.current) setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      threadGeneration.current++;
    };
  }, [asset.id, refreshKey]);
  function seek(value: number) {
    const f = Math.max(0, Math.min((asset.frames || 1) - 1, value));
    video.current?.pause();
    if (video.current) video.current.currentTime = ((f + 0.5) * fps.d) / fps.n;
    currentFrame.current = f;
    setFrame(f);
  }
  function add() {
    if (!body.trim() || locked) return;
    if (drafts.length >= 200) {
      onError("Envoyez cette passe avant d’ajouter de nouveaux retours.");
      return;
    }
    onDraft({
      id: crypto.randomUUID(),
      assetId: asset.id,
      name: asset.name,
      body: body.trim(),
      anchor: {
        ...(point ? { point } : {}),
        ...(asset.kind === "video" && !general
          ? {
              frame: currentFrame.current,
              ...(range
                ? {
                    endFrame: Math.max(
                      currentFrame.current + 1,
                      Math.min(
                        asset.frames || 1,
                        Math.round((end * fps.n) / fps.d),
                      ),
                    ),
                  }
                : {}),
            }
          : {}),
      },
    });
    setBody("");
    setPoint(undefined);
    setPin(false);
    setRange(false);
    form.current?.focus();
  }
  async function compare() {
    video.current?.pause();
    if (compareOn) {
      setCompareOn(false);
      return;
    }
    const prior = manifest.versions.find(
      (v) => v.number < manifest.revision.number,
    );
    if (!prior) {
      onError("Il n’y a pas encore de version précédente à comparer.");
      return;
    }
    try {
      const data = await api<{ items: Asset[] }>(
        "assets?revision=" +
          prior.id +
          "&logicalId=" +
          encodeURIComponent(asset.logicalId),
      );
      if (!data.items[0])
        throw Error("Ce média n’existait pas dans la version précédente.");
      setComparison(data.items[0]);
      setCompareOn(true);
    } catch (e) {
      onError((e as Error).message);
    }
  }
  async function sendReply(thread: Thread) {
    if (!manifest.viewer.name) {
      onError(
        "Indiquez votre nom dans « Envoyer mes retours » avant de répondre.",
      );
      return;
    }
    const value = reply[thread.id]?.trim();
    if (!value) return;
    setReplyBusy(thread.id);
    const key = "juno-review-reply:" + thread.id;
    let operation = {
      opId: crypto.randomUUID(),
      threadId: thread.id,
      body: value,
    };
    try {
      const saved = draftStorage.getItem(key);
      if (saved) {
        const old = JSON.parse(saved);
        if (old.body === value) operation = old;
      }
      draftStorage.setItem(key, JSON.stringify(operation));
      await api("reply", "POST", operation);
      draftStorage.removeItem(key);
      setReply((p) => ({ ...p, [thread.id]: "" }));
      await load();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setReplyBusy("");
    }
  }
  const ratio = asset.width / asset.height,
    fit = Math.max(
      120,
      Math.min(dimensions.width - 24, (dimensions.height - 30) * ratio),
    ),
    width = fit * (zoom ? 2 : 1),
    annotation = point || focus?.point;
  return (
    <section
      ref={root}
      className="viewer"
      role="dialog"
      aria-modal="true"
      aria-label={"Relecture de " + asset.name}
    >
      <header className="viewer-header">
        <button className="quiet" onClick={onClose}>
          <ArrowLeft size={18} /> Galerie
        </button>
        <div>
          <strong>{asset.name}</strong>
          <span>
            Version {manifest.revision.number} · {asset.width} × {asset.height}
          </span>
        </div>
        <div className="viewer-actions">
          {asset.kind === "photo" && (
            <button
              className={"icon " + (selected ? "selected" : "")}
              disabled={locked}
              aria-label={
                selected ? "Retirer de ma sélection" : "Ajouter à ma sélection"
              }
              aria-pressed={selected}
              onClick={onSelect}
            >
              <Heart size={21} fill={selected ? "currentColor" : "none"} />
            </button>
          )}
          <button
            className="icon"
            aria-label="Comparer à la version précédente"
            aria-pressed={compareOn}
            onClick={() => void compare()}
          >
            <Columns2 size={20} />
          </button>
          {manifest.downloads && (
            <a
              className="icon"
              href={mediaURL(asset.id, false, true)}
              aria-label="Télécharger ce rendu"
            >
              <Download size={20} />
            </a>
          )}
          <button
            className="icon"
            onClick={() => onNavigate(-1)}
            aria-label="Média précédent"
          >
            <ChevronLeft size={21} />
          </button>
          <button
            className="icon"
            onClick={() => onNavigate(1)}
            aria-label="Média suivant"
          >
            <ChevronRight size={21} />
          </button>
        </div>
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {saveFailed && (
        <p className="notice">
          Gardez cette page ouverte : ce navigateur ne peut pas sauvegarder le
          texte sur cet appareil.
        </p>
      )}
      <div className="viewer-layout">
        <div className="viewer-canvas">
          <div className="media-tools">
            <span>
              {asset.kind === "video"
                ? time(frame, fps) + " · image " + (frame + 1)
                : "Votre image, en entier"}
            </span>
            <div>
              {asset.kind === "photo" && (
                <button className="quiet" onClick={() => setZoom(!zoom)}>
                  {zoom ? <ZoomOut size={17} /> : <ZoomIn size={17} />}{" "}
                  {zoom ? "Ajuster" : "Zoomer"}
                </button>
              )}
              <button
                className={"quiet " + (pin ? "active" : "")}
                disabled={locked}
                onClick={() => {
                  setPin(!pin);
                  video.current?.pause();
                  setFocus(null);
                }}
              >
                <MapPin size={17} />{" "}
                {pin ? "Cliquez sur le détail" : "Pointer un détail"}
              </button>
            </div>
          </div>
          {compareOn && comparison ? (
            <div className="comparison">
              <div>
                <span>Version précédente</span>
                {comparison.kind === "photo" ? (
                  <img src={mediaURL(comparison.id)} alt={comparison.name} />
                ) : (
                  <video src={mediaURL(comparison.id)} controls playsInline />
                )}
              </div>
              <div>
                <span>
                  Version {manifest.revision.number} · retours sur cette version
                </span>
                {asset.kind === "photo" ? (
                  <img src={mediaURL(asset.id)} alt={asset.name} />
                ) : (
                  <video src={mediaURL(asset.id)} controls playsInline />
                )}
              </div>
              <button className="quiet" onClick={() => setCompareOn(false)}>
                Revenir aux annotations
              </button>
            </div>
          ) : null}
          <div
            ref={area}
            className={"media-area " + (compareOn ? "hidden" : "")}
          >
            <div
              ref={content}
              className={"media-content " + (pin ? "pin-mode" : "")}
              style={{ width, aspectRatio: String(ratio) }}
              onClick={(e) => {
                if (!pin || locked) return;
                const rect = content.current!.getBoundingClientRect();
                setPoint({
                  x: Math.max(
                    0,
                    Math.min(1, (e.clientX - rect.left) / rect.width),
                  ),
                  y: Math.max(
                    0,
                    Math.min(1, (e.clientY - rect.top) / rect.height),
                  ),
                });
                setPin(false);
                setFocus(null);
                form.current?.focus();
              }}
            >
              {asset.kind === "photo" ? (
                <img
                  src={mediaURL(asset.id)}
                  alt={asset.name}
                  draggable={false}
                />
              ) : (
                <video
                  ref={video}
                  src={mediaURL(asset.id)}
                  poster={mediaURL(asset.id, true)}
                  controls={!pin}
                  controlsList={manifest.downloads ? undefined : "nodownload"}
                  onError={()=>onError("Ce navigateur ne peut pas lire le rendu vidéo. Essayez de recharger la page ou un autre navigateur.")}
                  playsInline
                  preload="metadata"
                  onLoadedMetadata={() => {
                    if (saved.body && saved.frame) seek(saved.frame);
                  }}
                  onTimeUpdate={() => {
                    if (!video.current?.requestVideoFrameCallback) {
                      const f = Math.min(
                        (asset.frames || 1) - 1,
                        Math.max(
                          0,
                          Math.floor(
                            ((video.current?.currentTime || 0) * fps.n) / fps.d + 1e-6,
                          ),
                        ),
                      );
                      currentFrame.current = f;
                      setFrame(f);
                    }
                  }}
                />
              )}
              {annotation && (
                <div
                  className="annotation-pin"
                  style={{
                    left: annotation.x * 100 + "%",
                    top: annotation.y * 100 + "%",
                  }}
                  aria-label="Zone du commentaire"
                >
                  <MapPin size={27} />
                </div>
              )}
            </div>
          </div>
          {asset.kind === "video" && !compareOn && (
            <div className="frame-controls">
              <button className="quiet" onClick={() => seek(frame - 1)}>
                <ChevronLeft size={16} /> Image précédente
              </button>
              <button className="quiet" onClick={() => seek(frame + 1)}>
                Image suivante <ChevronRight size={16} />
              </button>
            </div>
          )}
        </div>
        <aside className="comments">
          <div className="comments-title">
            <h2>Vos retours</h2>
            <span>{threads.length + mine.length}</span>
          </div>
          <form
            className="comment-form"
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <label htmlFor="comment-body">Que souhaitez-vous ajuster ?</label>
            <textarea
              id="comment-body"
              ref={form}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onFocus={() => video.current?.pause()}
              maxLength={4000}
              placeholder="Par exemple : éclaircir légèrement ce visage…"
              rows={4}
              disabled={locked}
            />
            {point && (
              <button
                type="button"
                className="pill"
                onClick={() => setPoint(undefined)}
              >
                <MapPin size={14} /> Détail pointé · retirer
              </button>
            )}
            {asset.kind === "video" && (
              <>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={general}
                    onChange={(e) => setGeneral(e.target.checked)}
                  />
                  À propos de toute la vidéo
                </label>
                {!general && (
                  <>
                    <span className="hint">À {time(frame, fps)}</span>
                    <label className="check-row">
                      <input
                        type="checkbox"
                        checked={range}
                        onChange={(e) => {
                          setRange(e.target.checked);
                          setEnd(((frame + 1) * fps.d) / fps.n);
                        }}
                      />
                      Sur un passage
                    </label>
                    {range && (
                      <label className="end-range">
                        Jusqu’à (secondes)
                        <input
                          type="number"
                          step="any"
                          min={((frame + 1) * fps.d) / fps.n}
                          max={asset.duration}
                          value={end}
                          onChange={(e) => setEnd(Number(e.target.value))}
                        />
                      </label>
                    )}
                  </>
                )}
              </>
            )}
            <button className="button" disabled={locked || !body.trim()}>
              <Send size={16} /> Ajouter à mes retours
            </button>
            <small>
              Vos remarques restent en brouillon jusqu’à leur envoi depuis la
              galerie.
            </small>
          </form>
          <div className="thread-list">
            {mine.map((d) => (
              <article className="thread draft" key={d.id}>
                <span className="tag">Brouillon · à envoyer</span>
                <p>{d.body}</p>
                {d.anchor.frame != null && (
                  <small>{time(d.anchor.frame, fps)}</small>
                )}
              </article>
            ))}
            {threads.map((t) => (
              <article className="thread" key={t.id}>
                <button
                  className="thread-anchor"
                  onClick={() => {
                    setFocus(t.anchor);
                    setPoint(undefined);
                    if (t.anchor.frame != null) seek(t.anchor.frame);
                    setCompareOn(false);
                  }}
                >
                  <span
                    className={"tag " + (t.status === "done" ? "done" : "")}
                  >
                    {statuses[t.status] || t.status}
                  </span>
                  {t.anchor.frame != null && (
                    <span>
                      {time(t.anchor.frame, fps)}
                      {t.anchor.endFrame != null
                        ? " → " + time(t.anchor.endFrame, fps)
                        : ""}
                    </span>
                  )}
                  {t.anchor.point && <MapPin size={15} />}
                </button>
                {t.comments.map((c) => (
                  <div className="message" key={c.id}>
                    <div>
                      <strong>{c.author}</strong>
                      <time>{date(c.created)}</time>
                    </div>
                    <p>{c.body}</p>
                  </div>
                ))}
                <form
                  className="reply"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void sendReply(t);
                  }}
                >
                  <input
                    aria-label="Répondre à cette discussion"
                    placeholder="Répondre…"
                    maxLength={4000}
                    value={reply[t.id] || ""}
                    onChange={(e) =>
                      setReply((r) => ({ ...r, [t.id]: e.target.value }))
                    }
                    disabled={replyBusy === t.id}
                  />
                  <button
                    className="icon"
                    aria-label="Envoyer la réponse"
                    disabled={!reply[t.id]?.trim() || replyBusy === t.id}
                  >
                    <Send size={16} />
                  </button>
                </form>
              </article>
            ))}
            {!loading && !threads.length && !mine.length && (
              <p className="empty-small">
                Un détail à reprendre ? Ajoutez votre première remarque ici.
              </p>
            )}
            {next != null && (
              <button
                className="quiet"
                onClick={() => void load(next)}
                disabled={loading}
              >
                Voir les retours précédents
              </button>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}
