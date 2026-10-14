/**
 * Écrire le tri de Juno dans un fichier .xmp que Lightroom Classic lira.
 *
 * Juno ne possède que quatre choses dans ce fichier : `xmp:Rating`,
 * `xmp:Label`, `xmp:MetadataDate` et les mots-clés sous la racine « Juno| ».
 * Tout le reste (les réglages `crs:` d'Aftershoot ou de Lightroom, les
 * masques, les autres mots-clés) garde ses octets : le fichier n'est jamais
 * resérialisé, on ne remplace que quelques plages. Vérifié sur un sidecar
 * Aftershoot de 103 Ko et 462 réglages : une seule ligne d'origine touchée.
 *
 * Toute structure qu'on ne reconnaît pas avec certitude est refusée : mieux
 * vaut ne rien écrire que d'abîmer les retouches d'un photographe.
 */
"use strict";
const NS = {
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  xmp: "http://ns.adobe.com/xap/1.0/",
  dc: "http://purl.org/dc/elements/1.1/",
  lr: "http://ns.adobe.com/lightroom/1.0/",
};
/** Au-delà, ce n'est plus un sidecar ordinaire. */
const TAILLE_MAX = 8 * 1024 * 1024;
class XmpNonReconnu extends Error {}
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c],
  );
const unesc = (s) =>
  s.replace(
    /&(amp|lt|gt|quot|apos|#x?[0-9a-fA-F]+);/g,
    (m, e) =>
      ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[e] ??
      String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)),
  );
