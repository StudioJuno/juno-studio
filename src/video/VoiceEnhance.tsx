import { useState } from "react";
import type { Asset, Clip, VideoJob } from "./types";
export default function VoiceEnhance({
  projectId,
  clip,
  assets,
  jobs,
  onPatch,
  onQueued,
  onError,
}: {
  projectId: string;
  clip: Clip;
  assets: Asset[];
  jobs: VideoJob[];
  onPatch: (p: Partial<Clip>) => void;
  onQueued: () => Promise<void>;
  onError: (e: unknown) => void;
}) {
  const [busy, setBusy] = useState(false),
    [settings, setSettings] = useState({
      strength: 0.7,
      highpass: 80,
      bass: 0,
      presence: 2,
      air: 0,
      compression: 2,
    });
  const sourceId = clip.originalAssetId ?? clip.assetId;
  const versions = assets.filter(
    (a) => a.audioProcessing?.sourceAssetId === sourceId,
  );
  async function prepare() {
    setBusy(true);
    try {
      await window.juno!.video.processAudio({
        projectId,
        assetId: sourceId,
        settings,
      });
      await onQueued();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="voice-enhance">
      <h3>Améliorer la voix</h3>
      <p className="vf-hint">
        Réduction de bruit IA sur cet ordinateur. L’original reste conservé ;
        comparez les versions avec le sélecteur ci-dessous.
      </p>
      <label>
        Réduction du bruit (%)
        <input
          type="number"
          min={0}
          max={100}
          value={Math.round(settings.strength * 100)}
          onChange={(e) =>
            setSettings({
              ...settings,
              strength:
                Math.max(0, Math.min(100, Number(e.target.value))) / 100,
            })
          }
        />
      </label>
      <details>
        <summary>Égalisation et dynamique</summary>
        {(
          [
            ["highpass", "Coupe-bas (Hz)", 0, 200, 10],
            ["bass", "Graves (dB)", -12, 12, 1],
            ["presence", "Présence (dB)", -12, 12, 1],
            ["air", "Aigus (dB)", -12, 12, 1],
            ["compression", "Compression (ratio)", 1, 8, 0.5],
          ] as const
        ).map(([key, label, min, max, step]) => (
          <label key={key}>
            {label}
            <input
              type="number"
              min={min}
              max={max}
              step={step}
              value={settings[key]}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  [key]: Math.max(min, Math.min(max, Number(e.target.value))),
                })
              }
            />
          </label>
        ))}
      </details>
      <button
        disabled={
          busy ||
          !!jobs.find(
            (j) =>
              j.projectId === projectId &&
              j.kind === "audio" &&
              ["queued", "running"].includes(j.state),
          )
        }
        onClick={() => void prepare()}
      >
        {busy ? "Préparation…" : "Préparer une version améliorée"}
      </button>
      {versions.length > 0 && (
        <label>
          Version du son
          <select
            aria-label="Version du son"
            value={clip.assetId}
            onChange={(e) =>
              onPatch({ assetId: e.target.value, originalAssetId: sourceId })
            }
          >
            <option value={sourceId}>Original</option>
            {versions.map((a, i) => (
              <option key={a.id} value={a.id}>
                Voix améliorée {i + 1}
              </option>
            ))}
          </select>
        </label>
      )}
      {clip.originalAssetId && clip.assetId !== clip.originalAssetId && (
        <button onClick={() => onPatch({ assetId: sourceId })}>
          Revenir au son original
        </button>
      )}
    </section>
  );
}
