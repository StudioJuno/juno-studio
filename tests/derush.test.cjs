const { test } = require("node:test"),
  assert = require("node:assert/strict");
const D = require("../electron/video/derush.cjs");

/**
 * Les règles du dérushage sur des relevés fabriqués : une mesure de qualité
 * tous les sixièmes de seconde, une image de mouvement tous les douzièmes,
 * comme les rend la lecture de l'aperçu (derush-native.test.cjs la vérifie
 * sur de vraies images).
 */
function hasard(graine) {
  let x = graine >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 4294967296;
  };
}
function rush(duree, { qualite = () => ({}), mouvement = () => ({}) } = {}) {
  const r = hasard(7),
    q = [],
    m = [];
  for (let k = 0; k / D.FPS_QUALITE < duree; k++) {
    const t = k / D.FPS_QUALITE;
    q.push({
      t,
      flou: 6 + 0.1 * r(),
      detail: 65 + r(),
      yavg: 120,
      ylow: 40,
      yhigh: 200,
      ymax: 235,
      ydif: 2 + r(),
      ...qualite(t),
    });
  }
  for (let k = 1; k / D.FPS_MOUVEMENT < duree; k++) {
    const t = k / D.FPS_MOUVEMENT;
    // Le léger balancement d'une caméra tenue sans trembler.
    m.push({
      t,
      dx: 0.06 * (r() - 0.5),
      dy: 0.06 * (r() - 0.5),
      pic: 0.8,
      accord: 1,
      // Le bruit d'un capteur, vu sur la miniature (mesuré : 0,10 à 0,17).
      ecart: 0.1 + 0.07 * r(),
      ...mouvement(t, r),
    });
  }
  return { qualite: q, mouvement: m, duree };
}
const entre = (t, a, b) => t >= a && t < b;
/** La part de [de, a] dans chaque état. */
function parts(plages, de, a) {
  const sortie = {};
  for (const p of plages) {
    const x = Math.max(de, p.debut),
      y = Math.min(a, p.fin);
    if (y > x) sortie[p.etat] = (sortie[p.etat] || 0) + (y - x) / (a - de);
  }
  return sortie;
}
const raisons = (plages, de, a) =>
  [...new Set(plages.filter((p) => p.fin > de && p.debut < a).flatMap((p) => p.raisons))].sort();
function continues(r, duree) {
  assert.equal(r.plages[0].debut, 0);
  assert.equal(r.plages.at(-1).fin, Math.round(duree * 1000) / 1000);
  for (let i = 1; i < r.plages.length; i++) {
    assert.equal(r.plages[i].debut, r.plages[i - 1].fin, "trou ou chevauchement");
    assert.notEqual(r.plages[i].etat, r.plages[i - 1].etat, "deux voisins de même état");
  }
}

test("un rush propre reste entier et bon", () => {
  const r = D.decouper(rush(40));
  assert.deepEqual(r.plages, [{ debut: 0, fin: 40, etat: "bon", raisons: [] }]);
  assert.deepEqual(r.resume, { duree: 40, bon: 40, verifier: 0, masque: 0 });
  assert.equal(r.mouvement, "fixe");
});

test("le noir est masqué, une soirée sombre traversée de lumières ne l'est pas", () => {
  const noir = D.decouper(
    rush(30, { qualite: (t) => (entre(t, 10, 13) ? { yavg: 16.5, ylow: 16, yhigh: 18, ymax: 30, flou: undefined, detail: 1 } : {}) }),
  );
  continues(noir, 30);
  assert.ok(parts(noir.plages, 10.2, 12.8).masque > 0.99);
  assert.deepEqual(raisons(noir.plages, 10.2, 12.8), ["noir"]);
  assert.ok(parts(noir.plages, 0, 9.6).bon > 0.99);
  const soiree = D.decouper(
    rush(30, { qualite: (t) => (entre(t, 10, 20) ? { yavg: 19, ylow: 16, yhigh: 30, ymax: 235 } : {}) }),
  );
  assert.equal(soiree.resume.masque, 0);
});

