import { useEffect, useRef, useState } from "react";
import { AUDIO_BUSES } from "./audio-mix";
import type { Sequence } from "./types";
export default function AudioMixer({
  sequence: s,
  onChange,
}: {
  sequence: Sequence;
  onChange: (s: Sequence) => void;
}) {
  const [levels, setLevels] = useState<Record<number, number>>({});
  const samples = useRef(
    new Map<string, { track: number; peak: number; at: number }>(),
  );
  useEffect(() => {
    const receive = (event: Event) => {
      const value = (event as CustomEvent).detail;
      if (value && Number.isFinite(value.peak))
        samples.current.set(value.id, value);
    };
    window.addEventListener("juno-audio-meter", receive);
    const timer = setInterval(() => {
      const next: Record<number, number> = {};
      for (const [id, v] of samples.current) {
        if (Date.now() - v.at > 350) samples.current.delete(id);
        else next[v.track] = Math.max(next[v.track] || 0, v.peak);
      }
      setLevels(next);
    }, 200);
    return () => {
      window.removeEventListener("juno-audio-meter", receive);
      clearInterval(timer);
    };
  }, []);
  const db = (gain: number) =>
    Math.round(20 * Math.log10(Math.max(0.001, gain)) * 10) / 10;
  const tracks = [
    ...new Set([
      10,
      11,
      ...s.clips.filter((c) => c.track >= 10).map((c) => c.track),
      ...Object.keys(s.tracks ?? {})
        .map(Number)
        .filter((n) => n >= 10),
    ]),
  ].sort((a, b) => a - b);
  function patch(n: number, p: NonNullable<Sequence["tracks"]>[string]) {
    onChange({
      ...s,
      tracks: { ...s.tracks, [n]: { ...s.tracks?.[n], ...p } },
    });
  }
  return (
    <details className="audio-mixer" open>
      <summary>Mixeur des pistes</summary>
      <details className="audio-buses">
        <summary>Groupes · voix, musique et ambiances</summary>
        {AUDIO_BUSES.map(({ id, label }) => {
          const bus = s.buses?.[id] || {};
          const update = (v: typeof bus) =>
            onChange({ ...s, buses: { ...s.buses, [id]: { ...bus, ...v } } });
          return (
            <fieldset key={id}>
              <legend>{label}</legend>
              <label>
                Niveau (dB)
                <input
                  aria-label={`Niveau du groupe ${label}`}
                  type="number"
                  min={-60}
                  max={12}
                  step={0.5}
                  value={db(bus.gain ?? 1)}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (e.target.value && Number.isFinite(n))
                      update({
                        gain: 10 ** (Math.max(-60, Math.min(12, n)) / 20),
                      });
                  }}
                />
              </label>
              <div className="mixer-buttons">
                <button
                  aria-pressed={!!bus.muted}
                  onClick={() => update({ muted: !bus.muted })}
                >
                  Muet
                </button>
                <button
                  aria-pressed={!!bus.solo}
                  onClick={() => update({ solo: !bus.solo })}
                >
                  Solo
                </button>
              </div>
            </fieldset>
          );
        })}
      </details>
      {tracks.map((n) => {
        const t = s.tracks?.[n] ?? {};
        return (
          <fieldset key={n}>
            <legend>A{n - 9}</legend>
            <div className="audio-level">
              <meter
                min={-60}
                max={0}
                low={-24}
                high={-6}
                optimum={-12}
                value={db(levels[n] || 0.001)}
                aria-label={`Crête indicative A${n - 9}`}
              />
              <output>{levels[n] ? `${db(levels[n])} dBFS` : "−∞ dBFS"}</output>
            </div>
            <label>
              Groupe
              <select
                aria-label={`Groupe de A${n - 9}`}
                value={t.bus || ""}
                onChange={(e) =>
                  patch(n, {
                    bus: (e.target.value || undefined) as typeof t.bus,
                  })
                }
              >
                <option value="">Sortie directe</option>
                {AUDIO_BUSES.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </select>
            </label>
            <input
              aria-label={`Nom de la piste A${n - 9}`}
              value={t.name ?? ""}
              placeholder={
                n === 10 ? "Voix / son caméra" : "Musique / ambiance"
              }
              maxLength={80}
              onChange={(e) => patch(n, { name: e.target.value })}
            />
            <div className="mixer-buttons">
              <button
                aria-pressed={t.muted ?? false}
                onClick={() => patch(n, { muted: !t.muted })}
              >
                Muet
              </button>
              <button
                aria-pressed={t.solo ?? false}
                onClick={() => patch(n, { solo: !t.solo })}
              >
                Solo
              </button>
              <button
                aria-pressed={t.locked ?? false}
                onClick={() => patch(n, { locked: !t.locked })}
              >
                Verrouiller
              </button>
            </div>
            <label>
              Panoramique
              <input
                aria-label={`Panoramique A${n - 9}`}
                type="number"
                min={-100}
                max={100}
                step={5}
                value={Math.round((t.pan || 0) * 100)}
                onChange={(e) => {
                  const value = Number(e.target.value);
                  if (e.target.value && Number.isFinite(value))
                    patch(n, { pan: Math.max(-1, Math.min(1, value / 100)) });
                }}
              />
            </label>
            <label>
              Volume (dB)
              <input
                type="number"
                min={-60}
                max={12}
                step={0.5}
                value={
                  Math.round(
                    20 * Math.log10(Math.max(0.001, t.gain ?? 1)) * 10,
                  ) / 10
                }
                onChange={(e) => {
                  if (
                    e.target.value !== "" &&
                    Number.isFinite(Number(e.target.value))
                  )
                    patch(n, {
                      gain:
                        10 **
                        (Math.max(-60, Math.min(12, Number(e.target.value))) /
                          20),
                    });
                }}
              />
            </label>
          </fieldset>
        );
      })}
      <button
        disabled={tracks.length >= 10}
        onClick={() => {
          const n = Array.from({ length: 10 }, (_, i) => i + 10).find(
            (n) => !tracks.includes(n),
          );
          if (n !== undefined) patch(n, { name: `Audio ${n - 9}` });
        }}
      >
        Ajouter une piste audio
      </button>
      <p className="vf-hint">
        Glissez un bloc audio vers une autre piste. Les réglages du mixeur
        s’appliquent à la lecture et à l’export. Panoramique : −100 à gauche,
        +100 à droite. Les indicateurs estiment la crête maximale des clips de
        la piste dans l’aperçu ; ce n’est pas une mesure LUFS du mixage final.
      </p>
    </details>
  );
}
