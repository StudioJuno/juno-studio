import { useDock } from "../workbench/useDock";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Sparkles,
  Mic,
  Square,
  X,
  ArrowUp,
  History,
  Undo2,
  Redo2,
  Loader2,
} from "lucide-react";
import {
  cibleDite,
  parsePrompt,
  Refus,
  type Plan,
  type Scope,
} from "./commands";
import {
  cibleInchangee,
  confirmationRequise,
  relireProposition,
} from "./intent-check";
import type { CommandRecord } from "./records";
import type { Asset, Sequence } from "../video/types";
import { STYLES } from "../model";
import "./pilot.css";
export type PilotContext = {
  domain: "photo" | "video";
  projectId: string;
  label: string;
  ids: Record<Scope, string[]>;
  revisions?: Record<string, number>;
  sequence?: Sequence;
  assets?: Asset[];
  frame?: number;
};
type Props = {
  domain: PilotContext["domain"];
  projectId: string;
  label: string;
  capture: () => Promise<PilotContext>;
  run: (plan: Plan, context: PilotContext) => Promise<string>;
  history: () => Promise<CommandRecord[]>;
  restore: (record: CommandRecord, redo: boolean) => Promise<string>;
  onListen?: () => void;
};
const scopes: Record<Scope, string> = {
  current: "Élément actif",
  selection: "Sélection",
  album: "Tout le projet",
  kept: "Photos gardées",
};
/** Les boutons d'exemple : chacun doit être compris tel quel (un test y veille). */
export const EXEMPLES: Record<PilotContext["domain"], string[]> = {
  photo: [
    "Exposition à 0,3",
    "Applique le style Film doux",
    "Trie et retouche cet album",
    "Redresse la photo",
    "Envoie le tri à Lightroom",
    "Reviens à l’original",
  ],
  video: [
    "Coupe ici",
    "Volume à -6 dB",
    "Crée un montage de 60 secondes",
    "Crée les sous-titres",
  ],
};
/**
 * Le style choisi dans « Style de l’album ». « Trie et retouche cet album »
 * au pilote l'ignorait et retouchait tout l'album en Signature.
 */