test("une caméra oubliée en marche est à vérifier ; une image figée courte, ou un plan posé, ne sont pas touchés", () => {
  // Rien ne bouge ni ne change pendant 3 min (mesuré : 0,001 à 0,035).
  const oubli = D.decouper(
    rush(400, {
      qualite: (t) => (entre(t, 100, 280) ? { ydif: 0.02 } : {}),
      mouvement: (t, r) => (entre(t, 100, 280) ? { ecart: 0.03 * r() } : {}),
    }),
  );
  assert.equal(oubli.resume.masque, 0);
  assert.ok(parts(oubli.plages, 100.5, 279.5).verifier > 0.99, JSON.stringify(oubli.plages));
  assert.deepEqual(raisons(oubli.plages, 100.5, 279.5), ["immobile"]);
  assert.ok(parts(oubli.plages, 0, 99.5).bon > 0.99);
  // Le même calme pendant 90 s : un plan posé, gardé.
  const pose = D.decouper(
    rush(200, {
      qualite: (t) => (entre(t, 50, 140) ? { ydif: 0.02 } : {}),
      mouvement: (t, r) => (entre(t, 50, 140) ? { ecart: 0.03 * r() } : {}),
    }),
  );
  assert.equal(pose.resume.bon, 200);
  // Un plan fixe au bruit de capteur visible, 5 min : rien.
  const r = hasard(3),
    bruit = D.decouper(rush(300, { qualite: () => ({ ydif: 0.2 + 0.4 * r() }) }));
  assert.equal(bruit.resume.bon, 300);
});

test("un flou passager entre deux passages nets est masqué", () => {
  const r = D.decouper(
    rush(40, { qualite: (t) => (entre(t, 20, 23) ? { flou: 14, detail: 17 } : {}) }),
  );
  continues(r, 40);
  assert.ok(parts(r.plages, 20.2, 22.8).masque > 0.99, JSON.stringify(r.plages));
  assert.deepEqual(raisons(r.plages, 20.2, 22.8), ["flou"]);
  assert.ok(parts(r.plages, 0, 19.6).bon > 0.99);
  assert.ok(parts(r.plages, 23.4, 40).bon > 0.99);
});

test("un flou tenu longtemps, ou un plan flou entre deux coupes, est seulement à vérifier", () => {
  const long = D.decouper(
    rush(60, { qualite: (t) => (entre(t, 20, 32) ? { flou: 14, detail: 17 } : {}) }),
  );
  assert.equal(long.resume.masque, 0);
  assert.ok(parts(long.plages, 20.2, 31.8).verifier > 0.99);
  // Le flou artistique d'un film monté : un plan flou, coupe avant, coupe après.
  const coupe = (t) => Math.abs(t - 20) < 0.01 || Math.abs(t - 23) < 0.01;
  const monte = D.decouper(
    rush(40, {
      qualite: (t) => ({
        ...(entre(t, 20, 23) ? { flou: 14, detail: 17 } : {}),
        ...(coupe(t) ? { ydif: 60 } : {}),
      }),
      mouvement: (t) => (Math.abs(t - 20) < 0.05 || Math.abs(t - 23) < 0.05 ? { pic: 0.06 } : {}),
    }),
  );
  assert.equal(monte.resume.masque, 0, JSON.stringify(monte.plages));
  assert.ok(parts(monte.plages, 20.2, 22.8).verifier > 0.99);
  // Un flou léger, passager : à vérifier ; tenu tout le rush : rien.
  const leger = D.decouper(
    rush(40, { qualite: (t) => (entre(t, 20, 23) ? { flou: 8.6, detail: 39 } : {}) }),
  );
  assert.equal(leger.resume.masque, 0);
  assert.ok(parts(leger.plages, 20.2, 22.8).verifier > 0.99);
  assert.deepEqual(raisons(leger.plages, 20.2, 22.8), ["flou-leger"]);
  const doux = D.decouper(rush(40, { qualite: () => ({ flou: 8.6, detail: 39 }) }));
  assert.equal(doux.resume.bon, 40);
});

