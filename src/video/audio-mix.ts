import type { Clip, Sequence } from "./types";
export const AUDIO_BUSES = [
  { id: "voice", label: "Voix" },
  { id: "music", label: "Musique" },
  { id: "ambience", label: "Ambiances" },
  { id: "effect", label: "Effets" },
] as const;
export type AudioBus = (typeof AUDIO_BUSES)[number]["id"];
export function audioMix(s: Sequence, c: Clip) {
  const track = s.tracks?.[c.track],
    bus = track?.bus ? s.buses?.[track.bus] : undefined;
  const solo =
    Object.entries(s.tracks || {}).some(
      ([n, t]) => Number(n) >= 10 && t.solo,
    ) || Object.values(s.buses || {}).some((b) => b.solo);
  return {
    audible:
      c.component !== "video" &&
      !c.muted &&
      !track?.muted &&
      !bus?.muted &&
      (!solo || !!track?.solo || !!bus?.solo),
    gain: (track?.gain ?? 1) * (bus?.gain ?? 1),
    pan: Math.max(-1, Math.min(1, (c.pan ?? 0) + (track?.pan ?? 0))),
  };
}
