import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  EyeOff,
  Film,
  ListVideo,
  Pause,
  Play,
  Plus,
  Repeat,
  RotateCcw,
  ScanSearch,
} from "lucide-react";
import type { Asset, DerushPlage, VideoJob, VideoProject } from "./types";
import {
  blocs,
  ETATS,
  MOUVEMENTS,
  ordreDeTournage,
  passages,
  raisonLue,
  resume,
  utiles,
} from "./derush";
import { PLANS, type TypePlan } from "./derush-plans";

/**
 * Le mode « Dérush » : tous les rushes vidéo du projet, chacun avec la bande
 * de ses passages (bons, à vérifier, masqués) ; un lecteur de passage pour
 * les revoir, les garder ou les masquer ; l'ajout au montage et le
 * pré-montage. Le dérushage lui-même tourne en fond (electron/video/derush.cjs) :
 * cet écran ne fait que lire ses résultats et y poser vos décisions.
 */

/** Une durée lisible : 4:05, 1:02:09. */
export function mmss(secondes: number) {
  const t = Math.max(0, Math.round(secondes)),
    h = Math.floor(t / 3600),
    m = Math.floor((t % 3600) / 60),
    s = t % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : String(m)) + ":" + String(s).padStart(2, "0");
}

const libelle = (p: DerushPlage) =>
  `${ETATS[p.etat]}${p.raisons.length ? " · " + p.raisons.map(raisonLue).join(", ") : ""} · ${mmss(p.debut)} à ${mmss(p.fin)}`;

/**
 * La bande des passages d'un rush. Chaque passage est posé à sa place exacte
 * (part du rush), si bien que la tête de lecture du lecteur tombe juste.
 *
 * - `onChoisir` et `boutons` : un bouton par passage, pour le clavier (le
 *   lecteur).
 * - `onChoisir` seul : un seul clic, lu à la position de la souris, sans un
 *   bouton par passage (la liste : des milliers d'arrêts de tabulation pour
 *   un mariage, sinon).
 * - Sans `onChoisir` : un simple aperçu (cartes de la bibliothèque).
 */
export function BandeDerush({
  asset,
  actif,
  onChoisir,
  compacte = false,
  boutons = false,
}: {
  asset: Asset;
  actif?: DerushPlage | null;
  onChoisir?: (p: DerushPlage) => void;
  compacte?: boolean;
  boutons?: boolean;
}) {
  const liste = passages(asset.derush);
  if (!liste.length)
    return <div className={`vf-bande attente ${compacte ? "compacte" : ""}`} aria-hidden="true" />;
  const duree = Math.max(asset.duration || liste[liste.length - 1].fin, 0.001),
    place = (p: DerushPlage) => ({
      left: `${(100 * p.debut) / duree}%`,
      width: `${(100 * (p.fin - p.debut)) / duree}%`,
    }),
    estActif = (p: DerushPlage) => !!actif && Math.abs(actif.debut - p.debut) < 1e-6;
  if (onChoisir && boutons)
    return (
      <div className={`vf-bande ${compacte ? "compacte" : ""}`} role="group" aria-label={"Passages de " + asset.name}>
        {liste.map((p) => (
          <button
            key={p.debut}
            type="button"
            className={`vf-passage ${p.etat} ${estActif(p) ? "actif" : ""}`}
            style={place(p)}
            title={libelle(p)}
            aria-label={libelle(p)}
            aria-pressed={estActif(p)}
            onClick={() => onChoisir(p)}
          />
        ))}
      </div>
    );
  return (
    <div
      className={`vf-bande ${compacte ? "compacte" : ""} ${onChoisir ? "cliquable" : ""}`}
      aria-hidden="true"
      onClick={
        onChoisir
          ? (e) => {
              const r = e.currentTarget.getBoundingClientRect(),
                t = ((e.clientX - r.left) / Math.max(r.width, 1)) * duree,
                p = liste.find((x) => t >= x.debut && t < x.fin) || liste[liste.length - 1];
              onChoisir(p);
            }
          : undefined
      }
    >
      {liste.map((p) => (
        <span
          key={p.debut}
          className={`vf-passage ${p.etat} ${estActif(p) ? "actif" : ""}`}
          style={place(p)}
          title={libelle(p)}
        />
      ))}
    </div>
  );
}

