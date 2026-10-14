const { test } = require("node:test");
const assert = require("node:assert/strict");
const L = require("../electron/video/loudness.cjs");
const FPS = { n: 25, d: 1 };
test("silencedetect est lu tel que FFmpeg l'écrit", () => {
  const journal = `
[silencedetect @ 0x14] silence_start: 2.5
[silencedetect @ 0x14] silence_end: 4.125 | silence_duration: 1.625
[silencedetect @ 0x14] silence_start: 9
[silencedetect @ 0x14] silence_end: 10.5 | silence_duration: 1.5
`;
  assert.deepEqual(L.parseSilence(journal, 12), [
    { start: 2.5, end: 4.125 },
    { start: 9, end: 10.5 },
  ]);
});
test("un silence encore ouvert à la fin du média est fermé sur sa durée", () => {
  // FFmpeg n'écrit pas de silence_end quand le fichier se termine en silence.
  assert.deepEqual(L.parseSilence("silence_start: 30", 42), [
    { start: 30, end: 42 },
  ]);
  // Sans durée connue, on n'invente pas de fin.
  assert.deepEqual(L.parseSilence("silence_start: 30"), []);
  // Un silence de durée nulle ou négative n'existe pas.
  assert.deepEqual(L.parseSilence("silence_start: 5\nsilence_end: 5"), []);
  assert.deepEqual(L.parseSilence("silence_end: 4"), []);
  assert.deepEqual(L.parseSilence(""), []);
});
test("la parole est exactement le complément du silence", () => {
  const speech = L.speechFrom([{ start: 2, end: 4 }], 10);
  assert.deepEqual(speech, [
    { start: 0, end: 2 },
    { start: 4, end: 10 },
  ]);
  // Un média entièrement silencieux ne contient aucune parole.
  assert.deepEqual(L.speechFrom([{ start: 0, end: 10 }], 10), []);
  // Aucun silence détecté : tout est parole.
  assert.deepEqual(L.speechFrom([], 10), [{ start: 0, end: 10 }]);
  assert.deepEqual(L.speechFrom([], 0), []);
});
test("des silences qui se chevauchent ne produisent pas de parole fantôme", () => {
  const speech = L.speechFrom(
    [
      { start: 5, end: 8 },
      { start: 2, end: 6 },
    ],
    10,
  );
  assert.deepEqual(speech, [
    { start: 0, end: 2 },
    { start: 8, end: 10 },
  ]);
});
test("les intervalles se fusionnent selon l'écart toléré", () => {
  const list = [
    { start: 0, end: 1 },
    { start: 1.2, end: 2 },
    { start: 5, end: 6 },
  ];
  assert.deepEqual(L.mergeIntervals(list, 0.5), [
    { start: 0, end: 2 },
    { start: 5, end: 6 },
  ]);
  assert.equal(L.mergeIntervals(list, 0).length, 3);
});
test("un plan ralenti étire aussi ses silences", () => {
  // Plan posé à 2 s du montage, entrant à 10 s dans le média, à demi-vitesse.
  const clip = { start: 50, duration: 250, inUs: 10e6, speed: 0.5 };
  const mapped = L.toTimeline([{ start: 11, end: 12 }], clip, FPS);
  // 1 s de média à vitesse 0,5 occupe 2 s de montage, à partir de 2 s + 2 s.
  assert.equal(mapped.length, 1);
  assert.ok(Math.abs(mapped[0].start - 4) < 1e-9);
  assert.ok(Math.abs(mapped[0].end - 6) < 1e-9);
});
test("ce qui tombe hors du plan est coupé, pas déplacé", () => {
  const clip = { start: 0, duration: 25, inUs: 0, speed: 1 };
  // Le plan ne dure qu'une seconde : un intervalle à 5 s n'y entre pas.
  assert.deepEqual(L.toTimeline([{ start: 5, end: 6 }], clip, FPS), []);
  // Un intervalle à cheval est tronqué au bord du plan.
  const cut = L.toTimeline([{ start: 0.5, end: 9 }], clip, FPS);
  assert.deepEqual(cut, [{ start: 0.5, end: 1 }]);
});
test("l'enveloppe ne garde que ce qui touche le segment rendu", () => {
  // Un discours d'une heure ne doit pas produire une expression d'une heure.
  const speech = Array.from({ length: 500 }, (_, i) => ({
    start: i * 10,
    end: i * 10 + 4,
  }));
  const whole = L.duckExpression(speech, {});
  const windowed = L.duckExpression(speech, {}, { start: 100, end: 110 });
  assert.ok(windowed.length < whole.length / 50, "expression non bornée");
  assert.ok(windowed.includes("max") === false || windowed.length < 400);
});
test("sans profondeur, aucune atténuation n'est écrite", () => {
  assert.equal(L.duckExpression([{ start: 0, end: 1 }], { depth: 0 }), null);
  assert.equal(L.duckExpression([], {}), null);
  // Une fenêtre sans parole ne produit rien non plus.
  assert.equal(
    L.duckExpression([{ start: 0, end: 1 }], {}, { start: 500, end: 510 }),
    null,
  );
});
test("l'expression échappe ses virgules pour survivre à filter_complex", () => {
  const expr = L.duckExpression([{ start: 1, end: 2 }], { depth: 0.5 });
  // Une virgule nue couperait le graphe de filtres en deux.
  assert.ok(!/[^\\],/.test(expr), "virgule non échappée : " + expr);
  assert.ok(expr.startsWith("1-0.500000*("));
});
test("les réglages d'atténuation hors bornes sont refusés", () => {
  assert.throws(() => L.validateDuck({ depth: 2 }), /depth/);
  assert.throws(() => L.validateDuck({ attack: 0 }), /attack/);
  assert.throws(() => L.validateDuck({ release: 99 }), /release/);
  assert.throws(() => L.validateDuck({ hold: -1 }), /hold/);
  assert.deepEqual(L.validateDuck({}), L.DUCK);
});
test("une mesure de niveau infinie est refusée, pas propagée", () => {
  // loudnorm rapporte -inf sur un passage muet : l'appliquer casserait le son.
  const muet = `{"input_i":"-inf","input_tp":"-120","input_lra":"0",
    "input_thresh":"-inf","target_offset":"0"}`;
  assert.equal(L.measuredValues(muet), null);
  assert.equal(L.normaliseFilter("reseaux", muet), "loudnorm=I=-14:TP=-1:LRA=11");
});
test("la seconde passe reprend exactement la mesure de la première", () => {
  const journal = `bruit de journal
{"input_i":"-18.5","input_tp":"-2.1","input_lra":"6.3",
 "input_thresh":"-28.9","target_offset":"0.4"}
fin`;
  const f = L.normaliseFilter("television", journal);
  assert.ok(f.startsWith("loudnorm=I=-23:TP=-1:LRA=7"));
  assert.ok(f.includes("measured_I=-18.5"));
  assert.ok(f.includes("measured_TP=-2.1"));
  // Le paramètre de seconde passe de loudnorm s'appelle « offset ».
  assert.ok(f.includes(":offset=0.4"));
  assert.ok(f.includes("linear=true"));
});
test("une cible inconnue est refusée", () => {
  assert.throws(() => L.normaliseFilter("inventée"), /inconnue/);
  for (const key of Object.keys(L.TARGETS))
    assert.ok(L.normaliseFilter(key).startsWith("loudnorm=I="));
});
test("un journal sans JSON ne fait pas tomber la lecture", () => {
  assert.equal(L.parseLoudnorm("aucun objet ici"), null);
  assert.equal(L.parseLoudnorm("{ cassé"), null);
  assert.equal(L.parseLoudnorm(""), null);
});
test("l'enveloppe peut être écrite dans une autre horloge que t", () => {
  // Dans le graphe de rendu, chaque plan repart à t=0 : sans décalage,
  // l'atténuation tomberait au mauvais endroit du montage.
  const expr = L.duckExpression(
    [{ start: 10, end: 12 }],
    { depth: 0.5 },
    undefined,
    "(t+8.000000)",
  );
  // Le début est reculé de l'attaque : 10 - 0,25 = 9,75.
  assert.ok(expr.includes("(t+8.000000)-9.750000"), expr);
  assert.ok(expr.includes("-(t+8.000000)"), expr);
  assert.ok(!/[^+(]t-/.test(expr), "une horloge a été oubliée : " + expr);
});
const CLIP = {
  id: "c",
  assetId: "v",
  start: 0,
  duration: 250,
  inUs: 0,
  speed: 1,
  gain: 1,
  muted: false,
  audioRole: "voice",
  track: 10,
};
const SEQ = { fps: FPS, clips: [CLIP] };
const ASSETS = new Map([
  [
    "v",
    { id: "v", duration: 10, analysis: { scenes: [], silences: [{ start: 2, end: 6 }] } },
  ],
]);
test("la parole d'une séquence est lue depuis l'analyse des médias", () => {
  const speech = L.sequenceSpeech(SEQ, ASSETS);
  // Le plan dure 10 s, le média est silencieux de 2 s à 6 s.
  assert.deepEqual(
    speech.map((s) => [+s.start.toFixed(2), +s.end.toFixed(2)]),
    [
      [0, 2],
      [6, 10],
    ],
  );
});
test("un plan voix non analysé compte entièrement comme parole", () => {
  // Mieux vaut atténuer un peu trop que couvrir un discours.
  const sans = new Map([["v", { id: "v", duration: 10 }]]);
  assert.deepEqual(L.sequenceSpeech(SEQ, sans), [{ start: 0, end: 10 }]);
});
test("une voix inaudible n'atténue jamais la musique", () => {
  for (const modif of [
    { muted: true },
    { gain: 0 },
    { audioRole: "music" },
    { audioRole: undefined },
  ])
    assert.deepEqual(
      L.sequenceSpeech({ ...SEQ, clips: [{ ...CLIP, ...modif }] }, ASSETS),
      [],
      "cas non couvert : " + JSON.stringify(modif),
    );
  // Une piste coupée entière ne parle pas non plus.
  assert.deepEqual(
    L.sequenceSpeech({ ...SEQ, tracks: { 10: { muted: true } } }, ASSETS),
    [],
  );
  // Mais un volume animé qui monte reste de la parole.
  const anime = { ...CLIP, gain: 0, animation: { gain: [{ frame: 0, value: 1 }] } };
  assert.equal(L.sequenceSpeech({ ...SEQ, clips: [anime] }, ASSETS).length, 2);
});
test("deux plans voix qui se suivent ne font qu'une seule atténuation", () => {
  const second = { ...CLIP, id: "d", start: 250, duration: 250 };
  const speech = L.sequenceSpeech({ ...SEQ, clips: [CLIP, second] }, ASSETS);
  // 6-10 du premier plan touche 10-12 du second : les deux fusionnent.
  assert.ok(speech.some((s) => s.start === 6 && s.end === 12), JSON.stringify(speech));
});
