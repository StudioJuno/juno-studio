import { useEffect, useRef, useState } from "react";
export default function ColorReference({
  clipId,
  label,
}: {
  clipId?: string;
  label: string;
}) {
  const [reference, setReference] = useState<{ url: string; label: string }>(),
    [error, setError] = useState("");
  const live = useRef<HTMLCanvasElement>(null);
  const source = () => {
    const list = [
      ...document.querySelectorAll<HTMLCanvasElement>(
        ".vf-preview canvas[data-video-clip]",
      ),
    ];
    return list.find((c) => c.dataset.videoClip === clipId);
  };
  useEffect(() => {
    const update = () => {
      const s = source(),
        c = live.current;
      if (!s?.width || !c) return;
      const ratio = s.height / s.width;
      c.width = 640;
      c.height = Math.max(1, Math.round(640 * ratio));
      c.getContext("2d")?.drawImage(s, 0, 0, c.width, c.height);
    };
    update();
    const timer = setInterval(update, 300);
    return () => clearInterval(timer);
  }, [clipId, reference]);
  return (
    <details className="color-reference">
      <summary>Comparer à une image de référence</summary>
      <div className="color-reference-tools">
        <button
          disabled={!clipId}
          onClick={() => {
            try {
              const s = source();
              if (!s?.width)
                throw Error(
                  "Placez le curseur dans le plan sélectionné et attendez son affichage.",
                );
              const c = document.createElement("canvas");
              c.width = 640;
              c.height = Math.max(1, Math.round((s.height / s.width) * 640));
              c.getContext("2d")!.drawImage(s, 0, 0, c.width, c.height);
              setReference({ url: c.toDataURL("image/jpeg", 0.9), label });
              setError("");
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Mémoriser cette image
        </button>
        {reference && (
          <button onClick={() => setReference(undefined)}>
            Effacer la référence
          </button>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {reference ? (
        <div className="color-reference-pair">
          <figure>
            <img src={reference.url} alt="Image de référence figée" />
            <figcaption>Référence · {reference.label}</figcaption>
          </figure>
          <figure>
            <canvas ref={live} aria-label="Image courante pour comparaison" />
            <figcaption>Plan courant · {label}</figcaption>
          </figure>
        </div>
      ) : (
        <p className="vf-hint">
          Mémorisez une image, puis sélectionnez un autre plan pour comparer son
          rendu. Cette référence reste disponible tant que le panneau Couleur
          est ouvert.
        </p>
      )}
    </details>
  );
}