test("un tremblement fort est masqué, un panoramique régulier ne l'est pas", () => {
  const tremble = D.decouper(
    rush(30, {
      mouvement: (t, r) => (entre(t, 10, 13) ? { dx: 2.4 * (r() - 0.5) * 2, dy: 2.4 * (r() - 0.5) * 2 } : {}),
    }),
  );
  continues(tremble, 30);
  assert.ok(parts(tremble.plages, 10.3, 12.7).masque > 0.99, JSON.stringify(tremble.plages));
  assert.deepEqual(raisons(tremble.plages, 10.3, 12.7), ["bouge"]);
  // Ce qui précède et suit d'une bonne seconde reste bon.
  assert.ok(parts(tremble.plages, 0, 8.8).bon > 0.99);
  assert.ok(parts(tremble.plages, 14.2, 30).bon > 0.99);
  // Un panoramique, et un drone : réguliers, rapides ou lents.
  for (const dx of [3, 0.4]) {
    const pano = D.decouper(rush(30, { mouvement: (t, r) => ({ dx: dx + 0.05 * (r() - 0.5), dy: 0.1 }) }));
    assert.deepEqual(pano.plages, [{ debut: 0, fin: 30, etat: "bon", raisons: [] }], "dx " + dx);
    assert.equal(pano.mouvement, "maitrise");
  }
});

test("un rush de moins d'une seconde est masqué ; un départ agité aussi", () => {
  const court = D.decouper(rush(0.6));
  assert.deepEqual(court.plages, [{ debut: 0, fin: 0.6, etat: "masque", raisons: ["accidentel"] }]);
  const depart = D.decouper(
    // L'appui sur le bouton : une secousse de 1 à 2 % de l'image, 0,7 s.
    rush(20, { mouvement: (t, r) => (t < 0.7 ? { dx: 4 * (r() - 0.5), dy: 4 * (r() - 0.5) } : {}) }),
  );
  assert.equal(depart.plages[0].etat, "masque", JSON.stringify(depart.plages));
  assert.ok(depart.plages[0].raisons.includes("declenchement") || depart.plages[0].raisons.includes("bouge"));
  assert.ok(depart.plages[0].fin <= 1.5);
});

test("un bon passage trop court entre deux défauts devient à vérifier", () => {
  const r = D.decouper(
    rush(30, {
      qualite: (t) =>
        entre(t, 10, 13) || entre(t, 14, 17) ? { yavg: 16.5, ylow: 16, yhigh: 18, ymax: 30, flou: undefined, detail: 1 } : {},
    }),
  );
  const ile = r.plages.find((p) => p.debut > 12 && p.fin < 15);
  assert.equal(ile?.etat, "verifier", JSON.stringify(r.plages));
  assert.deepEqual(ile.raisons, ["court"]);
});

test("les coupes demandent les deux signes : différence d'image et corrélation perdue", () => {
  const R = D.REGLAGES.prudent,
    base = rush(10);
  base.qualite[30].ydif = 60;
  // La corrélation reste bonne : un mouvement rapide, pas une coupe.
  assert.equal(D.coupes(base.qualite, base.mouvement, R).filter(Boolean).length, 0);
  for (const m of base.mouvement) if (m.t > base.qualite[29].t && m.t <= base.qualite[30].t) m.pic = 0.05;
  const c = D.coupes(base.qualite, base.mouvement, R);
  assert.deepEqual(c.flatMap((v, i) => (v ? [i] : [])), [30]);
});

test("la corrélation de phase retrouve un déplacement connu", () => {
  const W = D.MINI_L,
    H = D.MINI_H,
    r = hasard(11),
    grand = new Float64Array((W + 20) * (H + 20));
  // Une texture lisse : du bruit moyenné.
  const brut = grand.map(() => r() * 255);
  for (let y = 0; y < H + 20; y++)
    for (let x = 0; x < W + 20; x++) {
      let s = 0,
        n = 0;
      for (let j = -2; j <= 2; j++)
        for (let i = -2; i <= 2; i++) {
          const xx = x + i,
            yy = y + j;
          if (xx >= 0 && yy >= 0 && xx < W + 20 && yy < H + 20) {
            s += brut[yy * (W + 20) + xx];
            n++;
          }
        }
      grand[y * (W + 20) + x] = s / n;
    }
  const vue = (ox, oy) => {
    const img = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) img[y * W + x] = grand[(y + oy) * (W + 20) + x + ox];
    return img;
  };
  const m = D.creerMouvement();
  assert.equal(m.pousser(vue(10, 10)), null);
  // La vue recule de 3 px vers la gauche et monte de 2 : le contenu glisse
  // de 3 px vers la droite et de 2 vers le bas.
  const d = m.pousser(vue(7, 8));
  assert.ok(Math.abs(d.dx - 3) < 0.35, "dx " + d.dx);
  assert.ok(Math.abs(d.dy - 2) < 0.35, "dy " + d.dy);
  assert.ok(d.pic > 0.25, "pic " + d.pic);
  assert.equal(d.accord, 1);
  // La caméra ne bouge pas, un sujet bouge dans une zone : rien ne bouge.
  const fixe = D.creerMouvement(),
    avant = vue(10, 10),
    apres = vue(10, 10);
  for (let y = 5; y < 22; y++)
    for (let x = 36; x < 60; x++) {
      avant[y * W + x] = grand[(y + 10) * (W + 20) + x + 10];
      apres[y * W + x] = grand[(y + 14) * (W + 20) + x + 7];
    }
  fixe.pousser(avant);
  const s = fixe.pousser(apres);
  assert.ok(Math.hypot(s.dx, s.dy) < 0.3, JSON.stringify(s));
});

