// Same track/bus routing as the monitor. The rendered stereo pan follows
// Web Audio StereoPanner (centre keeps the original stereo image).
function audioMix(s, c) {
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
function panFilter(p) {
  if (!p) return "";
  const angle = ((p < 0 ? p + 1 : p) * Math.PI) / 2;
  const cos = Math.cos(angle).toFixed(8),
    sin = Math.sin(angle).toFixed(8);
  return p < 0
    ? `pan=stereo|c0=c0+${cos}*c1|c1=${sin}*c1`
    : `pan=stereo|c0=${cos}*c0|c1=c1+${sin}*c0`;
}
module.exports = { audioMix, panFilter };
