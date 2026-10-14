import { useEffect, useRef, useState } from "react";
import { Check, Grid2X2, Pause, Play, Plus, Trash2, X } from "lucide-react";
import type { Asset, MulticamGroup, Sequence, VideoProject } from "./types";
function Angle({
  asset,
  offset,
  time,
  playing,
  audible,
}: {
  asset: Asset;
  offset: number;
  time: number;
  playing: boolean;
  audible: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null),
    available = time >= offset && time < offset + asset.duration;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const target = Math.max(0, time - offset);
    if (available) {
      if (Math.abs(el.currentTime - target) > (playing ? 0.15 : 0.015))
        el.currentTime = target;
      if (playing) void el.play().catch(() => {});
      else el.pause();
    } else el.pause();
  }, [time, playing, offset, available]);
  return (
    <>
      {
        <video
          ref={ref}
          src={asset.proxy}
          muted={!audible}
          playsInline
          preload="auto"
          style={{ visibility: available ? "visible" : "hidden" }}
          onLoadedData={() => {
            if (ref.current)
              ref.current.currentTime = Math.max(0, time - offset);
          }}
        />
      }
      {!available && (
        <span className="vf-angle-unavailable">Caméra hors enregistrement</span>
      )}
    </>
  );
}
export default function MulticamPanel({
  project,
  sequence,
  onClose,
  onSequence,
  onRefresh,
  onError,
}: {
  project: VideoProject;
  sequence: Sequence;
  onClose: () => void;
  onSequence: (s: Sequence) => void;
  onRefresh: () => Promise<void>;
  onError: (e: unknown) => void;
}) {
  const api = window.juno!.video,
    dialog = useRef<HTMLDialogElement>(null),
    [group, setGroup] = useState<MulticamGroup | null>(
      project.multicam[0] || null,
    ),
    [chosen, setChosen] = useState<string[]>([]),
    [name, setName] = useState("Montage multicaméra"),
    [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false),
    [busy, setBusy] = useState(false),
    timeRef = useRef(time);
  timeRef.current = time;
  const videos = project.assets.filter((a) => a.kind === "video"),
    duration = group
      ? Math.max(
          0,
          ...group.angles.map(
            (a) =>
              a.offset +
              (videos.find((v) => v.id === a.assetId)?.duration || 0),
          ),
        )
      : 0;
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  useEffect(() => {
    if (!playing) return;
    const begin = performance.now(),
      start = timeRef.current;
    let raf = 0;
    const tick = (at: number) => {
      const next = start + (at - begin) / 1000;
      if (next >= duration) {
        setTime(duration);
        setPlaying(false);
        return;
      }
      setTime(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, duration]);
  function cut(assetId: string) {
    if (!group) return;
    const a = group.angles.find((a) => a.assetId === assetId)!;
    if (
      time < a.offset ||
      time >= a.offset + (videos.find((v) => v.id === assetId)?.duration || 0)
    )
      return;
    const t =
      (Math.round((time * sequence.fps.n) / sequence.fps.d) * sequence.fps.d) /
      sequence.fps.n;
    setGroup({
      ...group,
      switches: [
        ...group.switches.filter((c) => Math.abs(c.time - t) > 0.001),
        { time: t, assetId },
      ].sort((a, b) => a.time - b.time),
    });
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input,textarea,select")) return;
      if (e.code === "Space") {
        e.preventDefault();
        setPlaying((v) => !v);
      }
      const i = e.key === "0" ? 9 : Number(e.key) - 1;
      if (/^\d$/.test(e.key) && group?.angles[i]) {
        e.preventDefault();
        cut(group.angles[i].assetId);
      }
    };
    const el = dialog.current;
    el?.addEventListener("keydown", key);
    return () => el?.removeEventListener("keydown", key);
  }, [group, time]);
  const active =
    group?.switches.filter((c) => c.time <= time).at(-1)?.assetId ||
    group?.angles.find((a) => time >= a.offset)?.assetId;
  async function action(action: "save" | "timecode" | "audio" | "build") {
    if (!group) return;
    setBusy(true);
    setPlaying(false);
    try {
      const r = await api.multicam({
        projectId: project.id,
        group,
        action,
        settings: {
          fps: sequence.fps,
          width: sequence.width,
          height: sequence.height,
        },
      });
      if (r.group) setGroup(r.group);
      await onRefresh();
      if (r.sequence) {
        onSequence(r.sequence);
        onClose();
      } else if (action === "save") onError("Repères multicaméra enregistrés.");
      else if (action === "audio")
        onError(
          "Synchronisation en cours. Le résultat apparaîtra dans un nouveau groupe ; les repères ambigus resteront à vérifier.",
        );
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog ref={dialog} className="vf-dialog vf-multicam" onCancel={onClose}>
      <header>
        <h2>
          <Grid2X2 size={20} /> Montage multicaméra
        </h2>
        <button aria-label="Fermer multicaméra" onClick={onClose}>
          <X size={19} />
        </button>
      </header>
      <div className="vf-multi-top">
        <select
          aria-label="Groupe multicaméra"
          value={group?.id || ""}
          onChange={(e) => {
            setGroup(
              project.multicam.find((g) => g.id === e.target.value) || null,
            );
            setPlaying(false);
            setTime(0);
          }}
        >
          <option value="">Nouveau groupe</option>
          {group && !project.multicam.some((g) => g.id === group.id) && (
            <option value={group.id}>{group.name} · Non enregistré</option>
          )}
          {project.multicam.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        {group && (
          <>
            <button disabled={busy} onClick={() => void action("timecode")}>
              Synchroniser par timecode
            </button>
            <button disabled={busy} onClick={() => void action("audio")}>
              Synchroniser par le son
            </button>
          </>
        )}
      </div>
      {!group ? (
        <div className="vf-multi-create">
          <label className="vf-field">
            Nom du groupe
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={160}
            />
          </label>
          <p>
            Choisissez de 2 à 10 fichiers caméra correspondant au même
            événement.
          </p>
          <div className="vf-multi-choices">
            {videos.map((a) => (
              <label key={a.id}>
                <input
                  type="checkbox"
                  checked={chosen.includes(a.id)}
                  disabled={!chosen.includes(a.id) && chosen.length >= 10}
                  onChange={(e) =>
                    setChosen(
                      e.target.checked
                        ? [...chosen, a.id]
                        : chosen.filter((id) => id !== a.id),
                    )
                  }
                />
                {a.name}
                <small>{a.timecode || "Timecode absent"}</small>
              </label>
            ))}
          </div>
          <button
            className="vf-primary"
            disabled={chosen.length < 2 || !name.trim()}
            onClick={() =>
              setGroup({
                id: crypto.randomUUID(),
                name,
                referenceAssetId: chosen[0],
                angles: chosen.map((assetId) => ({ assetId, offset: 0 })),
                switches: [],
              })
            }
          >
            <Plus size={16} />
            Préparer les {chosen.length} caméras
          </button>
        </div>
      ) : (
        <>
          <p className="vf-hint">
            Cliquez sur une caméra pendant la lecture pour placer une coupe, ou
            utilisez les touches 1 à 9 et 0. Le son de référence reste continu.
            Vérifiez la synchronisation avant de créer le montage.
          </p>
          <div className="vf-angle-grid">
            {group.angles.map((a, i) => {
              const v = videos.find((v) => v.id === a.assetId)!;
              return (
                <article key={a.assetId}>
                  <button
                    className={active === a.assetId ? "active" : ""}
                    aria-label={"Couper vers caméra " + (i + 1)}
                    onClick={() => cut(a.assetId)}
                  >
                    <Angle
                      asset={v}
                      offset={a.offset}
                      time={time}
                      playing={playing}
                      audible={a.assetId === group.referenceAssetId}
                    />
                    <span className="vf-angle-label">
                      {i === 9 ? "0" : i + 1} · {v.name}
                    </span>
                    {active === a.assetId && (
                      <i>
                        <Check size={16} />
                      </i>
                    )}
                  </button>
                  <label>
                    Décalage (s)
                    <input
                      aria-label={"Décalage caméra " + (i + 1)}
                      type="number"
                      step={sequence.fps.d / sequence.fps.n}
                      value={Number(a.offset.toFixed(4))}
                      onChange={(e) => {
                        setPlaying(false);
                        setGroup({
                          ...group,
                          angles: group.angles.map((x) =>
                            x.assetId === a.assetId
                              ? { ...x, offset: Number(e.target.value) }
                              : x,
                          ),
                        });
                      }}
                    />
                  </label>
                  {a.estimate && (
                    <small className={a.estimate.reliable ? "" : "vf-warning"}>
                      {a.estimate.reliable
                        ? "Repère audio trouvé"
                        : "À vérifier"}{" "}
                      · corrélation {Math.round(a.estimate.confidence * 100)} %
                    </small>
                  )}
                  {!a.estimate && a.sync === "à vérifier" && (
                    <small className="vf-warning">
                      À vérifier · caméra sans son, calez son décalage à la main
                    </small>
                  )}
                </article>
              );
            })}
          </div>
          <div className="vf-multi-transport">
            <button
              aria-label={playing ? "Pause multicaméra" : "Lire multicaméra"}
              onClick={() => {
                if (time >= duration) setTime(0);
                setPlaying((v) => !v);
              }}
            >
              {playing ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <output>{time.toFixed(2)} s</output>
            <input
              type="range"
              aria-label="Position multicaméra"
              min={0}
              max={duration}
              step={sequence.fps.d / sequence.fps.n}
              value={time}
              onChange={(e) => {
                setPlaying(false);
                setTime(Number(e.target.value));
              }}
            />
            <label>
              Son de référence
              <select
                value={group.referenceAssetId}
                onChange={(e) =>
                  setGroup({ ...group, referenceAssetId: e.target.value })
                }
              >
                {group.angles.map((a) => (
                  <option key={a.assetId} value={a.assetId}>
                    {videos.find((v) => v.id === a.assetId)?.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="vf-multi-cuts">
            {group.switches.map((c, i) => (
              <span key={i}>
                <button
                  onClick={() => {
                    setTime(c.time);
                    setPlaying(false);
                  }}
                >
                  {c.time.toFixed(2)} s · Cam{" "}
                  {group.angles.findIndex((a) => a.assetId === c.assetId) + 1}
                </button>
                <button
                  aria-label={"Retirer coupe " + (i + 1)}
                  onClick={() =>
                    setGroup({
                      ...group,
                      switches: group.switches.filter((_, j) => j !== i),
                    })
                  }
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
          <p className="vf-hint">
            Le repérage audio compare les dix premières minutes. Un son absent,
            répétitif ou sans passage commun demande un réglage manuel.
          </p>
          <footer>
            <button disabled={busy} onClick={() => void action("save")}>
              Enregistrer les repères
            </button>
            <button
              className="vf-primary"
              disabled={busy}
              onClick={() => void action("build")}
            >
              Créer une séquence avec ces coupes
            </button>
          </footer>
        </>
      )}
    </dialog>
  );
}
