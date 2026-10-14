import { useRef, useState } from "react";
import { Sparkles, Loader2, FolderSearch, Images, Trash2 } from "lucide-react";
import { STYLES } from "../model";
import { profileStatus } from "../modules/style-profile";
import { explainProfile } from "../modules/xmp";
import { LOOK_LIMITS } from "../modules/look-store";
import {
  describeLook,
  forgetLook,
  learnLookFromImages,
  readLook,
  writeLook,
  type StoredLook,
} from "../modules/look-store";
import {
  describeProfile,
  forgetXmpProfile,
  learnFromFolder,
  readXmpProfile,
  type StoredXmpProfile,
} from "../modules/xmp-store";
export default function AlbumAction({
  disabled,
  run,
  compact = false,
  projectId = "",
}: {
  disabled: boolean;
  compact?: boolean;
  run: (style: string) => Promise<unknown>;
  /** Le message d'une passe appartient au projet où elle a été lancée. */
  projectId?: string;
}) {
  const [style, setStyle] = useState(() => {
    try {
      return localStorage.getItem("juno-album-style") || "signature";
    } catch {
      return "signature";
    }
  });
  const [busy, setBusy] = useState(false),
    // Le composant n'est pas remonté quand on change de projet : sans le
    // projet d'origine, « Première passe lancée » restait affiché ailleurs.
    [note, setNote] = useState({ text: "", projectId: "" });
  const message = note.projectId === projectId ? note.text : "";
  const locked = useRef(false);
  return (
    <div className={`album-action ${compact ? "album-compact" : ""}`}>
      <label>
        <span>Style de l’album</span>
        <select
          aria-label="Style de l’album"
          value={STYLES.some((s) => s.id === style) ? style : "signature"}
          disabled={busy}
          onChange={(e) => {
            setStyle(e.target.value);
            try {
              localStorage.setItem("juno-album-style", e.target.value);
            } catch {}
          }}
        >
          {STYLES.filter((s) => s.id !== "original").map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <button
        className="button primary full"
        disabled={disabled || busy}
        onClick={async () => {
          if (locked.current) return;
          locked.current = true;
          setBusy(true);
          const origine = projectId;
          setNote({ text: "", projectId: origine });
          try {
            await run(STYLES.some((s) => s.id === style) ? style : "signature");
            setNote({
              text: "Première passe lancée. Suivez-la dans Activité ; vous pouvez la suspendre et l’annuler dans l’historique du pilote.",
              projectId: origine,
            });
          } catch (e) {
            setNote({ text: (e as Error).message, projectId: origine });
          } finally {
            locked.current = false;
            setBusy(false);
          }
        }}
      >
        {busy ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}{" "}
        Préparer l’album
      </button>
      {!compact && (
        <small>Analyse + balance des blancs + style · hors ligne · 0 €</small>
      )}
      {!compact && <p className="micro-note">{profileStatus()}</p>}
      <LightroomStyle compact={compact} />
      <DeliveredLook compact={compact} />
      {!compact && (
        <p className="micro-note">
          Les variantes et les ambiances atypiques restent à vérifier.
          Originaux, photos protégées et retouches reprises à la main sont
          préservés.
        </p>
      )}
      {message && (
        <p role="status" className="micro-note">
          {message}
        </p>
      )}
    </div>
  );
}
/**
 * Apprendre le style du photographe depuis un dossier retouché dans Lightroom.
 *
 * Les fichiers .xmp d'un dossier portent les réglages réellement appliqués à
 * chaque photo. Sur un album entier, ils disent ce qu'il fait toujours. C'est
 * plus rapide et plus sûr que d'attendre douze corrections dans Juno, et ça
 * ne demande aucun apprentissage automatique.
 */
function LightroomStyle({ compact = false }: { compact?: boolean }) {
  const [profile, setProfile] = useState<StoredXmpProfile | undefined>(() =>
    readXmpProfile(),
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const api = typeof window !== "undefined" ? window.juno : undefined;
  if (!api?.stylePickFolder) return null;
  return (
    <div className={`lightroom-style${compact ? " compact" : ""}`}>
      <button
        className={compact ? "button" : "button full"}
        title="Lire les fichiers .xmp d’un dossier retouché dans Lightroom pour en apprendre votre style. Rien n’est modifié dans ce dossier."
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMessage("");
          try {
            const folder = await api.stylePickFolder!();
            if (!folder) return;
            if (!folder.fichiers.length) {
              setMessage(
                `Aucun fichier .xmp lisible dans « ${folder.nom} ». Dans Lightroom, utilisez « Enregistrer les métadonnées dans le fichier » pour les créer.`,
              );
              return;
            }
            const learned = learnFromFolder(folder);
            if (!Object.keys(learned.signature).length && !Object.keys(learned.bias).length) {
              setMessage(
                `${learned.samples} retouches lues, mais aucune régularité assez nette pour en tirer un style. Un dossier d'un seul mariage donne un meilleur résultat qu'un mélange.`,
              );
              return;
            }
            const { writeXmpProfile } = await import("../modules/xmp-store");
            writeXmpProfile(learned);
            setProfile(learned);
            setMessage("");
          } catch (e) {
            setMessage((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? (
          <Loader2 size={16} className="spin" />
        ) : (
          <FolderSearch size={16} />
        )}{" "}
        {compact ? "Mon style Lightroom" : "Apprendre mon style depuis Lightroom"}
      </button>
      {!compact && <p className="micro-note">{describeProfile(profile)}</p>}
      {!compact &&
        profile &&
        explainProfile(profile).map((ligne) => (
          <p key={ligne} className="micro-note">
            {ligne}
          </p>
        ))}
      {profile && !compact && (
        <button
          className="button ghost full"
          onClick={() => {
            forgetXmpProfile();
            setProfile(undefined);
            setMessage("");
          }}
        >
          <Trash2 size={16} /> Oublier ce style
        </button>
      )}
      {message && (
        <p role="status" className="micro-note">
          {message}
        </p>
      )}
      {compact && profile && (
        <span className="micro-note" title={describeProfile(profile)}>
          {profile.samples} retouches apprises
        </span>
      )}
    </div>
  );
}
/**
 * Apprendre le rendu voulu depuis des photos déjà livrées.
 *
 * C'est le chemin pour un photographe qui n'a pas de fichiers Lightroom, donc
 * pour la plupart d'entre eux. Il n'apprend pas les corrections appliquées,
 * seulement la couleur du résultat, et c'est dit.
 */
function DeliveredLook({ compact = false }: { compact?: boolean }) {
  const [look, setLook] = useState<StoredLook | undefined>(() => readLook());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const api = typeof window !== "undefined" ? window.juno : undefined;
  if (!api?.lookPickFolder) return null;
  return (
    <div className={`delivered-look${compact ? " compact" : ""}`}>
      <button
        className={compact ? "button" : "button full"}
        disabled={busy}
        title="Mesurer le rendu de photos que vous avez déjà livrées, pour que Juno vise la même couleur. Le dossier n’est pas modifié."
        onClick={async () => {
          setBusy(true);
          setMessage("");
          try {
            const folder = await api.lookPickFolder!();
            if (!folder) return;
            if (!folder.images.length) {
              setMessage(
                `Aucune image lisible dans « ${folder.nom} ».`,
              );
              return;
            }
            const learned = learnLookFromImages(folder);
            writeLook(learned);
            setLook(learned);
          } catch (e) {
            setMessage((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? <Loader2 size={16} className="spin" /> : <Images size={16} />}{" "}
        {compact ? "Mon rendu livré" : "Apprendre le rendu de mes photos livrées"}
      </button>
      {!compact && <p className="micro-note">{describeLook(look)}</p>}
      {!compact && look && <p className="micro-note">{LOOK_LIMITS}</p>}
      {!compact && look && (
        <button
          className="button ghost full"
          onClick={() => {
            forgetLook();
            setLook(undefined);
            setMessage("");
          }}
        >
          <Trash2 size={16} /> Oublier ce rendu
        </button>
      )}
      {message && (
        <p role="status" className="micro-note">
          {message}
        </p>
      )}
      {compact && look && (
        <span className="micro-note" title={describeLook(look)}>
          {look.samples} photos mesurées
        </span>
      )}
    </div>
  );
}