type Filtre = "tous" | "masques" | "verifier" | "attente";
const PAGE = 80;
const enCoursDeTache = (j: VideoJob, projectId: string) =>
  j.kind === "derush" && j.projectId === projectId && !["done", "failed", "cancelled"].includes(j.state);
/** Un rush que le dérushage peut lire : vidéo, prêt, avec son aperçu, pas en échec. */
const lisible = (a: Asset) => a.kind === "video" && a.status === "ready" && !!a.proxy && !a.derushEchec;

export default function DerushView({
  project,
  jobs,
  api,
  plansAClasser = 0,
  focus,
  onAjouter,
  onPreMonter,
  onNotify,
  onRefresh,
}: {
  project: VideoProject;
  jobs: VideoJob[];
  api: NonNullable<Window["juno"]>["video"];
  /** Les rushes dont le type de plan reste à relever (derush-plans.ts). */
  plansAClasser?: number;
  /** Le rush à montrer en arrivant (lien d'une carte de la bibliothèque). */
  focus?: string;
  /** Un passage (ou, sans `morceau`, tous les morceaux utiles) au bout du montage. */
  onAjouter: (a: Asset, morceau?: { debut: number; fin: number }) => void;
  onPreMonter: (assets: Asset[]) => void;
  onNotify: (e: unknown) => void;
  onRefresh: () => Promise<void> | void;
}) {
  const rushes = useMemo(
    () => project.assets.filter((a) => a.kind === "video").sort(ordreDeTournage),
    [project.assets],
  );
  const [filtre, setFiltre] = useState<Filtre>("tous"),
    [mouvement, setMouvement] = useState(""),
    [camera, setCamera] = useState(""),
    [plan, setPlan] = useState(""),
    [page, setPage] = useState(0),
    [choisiId, setChoisiId] = useState(focus || ""),
    [actifDebut, setActifDebut] = useState<number | null>(null);
  useEffect(() => {
    if (focus) {
      setChoisiId(focus);
      setActifDebut(null);
    }
  }, [focus]);
  const enCours = jobs.some((j) => enCoursDeTache(j, project.id));
  const liste = useMemo(
    () =>
      rushes.filter((a) => {
        const r = resume(a.derush);
        if (filtre === "masques" && !(r.masque > 0)) return false;
        if (filtre === "verifier" && !(r.verifier > 0)) return false;
        if (filtre === "attente" && a.derush) return false;
        if (mouvement && a.derush?.mouvement !== mouvement) return false;
        if (camera && (a.camera || "Inconnue") !== camera) return false;
        if (plan && a.derush?.plan !== plan) return false;
        return true;
      }),
    [rushes, filtre, mouvement, camera, plan],
  );
  useEffect(() => setPage(0), [filtre, mouvement, camera, plan]);
  const dernierePage = Math.max(0, Math.ceil(liste.length / PAGE) - 1),
    pageAffichee = Math.min(page, dernierePage),
    visibles = liste.slice(pageAffichee * PAGE, (pageAffichee + 1) * PAGE);
  const cameras = useMemo(() => [...new Set(rushes.map((a) => a.camera || "Inconnue"))].sort(), [rushes]);
  const choisi = rushes.find((a) => a.id === choisiId) || visibles[0] || rushes[0];
  const bilan = useMemo(
    () =>
      rushes.reduce(
        (t, a) => {
          t.duree += a.duration;
          // En attente : ce que le dérushage peut encore lire, pas un rush en
          // erreur, en échec ou en cours d'import.
          if (!a.derush && lisible(a)) t.attente++;
          const r = resume(a.derush);
          t.masque += r.masque;
          t.verifier += r.verifier;
          return t;
        },
        { duree: 0, masque: 0, verifier: 0, attente: 0 },
      ),
    [rushes],
  );
  const heure = (ms: number) => new Date(ms).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const choisir = useMemo(
    () => (id: string, debut: number | null) => {
      setChoisiId(id);
      setActifDebut(debut);
    },
    [],
  );
  if (!rushes.length)
    return (
      <div className="vf-derush vide">
        <ScanSearch size={30} />
        <p>Importez vos rushes : Juno les dérushe en fond, sans rien supprimer.</p>
      </div>
    );
  const groupes = blocs(visibles);
  return (
    <div className="vf-derush">
      <section className="vf-derush-liste" aria-label="Rushes">
        <div className="vf-panel-heading">
          <h2>Dérush</h2>
          <span>{rushes.length}</span>
        </div>
        <p className="vf-derush-bilan">
          <b>{mmss(bilan.duree - bilan.masque)}</b> utiles sur {mmss(bilan.duree)}
          {bilan.masque > 0 && <> · {mmss(bilan.masque)} masquées</>}
          {bilan.verifier > 0 && <> · {mmss(bilan.verifier)} à vérifier</>}
          {bilan.attente > 0 && (
            <>
              <br />
              {enCours
                ? `Dérushage en cours : ${bilan.attente} rush${bilan.attente > 1 ? "es" : ""} en attente.`
                : `${bilan.attente} rush${bilan.attente > 1 ? "es" : ""} pas encore dérushé${bilan.attente > 1 ? "s" : ""}.`}
            </>
          )}
          {plansAClasser > 0 && (
            <>
              <br />
              Types de plan en cours de relevé : {plansAClasser} rush{plansAClasser > 1 ? "es" : ""}.
            </>
          )}
        </p>
        <div className="vf-media-filters" aria-label="Filtrer les rushes">
          {(
            [
              ["tous", "Tous"],
              ["masques", "Avec du masqué"],
              ["verifier", "À vérifier"],
              ["attente", "En attente"],
            ] as const
          ).map(([f, l]) => (
            <button key={f} aria-pressed={filtre === f} onClick={() => setFiltre(f)}>
              {l}
            </button>
          ))}
        </div>
        <div className="vf-derush-choix">
          <select aria-label="Mouvement de la caméra" value={mouvement} onChange={(e) => setMouvement(e.target.value)}>
            <option value="">Tous les mouvements</option>
            {Object.entries(MOUVEMENTS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <select aria-label="Type de plan" value={plan} onChange={(e) => setPlan(e.target.value)}>
            <option value="">Tous les plans</option>
            {Object.entries(PLANS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          {cameras.length > 1 && (
            <select aria-label="Caméra" value={camera} onChange={(e) => setCamera(e.target.value)}>
              <option value="">Toutes les caméras</option>
              {cameras.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
        </div>
        <ul className="vf-derush-rushes">
          {groupes.flatMap((b, n) => [
            // Les blocs de la journée, dès qu'il y en a plusieurs.
            ...(groupes.length > 1
              ? [
                  <li key={"bloc-" + n} className="vf-derush-bloc">
                    {b.debut !== undefined && b.fin !== undefined
                      ? `${heure(b.debut)} → ${heure(b.fin)}`
                      : "Sans heure de tournage"}
                    <small>
                      {b.assets.length} rush{b.assets.length > 1 ? "es" : ""}
                    </small>
                  </li>,
                ]
              : []),
            ...b.assets.map((a) => (
              <LigneRush key={a.id} asset={a} choisi={a.id === choisi?.id} enCours={enCours} onChoisir={choisir} />
            )),
          ])}
          {!liste.length && <li className="vf-hint">Aucun rush ne correspond à ces filtres.</li>}
        </ul>
        {liste.length > PAGE && (
          <div className="vf-media-pages">
            <button disabled={!pageAffichee} onClick={() => setPage(pageAffichee - 1)}>
              Précédent
            </button>
            <span>
              {pageAffichee + 1} / {dernierePage + 1}
            </span>
            <button disabled={pageAffichee >= dernierePage} onClick={() => setPage(pageAffichee + 1)}>
              Suivant
            </button>
          </div>
        )}
        <footer>
          <button
            className="vf-primary"
            disabled={!liste.some((a) => a.status === "ready")}
            title="Une nouvelle séquence avec les passages utiles des rushes affichés, dans l’ordre de la journée"
            onClick={() => onPreMonter(liste)}
          >
            <ListVideo size={15} />
            Pré-monter {liste.length > 1 ? `ces ${liste.length} rushes` : "ce rush"}
          </button>
          {bilan.attente > 0 && !enCours && (
            <button
              onClick={() =>
                void api
                  .derush({ projectId: project.id, ids: rushes.filter((a) => !a.derush && lisible(a)).map((a) => a.id) })
                  .then(onRefresh)
                  .catch(onNotify)
              }
            >
              <ScanSearch size={15} />
              Dérusher maintenant
            </button>
          )}
        </footer>
      </section>
      {choisi && (
        <LecteurPassages
          key={choisi.id}
          asset={choisi}
          debutActif={actifDebut}
          onActif={setActifDebut}
          onDecision={(p, etat) =>
            api
              .derushDecision({ projectId: project.id, assetId: choisi.id, debut: p.debut, fin: p.fin, etat })
              .then(onRefresh)
              .catch(onNotify)
          }
          onAjouter={onAjouter}
        />
      )}
    </div>
  );
}

/**
 * Une ligne de la liste : redessinée seulement quand son rush ou son choix
 * changent (le studio se rafraîchit toutes les 1,2 s pendant un dérushage,
 * et un mariage compte des centaines de rushes).
 */
const LigneRush = memo(function LigneRush({
  asset: a,
  choisi,
  enCours,
  onChoisir,
}: {
  asset: Asset;
  choisi: boolean;
  enCours: boolean;
  onChoisir: (id: string, debut: number | null) => void;
}) {
  const r = resume(a.derush);
  return (
    <li className={choisi ? "choisi" : ""}>
      <button className="vf-derush-rush" aria-pressed={choisi} onClick={() => onChoisir(a.id, null)}>
        {a.thumbnail ? <img src={a.thumbnail} alt="" loading="lazy" /> : <Film size={18} />}
        <span>
          <b title={a.name}>{a.name}</b>
          <small title={a.derushEchec?.message}>
            {a.derush
              ? `${mmss(a.duration - r.masque)} utiles sur ${mmss(a.duration)}`
              : a.derushEchec
                ? "Dérushage impossible : aperçu illisible"
                : a.status !== "ready" || !a.proxy
                  ? "Pas lisible pour le dérushage"
                  : enCours
                    ? "Dérushage en attente"
                    : "Pas encore dérushé"}
            {a.derush?.plan ? " · " + PLANS[a.derush.plan as TypePlan] : ""}
            {a.derush?.mouvement ? " · " + MOUVEMENTS[a.derush.mouvement] : ""}
            {a.camera ? " · " + a.camera : ""}
          </small>
        </span>
      </button>
      <BandeDerush asset={a} compacte onChoisir={(p) => onChoisir(a.id, p.debut)} />
    </li>
  );
});

/**
 * Le lecteur d'un rush : la grande bande de ses passages, l'aperçu qui lit
 * le passage choisi et s'arrête à sa fin (ou le reprend en boucle), et les
 * décisions. Clavier : espace lit, flèches changent de passage (Maj : le
 * prochain à revoir), G garde, M masque, A ajoute au montage.
 */
function LecteurPassages({
  asset,
  debutActif,
  onActif,
  onDecision,
  onAjouter,
}: {
  asset: Asset;
  debutActif: number | null;
  onActif: (debut: number | null) => void;
  onDecision: (p: DerushPlage, etat: "bon" | "masque" | null) => Promise<void>;
  onAjouter: (a: Asset, morceau?: { debut: number; fin: number }) => void;
}) {
  const video = useRef<HTMLVideoElement>(null),
    zone = useRef<HTMLElement>(null),
    [lecture, setLecture] = useState(false),
    [boucle, setBoucle] = useState(false),
    [instant, setInstant] = useState(0);
  const liste = passages(asset.derush);
  // Le passage actif : celui choisi, ou celui sous la tête de lecture (une
  // décision réécrit les passages, la tête reste où elle est).
  const actif =
    liste.find((p) => debutActif !== null && Math.abs(p.debut - debutActif) < 1e-6) ||
    liste.find((p) => instant >= p.debut && instant < p.fin) ||
    liste[0] ||
    null;
  const borne = useRef<{ debut: number; fin: number } | null>(null);
  borne.current = actif;
  const boucleRef = useRef(boucle);
  boucleRef.current = boucle;
  useEffect(() => {
    const v = video.current;
    if (!v || !actif || debutActif === null) return;
    v.currentTime = actif.debut + 0.001;
    setInstant(actif.debut);
    // Un passage choisi dans la liste : le clavier passe au lecteur.
    zone.current?.focus({ preventScroll: true });
  }, [debutActif]);
  // Arrêt à la fin du passage : contrôlé à chaque image d'écran, la lecture
  // ne déborde pas sur le passage suivant.
  useEffect(() => {
    if (!lecture) return;
    let id = 0;
    const tour = () => {
      const v = video.current,
        b = borne.current;
      if (v && b && v.currentTime >= b.fin - 0.02) {
        if (boucleRef.current) v.currentTime = b.debut + 0.001;
        else {
          v.pause();
          v.currentTime = Math.max(b.debut, b.fin - 0.04);
        }
      }
      if (v) setInstant(v.currentTime);
      id = requestAnimationFrame(tour);
    };
    id = requestAnimationFrame(tour);
    return () => cancelAnimationFrame(id);
  }, [lecture]);
  const aller = (pas: number, seulementARevoir = false) => {
    if (!liste.length) return;
    const i = actif ? liste.indexOf(actif) : -1;
    for (let k = i + pas; k >= 0 && k < liste.length; k += pas)
      if (!seulementARevoir || liste[k].etat !== "bon") {
        onActif(liste[k].debut);
        return;
      }
  };
  const basculer = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) {
      if (actif && (v.currentTime < actif.debut || v.currentTime >= actif.fin - 0.05))
        v.currentTime = actif.debut + 0.001;
      void v.play().catch(() => {});
    } else v.pause();
  };
  // Le bouton cliqué disparaît quand la décision arrive (« Garder » sur un
  // passage devenu bon) : le clavier revient au lecteur, sinon il tombe sur
  // la page et ses touches n'iraient plus nulle part.
  const decider = (p: DerushPlage, etat: "bon" | "masque" | null) =>
    void onDecision(p, etat).finally(() => zone.current?.focus({ preventScroll: true }));
  const choix = actif?.raisons.includes("choix");
  return (
    <section
      ref={zone}
      className="vf-derush-lecteur"
      aria-label={"Lecteur de " + asset.name}
      tabIndex={0}
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).closest("select,input,textarea")) return;
        // Cmd, Ctrl et Alt gardent leur sens (copier, tout sélectionner) ;
        // une touche tenue n'ajoute pas un plan par répétition.
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        const k = e.key.toLowerCase();
        let fait = true;
        if (e.key === " ") {
          if (!e.repeat) basculer();
        } else if (e.key === "ArrowRight") aller(1, e.shiftKey);
        else if (e.key === "ArrowLeft") aller(-1, e.shiftKey);
        else if (k === "g" && actif) {
          if (!e.repeat) decider(actif, "bon");
        } else if (k === "m" && actif) {
          if (!e.repeat) decider(actif, "masque");
        } else if (k === "a" && actif) {
          if (!e.repeat) onAjouter(asset, actif);
        } else fait = false;
        if (fait) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      <header>
        <b title={asset.name}>{asset.name}</b>
        <small>
          {mmss(asset.duration)}
          {asset.derush?.plan ? " · " + PLANS[asset.derush.plan as TypePlan] : ""}
          {asset.derush?.mouvement ? " · " + MOUVEMENTS[asset.derush.mouvement] : ""}
          {asset.camera ? " · " + asset.camera : ""}
        </small>
      </header>
      <div className="vf-derush-video">
        {asset.proxy ? (
          <video
            ref={video}
            src={asset.proxy}
            preload="metadata"
            playsInline
            onPlay={() => setLecture(true)}
            onPause={() => setLecture(false)}
            onSeeked={(e) => setInstant(e.currentTarget.currentTime)}
            onClick={basculer}
          />
        ) : (
          <p className="vf-hint">Aperçu en préparation.</p>
        )}
      </div>
      {liste.length ? (
        <>
          <div className="vf-derush-grande-bande">
            <BandeDerush asset={asset} actif={actif} boutons onChoisir={(p) => onActif(p.debut)} />
            <i
              className="vf-derush-tete"
              aria-hidden="true"
              style={{ left: `${(100 * instant) / Math.max(asset.duration, 0.001)}%` }}
            />
          </div>
          {actif && (
            <div className="vf-derush-passage">
              <p>
                <span className={`vf-etat ${actif.etat}`}>{ETATS[actif.etat]}</span>
                {actif.raisons.map(raisonLue).join(", ")}
                <small>
                  {mmss(actif.debut)} à {mmss(actif.fin)} · {(actif.fin - actif.debut).toFixed(1).replace(".", ",")} s
                </small>
              </p>
              <div className="vf-derush-actions">
                <button onClick={() => aller(-1)} aria-label="Passage précédent" title="Passage précédent (←)">
                  <ChevronLeft size={15} />
                </button>
                <button onClick={basculer} title="Lire le passage (espace)">
                  {lecture ? <Pause size={15} /> : <Play size={15} />}
                  {lecture ? "Pause" : "Lire"}
                </button>
                <button onClick={() => aller(1)} aria-label="Passage suivant" title="Passage suivant (→)">
                  <ChevronRight size={15} />
                </button>
                <button aria-pressed={boucle} onClick={() => setBoucle((b) => !b)} title="Reprendre le passage en boucle">
                  <Repeat size={15} />
                </button>
                <span />
                {actif.etat !== "bon" && (
                  <button onClick={() => decider(actif, "bon")} title="Garder ce passage (G)">
                    <Check size={15} />
                    Garder
                  </button>
                )}
                {actif.etat !== "masque" && (
                  <button onClick={() => decider(actif, "masque")} title="Masquer ce passage (M)">
                    <EyeOff size={15} />
                    Masquer
                  </button>
                )}
                {choix && (
                  <button onClick={() => decider(actif, null)} title="Rendre ce passage à l’analyse">
                    <RotateCcw size={15} />
                    Rendre à l’analyse
                  </button>
                )}
                <button onClick={() => onAjouter(asset, actif)} title="Ajouter ce passage au bout du montage (A)">
                  <Plus size={15} />
                  Ajouter
                </button>
              </div>
            </div>
          )}
          <div className="vf-derush-pied">
            <button onClick={() => aller(1, true)} title="Le prochain passage à vérifier ou masqué (Maj + →)">
              Suivant à revoir
              <ChevronRight size={15} />
            </button>
            <button onClick={() => onAjouter(asset)}>
              <Plus size={15} />
              Ajouter les passages utiles ({mmss(utiles(asset).reduce((t, m) => t + m.fin - m.debut, 0))})
            </button>
          </div>
        </>
      ) : (
        <p className="vf-hint">
          {asset.derushEchec
            ? "Le dérushage n’a pas pu lire l’aperçu de ce rush. Il sera relu quand l’aperçu sera refait (profil couleur, média retrouvé)."
            : "Ce rush n’est pas encore dérushé : il le sera en fond, sans rien vous demander."}
        </p>
      )}
    </section>
  );
}