/** Un balayage XML minimal, attentif aux guillemets. Lève une erreur au moindre doute. */
function scan(xml) {
  const els = [],
    stack = [];
  let i = 0;
  while ((i = xml.indexOf("<", i)) !== -1) {
    if (xml.startsWith("<?", i)) {
      const e = xml.indexOf("?>", i);
      if (e < 0) throw new XmpNonReconnu("instruction non terminée");
      i = e + 2;
      continue;
    }
    if (xml.startsWith("<!--", i)) {
      const e = xml.indexOf("-->", i);
      if (e < 0) throw new XmpNonReconnu("commentaire non terminé");
      i = e + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", i)) {
      const e = xml.indexOf("]]>", i);
      if (e < 0) throw new XmpNonReconnu("CDATA non terminé");
      i = e + 3;
      continue;
    }
    // Un DOCTYPE peut déclarer des entités : on ne s'y aventure pas.
    if (xml.startsWith("<!", i)) throw new XmpNonReconnu("DOCTYPE");
    if (xml[i + 1] === "/") {
      const e = xml.indexOf(">", i),
        name = xml.slice(i + 2, e).trim();
      const el = stack.pop();
      if (e < 0 || !el || el.name !== name) throw new XmpNonReconnu("balise fermante inattendue " + name);
      el.close = i;
      el.end = e + 1;
      i = e + 1;
      continue;
    }
    let j = i + 1,
      q = null;
    for (; j < xml.length; j++) {
      const c = xml[j];
      if (q) {
        if (c === q) q = null;
      } else if (c === '"' || c === "'") q = c;
      else if (c === ">") break;
    }
    if (j >= xml.length) throw new XmpNonReconnu("balise ouvrante non terminée");
    const self = xml[j - 1] === "/";
    const body = xml.slice(i + 1, self ? j - 1 : j);
    const name = (body.match(/^[^\s/>]+/) || [""])[0];
    if (!name) throw new XmpNonReconnu("balise sans nom");
    const attrs = [];
    const re = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let m;
    while ((m = re.exec(body)))
      attrs.push({
        name: m[1],
        value: unesc(m[3] ?? m[4]),
        start: i + 1 + m.index,
        vStart: i + 1 + m.index + m[0].indexOf(m[2]) + 1,
        vLen: (m[3] ?? m[4]).length,
      });
    const el = {
      name,
      start: i,
      tagEnd: j + 1,
      insertAt: self ? j - 1 : j,
      self,
      attrs,
      parent: stack[stack.length - 1] || null,
      children: [],
    };
    if (el.parent) el.parent.children.push(el);
    els.push(el);
    if (!self) stack.push(el);
    else {
      el.close = null;
      el.end = j + 1;
    }
    i = j + 1;
  }
  if (stack.length) throw new XmpNonReconnu("élément non fermé " + stack[stack.length - 1].name);
  return els;
}
function portee(el) {
  const map = {},
    chaine = [];
  for (let e = el; e; e = e.parent) chaine.unshift(e);
  for (const e of chaine)
    for (const a of e.attrs) if (a.name.startsWith("xmlns:")) map[a.name.slice(6)] = a.value;
  return map;
}
/** Les Descriptions de premier niveau, et leur préfixe rdf. */
function structure(xml) {
  const els = scan(xml);
  const rdf = els.find((e) => e.name.endsWith(":RDF") && portee(e)[e.name.split(":")[0]] === NS.rdf);
  if (!rdf) throw new XmpNonReconnu("pas de rdf:RDF");
  const rdfP = rdf.name.split(":")[0];
  const tops = rdf.children.filter((e) => e.name === rdfP + ":Description");
  if (!tops.length) throw new XmpNonReconnu("pas de rdf:Description");
  return { rdfP, tops };
}
/** Une propriété, cherchée dans toutes les Descriptions ; deux exemplaires sont refusés. */
function trouver(tops, uri, local) {
  const vus = [];
  for (const d of tops) {
    const sc = portee(d);
    for (const a of d.attrs) {
      const [p, l] = a.name.split(":");
      if (l === local && sc[p] === uri) vus.push({ kind: "attr", d, a });
    }
    for (const c of d.children) {
      const [p, l] = c.name.split(":");
      if (l === local && portee(c)[p] === uri) vus.push({ kind: "elem", d, c });
    }
  }
  if (vus.length > 1) throw new XmpNonReconnu(local + " présent plusieurs fois");
  return vus[0] || null;
}
function valeurSimple(xml, f) {
  if (!f) return undefined;
  if (f.kind === "attr") return f.a.value;
  if (f.c.self || f.c.children.length) throw new XmpNonReconnu(f.c.name + " sous une forme non reconnue");
  return unesc(xml.slice(f.c.tagEnd, f.c.close));
}
function listeSac(xml, f) {
  if (!f) return [];
  if (f.kind === "attr") throw new XmpNonReconnu(f.a.name + " en attribut");
  const b = f.c.children[0];
  if (!b || f.c.children.length !== 1 || !/:(Bag|Seq)$/.test(b.name))
    throw new XmpNonReconnu(f.c.name + " sans rdf:Bag");
  return b.children.map((li) => {
    if (li.self || li.children.length) throw new XmpNonReconnu(f.c.name + " : entrée non reconnue");
    return unesc(xml.slice(li.tagEnd, li.close));
  });
}
const aJuno = (k) => k === "Juno" || k.startsWith("Juno|");
/** Ce que le fichier dit aujourd'hui : sert à détecter une note posée ailleurs. */
function lire(xml) {
  const { tops } = structure(xml);
  const note = valeurSimple(xml, trouver(tops, NS.xmp, "Rating"));
  return {
    rating: note === undefined ? undefined : Number(note),
    label: valeurSimple(xml, trouver(tops, NS.xmp, "Label")),
    keywords: listeSac(xml, trouver(tops, NS.lr, "hierarchicalSubject")),
  };
}
/**
 * Fusionner le tri dans un sidecar existant.
 *
 * `record` : `rating` (1 à 5, `null` pour retirer, `undefined` pour ne pas
 * toucher), `label` (même règle), `keywords` (chemins complets « Juno|… »,
 * qui remplacent tout le sous-arbre Juno), `date` (ISO 8601).
 */
