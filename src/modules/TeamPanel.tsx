import { getThumbnail } from "../db";
import { useEffect, useState } from "react";
import {
  Users,
  RefreshCw,
  Upload,
  Download,
  MessageSquare,
  ShieldCheck,
  LogOut,
  Plus,
} from "lucide-react";
import type { Photo, Project } from "../model";
import { uid, DEFAULT } from "../model";
import type { TeamSession } from "../global";
import { putProject, restoreProject } from "../db";
import { validateCatalog } from "./catalog-validation";
type Summary = {
  id: string;
  name: string;
  kind: string;
  owner: string;
  revision: number;
  updated: number;
};
type Comment = {
  id: string;
  photoId?: string;
  body: string;
  created: number;
  author: string;
};
/**
 * Une photo dans le catalogue partagé, plafonné à 8 Mo par le service.
 * Ne partent pas : ce qui ne sert qu'au poste (source, vignette envoyée à
 * part, historique), l'empreinte de rafale (3,4 ko, tri local), le résumé de
 * sens (20,8 ko, recalculé par la passe d'album) et la pile de
 * rétablissement. Avec le résumé de sens, le partage échouait dès environ
 * 320 photos analysées.
 */
/**
 * Les lectures de visage pèsent 6,6 ko chacune (signature géométrique et
 * descripteur du réseau en nombres à 17 chiffres) : un mariage de 2 000
 * photos dépassait le plafond de 8 Mo du service d'équipe. Le descripteur
 * suffit à reconnaître une personne (people.ts le préfère) : la signature ne
 * part que sans lui. Le descripteur voyage en entiers de 16 bits au
 * dix-millième (344 caractères au lieu de 2,5 ko), bien sous l'écart qui
 * sépare deux personnes (0,6) ; la copie reçue le rend en nombres.
 */
