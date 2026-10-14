/**
 * La netteté d'un visage, lue dans la bande des yeux, sans dépendre de sa taille.
 *
 * L'ancienne mesure (variance du laplacien dans la boîte, à 480 px) dépendait
 * surtout de la taille du visage : un petit visage mesurait 7 000, un grand
 * 1 800, et elle séparait les visages flous des nets moins bien que le hasard
 * (AUC 0,455 sur les 2 296 photos à visage de l'album Audrey-Ann et Clément).
 *
 * Celle-ci, mesurée le 28/09/2026 sur 189 visages jugés à l'œil par trois
 * juges (zone des yeux à 100 %) : AUC 0,965 [0,939 ; 0,987].
 * 1. On ne lit que la bande des yeux et des sourcils (15 à 85 % de la largeur
 *    de la boîte, 20 à 55 % de sa hauteur) : là sont les détails fins, et la
 *    peau lisse et le fond flou restent dehors.
 * 2. La bande est rééchantillonnée sur une grille fixe, celle d'une image de
 *    3 072 px (×3 depuis l'image d'analyse de 1 024 px).
 * 3. En chaque point : gradient divisé par l'étendue locale (max − min) dans
 *    une fenêtre de rayon 2. Le rapport ne dépend ni du contraste ni de
 *    l'exposition, seulement de la raideur des bords.
 * 4. La netteté est le 95e centile de ce rapport : les bords les plus raides
 *    de la bande, paupières et cils quand ils sont nets.
 *
 * Elle ne vaut QUE sur l'image d'analyse de 1 024 px (bilinéaire sans
 * préfiltre, comme `resizeRaster`), tirée d'une photo d'au moins 3 000 px :
 * c'est l'agrandissement ×3 qui borne le rapport entre 0,25 (rampe) et 0,33
 * (marche d'un pixel). Sur la vignette de 480 px, tous les visages nets
 * tomberaient à 0,14. Ailleurs, elle rend `undefined`, jamais un chiffre faux.
 *
 * Autre limite : un visage flou très peu contrasté (lumière faible) peut
 * passer pour net, car le plancher d'étendue (8 niveaux) écarte ses bords
 * doux. Un plancher plus bas le corrige mais dégrade la mesure sur les vrais
 * visages (AUC à l'œil 0,965 à 8, 0,942 à 2, 0,915 à 1) : il reste à 8.
 *
 * Limite connue : le bruit la fait MONTER (il imite des bords raides). Sur
 * une photo très bruitée (soirée à haute sensibilité, absente de l'album de
 * mesure), un flou peut passer inaperçu ; l'erreur va toujours vers le flou
 * manqué, jamais vers la fausse alerte. Un estimateur de bruit simple ne
 * sépare pas le bruit de la texture de peau (mesuré : 2,7 sur les visages
 * nets, 1,7 sur les flous) : il n'est donc pas utilisé.
 */
