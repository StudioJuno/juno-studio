import { useEffect, useRef, useState } from "react";
import { Sparkles, KeyRound, X } from "lucide-react";
export default function GenerationPanel({
  projectId,
  onClose,
  onQueued,
}: {
  projectId: string;
  onClose: () => void;
  onQueued: () => Promise<void>;
}) {
  const api = window.juno!.video,
    ref = useRef<HTMLDialogElement>(null),
    [configured, setConfigured] = useState(false),
    [key, setKey] = useState(""),
    [prompt, setPrompt] = useState(""),
    [model, setModel] = useState("veo-3.1-fast-generate-preview"),
    [aspect, setAspect] = useState("16:9"),
    [resolution, setResolution] = useState("1080p"),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    ref.current?.showModal();
    void api
      .generationKeyStatus()
      .then(setConfigured)
      .catch((e) => setMessage(e.message));
    return () => ref.current?.close();
  }, []);
  async function save() {
    setBusy(true);
    try {
      setConfigured(await api.saveGenerationKey(key));
      setKey("");
      setMessage(
        "Clé enregistrée dans le stockage sécurisé de cet ordinateur.",
      );
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function generate() {
    setBusy(true);
    setMessage("");
    try {
      await api.generate({ projectId, prompt, model, aspect, resolution });
      await onQueued();
      onClose();
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog ref={ref} className="vf-dialog vf-generation" onCancel={onClose}>
      <header>
        <h2>
          <Sparkles size={20} /> Générer un plan
        </h2>
        <button aria-label="Fermer génération" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <p>
        Créez une vidéo de huit secondes à partir d’une description. Le résultat
        sera ajouté à votre bibliothèque.
      </p>
      <details open={!configured}>
        <summary>
          <KeyRound size={14} />{" "}
          {configured
            ? "Compte Google configuré"
            : "Connecter Google AI Studio"}
        </summary>
        <label className="vf-field">
          Clé API Google
          <input
            type="password"
            autoComplete="off"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Saisissez votre clé sur cet ordinateur"
          />
        </label>
        <button disabled={busy || !key.trim()} onClick={() => void save()}>
          Enregistrer la clé
        </button>
        {configured && (
          <button
            disabled={busy}
            onClick={() =>
              void api
                .saveGenerationKey("")
                .then(setConfigured)
                .catch((e) => setMessage(e.message))
            }
          >
            Déconnecter Google
          </button>
        )}
      </details>
      <label className="vf-field">
        Décrivez le plan
        <textarea
          rows={5}
          maxLength={4000}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Lieu, sujet, lumière, mouvement de caméra, ambiance sonore…"
        />
      </label>
      <div className="vf-generation-options">
        <label className="vf-field">
          Modèle
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="veo-3.1-fast-generate-preview">Veo 3.1 Fast</option>
            <option value="veo-3.1-generate-preview">Veo 3.1</option>
          </select>
        </label>
        <label className="vf-field">
          Cadrage
          <select value={aspect} onChange={(e) => setAspect(e.target.value)}>
            <option>16:9</option>
            <option>9:16</option>
          </select>
        </label>
        <label className="vf-field">
          Résolution
          <select
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
          >
            <option>720p</option>
            <option>1080p</option>
          </select>
        </label>
      </div>
      <p className="vf-hint">
        Google reçoit votre description et facture cette génération sur votre
        compte. Vous pouvez continuer le montage pendant le traitement. La pause
        dans Juno arrête le suivi local ; la génération peut continuer chez
        Google.
      </p>
      {message && (
        <p role="alert" className="vf-warning">
          {message}
        </p>
      )}
      <footer>
        <button
          className="vf-primary"
          disabled={busy || !configured || prompt.trim().length < 5}
          onClick={() => void generate()}
        >
          <Sparkles size={16} />
          Générer avec Google
        </button>
      </footer>
    </dialog>
  );
}
