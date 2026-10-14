import { correctTranscript } from "./transcript-correction";
import { clipCaptions } from "./caption-timing";
import { useEffect, useRef, useState } from "react";
import { FileText, Plus, Sparkles, Play } from "lucide-react";
import type { Asset, Caption, Clip, Sequence } from "./types";
import { frame, seconds } from "./edit";
export default function TranscriptPanel({
  assets,
  clip,
  sequence,
  available,
  onTranscribe,
  onAdd,
  onCaptions,
  onEdit,
  onListen,
}: {
  assets: Asset[];
  clip?: Clip;
  sequence: Sequence;
  available: boolean;
  onTranscribe: (id: string, language: string) => void;
  onAdd: (asset: Asset, start: number, end: number) => void;
  onCaptions: (captions: Caption[]) => void;
  onListen?: () => void;
  onEdit: (asset: Asset, segments: NonNullable<Asset["transcript"]>) => void;
}) {
  const [id, setId] = useState(
      clip?.assetId || assets.find((a) => a.audioChannels)?.id || "",
    ),
    [language, setLanguage] = useState("fr"),
    [query, setQuery] = useState(""),
    [editing, setEditing] = useState(-1),
    [text, setText] = useState(""),
    [listenError, setListenError] = useState("");
  useEffect(() => {
    if (
      clip?.assetId &&
      assets.some((a) => a.id === clip.assetId && a.audioChannels)
    )
      setId(clip.assetId);
  }, [clip?.assetId]);
  const audio = useRef<HTMLAudioElement>(null);
  const stopAt = useRef<number | undefined>(undefined);
  useEffect(() => {
    setEditing(-1);
    setListenError("");
    stopAt.current = undefined;
    audio.current?.pause();
  }, [id]);
  const a = assets.find((a) => a.id === id),
    segments = a?.transcript || [];
  function captions() {
    if (!a || !clip || clip.assetId !== a.id) return;
    const out = clipCaptions(segments, clip, sequence);
    onCaptions([
      ...sequence.captions.filter(
        (c) => (c as Caption & { autoSource?: string }).autoSource !== clip.id,
      ),
      ...out,
    ]);
  }
  return (
    <div className="vf-transcript">
      <div className="vf-panel-heading">
        <h2>Texte & transcription</h2>
        <FileText size={15} />
      </div>
      <label className="vf-field">
        Média
        <select
          aria-label="Média à transcrire"
          value={id}
          onChange={(e) => setId(e.target.value)}
        >
          <option value="">Choisir un média</option>
          {assets
            .filter((a) => a.audioChannels)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
        </select>
      </label>
      <label className="vf-field">
        Langue
        <select value={language} onChange={(e) => setLanguage(e.target.value)}>
          {[
            ["auto", "Détection automatique"],
            ["fr", "Français"],
            ["en", "Anglais"],
            ["es", "Espagnol"],
            ["de", "Allemand"],
            ["it", "Italien"],
          ].map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <button
        className="vf-primary"
        disabled={!a || !available || !!a.transcriptManual}
        onClick={() => a && onTranscribe(a.id, language)}
      >
        <Sparkles size={14} />
        {a?.transcript
          ? "Retranscrire avec cette langue"
          : "Transcrire localement"}
      </button>
      {a?.transcriptManual && (
        <p className="vf-hint">
          Cette transcription a été corrigée à la main. Elle est protégée contre
          un remplacement automatique.
        </p>
      )}
      {a?.transcript && !a.transcriptManual && (
        <p className="vf-hint">
          Si les mots sont incorrects, choisissez la langue parlée puis
          relancez. Ensuite, cliquez sur « Sous-titrer le plan sélectionné »
          pour mettre les sous-titres à jour.
        </p>
      )}
      {!available && (
        <p className="vf-hint">
          Le modèle de transcription n’est pas installé sur ce poste.
        </p>
      )}
      {a?.transcript && (
        <>
          <audio
            className="transcript-listen"
            ref={audio}
            src={a.proxy || a.source}
            controls
            preload="metadata"
            onPlay={onListen}
            onTimeUpdate={() => {
              if (
                stopAt.current !== undefined &&
                audio.current &&
                audio.current.currentTime >= stopAt.current
              ) {
                audio.current.pause();
                stopAt.current = undefined;
              }
            }}
            onError={() =>
              setListenError(
                "Lecture impossible : vérifiez que le média et son aperçu sont accessibles.",
              )
            }
          />
          {listenError && <p role="alert">{listenError}</p>}
          <p className="vf-hint">
            Les mots soulignés sont incertains quand le modèle fournit une
            confiance. Une correction mot à mot conserve la synchronisation ;
            ajouter ou retirer des mots retire ces repères.
          </p>
          <input
            className="vf-search"
            placeholder="Chercher dans le dialogue…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button disabled={!clip || clip.assetId !== a.id} onClick={captions}>
            Sous-titrer le plan sélectionné
          </button>
          <div className="vf-transcript-segments">
            {segments
              .map((t, i) => ({ t, i }))
              .filter(({ t }) =>
                t.text.toLowerCase().includes(query.toLowerCase()),
              )
              .map(({ t, i }) => (
                <article key={i}>
                  <div>
                    <small>
                      {Math.floor(t.start / 60)}:
                      {String(Math.floor(t.start) % 60).padStart(2, "0")} –{" "}
                      {Math.floor(t.end / 60)}:
                      {String(Math.floor(t.end) % 60).padStart(2, "0")}
                    </small>
                    <button
                      aria-label={`Écouter le passage ${i + 1}`}
                      onClick={() => {
                        const el = audio.current;
                        if (el) {
                          onListen?.();
                          el.currentTime = t.start;
                          stopAt.current = t.end;
                          setListenError("");
                          void el
                            .play()
                            .catch(() =>
                              setListenError(
                                "Lecture impossible : vérifiez le média et réessayez.",
                              ),
                            );
                        }
                      }}
                    >
                      <Play size={13} />
                    </button>
                    <button
                      aria-label="Ajouter ce passage"
                      title="Ajouter ce passage au montage"
                      onClick={() => onAdd(a, t.start, t.end)}
                    >
                      <Plus size={13} />
                    </button>
                  </div>
                  {editing === i ? (
                    <>
                      <textarea
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                      />
                      <button
                        onClick={() => {
                          onEdit(
                            a,
                            segments.map((p, j) =>
                              j === i ? correctTranscript(p, text) : p,
                            ),
                          );
                          setEditing(-1);
                        }}
                      >
                        Enregistrer le texte
                      </button>
                    </>
                  ) : (
                    <button
                      className="vf-transcript-text"
                      title="Corriger ce texte"
                      onClick={() => {
                        setEditing(i);
                        setText(t.text);
                      }}
                    >
                      {t.words?.length
                        ? t.words.map((w, wi) => (
                            <span
                              key={wi}
                              className={
                                w.confidence !== undefined &&
                                w.confidence < 0.65
                                  ? "uncertain-word"
                                  : ""
                              }
                              title={
                                w.confidence !== undefined
                                  ? `Confiance du modèle : ${Math.round(w.confidence * 100)} %`
                                  : undefined
                              }
                            >
                              {wi ? " " : ""}
                              {w.text}
                            </span>
                          ))
                        : t.text}
                    </button>
                  )}
                </article>
              ))}
          </div>
        </>
      )}
      {!a?.transcript && (
        <p className="vf-hint">
          La reconnaissance vocale s’exécute sur cet ordinateur. Relisez les
          noms et les sous-titres avant livraison.
        </p>
      )}
    </div>
  );
}