(function (racine) {
  var COTE = 1024; // grand côté de l'image d'analyse, seul valide
  /**
   * Grand côté minimal de la photo d'origine. La mesure repose sur une forte
   * réduction sans préfiltre ; depuis une petite source, elle baisse et des
   * visages nets passent pour flous. Mesuré en simulant la source sur les 189
   * visages jugés à l'œil : nets signalés à tort 0/110 depuis 6 720 px, 2 depuis
   * 4 000, 3 depuis 3 072, 22 depuis 2 048, 37 depuis 1 616 (aperçu Sony).
   */
  var SOURCE_MIN = 3000;
  var LARGEUR_ANALYSE = 3072;
  var BANDE = { x0: 0.15, x1: 0.85, y0: 0.2, y1: 0.55 };
  var CENTILE = 0.95;
  var PLANCHER = 8; // étendue locale minimale, en niveaux de gris
  var FENETRE_SOURCE = 0.72; // demi-fenêtre minimale, en pixels de la source
  var CASES = 4096;
  var RAPPORT_MAX = 0.75;
  var POINTS_MIN = 30; // moins de bords que ça : non mesurable

  // Poids de rééchantillonnage d'un axe : moyenne de surface quand on réduit,
  // bilinéaire quand on agrandit.
  function poids(debut, pas, nSortie, nEntree) {
    var idx = [], wt = [], off = [0];
    for (var j = 0; j < nSortie; j++) {
      if (pas >= 1) {
        var a = debut + j * pas, b = a + pas;
        for (var i = Math.floor(a); i < Math.ceil(b); i++) {
          var r = Math.min(b, i + 1) - Math.max(a, i);
          if (r > 1e-6) { idx.push(Math.min(nEntree - 1, Math.max(0, i))); wt.push(r / pas); }
        }
      } else {
        var c = debut + (j + 0.5) * pas - 0.5, i0 = Math.floor(c), f = c - i0;
        idx.push(Math.min(nEntree - 1, Math.max(0, i0))); wt.push(1 - f);
        idx.push(Math.min(nEntree - 1, Math.max(0, i0 + 1))); wt.push(f);
      }
      off.push(idx.length);
    }
    return { idx: Int32Array.from(idx), wt: Float32Array.from(wt), off: Int32Array.from(off) };
  }
  function reechantillonner(g, w, h, x, y, rw, rh, lo, ho) {
    var px = poids(x, rw / lo, lo, w), py = poids(y, rh / ho, ho, h);
    var ry0 = h, ry1 = 0, k;
    for (k = 0; k < py.idx.length; k++) { var i = py.idx[k]; if (i < ry0) ry0 = i; if (i > ry1) ry1 = i; }
    var nr = ry1 - ry0 + 1, tmp = new Float32Array(nr * lo);
    for (var r = 0; r < nr; r++) {
      var base = (ry0 + r) * w, sortie = r * lo;
      for (var j = 0; j < lo; j++) {
        var s = 0;
        for (k = px.off[j]; k < px.off[j + 1]; k++) s += g[base + px.idx[k]] * px.wt[k];
        tmp[sortie + j] = s;
      }
    }
    var out = new Float32Array(lo * ho);
    for (var q = 0; q < ho; q++) {
      var so = q * lo;
      for (k = py.off[q]; k < py.off[q + 1]; k++) {
        var wy = py.wt[k], b0 = (py.idx[k] - ry0) * lo;
        for (var jj = 0; jj < lo; jj++) out[so + jj] += tmp[b0 + jj] * wy;
      }
    }
    return out;
  }
  // Étendue locale (max − min) dans une fenêtre carrée de rayon r, séparable.
  function etendue(B, w, h, r) {
    var n = w * h, mx = new Float32Array(n), mn = new Float32Array(n), E = new Float32Array(n);
    var x, y, d, a, b, v;
    for (y = 0; y < h; y++) {
      var l = y * w;
      for (x = 0; x < w; x++) {
        a = -Infinity; b = Infinity;
        var d0 = x - r < 0 ? 0 : x - r, d1 = x + r >= w ? w - 1 : x + r;
        for (d = d0; d <= d1; d++) { v = B[l + d]; if (v > a) a = v; if (v < b) b = v; }
        mx[l + x] = a; mn[l + x] = b;
      }
    }
    for (y = 0; y < h; y++) {
      var e0 = y - r < 0 ? 0 : y - r, e1 = y + r >= h ? h - 1 : y + r;
      for (x = 0; x < w; x++) {
        a = -Infinity; b = Infinity;
        for (d = e0; d <= e1; d++) { var i = d * w + x; if (mx[i] > a) a = mx[i]; if (mn[i] < b) b = mn[i]; }
        E[y * w + x] = a - b;
      }
    }
    return E;
  }
  /**
   * @param gris plan de gris de l'image d'analyse entière (0 à 255)
   * @param boite boîte du visage, en pixels de cette image
   * @param cote grand côté de l'image
   * @param source grand côté de la photo d'origine
   * @returns la netteté, ou `undefined` si elle n'est pas mesurable
   */
  function mesurer(gris, largeur, hauteur, boite, cote, source) {
    if (Math.round(cote) !== COTE || !(source >= SOURCE_MIN)) return undefined;
    if (!(boite.w > 0) || !(boite.h > 0)) return undefined;
    var s = cote / LARGEUR_ANALYSE;
    var r = Math.max(1, Math.round(FENETRE_SOURCE / s));
    var x = Math.max(0, boite.x + BANDE.x0 * boite.w), y = Math.max(0, boite.y + BANDE.y0 * boite.h);
    var x1 = Math.min(largeur, boite.x + BANDE.x1 * boite.w), y1 = Math.min(hauteur, boite.y + BANDE.y1 * boite.h);
    if (x1 - x < 1 || y1 - y < 1) return undefined;
    var lo = Math.max(4, Math.round((x1 - x) / s)), ho = Math.max(4, Math.round((y1 - y) / s));
    var B = reechantillonner(gris, largeur, hauteur, x, y, x1 - x, y1 - y, lo, ho);
    var E = etendue(B, lo, ho, r);
    var hist = new Uint32Array(CASES), n = 0;
    for (var yy = 1; yy < ho - 1; yy++)
      for (var xx = 1; xx < lo - 1; xx++) {
        var i = yy * lo + xx, e = E[i];
        if (e < PLANCHER) continue;
        var gx = B[i + 1] - B[i - 1], gy = B[i + lo] - B[i - lo];
        var c = Math.floor((Math.sqrt(gx * gx + gy * gy) / (2 * e) / RAPPORT_MAX) * CASES);
        hist[c >= CASES ? CASES - 1 : c]++;
        n++;
      }
    // Une bande unie ou noire n'a pas de bord : on ne sait pas, ce n'est pas
    // « très flou ». Rendre 0 aurait déclaré flous les visages dans l'ombre.
    if (n < POINTS_MIN) return undefined;
    var cible = CENTILE * n, cumul = 0;
    for (var k = 0; k < CASES; k++) {
      if (cumul + hist[k] > cible)
        return ((k + (cible - cumul) / hist[k]) / CASES) * RAPPORT_MAX;
      cumul += hist[k];
    }
    return RAPPORT_MAX;
  }
  /**
   * Un visage brûlé : la part des pixels de luminance > 249 (le même seuil que
   * l'écrêtage de l'image entière) dans le cœur du visage, les 60 % centraux
   * de sa boîte relative. Le cœur écarte cheveux clairs et fond derrière.
   * Rend undefined pour une boîte vide.
   */
  function ecrete(gris, largeur, hauteur, boite) {
    var x0 = Math.max(0, Math.floor((boite.x + 0.2 * boite.w) * largeur)),
      x1 = Math.min(largeur, Math.ceil((boite.x + 0.8 * boite.w) * largeur)),
      y0 = Math.max(0, Math.floor((boite.y + 0.2 * boite.h) * hauteur)),
      y1 = Math.min(hauteur, Math.ceil((boite.y + 0.8 * boite.h) * hauteur));
    var blancs = 0, total = 0;
    for (var y = y0; y < y1; y++)
      for (var x = x0; x < x1; x++) {
        total++;
        if (gris[y * largeur + x] > 249) blancs++;
      }
    return total ? Math.round((blancs / total) * 1e4) / 1e4 : undefined;
  }
  var api = { mesurer: mesurer, ecrete: ecrete, COTE: COTE, SOURCE_MIN: SOURCE_MIN };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  racine.JunoNettete = api;
})(typeof self !== "undefined" ? self : globalThis);