test("les mesures écrites par metadata=print sont relues", () => {
  const texte = [
    "frame:0    pts:0       pts_time:0",
    "lavfi.blur=6.171",
    "lavfi.signalstats.YAVG=120.5",
    "lavfi.signalstats.YLOW=40",
    "lavfi.signalstats.YHIGH=200",
    "lavfi.signalstats.YMAX=235",
    "lavfi.signalstats.YDIF=0",
    "lavfi.siti.si=65.25",
    "lavfi.siti.ti=0",
    "frame:1    pts:2560    pts_time:0.166667",
    "lavfi.signalstats.YAVG=16",
    "lavfi.signalstats.YDIF=1.5e-02",
    "",
  ].join("\n");
  assert.deepEqual(D.lireQualite(texte), [
    { t: 0, flou: 6.171, yavg: 120.5, ylow: 40, yhigh: 200, ymax: 235, ydif: 0, detail: 65.25 },
    { t: 0.166667, yavg: 16, ydif: 0.015 },
  ]);
});

test("les suites et les trous bouchés", () => {
  assert.deepEqual(D.suites([false, true, true, false, true]), [
    [1, 2],
    [4, 4],
  ]);
  assert.deepEqual(D.boucher([true, false, true, false, false, true], 1), [true, true, true, false, false, true]);
  // Un trou en bordure n'est pas bouché.
  assert.deepEqual(D.boucher([false, true, false], 1), [false, true, false]);
});

test("la caméra et l'heure de tournage se lisent sans faire échouer la lecture du média", () => {
  const { cameraOf, recordedAt, escapeFilter } = require("../electron/video/engine.cjs");
  // Une étiquette choisie par le fichier ne doit pas faire échouer `probe`.
  for (const make of ["Foo (Bar", "+Cam", "[ACME", "a.*b"])
    assert.doesNotThrow(() => cameraOf({ tags: { make, model: "X" } }, [], "a.mp4"));
  assert.equal(cameraOf({ tags: { make: "Canon", model: "Canon EOS R5" } }, [], "a.mp4"), "Canon EOS R5");
  assert.equal(cameraOf({ tags: { "com.apple.quicktime.make": "Apple", "com.apple.quicktime.model": "iPhone 15 Pro" } }, [], "IMG_1.MOV"), "iPhone 15 Pro");
  assert.equal(cameraOf({ tags: { major_brand: "XAVC" } }, [], "x.mp4"), "Sony");
  assert.equal(cameraOf({}, [{ tags: { handler_name: "DJI.AVC" } }], "x.mp4"), "DJI");
  assert.equal(cameraOf({}, [], "MVI_0457.MP4"), "Canon");
  assert.equal(cameraOf({}, [], "rush.mp4"), undefined);
  assert.equal(recordedAt({ creation_time: "1970-01-01T00:00:00Z" }), undefined);
  assert.equal(recordedAt({ "com.apple.quicktime.creationdate": "2026-06-14T17:32:10+0200" }), Date.UTC(2026, 5, 14, 15, 32, 10));
  // Une apostrophe ferme la citation, s'échappe pour le graphe et l'option,
  // puis la rouvre ; un chemin sans apostrophe ne change pas.
  assert.equal(escapeFilter("/a/O'Brien/x.txt"), "/a/O\\'\\''Brien/x.txt");
  assert.equal(escapeFilter("C:\\Users\\Jo\\x.cube"), "C\\:/Users/Jo/x.cube");
});