const DESCRIPTEUR_COMPACT = "i16:";
function compacter(v: number[]) {
  const n = Int16Array.from(v, (x) => Math.max(-32768, Math.min(32767, Math.round(x * 10000))));
  let texte = "";
  const octets = new Uint8Array(n.buffer);
  for (let i = 0; i < octets.length; i += 8192)
    texte += String.fromCharCode(...octets.subarray(i, i + 8192));
  return DESCRIPTEUR_COMPACT + btoa(texte);
}
/** Le descripteur reçu compacté redevient un tableau de nombres. */
export function deplier(v: unknown): number[] | undefined {
  if (Array.isArray(v)) return v as number[];
  if (typeof v !== "string" || !v.startsWith(DESCRIPTEUR_COMPACT) || v.length > 4096) return undefined;
  try {
    const brut = atob(v.slice(DESCRIPTEUR_COMPACT.length));
    if (brut.length % 2) return undefined;
    const octets = Uint8Array.from(brut, (c) => c.charCodeAt(0));
    return Array.from(new Int16Array(octets.buffer), (x) => x / 10000);
  } catch {
    return undefined;
  }
}
function analyseDEquipe(a: NonNullable<Photo["analysis"]>) {
  const arrondi = (v: number[]) => v.map((x) => Math.round(x * 1000) / 1000);
  return {
    ...a,
    empreinte: undefined,
    faces: a.faces
      ? {
          ...a.faces,
          reads: a.faces.reads?.map((r) => ({
            ...r,
            descriptor: r.descriptor?.length ? (compacter(r.descriptor) as unknown as number[]) : undefined,
            signature: r.descriptor?.length ? undefined : r.signature && arrondi(r.signature),
          })),
        }
      : undefined,
  };
}
export function ficheDEquipe(p: Photo, photoIds: Map<string, string>) {
  const {
    thumbnail,
    source,
    history,
    versions,
    semantic,
    future,
    originalRecovery,
    ...reste
  } = p;
  return {
    ...reste,
    analysis: p.analysis ? analyseDEquipe(p.analysis) : undefined,
    id: p.remotePhotoId || p.id,
    parentId: p.parentId ? photoIds.get(p.parentId) : undefined,
    source: undefined,
    history: [],
    versions: versions?.slice(-5),
  };
}
export default function TeamPanel({
  project,
  photos,
  current,
  onProject,
  onRestore,
}: {
  project?: Project;
  photos: Photo[];
  current?: Photo;
  onProject: (p: Project) => void;
  onRestore: (p: Project, photos: Photo[]) => void;
}) {
  const [local, setLocal] = useState<{
      installed: boolean;
      available: boolean;
      setupRequired: boolean;
      url: string;
    } | null>(null),
    [confirmPassword, setConfirmPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState(""),
    [newPassword, setNewPassword] = useState("");
  const [session, setSession] = useState<TeamSession | null>(null),
    [url, setUrl] = useState("http://127.0.0.1:8787"),
    [email, setEmail] = useState("contact@studio-juno.fr"),
    [password, setPassword] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [remote, setRemote] = useState<Summary[]>([]),
    [comments, setComments] = useState<Comment[]>([]),
    [body, setBody] = useState(""),
    [shareEmail, setShareEmail] = useState(""),
    [role, setRole] = useState("reviewer"),
    [userName, setUserName] = useState(""),
    [userEmail, setUserEmail] = useState(""),
    [userPassword, setUserPassword] = useState(""),
    [users, setUsers] = useState<
      { id: string; name: string; email: string; disabled: boolean }[]
    >([]),
    [members, setMembers] = useState<
      { id: string; name: string; email: string; role: string }[]
    >([]),
    [consent, setConsent] = useState(false);
  const associated = !!(
      project?.remoteId &&
      session &&
      project.remoteServer === session.url
    ),
    remoteId = associated ? project?.remoteId : undefined;
  const api = <T,>(
    route: string,
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" = "GET",
    body?: unknown,
    revision?: number,
  ) => window.juno!.teamRequest<T>({ route, method, body, revision });
  async function action(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    setRemote(await api<Summary[]>("/projects"));
    if (session?.user.role === "admin")
      setUsers(await api<typeof users>("/users"));
    if (remoteId) {
      setComments(await api<Comment[]>(`/projects/${remoteId}/comments`));
      try {
        setMembers(await api<typeof members>(`/projects/${remoteId}/members`));
      } catch {
        setMembers([]);
      }
    }
  }
  useEffect(() => {
    window.juno
      ?.teamStatus()
      .then(setSession)
      .catch((e) => setMessage(e.message));
    window.juno
      ?.teamLocalStatus()
      .then(setLocal)
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (session) void action(refresh);
  }, [session?.url, remoteId]);
  async function publish() {
    if (!project || !session || !consent) return;
    const id = remoteId || uid();
    const photoIds = new Map(
      photos.map((p) => [p.id, p.remotePhotoId || p.id]),
    );
    const payload = {
      schema: 2,
      project: {
        name: project.name,
        date: project.date,
        location: project.location,
        kind: project.kind,
      },
      photos: photos.map((p) => ficheDEquipe(p, photoIds)),
    };
    const result = remoteId
      ? await api<{ revision: number }>(
          `/projects/${id}`,
          "PUT",
          { payload },
          project.sharedRevision,
        )
      : await api<{ revision: number }>("/projects", "POST", {
          id,
          name: project.name,
          kind: project.kind || "Projet libre",
          payload,
        });
    const p = {
      ...project,
      remoteId: id,
      remoteServer: session.url,
      sharedRevision: result.revision,
    };
    await putProject(p);
    onProject(p);
    for (let i = 0; i < photos.length; i += 40) {
      setMessage(
        `Envoi des aperçus · ${Math.min(i + 40, photos.length)} / ${photos.length}`,
      );
      await api(`/projects/${id}/previews`, "POST", {
        photos: await Promise.all(
          photos.slice(i, i + 40).map(async (p) => ({
            id: p.remotePhotoId || p.id,
            thumbnail: p.thumbnail || (await getThumbnail(p.id)),
          })),
        ),
      });
    }
    setMessage(
      "Projet et aperçus synchronisés. Les originaux restent sur votre poste.",
    );
    setRemote(await api<Summary[]>("/projects"));
  }
  async function retrieve(id: string) {
    const data = await api<{
      id: string;
      revision: number;
      payload: { project: Project; photos: Photo[] };
    }>(`/projects/${id}`);
    if (
      !data.payload?.project ||
      !Array.isArray(data.payload.photos) ||
      data.payload.photos.length > 50000
    )
      throw Error("Catalogue partagé invalide.");
    const thumbnails = new Map<string, string>();
    for (let offset = 0; offset <= 50000; offset += 50) {
      const result = await api<{
        photos: { id: string; thumbnail: string }[];
        more: boolean;
      }>(`/projects/${id}/previews?offset=${offset}`);
      for (const p of result.photos) thumbnails.set(p.id, p.thumbnail);
      if (!result.more) break;
      setMessage(`Récupération des aperçus · ${thumbnails.size}`);
    }
    const p: Project = {
      ...data.payload.project,
      id: uid(),
      name: data.payload.project.name + " · équipe",
      demo: false,
      created: Date.now(),
      sharedRevision: data.revision,
      remoteId: id,
      remoteServer: session!.url,
    };
    const ids = new Map(data.payload.photos.map((p) => [p.id, uid()]));
    const ps: Photo[] = data.payload.photos.map((photo) => {
      if (
        !/^[a-f0-9]{64}$/.test(photo.hash) ||
        typeof photo.name !== "string" ||
        !Number.isFinite(photo.width) ||
        !Number.isFinite(photo.height)
      )
        throw Error("Métadonnées de photo invalides.");
      return {
        ...photo,
        id: ids.get(photo.id)!,
        parentId: photo.parentId ? ids.get(photo.parentId) : undefined,
        remotePhotoId: photo.id,
        projectId: p.id,
        source: "idb",
        thumbnail: thumbnails.get(photo.id) || "",
        previewOnly: true,
        history: [],
        adjustments: { ...DEFAULT, ...photo.adjustments },
        analysis: photo.analysis?.faces?.reads
          ? {
              ...photo.analysis,
              faces: {
                ...photo.analysis.faces,
                reads: photo.analysis.faces.reads.map((r) => ({
                  ...r,
                  descriptor: deplier(r.descriptor),
                })),
              },
            }
          : photo.analysis,
      };
    });
    // La copie reçue est relue avant d'être affichée : onRestore la montre
    // telle quelle, et un champ du mauvais type (un verdict qui n'est pas un
    // texte) faisait planter l'écran à l'ouverture du projet.
    const propres = validateCatalog(p, ps).photos;
    await restoreProject(p, propres);
    onRestore(p, propres);
    setMessage(
      "Copie récupérée. Reliez les originaux depuis les sauvegardes pour accéder à la retouche et à l’export.",
    );
  }
  if (!window.juno)
    return (
      <div className="notice">
        <Users size={20} />
        <p>
          Le travail en équipe se configure dans l’application Mac ou Windows.
          Il utilise votre service Juno avec des comptes individuels et des
          droits par projet.
        </p>
      </div>
    );
  const setup = !!(
    local?.available &&
    local.setupRequired &&
    url === local.url
  );
  if (!session)
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void action(async () => {
            if (setup) {
              if (password !== confirmPassword)
                throw Error("Les mots de passe ne correspondent pas.");
              setSession(
                await window.juno!.teamLocalSetup({ email, password }),
              );
              setLocal(local ? { ...local, setupRequired: false } : null);
            } else
              setSession(
                await window.juno!.teamLogin({ url, email, password }),
              );
            setPassword("");
            setConfirmPassword("");
          });
        }}
      >
        <p className="modal-intro">
          {setup
            ? "Votre service local est installé. Créez votre compte administrateur pour activer l’espace équipe sur cet ordinateur."
            : "Connectez le studio au service de votre équipe. Vos projets restent utilisables hors ligne."}
        </p>
        <label className="field">
          Adresse du service Juno
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://studio.votre-domaine.fr"
            required
          />
        </label>
        <div className="field-row">
          <label className="field">
            Email
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              maxLength={250}
            />
          </label>
          <label className="field">
            {setup
              ? "Choisir un mot de passe · 12 caractères minimum"
              : "Mot de passe"}
            <input
              type="password"
              autoComplete={setup ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={setup ? 12 : 1}
              maxLength={300}
            />
          </label>
        </div>
        {setup && (
          <label className="field">
            Confirmer le mot de passe
            <input
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={12}
              maxLength={300}
            />
          </label>
        )}
        <button
          type="submit"
          className="button primary"
          disabled={
            busy ||
            !email ||
            !password ||
            (setup && (password.length < 12 || password !== confirmPassword))
          }
        >
          {busy
            ? "Connexion…"
            : setup
              ? "Créer mon espace local"
              : "Se connecter"}
        </button>
        {message && (
          <p className="team-message" role="status">
            {message}
          </p>
        )}
        <p className="micro-note">
          {local?.installed && url === local.url
            ? local.available
              ? "Ce service fonctionne sur ce Mac. Un hébergement HTTPS sera nécessaire pour connecter les autres photographes à distance."
              : "Le service local est installé mais ne répond pas. Consultez le guide d’installation pour le redémarrer."
            : "Pour rejoindre une équipe à distance, indiquez l’adresse HTTPS communiquée par votre administrateur."}
        </p>
      </form>
    );

  return (
    <div className="team-panel">
      <div className="team-identity">
        <ShieldCheck size={20} />
        <div>
          <b>{session.user.name}</b>
          <small>
            {session.url} ·{" "}
            {session.user.role === "admin" ? "Administrateur" : "Photographe"}
          </small>
        </div>
        <button
          aria-label="Déconnexion équipe"
          disabled={busy}
          onClick={() =>
            void action(async () => {
              await window.juno!.teamLogout();
              setSession(null);
            })
          }
        >
          <LogOut size={17} />
        </button>
      </div>
      {message && (
        <p className="team-message" role="status">
          {message}
        </p>
      )}
      <section className="settings-block">
        <h3>Partager « {project?.name} »</h3>
        <p>
          Envoie les réglages, la sélection et les aperçus aux membres autorisés
          du projet. Les originaux ne sont pas transférés : les collègues
          peuvent les relier par leur empreinte exacte.
        </p>
        <label className="team-consent">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />{" "}
          Je partage ce projet et ses aperçus avec le service indiqué ci-dessus.
        </label>
        <button
          className="button primary"
          disabled={busy || !consent || !project}
          onClick={() => void action(publish)}
        >
          <Upload size={15} />
          {remoteId ? "Synchroniser mes modifications" : "Partager le projet"}
        </button>
        {associated && (
          <small className="sync-revision">
            Version synchronisée : {project?.sharedRevision}
          </small>
        )}
        {remoteId && (
          <>
            <div className="field-row">
              <label className="field">
                Email d’un membre existant
                <input
                  value={shareEmail}
                  onChange={(e) => setShareEmail(e.target.value)}
                />
              </label>
              <label className="field">
                Droits
                <select value={role} onChange={(e) => setRole(e.target.value)}>
                  <option value="reviewer">Commenter</option>
                  <option value="editor">Modifier et commenter</option>
                  <option value="viewer">Consulter</option>
                </select>
              </label>
            </div>
            <button
              className="button secondary"
              disabled={busy || !shareEmail}
              onClick={() =>
                void action(async () => {
                  await api(`/projects/${remoteId}/members`, "POST", {
                    email: shareEmail,
                    role,
                  });
                  setShareEmail("");
                  await refresh();
                  setMessage("Accès accordé.");
                })
              }
            >
              <Plus size={14} /> Ajouter au projet
            </button>
            {members.map((m) => (
              <div className="team-row" key={m.id}>
                <span>
                  {m.name}
                  <small>
                    {m.email} · {m.role}
                  </small>
                </span>
                <button
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      await api(
                        `/projects/${remoteId}/members/${m.id}`,
                        "DELETE",
                      );
                      await refresh();
                    })
                  }
                >
                  Retirer l’accès
                </button>
              </div>
            ))}
          </>
        )}
      </section>
      <section className="settings-block">
        <div className="section-title">
          <h3>Projets de l’équipe</h3>
          <button
            disabled={busy}
            aria-label="Actualiser les projets"
            onClick={() => void action(refresh)}
          >
            <RefreshCw size={15} />
          </button>
        </div>
        {!remote.length && <p>Aucun projet partagé pour le moment.</p>}
        {remote.map((p) => (
          <div className="team-row" key={p.id}>
            <span>
              <b>{p.name}</b>
              <small>
                {p.kind} · version {p.revision}
              </small>
            </span>
            <button
              disabled={busy}
              onClick={() => void action(() => retrieve(p.id))}
            >
              <Download size={14} /> Récupérer en copie
            </button>
          </div>
        ))}
      </section>
      {remoteId && (
        <section className="settings-block">
          <h3>
            <MessageSquare size={16} /> Échanges sur le projet
          </h3>
          <div className="comments">
            {comments.map((c) => (
              <div key={c.id}>
                <b>{c.author}</b>
                <small>
                  {new Date(c.created).toLocaleString("fr-FR")}
                  {c.photoId ? " · photo" : ""}
                </small>
                <p>{c.body}</p>
              </div>
            ))}
          </div>
          <textarea
            aria-label="Commentaire sur le projet"
            value={body}
            maxLength={4000}
            onChange={(e) => setBody(e.target.value)}
            placeholder={
              current
                ? "Un commentaire sur la photo active…"
                : "Un commentaire sur ce projet…"
            }
          />
          <button
            className="button secondary"
            disabled={busy || !body.trim()}
            onClick={() =>
              void action(async () => {
                await api(`/projects/${remoteId}/comments`, "POST", {
                  body,
                  photoId: current?.remotePhotoId || current?.id,
                });
                setBody("");
                await refresh();
              })
            }
          >
            Publier le commentaire
          </button>
        </section>
      )}
      <details className="settings-block">
        <summary>Mon compte · changer le mot de passe</summary>
        <div className="field-row">
          <label className="field">
            Mot de passe actuel
            <input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </label>
          <label className="field">
            Nouveau mot de passe
            <input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </label>
        </div>
        <button
          className="button secondary"
          disabled={busy || !currentPassword || newPassword.length < 12}
          onClick={() =>
            void action(async () => {
              await api("/auth/password", "POST", {
                currentPassword,
                newPassword,
              });
              setCurrentPassword("");
              setNewPassword("");
              setMessage(
                "Mot de passe changé. Les autres sessions ont été déconnectées.",
              );
            })
          }
        >
          Changer le mot de passe
        </button>
      </details>
      {session.user.role === "admin" && (
        <section className="settings-block">
          <h3>
            <Users size={16} /> Comptes de l’équipe
          </h3>
          <div className="field-row">
            <label className="field">
              Nom
              <input
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
              />
            </label>
            <label className="field">
              Email
              <input
                type="email"
                value={userEmail}
                onChange={(e) => setUserEmail(e.target.value)}
              />
            </label>
          </div>
          <label className="field">
            Mot de passe initial · 12 caractères minimum
            <input
              type="password"
              autoComplete="new-password"
              value={userPassword}
              onChange={(e) => setUserPassword(e.target.value)}
            />
          </label>
          <button
            className="button secondary"
            disabled={
              busy || !userName || !userEmail || userPassword.length < 12
            }
            onClick={() =>
              void action(async () => {
                await api("/users", "POST", {
                  name: userName,
                  email: userEmail,
                  password: userPassword,
                  role: "photographer",
                });
                setUserName("");
                setUserEmail("");
                setUserPassword("");
                await refresh();
                setMessage("Compte créé.");
              })
            }
          >
            <Plus size={14} /> Créer le compte
          </button>
          {users.map((u) => (
            <div className="team-row" key={u.id}>
              <span>
                {u.name}
                <small>{u.email}</small>
              </span>
              {u.id !== session.user.id && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      await api("/users/" + u.id, "PATCH", {
                        disabled: !u.disabled,
                      });
                      await refresh();
                    })
                  }
                >
                  {u.disabled ? "Réactiver" : "Désactiver"}
                </button>
              )}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
