import { useEffect, useMemo, useState } from "react";
import { Check, FolderOpen, Info, RotateCcw, Send } from "lucide-react";
import type { Photo } from "../model";
import { readPeople } from "./people-store";
import {
  lightroomItems,
  PHRASES,
  type LightroomBilan,
  type LightroomEtat,
  type LightroomOptions,
  type LightroomPlan,
} from "./lightroom";
type Portee = "all" | "keep" | "selection";
/**
 * Envoyer le tri à Lightroom Classic : un .xmp à côté de chaque RAW, que
 * Lightroom lit à l'import ou avec « Lire les métadonnées ».
 */
export default function LightroomPanel({
  photos,
  selection,
  projectId,
  onClose,
  notify,
}: {
  photos: Photo[];
  selection: string[];
  projectId: string;
  onClose: () => void;
  notify: (message: string) => void;
}) {
  const [portee, setPortee] = useState<Portee>(selection.length > 1 ? "selection" : "all");
  const [options, setOptions] = useState<LightroomOptions>({
    etoiles: true,
    couleurs: true,
    tri: true,
    personnes: true,
    chapitres: false,
    remplacer: false,
  });
  const [plan, setPlan] = useState<LightroomPlan | null>(null);
  const [calcul, setCalcul] = useState(0);
  const [travail, setTravail] = useState("");
  const [erreur, setErreur] = useState("");
  const [bilan, setBilan] = useState<LightroomBilan | null>(null);
  const noms = useMemo(() => {
    const m = new Map(readPeople(projectId).filter((p) => p.name).map((p) => [p.id, p.name!]));
    return (id: string) => m.get(id);
  }, [projectId]);
  const items = useMemo(() => {
    const choisies =
      portee === "keep"
        ? photos.filter((p) => p.status === "keep")
        : portee === "selection"
          ? photos.filter((p) => selection.includes(p.id))
          : photos;
    return lightroomItems(choisies, noms);
  }, [photos, selection, portee, noms]);
  // Une clé stable : le catalogue se met à jour souvent, le bilan seulement
  // quand ce qui serait envoyé change.
  const cle = useMemo(() => JSON.stringify(items), [items]);
  // Le bilan se recalcule à chaque choix : rien n'est écrit avant « Envoyer ».
  useEffect(() => {
    if (!window.juno?.lightroom || bilan) return;
    let fini = false;
    setErreur("");
    setPlan(null);
    window.juno.lightroom
      .plan({ items, options })
      .then((p) => !fini && setPlan(p))
      .catch((e) => !fini && setErreur((e as Error).message));
    return () => {
      fini = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle, options, calcul, bilan]);
  const compte = plan?.compte || {};
  const aEcrire = (compte.nouveau || 0) + (compte.complete || 0) + (compte.conflit || 0);
  const bloquees = (compte.introuvable || 0) + (compte.absent || 0) + (compte["disque-absent"] || 0) + (compte.different || 0);
  const case_ = (cle: keyof LightroomOptions, texte: string, aide?: string) => (
    <label className="team-consent lightroom-option">
      <input
        type="checkbox"
        checked={!!options[cle]}
        onChange={(e) => setOptions({ ...options, [cle]: e.target.checked })}
      />{" "}
      <span>
        {texte}
        {aide && <small>{aide}</small>}
      </span>
    </label>
  );
  async function envoyer() {
    if (!plan) return;
    setTravail("Écriture des fichiers .xmp…");
    try {
      const b = await window.juno!.lightroom.write(plan.token);
      setBilan(b);
      notify(`${b.ecrits} photo(s) prêtes pour Lightroom.`);
    } catch (e) {
      setErreur((e as Error).message);
    } finally {
      setTravail("");
    }
  }
  async function retrouver() {
    const perdus = new Set(
      (plan?.lignes || []).filter((l) => ["introuvable", "absent", "different"].includes(l.etat)).map((l) => l.id),
    );
    setTravail("Recherche des originaux par leur empreinte…");
    try {
      const r = await window.juno!.lightroom.locate(items.filter((i) => perdus.has(i.id)));
      if (r) notify(`${r.trouves} original(aux) retrouvé(s) sur ${r.cherches}.`);
      setCalcul((n) => n + 1);
    } catch (e) {
      setErreur((e as Error).message);
    } finally {
      setTravail("");
    }
  }
  async function dossierPret() {
    const bloques = new Set(
      (plan?.lignes || [])
        .filter((l) => ["introuvable", "absent", "disque-absent", "different"].includes(l.etat))
        .map((l) => l.id),
    );
    setTravail("Copie des originaux et écriture des .xmp…");
    try {
      const r = await window.juno!.lightroom.folder({ items: items.filter((i) => bloques.has(i.id)), options });
      if (r) {
        notify(`${r.copies} photo(s) copiée(s) avec leur .xmp.${r.echecs.length ? ` ${r.echecs.length} en échec.` : ""}`);
        void window.juno!.lightroom.reveal(r.dossier);
      }
    } catch (e) {
      setErreur((e as Error).message);
    } finally {
      setTravail("");
    }
  }
  async function annuler() {
    if (!bilan) return;
    setTravail("Remise des fichiers dans leur état d’avant…");
    try {
      const r = await window.juno!.lightroom.undo(bilan.token);
      notify(
        `${r.rendus} fichier(s) remis comme avant.${r.gardes ? ` ${r.gardes} modifié(s) depuis dans Lightroom, laissé(s) tel(s) quel(s).` : ""}`,
      );
      onClose();
    } catch (e) {
      setErreur((e as Error).message);
    } finally {
      setTravail("");
    }
  }
  if (!window.juno?.lightroom)
    return (
      <p className="modal-intro">
        L’envoi à Lightroom écrit des fichiers à côté de vos originaux : il n’est disponible que dans l’application
        de bureau.
      </p>
    );
  if (bilan)
    return (
      <>
        <p className="modal-intro">
          <Check size={16} /> {bilan.ecrits} photo(s) prêtes pour Lightroom
          {bilan.inchanges ? `, ${bilan.inchanges} déjà à jour` : ""}.
          {bilan.conserves ? ` ${bilan.conserves} note(s) posée(s) ailleurs ont été gardées.` : ""}
        </p>
        {!!bilan.echecs.length && (
          <div className="notice warning">
            <Info size={16} />
            <div>
              <p>{bilan.echecs.length} photo(s) non envoyée(s) :</p>
              <ul className="lightroom-echecs">
                {bilan.echecs.slice(0, 6).map((e) => (
                  <li key={e.id}>
                    {e.name} : {e.raison}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
        <div className="notice">
          <Info size={16} />
          <p>
            Dans Lightroom : importez les photos, ou, si elles y sont déjà, sélectionnez-les puis Métadonnées, Lire les
            métadonnées à partir des fichiers. Pour les écartées, filtrez le mot-clé « Écartée » puis appuyez sur X.
          </p>
        </div>
        <div className="modal-actions">
          <button className="button secondary" disabled={!!travail} onClick={() => void annuler()}>
            <RotateCcw size={15} /> Annuler l’envoi
          </button>
          {bilan.dossiers[0] && (
            <button className="button secondary" onClick={() => void window.juno!.lightroom.reveal(bilan.dossiers[0])}>
              <FolderOpen size={15} /> Afficher dans le Finder
            </button>
          )}
          <button className="button primary" onClick={onClose}>
            Terminé
          </button>
        </div>
      </>
    );
  return (
    <>
      <p className="modal-intro">
        Juno écrit un fichier .xmp à côté de chaque RAW. Lightroom y lit les étoiles, la couleur et les mots-clés. Vos
        originaux et vos réglages Lightroom ne sont pas modifiés.
      </p>
      <label className="field">
        Photos
        <select value={portee} onChange={(e) => setPortee(e.target.value as Portee)}>
          <option value="all">Toutes ({photos.length})</option>
          <option value="keep">Les photos gardées ({photos.filter((p) => p.status === "keep").length})</option>
          <option value="selection" disabled={!selection.length}>
            La sélection ({selection.length})
          </option>
        </select>
      </label>
      <div className="lightroom-options">
        {case_("etoiles", "Étoiles")}
        {case_(
          "couleurs",
          "Couleur selon les étoiles, comme Aftershoot",
          `5 ${plan?.libelles[2] ?? "Vert"}, 4 ${plan?.libelles[3] ?? "Bleu"}, 3 ${plan?.libelles[1] ?? "Jaune"}, 2 ${plan?.libelles[0] ?? "Rouge"}, 1 ${plan?.libelles[4] ?? "Violet"} (noms lus dans Lightroom)`,
        )}
        {case_("tri", "Mots-clés de tri", "Juno › Tri › Gardée, Écartée, Protégée")}
        {case_("personnes", "Personnes nommées")}
        {case_("chapitres", "Chapitres", "L’import les met tous sur le premier : à n’envoyer qu’après les avoir rangés.")}
      </div>
      <div className="lightroom-bilan" aria-live="polite">
        {!plan && !erreur && <p>Préparation du bilan…</p>}
        {plan &&
          (Object.keys(PHRASES) as LightroomEtat[])
            .filter((e) => compte[e])
            .map((e) => (
              <p key={e} className={`lightroom-etat ${e}`}>
                {PHRASES[e](compte[e]!)}
                {e === "disque-absent" && plan.disques.length ? ` (${plan.disques.join(", ")})` : ""}
              </p>
            ))}
        {plan && !!compte.conflit && (
          <label className="team-consent lightroom-option">
            <input
              type="checkbox"
              checked={!!options.remplacer}
              onChange={(e) => setOptions({ ...options, remplacer: e.target.checked })}
            />{" "}
            <span>
              Remplacer les notes posées dans Aftershoot ou Lightroom
              <small>Sinon elles sont gardées, et Juno n’ajoute que ses mots-clés.</small>
            </span>
          </label>
        )}
        {erreur && <p className="lightroom-etat erreur">{erreur}</p>}
      </div>
      <div className="notice">
        <Info size={16} />
        <p>
          Photos déjà dans Lightroom ? 1. Dans Lightroom, Cmd+S (Enregistrer les métadonnées dans le fichier). 2. Envoyez
          ici. 3. Dans Lightroom, Lire les métadonnées. Sans l’étape 1, Lightroom remplacerait vos retouches récentes.
        </p>
      </div>
      {travail && <p className="micro-note">{travail}</p>}
      <div className="modal-actions">
        {!!bloquees && (
          <button className="button secondary" disabled={!!travail} onClick={() => void retrouver()}>
            <FolderOpen size={15} /> Retrouver le dossier des originaux…
          </button>
        )}
        {!!bloquees && (
          <button
            className="button secondary"
            disabled={!!travail}
            title="Copie des originaux gardés par Juno, avec leur .xmp, dans un dossier à importer dans Lightroom"
            onClick={() => void dossierPret()}
          >
            Préparer un dossier pour Lightroom…
          </button>
        )}
        <button className="button primary" disabled={!aEcrire || !!travail} onClick={() => void envoyer()}>
          <Send size={15} /> Envoyer à Lightroom{aEcrire ? ` (${aEcrire})` : ""}
        </button>
      </div>
    </>
  );
}