function fusionner(xml, record) {
  if (xml.length > TAILLE_MAX) throw new XmpNonReconnu("fichier trop volumineux");
  const { rdfP, tops } = structure(xml);
  const edits = [];
  const ajout = (e) => edits.push({ order: 0, ...e, seq: edits.length });
  const first = tops[0],
    firstScope = portee(first);
  const ajoutes = {},
    blocs = [];
  const prefixe = (uri, voulu) => {
    const p = Object.keys(firstScope).find((k) => firstScope[k] === uri);
    if (p) return p;
    if (ajoutes[uri]) return ajoutes[uri];
    let q = voulu;
    while (firstScope[q] || Object.values(ajoutes).includes(q)) q += "J";
    ajoutes[uri] = q;
    ajout({ at: first.insertAt, del: 0, ins: `\n    xmlns:${q}="${uri}"`, order: 0 });
    return q;
  };
  const poser = (uri, voulu, local, valeur) => {
    const f = trouver(tops, uri, local);
    if (f && f.kind === "attr") return ajout({ at: f.a.vStart, del: f.a.vLen, ins: esc(valeur) });
    if (f) {
      valeurSimple(xml, f);
      return ajout({ at: f.c.tagEnd, del: f.c.close - f.c.tagEnd, ins: esc(valeur) });
    }
    const p = prefixe(uri, voulu);
    ajout({ at: first.insertAt, del: 0, ins: `\n   ${p}:${local}="${esc(valeur)}"`, order: 1 });
  };
  const retirer = (uri, local) => {
    const f = trouver(tops, uri, local);
    if (!f) return;
    if (f.kind === "attr") {
      let s = f.a.start;
      while (/\s/.test(xml[s - 1])) s--;
      ajout({ at: s, del: f.a.vStart + f.a.vLen + 1 - s, ins: "" });
    } else {
      let s = f.c.start;
      while (/[ \t]/.test(xml[s - 1])) s--;
      if (xml[s - 1] === "\n") s--;
      ajout({ at: s, del: f.c.end - s, ins: "" });
    }
  };
  const sac = (uri, voulu, local, garder, ajouter) => {
    const f = trouver(tops, uri, local);
    const avant = listeSac(xml, f);
    if (f) {
      const b = f.c.children[0];
      const apres = avant.filter(garder);
      for (const k of ajouter) if (!apres.includes(k)) apres.push(k);
      if (apres.length === avant.length && apres.every((v, i) => v === avant[i])) return;
      if (!apres.length) return retirer(uri, local);
      const li = b.children[0]?.name || rdfP + ":li";
      return ajout({
        at: b.tagEnd,
        del: b.close - b.tagEnd,
        ins: apres.map((v) => `\n      <${li}>${esc(v)}</${li}>`).join("") + "\n    ",
      });
    }
    if (!ajouter.length) return;
    const p = prefixe(uri, voulu);
    blocs.push(
      `\n   <${p}:${local}>\n    <${rdfP}:Bag>` +
        ajouter.map((v) => `\n     <${rdfP}:li>${esc(v)}</${rdfP}:li>`).join("") +
        `\n    </${rdfP}:Bag>\n   </${p}:${local}>`,
    );
  };
  if (record.rating === null) retirer(NS.xmp, "Rating");
  else if (record.rating !== undefined) poser(NS.xmp, "xmp", "Rating", String(record.rating));
  if (record.label === null) retirer(NS.xmp, "Label");
  else if (record.label !== undefined) poser(NS.xmp, "xmp", "Label", record.label);
  const cles = [...new Set(record.keywords || [])];
  const feuilles = new Set(cles.map((k) => k.split("|").pop()));
  // Les feuilles que Juno avait posées dans dc:subject s'en vont avec leur
  // chemin ; un mot identique posé à la main ailleurs part aussi, c'est le
  // seul défaut connu de ce format à deux listes.
  const anciennes = new Set(
    listeSac(xml, trouver(tops, NS.lr, "hierarchicalSubject")).filter(aJuno).map((k) => k.split("|").pop()),
  );
  sac(NS.lr, "lr", "hierarchicalSubject", (k) => !aJuno(k), cles);
  sac(NS.dc, "dc", "subject", (k) => !anciennes.has(k) || feuilles.has(k), [...feuilles]);
  if (record.date) poser(NS.xmp, "xmp", "MetadataDate", record.date);
  if (blocs.length) {
    if (first.self)
      ajout({ at: first.insertAt, del: first.tagEnd - first.insertAt, ins: ">" + blocs.join("") + `\n  </${first.name}>`, order: 9 });
    else ajout({ at: first.close, del: 0, ins: blocs.join("").slice(1) + "\n  ", order: 3 });
  }
  edits.sort((a, b) => b.at - a.at || b.order - a.order || b.seq - a.seq);
  let out = xml;
  for (const e of edits) out = out.slice(0, e.at) + e.ins + out.slice(e.at + e.del);
  // Dernier contrôle : le résultat se relit, et dit bien ce qu'on voulait.
  const relu = lire(out);
  if (record.rating !== undefined && (relu.rating ?? null) !== (record.rating ?? null))
    throw new XmpNonReconnu("note relue différente");
  return out;
}
/** Un sidecar neuf, au format qu'écrivent Lightroom et Aftershoot. */
function nouveau(record) {
  const base =
    `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>\n` +
    `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Juno Studio">\n` +
    ` <rdf:RDF xmlns:rdf="${NS.rdf}">\n` +
    `  <rdf:Description rdf:about=""/>\n` +
    ` </rdf:RDF>\n` +
    `</x:xmpmeta>\n` +
    `<?xpacket end="w"?>\n`;
  return fusionner(base, record);
}
module.exports = { fusionner, nouveau, lire, scan, XmpNonReconnu, TAILLE_MAX, aJuno };
