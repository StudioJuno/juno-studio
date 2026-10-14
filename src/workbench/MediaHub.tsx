import { useEffect, useState } from "react";
import { Film, Music2, Image as ImageIcon } from "lucide-react";
import type { Photo } from "../model";
import type { Asset } from "../video/types";
import PhotoThumbnail from "../modules/PhotoThumbnail";
export default function MediaHub({
  projectId,
  photos,
  onPhoto,
  onVideo,
  onImport,
}: {
  projectId: string;
  photos: Photo[];
  onPhoto: (id: string) => void;
  onVideo: () => void;
  onImport: () => void;
}) {
  const [media, setMedia] = useState<Asset[]>([]),
    [filter, setFilter] = useState("all"),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(0),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const list = await window.juno?.video.list(),
          project = list?.projects.find((p) => p.photoProjectId === projectId);
        const p = project ? await window.juno!.video.project(project.id) : null;
        if (alive) setMedia(p?.assets || []);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [projectId]);
  const items = [
    ...photos.map((p) => ({
      id: p.id,
      name: p.name,
      kind: "photo",
      photo: p,
      asset: undefined as Asset | undefined,
    })),
    ...media.map((a) => ({
      id: a.id,
      name: a.name,
      kind: a.kind,
      asset: a,
      photo: undefined as Photo | undefined,
    })),
  ].filter(
    (x) =>
      (filter === "all" || x.kind === filter) &&
      x.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  useEffect(() => setPage(0), [query, filter, projectId]);
  return (
    <section className="media-hub">
      <header>
        <div>
          <h1>Médias du projet</h1>
          <p>
            {photos.length} photos ·{" "}
            {media.filter((a) => a.kind === "video").length} vidéos ·{" "}
            {media.filter((a) => a.kind === "audio").length} sons
          </p>
        </div>
        <button className="button primary" onClick={onImport}>
          Importer
        </button>
      </header>
      <div className="media-hub-tools">
        <input
          aria-label="Rechercher un média du projet"
          placeholder="Rechercher un fichier…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label="Type de média"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">Tous les médias</option>
          <option value="photo">Photos</option>
          <option value="video">Vidéos</option>
          <option value="audio">Sons</option>
        </select>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="media-hub-grid">
        {items.slice(page * 60, (page + 1) * 60).map((x) => (
          <button
            key={x.id}
            className="media-hub-card"
            onClick={() => (x.photo ? onPhoto(x.id) : onVideo())}
          >
            <div>
              {x.photo ? (
                <PhotoThumbnail photo={x.photo} alt={x.name} />
              ) : x.asset?.thumbnail ? (
                <img src={x.asset.thumbnail} alt="" />
              ) : x.kind === "audio" ? (
                <Music2 size={32} />
              ) : x.kind === "video" ? (
                <Film size={32} />
              ) : (
                <ImageIcon size={32} />
              )}
            </div>
            <span title={x.name}>{x.name}</span>
            <small>
              {x.kind === "photo"
                ? "Photo"
                : x.kind === "audio"
                  ? "Audio"
                  : x.kind === "video"
                    ? "Vidéo"
                    : "Image"}
            </small>
          </button>
        ))}
      </div>
      {!items.length && (
        <p>Aucun média à afficher. Importez des fichiers pour commencer.</p>
      )}
      {items.length > 60 && (
        <nav aria-label="Pages de médias">
          <button disabled={!page} onClick={() => setPage((p) => p - 1)}>
            Précédents
          </button>
          <span>
            {page + 1} / {Math.ceil(items.length / 60)}
          </span>
          <button
            disabled={(page + 1) * 60 >= items.length}
            onClick={() => setPage((p) => p + 1)}
          >
            Suivants
          </button>
        </nav>
      )}
    </section>
  );
}
