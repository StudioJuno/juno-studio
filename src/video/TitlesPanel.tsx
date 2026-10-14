import MotionControls from "./MotionControls";
import CaptionWords from "./CaptionWords";
import CaptionStyles from "./CaptionStyles";
import { useRef, useState, useEffect } from "react";
import { Plus, Trash2, Upload } from "lucide-react";
import type { Sequence, Title, Caption } from "./types";
import { frame, seconds, srt } from "./edit";
import { parseSrt } from "./subtitles";
import { titleSizeLimit } from "./transform";
export default function TitlesPanel({
  sequence,
  playhead,
  onChange,
  onSeek,
  onError,
  focusId,
  onSelect,
}: {
  focusId?: string;
  onSelect?: (id: string) => void;
  sequence: Sequence;
  playhead: number;
  onChange: (s: Sequence) => void;
  onSeek: (t: number) => void;
  onError: (e: unknown) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [element, setElement] = useState("text");
  const [mode, setMode] = useState<"titles" | "captions">("titles"),
    [selected, setSelected] = useState(""),
    [page, setPage] = useState(0);
  const count = sequence[mode].length,
    last = Math.max(0, Math.ceil(count / 20) - 1),
    current = Math.min(page, last);
  useEffect(() => {
    if (!focusId) return;
    const index = sequence.titles.findIndex((t) => t.id === focusId);
    if (index >= 0) {
      setMode("titles");
      setSelected(focusId);
      setPage(Math.floor(index / 20));
    }
  }, [focusId]);
  function patch(
    field: "titles" | "captions",
    id: string,
    part: Partial<Title | Caption>,
  ) {
    onChange({
      ...sequence,
      [field]: sequence[field].map((t) =>
        t.id === id
          ? {
              ...t,
              ...part,
              ...(field === "captions" &&
              part.text !== undefined &&
              part.text !== t.text
                ? { words: undefined }
                : {}),
              ...(field === "captions" && part.duration !== undefined
                ? {
                    words: (t as Caption).words
                      ?.filter((w) => w.start < part.duration!)
                      .map((w) => ({
                        ...w,
                        end: Math.min(w.end, part.duration!),
                      })),
                  }
                : {}),
            }
          : t,
      ),
    });
  }
  function addElement() {
    const id = crypto.randomUUID();
    onChange({
      ...sequence,
      titles: [
        ...sequence.titles,
        {
          id,
          text: element === "text" ? "Votre titre" : "",
          ...(element !== "text"
            ? {
                graphic: {
                  kind: element as NonNullable<Title["graphic"]>["kind"],
                  width: 0.3,
                  height: 0.15,
                  fill: "#315b43",
                  value: 0.75,
                },
              }
            : {}),
          start: playhead,
          duration: frame(5, sequence),
          size: 72,
          y: 0.5,
          color: "#ffffff",
        },
      ],
    });
    setSelected(id);
    onSelect?.(id);
    setPage(Math.floor(sequence.titles.length / 20));
  }
  return (
    <div className="vf-title-editor">
      <div className="vf-panel-heading">
        <h2>Motion design & sous-titres</h2>
        <button
          aria-label="Ajouter un titre"
          hidden={mode !== "titles"}
          onClick={addElement}
        >
          <Plus size={16} />
        </button>
      </div>
      <nav className="motion-tabs">
        <button
          aria-pressed={mode === "titles"}
          onClick={() => {
            setMode("titles");
            setPage(0);
            setSelected("");
          }}
        >
          Éléments graphiques
        </button>
        <button
          aria-pressed={mode === "captions"}
          onClick={() => {
            setMode("captions");
            setPage(0);
            setSelected("");
          }}
        >
          Sous-titres
        </button>
      </nav>
      <label hidden={mode !== "titles"} className="motion-element">
        Nouvel élément
        <select
          aria-label="Type d’élément graphique"
          value={element}
          onChange={(e) => setElement(e.target.value)}
        >
          <option value="text">Texte / titre</option>
          <option value="rectangle">Rectangle / cartouche</option>
          <option value="circle">Cercle / pastille</option>
          <option value="arrow">Flèche</option>
          <option value="bar">Barre de progression</option>
        </select>
      </label>
      <button
        hidden={mode !== "captions"}
        onClick={() => input.current?.click()}
      >
        <Upload size={14} />
        Importer un SRT
      </button>
      <input
        ref={input}
        type="file"
        hidden
        accept=".srt"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          try {
            const captions = parseSrt(await f.text(), sequence);
            onChange({
              ...sequence,
              captions: [...sequence.captions, ...captions],
            });
            onError(captions.length + " sous-titres ajoutés.");
          } catch (e) {
            onError(e);
          } finally {
            if (input.current) input.current.value = "";
          }
        }}
      />
      {mode === "captions" && sequence.captions.length > 0 && (
        <button
          onClick={() =>
            void window.juno
              ?.saveFile(
                sequence.name + ".srt",
                new TextEncoder().encode(srt(sequence)).buffer as ArrayBuffer,
              )
              .catch(onError)
          }
        >
          Exporter les sous-titres
        </button>
      )}
      {mode === "captions" && (
        <button
          onClick={() => {
            const id = crypto.randomUUID();
            onChange({
              ...sequence,
              captions: [
                ...sequence.captions,
                {
                  id,
                  text: "Votre sous-titre",
                  start: playhead,
                  duration: frame(3, sequence),
                },
              ],
            });
            setSelected(id);
            onSelect?.(id);
            setPage(Math.floor(sequence.captions.length / 20));
          }}
        >
          Ajouter un sous-titre
        </button>
      )}
      {mode === "captions" && (
        <CaptionStyles sequence={sequence} onChange={onChange} />
      )}
      {([mode] as const).map((field) => (
        <section key={field}>
          <h3>
            {field === "titles" ? "Titres" : "Sous-titres"} ·{" "}
            {sequence[field].length}
          </h3>
          {sequence[field]
            .slice(current * 20, current * 20 + 20)
            .map((t, i) => (
              <article key={t.id}>
                <details open={selected ? selected === t.id : i === 0}>
                  <summary
                    onClick={(e) => {
                      e.preventDefault();
                      setSelected(selected === t.id ? "closed" : t.id);
                      if (field === "titles")
                        onSelect?.(selected === t.id ? "" : t.id);
                    }}
                  >
                    {t.text.slice(0, 45) ||
                      (t as Title).graphic?.kind ||
                      "Élément"}
                  </summary>
                  <div>
                    <button onClick={() => onSeek(t.start)}>
                      {seconds(t.start, sequence).toFixed(2)} s
                    </button>
                    <button
                      aria-label={
                        "Supprimer " +
                        (field === "titles" ? "titre" : "sous-titre")
                      }
                      onClick={() =>
                        onChange({
                          ...sequence,
                          [field]: sequence[field].filter((x) => x.id !== t.id),
                        })
                      }
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                  <textarea
                    aria-label={
                      field === "titles"
                        ? "Texte du titre"
                        : "Texte du sous-titre"
                    }
                    maxLength={2000}
                    value={t.text}
                    onChange={(e) =>
                      patch(field, t.id, { text: e.target.value })
                    }
                  />
                  <div className="vf-title-timing">
                    <label>
                      Début (s)
                      <input
                        type="number"
                        min={0}
                        step={0.04}
                        value={Number(seconds(t.start, sequence).toFixed(3))}
                        onChange={(e) =>
                          patch(field, t.id, {
                            start: Math.max(
                              0,
                              frame(Number(e.target.value), sequence),
                            ),
                          })
                        }
                      />
                    </label>
                    <label>
                      Durée (s)
                      <input
                        type="number"
                        min={0.04}
                        step={0.04}
                        value={Number(seconds(t.duration, sequence).toFixed(3))}
                        onChange={(e) =>
                          patch(field, t.id, {
                            duration: Math.max(
                              1,
                              frame(Number(e.target.value), sequence),
                            ),
                          })
                        }
                      />
                    </label>
                  </div>
                  {field === "captions" && (
                    <CaptionWords
                      caption={t as Caption}
                      sequence={sequence}
                      onChange={(c) =>
                        onChange({
                          ...sequence,
                          captions: sequence.captions.map((x) =>
                            x.id === c.id ? c : x,
                          ),
                        })
                      }
                      onSeek={onSeek}
                    />
                  )}
                  {field === "titles" && (
                    <>
                      {(t as Title).graphic && (
                        <div className="graphic-controls">
                          <label>
                            Couleur de la forme
                            <input
                              type="color"
                              value={(t as Title).graphic!.fill}
                              onChange={(e) =>
                                patch(field, t.id, {
                                  graphic: {
                                    ...(t as Title).graphic!,
                                    fill: e.target.value,
                                  },
                                })
                              }
                            />
                          </label>
                          {(
                            [
                              "width",
                              "height",
                              ...((t as Title).graphic!.kind === "bar"
                                ? ["value" as const]
                                : []),
                            ] as const
                          ).map((key) => (
                            <label key={key}>
                              {key === "width"
                                ? "Largeur (%)"
                                : key === "height"
                                  ? "Hauteur (%)"
                                  : "Valeur (%)"}
                              <input
                                type="number"
                                min={key === "value" ? 0 : 1}
                                max={100}
                                value={Math.round(
                                  ((t as Title).graphic![key] ?? 0) * 100,
                                )}
                                onChange={(e) =>
                                  patch(field, t.id, {
                                    graphic: {
                                      ...(t as Title).graphic!,
                                      [key]: Math.max(
                                        key === "value" ? 0 : 0.01,
                                        Math.min(
                                          1,
                                          Number(e.target.value) / 100,
                                        ),
                                      ),
                                    },
                                  })
                                }
                              />
                            </label>
                          ))}
                        </div>
                      )}
                      <MotionControls
                        title={t as Title}
                        sequence={sequence}
                        playhead={playhead}
                        onPatch={(p) => patch(field, t.id, p)}
                        onSeek={onSeek}
                        onError={onError}
                      />
                    </>
                  )}
                  {field === "titles" && (
                    <div className="vf-title-appearance">
                      <label>
                        Modèle
                        <select
                          value=""
                          onChange={(e) => {
                            const styles: Record<string, Partial<Title>> = {
                              simple: {
                                fontFamily: "Inter",
                                fontWeight: 600,
                                x: 0.5,
                                y: 0.5,
                                align: "center",
                                size: 72,
                                backgroundOpacity: 0,
                                strokeWidth: 0,
                                shadow: false,
                              },
                              lower: {
                                fontFamily: "Inter",
                                fontWeight: 600,
                                x: 0.08,
                                y: 0.82,
                                align: "left",
                                size: 54,
                                backgroundColor: "#203d2d",
                                backgroundOpacity: 0.9,
                                padding: 20,
                                strokeWidth: 0,
                                shadow: false,
                              },
                              cinema: {
                                fontFamily: "Georgia",
                                fontWeight: 400,
                                x: 0.5,
                                y: 0.5,
                                align: "center",
                                size: 96,
                                backgroundOpacity: 0,
                                strokeWidth: 0,
                                shadow: true,
                              },
                              badge: {
                                fontFamily: "Inter",
                                fontWeight: 700,
                                x: 0.5,
                                y: 0.2,
                                align: "center",
                                size: 48,
                                backgroundColor: "#000000",
                                backgroundOpacity: 0.8,
                                padding: 24,
                                strokeWidth: 0,
                                shadow: false,
                              },
                            };
                            if (styles[e.target.value])
                              patch(field, t.id, styles[e.target.value]);
                          }}
                        >
                          <option value="">Choisir un modèle…</option>
                          <option value="simple">Sobre</option>
                          <option value="lower">
                            Cartouche de présentation
                          </option>
                          <option value="cinema">Cinéma</option>
                          <option value="badge">Étiquette</option>
                        </select>
                      </label>
                      <label>
                        Police
                        <select
                          value={(t as Title).fontFamily ?? "Arial"}
                          onChange={(e) =>
                            patch(field, t.id, {
                              fontFamily: e.target.value as Title["fontFamily"],
                            })
                          }
                        >
                          {["Arial", "Inter", "Georgia", "monospace"].map(
                            (f) => (
                              <option key={f}>{f}</option>
                            ),
                          )}
                        </select>
                      </label>
                      <label>
                        Graisse
                        <select
                          value={(t as Title).fontWeight ?? 600}
                          onChange={(e) =>
                            patch(field, t.id, {
                              fontWeight: Number(e.target.value),
                            })
                          }
                        >
                          <option value={400}>Normal</option>
                          <option value={600}>Demi-gras</option>
                          <option value={700}>Gras</option>
                        </select>
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={(t as Title).italic ?? false}
                          onChange={(e) =>
                            patch(field, t.id, { italic: e.target.checked })
                          }
                        />
                        Italique
                      </label>
                      <label>
                        Alignement
                        <select
                          value={(t as Title).align ?? "center"}
                          onChange={(e) =>
                            patch(field, t.id, {
                              align: e.target.value as Title["align"],
                            })
                          }
                        >
                          <option value="left">Gauche</option>
                          <option value="center">Centre</option>
                          <option value="right">Droite</option>
                        </select>
                      </label>
                      <label>
                        Taille
                        <input
                          type="number"
                          min={12}
                          max={titleSizeLimit(sequence.height)}
                          value={(t as Title).size}
                          onChange={(e) =>
                            patch(field, t.id, {
                              size: Math.max(
                                12,
                                Math.min(
                                  titleSizeLimit(sequence.height),
                                  Number(e.target.value),
                                ),
                              ),
                            })
                          }
                        />
                      </label>
                      {(
                        [
                          ["x", "Position horizontale (%)", 0.5, 0, 1, 100],
                          ["y", "Position verticale (%)", 0.5, 0, 1, 100],
                          ["width", "Largeur du texte (%)", 0.86, 0.1, 1, 100],
                          ["lineHeight", "Interligne", 1.2, 0.8, 3, 1],
                          ["rotation", "Rotation (°)", 0, -180, 180, 1],
                          ["opacity", "Opacité (%)", 1, 0, 1, 100],
                          [
                            "strokeWidth",
                            "Épaisseur du contour (px)",
                            0,
                            0,
                            24,
                            1,
                          ],
                          [
                            "backgroundOpacity",
                            "Opacité du fond (%)",
                            0,
                            0,
                            1,
                            100,
                          ],
                          ["padding", "Marge du fond (px)", 24, 0, 200, 1],
                        ] as const
                      ).map(([key, label, fallback, min, max, mult]) => (
                        <label key={key}>
                          {label}
                          <input
                            type="number"
                            min={min * mult}
                            max={max * mult}
                            step={key === "lineHeight" ? 0.1 : 1}
                            value={
                              Math.round(
                                ((t as Title)[key] ?? fallback) * mult * 100,
                              ) / 100
                            }
                            onChange={(e) => {
                              if (e.target.value !== "")
                                patch(field, t.id, {
                                  [key]: Math.max(
                                    min,
                                    Math.min(
                                      max,
                                      Number(e.target.value) / mult,
                                    ),
                                  ),
                                });
                            }}
                          />
                        </label>
                      ))}
                      <details className="depth-controls">
                        <summary>Relief 3D</summary>
                        {(
                          [
                            ["extrude", "Profondeur (%)", 0, 0, 1, 100],
                            ["angle", "Direction (°)", 45, -180, 180, 1],
                            ["light", "Lumière (%)", 0.4, 0, 1, 100],
                          ] as const
                        ).map(([key, label, fallback, min, max, mult]) => (
                          <label key={key}>
                            {label}
                            <input
                              type="number"
                              aria-label={label + " du relief"}
                              min={min * mult}
                              max={max * mult}
                              step={1}
                              value={Math.round(
                                ((t as Title).depth?.[key] ?? fallback) * mult,
                              )}
                              onChange={(e) => {
                                if (e.target.value === "") return;
                                const current = (t as Title).depth ?? {
                                  extrude: 0,
                                  angle: 45,
                                  light: 0.4,
                                };
                                patch(field, t.id, {
                                  depth: {
                                    ...current,
                                    [key]: Math.max(
                                      min,
                                      Math.min(
                                        max,
                                        Number(e.target.value) / mult,
                                      ),
                                    ),
                                  },
                                });
                              }}
                            />
                          </label>
                        ))}
                        <label>
                          Couleur des flancs
                          <input
                            type="color"
                            aria-label="Couleur des flancs du relief"
                            value={
                              (t as Title).depth?.color ??
                              (t as Title).graphic?.fill ??
                              (t as Title).color
                            }
                            onChange={(e) =>
                              patch(field, t.id, {
                                depth: {
                                  extrude: 0,
                                  angle: 45,
                                  light: 0.4,
                                  ...(t as Title).depth,
                                  color: e.target.value,
                                },
                              })
                            }
                          />
                        </label>
                        <p className="vf-hint">
                          Le relief épaissit le titre ou la forme. Il est
                          calculé à plat : il n’y a pas encore de caméra 3D ni
                          de modèle importé.
                        </p>
                      </details>
                      <label>
                        Contour
                        <input
                          type="color"
                          value={(t as Title).strokeColor ?? "#000000"}
                          onChange={(e) =>
                            patch(field, t.id, { strokeColor: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        Fond
                        <input
                          type="color"
                          value={(t as Title).backgroundColor ?? "#000000"}
                          onChange={(e) =>
                            patch(field, t.id, {
                              backgroundColor: e.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={(t as Title).shadow ?? false}
                          onChange={(e) =>
                            patch(field, t.id, { shadow: e.target.checked })
                          }
                        />
                        Ombre portée
                      </label>
                      <input
                        aria-label="Couleur du titre"
                        type="color"
                        value={(t as Title).color}
                        onChange={(e) =>
                          patch(field, t.id, { color: e.target.value })
                        }
                      />
                    </div>
                  )}
                </details>
              </article>
            ))}
        </section>
      ))}
      {count > 20 && (
        <nav className="motion-pages">
          <button
            disabled={current === 0}
            onClick={() => {
              setPage(current - 1);
              setSelected("");
            }}
          >
            Précédent
          </button>
          <span>
            {current + 1} / {last + 1}
          </span>
          <button
            disabled={current === last}
            onClick={() => {
              setPage(current + 1);
              setSelected("");
            }}
          >
            Suivant
          </button>
        </nav>
      )}
    </div>
  );
}