function styleAlbum() {
  try {
    const choisi = localStorage.getItem("juno-album-style");
    return choisi && STYLES.some((s) => s.id === choisi) ? choisi : "signature";
  } catch {
    return "signature";
  }
}
export default function Pilot(props: Props) {
  const [open, setOpen] = useState(false),
    [text, setText] = useState(""),
    [scope, setScope] = useState<Scope>("current");
  const [busy, setBusy] = useState(false),
    [recording, setRecording] = useState(false),
    [message, setMessage] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false),
    [records, setRecords] = useState<CommandRecord[]>([]);
  const [voiceAvailable, setVoiceAvailable] = useState(false),
    [planner, setPlanner] = useState<PlannerStatus | null>(null),
    [page, setPage] = useState(0);
  const [proposal, setProposal] = useState<{
    plan: Plan;
    target: PilotContext;
    summary: string;
    /** L'en-tête du pilote au moment de la préparation : ce qui était visé. */
    vue: string;
    /** Une commande locale qui attend une confirmation, non une proposition de l'IA. */
    confirmation?: boolean;
  } | null>(null);
  useDock("pilot", open, () => close());
  const input = useRef<HTMLTextAreaElement>(null),
    button = useRef<HTMLButtonElement>(null);
  const recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null);
  const startingMic = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    alive = useRef(true),
    cancelled = useRef(false),
    locked = useRef(false);
  const propsRef = useRef(props);
  propsRef.current = props;
  const openRef = useRef(open);
  openRef.current = open;
  const examples = EXEMPLES[props.domain];
  const stopTracks = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (timer.current) clearTimeout(timer.current);
  };
  const close = () => {
    cancelled.current = true;
    if (recorder.current?.state === "recording") recorder.current.stop();
    stopTracks();
    void window.juno?.voice.cancel();
    void window.juno?.planner.cancel();
    setRecording(false);
    setOpen(false);
    button.current?.focus();
  };
  useEffect(() => {
    alive.current = true;
    void window.juno?.voice
      .status()
      .then((s) => alive.current && setVoiceAvailable(s.available))
      .catch(() => {});
    void window.juno?.planner
      .status()
      .then((s) => alive.current && setPlanner(s))
      .catch(() => {});
    const key = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "p"
      ) {
        e.preventDefault();
        if (openRef.current) close();
        else setOpen(true);
      }
    };
    window.addEventListener("keydown", key);
    const propose = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.domain !== propsRef.current.domain || detail?.projectId !== propsRef.current.projectId || typeof detail.text !== 'string') return;
      setText(detail.text.slice(0, 8000));
      setScope('current');
      setProposal(null);
      setHistoryOpen(false);
      setMessage('Retour client à relire. Aucune correction n’a encore été appliquée.');
      setOpen(true);
    };
    window.addEventListener('juno-pilot-propose', propose);
    return () => {
      alive.current = false;
      cancelled.current = true;
      stopTracks();
      if (recorder.current?.state === "recording") recorder.current.stop();
      void window.juno?.voice.cancel();
      void window.juno?.planner.cancel();
      window.removeEventListener("keydown", key);
      window.removeEventListener('juno-pilot-propose', propose);
    };
  }, []);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  useEffect(() => {
    setRecords([]);
    setPage(0);
    setProposal(null);
    // Une portée « Tout le projet » laissée par une consigne précédente ne
    // suit pas le photographe dans un autre projet.
    setScope("current");
  }, [props.projectId]);
  // L'historique se relit à chaque ouverture du pilote : resté ouvert d'une
  // fois sur l'autre, il montrait une liste périmée, et « Annuler cette
  // commande » sur la première ligne visait la passe d'avant, pas celle
  // lancée depuis (relecture du 29/09/2026).
  useEffect(() => {
    if (open && historyOpen) void refreshHistory().catch((e) => setMessage(e.message));
  }, [open, historyOpen, props.projectId]);
  async function refreshHistory() {
    const target = propsRef.current;
    const data = await target.history();
    if (
      alive.current &&
      target.projectId === propsRef.current.projectId &&
      target.domain === propsRef.current.domain
    ) {
      setRecords(data);
      setPage(0);
    }
  }
  const languageAvailable = !!planner?.available;
  const installe = planner?.installation;
  // Suivre le téléchargement tant qu'il tourne ; s'arrêter dès qu'il finit.
  useEffect(() => {
    if (!installe?.enCours) return;
    const t = setInterval(() => {
      void window.juno?.planner
        .status()
        .then((s) => alive.current && setPlanner(s))
        .catch(() => {});
    }, 1000);
    return () => clearInterval(t);
  }, [installe?.enCours]);
  const go = (octets: number) =>
    (octets / 1e9).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + " Go";
  async function actionModele(
    faire: "install" | "cancelInstall" | "uninstall",
  ) {
    try {
      const s = await window.juno?.planner[faire]();
      if (s && alive.current) setPlanner(s);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }
  async function execute(value: string, frozen?: PilotContext, voice = false) {
    if (locked.current) return;
    locked.current = true;
    cancelled.current = false;
    setBusy(true);
    setMessage("");
    setProposal(null);
    try {
      const target = frozen || (await propsRef.current.capture());
      let plan: Plan;
      let interpreted = "";
      const style = target.domain === "photo" ? styleAlbum() : undefined;
      try {
        plan = parsePrompt(value, target.domain, scope, style);
      } catch (error) {
        // Une consigne comprise mais impossible ne gagne rien à passer par le
        // modèle de langue : il met plusieurs secondes à la reformuler vers une
        // action qui n'existe pas.
        if (error instanceof Refus || !window.juno) throw error;
        if (!languageAvailable)
          throw Error(
            (error instanceof Error ? error.message : String(error)) +
              (planner?.installable
                ? " Pour les formulations libres, installez l’IA locale dans « Exemples et fonctionnement »."
                : ""),
          );
        setMessage(
          "L’IA locale prépare les commandes… Vous pouvez fermer le pilote pour interrompre.",
        );
        // L'IA reçoit la cible nommée dans la phrase (« la photo active »)
        // plutôt que celle du panneau, et sa reformulation est relue avec.
        const result = await window.juno.planner.plan({
          domain: target.domain,
          text: value,
          scope: cibleDite(value) ?? scope,
        });
        if (cancelled.current || !alive.current) return;
        if (result.question || !result.commands.length) {
          setMessage(
            result.question || result.explanation || "Précisez votre demande.",
          );
          return;
        }
        // Les commandes sont relues une par une, jamais jointes par « puis » :
        // dans une phrase, « puis » reprend le verbe, et « Contraste à 10 »
        // aurait hérité du « Augmente » de la commande d'avant.
        plan = relireProposition(
          value,
          result.commands,
          target.domain,
          scope,
          style,
        );
        plan.label = value.slice(0, 200);
        plan.text = value;
        interpreted =
          result.explanation +
          "\n" +
          result.commands.join(" · ") +
          "\n\n" +
          (confirmationRequise(plan, target.ids) || "");
        plan.source = voice ? "voice" : "text";
        setProposal({
          plan,
          target,
          summary: interpreted.trim(),
          vue: propsRef.current.label,
        });
        setMessage(
          "Proposition préparée. Vérifiez les réglages ci-dessous avant de l’appliquer.",
        );
        return;
      }
      plan.source = voice ? "voice" : "text";
      if (cancelled.current || !alive.current) return;
      if (
        target.domain !== propsRef.current.domain ||
        target.projectId !== propsRef.current.projectId
      )
        throw Error(
          "Le projet a changé pendant la consigne. Rien n’a été modifié ; relancez-la dans le projet voulu.",
        );
      // Écarter, noter, remettre à l'original ou retirer plusieurs éléments
      // (tout le projet, les photos gardées, la sélection) : jamais sans une
      // confirmation qui dit combien d'éléments sont visés.
      const confirmation = confirmationRequise(plan, target.ids);
      if (confirmation) {
        setProposal({
          plan,
          target,
          summary: confirmation,
          vue: propsRef.current.label,
          confirmation: true,
        });
        setMessage("Vérifiez la cible ci-dessous avant de confirmer.");
        return;
      }
      const result = await propsRef.current.run(plan, target);
      if (alive.current) {
        setMessage(interpreted + result);
        setText("");
        await refreshHistory();
      }
    } catch (e) {
      if (alive.current && !cancelled.current)
        setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function listen() {
    if (recording) {
      recorder.current?.stop();
      return;
    }
    if (busy || locked.current || startingMic.current) return;
    startingMic.current = true;
    cancelled.current = false;
    setMessage("");
    try {
      const frozen = await propsRef.current.capture();
      propsRef.current.onListen?.();
      const audio = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      if (cancelled.current || !alive.current) {
        audio.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = audio;
      const chunks: Blob[] = [],
        r = new MediaRecorder(audio);
      recorder.current = r;
      r.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      r.onerror = () => {
        cancelled.current = true;
        stopTracks();
        if (alive.current) {
          setRecording(false);
          setMessage(
            "Le microphone a été interrompu. Votre projet est conservé.",
          );
        }
      };
      r.onstop = async () => {
        stopTracks();
        if (alive.current) setRecording(false);
        if (cancelled.current || !alive.current) return;
        setBusy(true);
        setMessage("Transcription sur votre ordinateur…");
        try {
          const result = await window.juno!.voice.transcribe({
            bytes: await new Blob(chunks, { type: r.mimeType }).arrayBuffer(),
          });
          if (cancelled.current || !alive.current) return;
          setText(result.text);
          setBusy(false);
          await execute(result.text, frozen, true);
        } catch (e) {
          if (alive.current && !cancelled.current)
            setMessage("Voix : " + (e as Error).message);
        } finally {
          if (alive.current) setBusy(false);
        }
      };
      r.start(250);
      setRecording(true);
      setMessage(
        "À l’écoute · cliquez sur Arrêter quand vous avez fini. 45 secondes maximum.",
      );
      timer.current = setTimeout(() => {
        if (r.state === "recording") r.stop();
      }, 45000);
    } catch (e) {
      stopTracks();
      if (alive.current && !cancelled.current) {
        setRecording(false);
        setMessage(
          "Microphone indisponible : " +
            (e as Error).message +
            ". Vous pouvez écrire votre consigne.",
        );
      }
    } finally {
      startingMic.current = false;
    }
  }
  return (
    <>
      <button
        ref={button}
        className="pilot-trigger"
        // Activité se ferme au premier appui hors d'elle, ce qui retire la
        // marge du panneau : le bouton se déplaçait sous le pointeur avant le
        // relâchement, et le clic ne l'atteignait pas. Il fallait cliquer deux
        // fois. L'appui s'arrête donc ici ; à l'ouverture, le pilote ferme
        // Activité lui-même par `useDock`.
        onPointerDown={(e) => {
          if (!open) e.stopPropagation();
        }}
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        title="Pilote Juno · ⌘/Ctrl + Maj + P"
      >
        <Sparkles size={15} /> Demander à Juno
      </button>
      {open &&
        createPortal(
          <aside
            className={`pilot-panel ${props.domain === "video" ? "pilot-dark" : ""}`}
            role="dialog"
            aria-label="Pilote Juno"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                close();
              }
            }}
          >
            <header>
              <div>
                <Sparkles size={18} />
                <strong>Pilote Juno</strong>
                <small>
                  {languageAvailable ? "IA locale" : "Commandes locales"} ·
                  texte et voix
                </small>
              </div>
              <button onClick={close} aria-label="Fermer le pilote">
                <X size={18} />
              </button>
            </header>
            <p className="pilot-context">{props.label}</p>
            <label className="pilot-scope">
              Appliquer à{" "}
              <select
                value={scope}
                onChange={(e) => {
                  setScope(e.target.value as Scope);
                  setProposal(null);
                }}
                disabled={busy || recording}
              >
                {(Object.entries(scopes) as [Scope, string][])
                  .filter(([s]) => props.domain === "photo" || s !== "kept")
                  .map(([s, label]) => (
                    <option key={s} value={s}>
                      {label}
                    </option>
                  ))}
              </select>
            </label>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void execute(text);
              }}
            >
              <textarea
                ref={input}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setProposal(null);
                }}
                placeholder={
                  props.domain === "photo"
                    ? "Ex. Baisse les hautes lumières de 15…"
                    : "Ex. Volume à -6 dB…"
                }
                aria-label="Votre consigne à Juno"
                rows={3}
                maxLength={6000}
                disabled={busy || recording}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void execute(text);
                  }
                }}
              />
              <div className="pilot-submit">
                <button
                  type="button"
                  onClick={() => void listen()}
                  disabled={(!voiceAvailable || busy) && !recording}
                  aria-label={
                    recording ? "Arrêter la dictée" : "Dicter une commande"
                  }
                  className={recording ? "pilot-recording" : ""}
                >
                  {recording ? <Square size={17} /> : <Mic size={17} />}
                  {recording ? "Arrêter" : "Parler"}
                </button>
                <button
                  type="submit"
                  className="pilot-execute"
                  disabled={!text.trim() || busy || recording}
                >
                  {busy ? (
                    <Loader2 size={16} className="spin" />
                  ) : (
                    <ArrowUp size={16} />
                  )}{" "}
                  Exécuter
                </button>
              </div>
            </form>
            {message && (
              <div role="status" aria-live="polite" className="pilot-result">
                {message}
              </div>
            )}
            {proposal && (
              <div className="pilot-proposal">
                <strong>
                  {proposal.confirmation ? "Confirmation" : "Proposition"} ·{" "}
                  {proposal.target.label}
                </strong>
                <p>{proposal.summary}</p>
                <small>
                  Cible : {scopes[proposal.plan.scope]} ·{" "}
                  {proposal.plan.scope === "current"
                    ? proposal.vue
                    : `${proposal.target.ids[proposal.plan.scope].length} élément(s)`}
                  {proposal.target.domain === "video" &&
                    proposal.target.sequence &&
                    ` · curseur à ${(
                      ((proposal.target.frame || 0) *
                        proposal.target.sequence.fps.d) /
                      proposal.target.sequence.fps.n
                    ).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} s`}
                </small>
                <div>
                  <button
                    disabled={busy || recording}
                    onClick={async () => {
                      if (locked.current) return;
                      locked.current = true;
                      setBusy(true);
                      try {
                        if (
                          proposal.target.projectId !==
                          propsRef.current.projectId
                        )
                          throw Error(
                            "Le projet a changé. Préparez une nouvelle proposition.",
                          );
                        // Ce qui est actif maintenant, et non au moment de la
                        // demande : une autre photo, une autre sélection ou un
                        // curseur déplacé ne reçoivent pas une proposition
                        // préparée pour l'élément d'avant.
                        const maintenant = await propsRef.current.capture();
                        if (
                          !cibleInchangee(
                            proposal.target,
                            maintenant,
                            proposal.plan.scope,
                            proposal.plan.actions,
                          )
                        ) {
                          setProposal(null);
                          throw Error(
                            "La cible a changé depuis la préparation (élément actif, sélection ou curseur). Rien n’a été modifié ; relancez la consigne.",
                          );
                        }
                        const result = await propsRef.current.run(
                          proposal.plan,
                          proposal.target,
                        );
                        setMessage(result);
                        setProposal(null);
                        setText("");
                        await refreshHistory();
                      } catch (e) {
                        setMessage((e as Error).message);
                      } finally {
                        locked.current = false;
                        setBusy(false);
                      }
                    }}
                  >
                    {proposal.confirmation
                      ? "Confirmer"
                      : "Appliquer la proposition"}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => {
                      // « Vérifiez la cible ci-dessous » restait affiché
                      // au-dessus d'une confirmation déjà retirée.
                      setMessage("Rien n’a été modifié.");
                      setProposal(null);
                    }}
                  >
                    {/* « Écarter » sous « écarter 312 photos » prêtait à confusion. */}
                    {proposal.confirmation ? "Annuler" : "Écarter"}
                  </button>
                </div>
              </div>
            )}
            <details className="pilot-help">
              <summary>Exemples et fonctionnement</summary>
              <p>
                Les commandes reconnues s’appliquent à la cible indiquée et
                restent annulables.{" "}
                {languageAvailable
                  ? "Un modèle de langage sur votre ordinateur interprète aussi les formulations libres, dans les limites des outils disponibles."
                  : "Les phrases non prises en charge sont signalées."}{" "}
                Aucun média n’est envoyé en ligne.
              </p>
              {planner?.installable && (
                <div className="pilot-model">
                  {installe?.enCours ? (
                    <>
                      <progress
                        max={installe.total}
                        value={installe.fait}
                        aria-label="Téléchargement de l’IA locale"
                      />
                      <small>
                        {go(installe.fait)} sur {go(installe.total)}
                      </small>
                      <button onClick={() => void actionModele("cancelInstall")}>
                        Interrompre
                      </button>
                    </>
                  ) : planner.source === "telecharge" ? (
                    <>
                      <small>IA locale installée.</small>
                      <button onClick={() => void actionModele("uninstall")}>
                        Retirer (libère {go(planner.taille)})
                      </button>
                    </>
                  ) : planner.source === "embarque" ? null : (
                    <>
                      <small>
                        {installe?.erreur ||
                          `Les commandes des exemples marchent sans elle. L’IA locale comprend en plus les formulations libres : ${go(planner.taille)} à télécharger une fois, puis tout reste sur cet ordinateur.`}
                      </small>
                      <button onClick={() => void actionModele("install")}>
                        {installe?.erreur ? "Reprendre" : "Installer l’IA locale"}
                      </button>
                    </>
                  )}
                </div>
              )}
              <div className="pilot-examples">
                {examples.map((ex) => (
                  <button
                    key={ex}
                    onClick={() => {
                      setText(ex);
                      input.current?.focus();
                    }}
                    disabled={busy || recording}
                  >
                    {ex}
                  </button>
                ))}
              </div>
              <p>
                Les valeurs photo sont en IL ou pourcentage ; les volumes vidéo
                en dB. « Puis » permet de combiner des réglages, sous le même
                verbe : « baisse les ombres de 20 puis hautes lumières de 10 ».
                La voix utilise le même interpréteur que le texte.
              </p>
            </details>
            <button
              className="pilot-history-toggle"
              onClick={() => {
                setHistoryOpen((v) => !v);
                void refreshHistory().catch((e) => setMessage(e.message));
              }}
            >
              <History size={16} /> Historique des commandes
            </button>
            {historyOpen && (
              <div className="pilot-history">
                <p>
                  Les changements ultérieurs sur les mêmes propriétés sont
                  préservés. Vidéo : les 500 dernières commandes sont
                  conservées.
                </p>
                {!records.length && (
                  <p>Aucune commande enregistrée pour ce projet.</p>
                )}
                {records.slice(page * 20, (page + 1) * 20).map((record) => (
                  <article key={record.id}>
                    <strong>{record.label}</strong>
                    <small>
                      {new Date(record.created).toLocaleString("fr-FR")} ·{" "}
                      {record.source === "voice"
                        ? "Voix"
                        : record.source === "text"
                          ? "Texte"
                          : record.source === "recipe"
                            ? "Recette"
                            : "Manuel"}{" "}
                      ·{" "}
                      {record.state === "undone"
                        ? "Annulée"
                        : record.state === "partial"
                          ? "Annulation partielle"
                          : "Appliquée"}
                    </small>
                    {/* Une annulation partielle se rétablit, ou se termine :
                        les deux gestes sont proposés (29/09/2026). */}
                    {(record.state === "partial"
                      ? [true, false]
                      : [record.state === "undone"]
                    ).map((redo) => (
                      <button
                        key={String(redo)}
                        disabled={busy || recording}
                        onClick={() => {
                          setBusy(true);
                          void props
                            .restore(record, redo)
                            .then(setMessage)
                            .then(refreshHistory)
                            .catch((e) => setMessage(e.message))
                            .finally(() => setBusy(false));
                        }}
                      >
                        {redo ? <Redo2 size={14} /> : <Undo2 size={14} />}
                        {redo
                          ? "Rétablir"
                          : record.state === "partial"
                            ? "Terminer l’annulation"
                            : "Annuler cette commande"}
                      </button>
                    ))}
                  </article>
                ))}
                {records.length > 20 && (
                  <nav>
                    <button
                      disabled={!page}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      Précédentes
                    </button>
                    <span>
                      {page + 1} / {Math.ceil(records.length / 20)}
                    </span>
                    <button
                      disabled={(page + 1) * 20 >= records.length}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Suivantes
                    </button>
                  </nav>
                )}
              </div>
            )}
          </aside>,
          document.body,
        )}
    </>
  );
}
