import { useEffect, useState } from "react";
import { CheckCircle2, AlertCircle, Download, RefreshCw } from "lucide-react";
import type { EngineStatus } from "../video/types";
import { openUpdates } from './UpdateCenter';
type SystemStatus = Awaited<
  ReturnType<NonNullable<Window["juno"]>["systemStatus"]>
>;
const gib = (n: number) =>
  (n / 1024 ** 3).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + " Go";
export default function SystemPanel() {
  const [status, setStatus] = useState<SystemStatus>(),
    [engine, setEngine] = useState<EngineStatus>(),
    [error, setError] = useState("");
  async function refresh() {
    try {
      if (!window.juno) return;
      const [s, e] = await Promise.all([
        window.juno.systemStatus(),
        window.juno.video.status(),
      ]);
      setStatus(s);
      setEngine(e);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  async function report() {
    try {
      await window.juno?.saveFile(
        "Juno-diagnostic-studio.json",
        new TextEncoder().encode(
          JSON.stringify(
            {
              generatedAt: new Date().toISOString(),
              system: status,
              engine,
              online: navigator.onLine,
            },
            null,
            2,
          ),
        ).buffer as ArrayBuffer,
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (!window.juno)
    return (
      <p>
        Les diagnostics matériels et codecs sont disponibles dans l’application
        installée.
      </p>
    );
  return (
    <div className="system-panel">
      <p className="system-intro">
        Vérifiez les ressources et les formats disponibles sur cet ordinateur.
        Le diagnostic reste local.
      </p>
      {error && <p role="alert">{error}</p>}
      {status && (
        <>
          <div className="system-metrics">
            <div>
              <small>Espace disque libre</small>
              <b>{gib(status.diskFree)}</b>
            </div>
            <div>
              <small>Mémoire utilisée par Juno</small>
              <b>{gib(status.appMemory)}</b>
            </div>
            <div>
              <small>Mémoire de l’ordinateur</small>
              <b>{gib(status.memoryTotal)}</b>
            </div>
            <div>
              <small>Fichiers enregistrés</small>
              <b>{status.originalsRegistered.toLocaleString("fr-FR")}</b>
            </div>
          </div>
          <p className="system-version">
            Juno {status.version} · {status.platform} · {status.arch}
          </p>
          {status.registryError && <p role="alert">{status.registryError}</p>}
        </>
      )}
      <h3>Formats d’export vérifiés au démarrage</h3>
      {engine?.exports?.map((profile) => (
        <div className="system-codec" key={profile.id}>
          {profile.available ? (
            <CheckCircle2 size={17} />
          ) : (
            <AlertCircle size={17} />
          )}
          <span>{profile.label}</span>
          <small>{profile.available ? "Disponible" : "Indisponible"}</small>
        </div>
      ))}
      {engine?.error && <p role="alert">{engine.error}</p>}
      <p className="system-note">
        Un codec disponible ne garantit pas toutes les résolutions ou tous les
        profils caméra. Les médias non lus restent identifiés dans les tâches.
      </p>
      <div className="system-actions">
        {window.juno?.updates && <button onClick={openUpdates}><Download size={15} /> Mises à jour de Juno</button>}
        <button onClick={() => void refresh()}>
          <RefreshCw size={15} /> Actualiser
        </button>
        <button disabled={!status} onClick={() => void report()}>
          <Download size={15} /> Exporter le diagnostic
        </button>
      </div>
    </div>
  );
}
