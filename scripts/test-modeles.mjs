// Les contrats des modèles : lancer la vraie application sur de vrais modèles
// et vérifier ce que chacun doit rendre. Voir REGISTRE-MODELES.md.
//
//   npm run test:modeles -- <photo d'une personne, cadrée au centre>
//   JUNO_RAWS=<dossier de RAW> npm run test:modeles -- <photo>   (ajoute Lightroom)
//
// Tout le reste est fabriqué à partir de cette photo : un plan 16/9 où la
// personne est à droite, et un rush où l'on applaudit à 8 secondes. Rien
// n'est écrit dans le dépôt ni dans vos projets : chaque contrat tourne sur un
// profil jetable, et l'application refuse de démarrer autrement.
import { spawnSync, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
const racine = path.resolve(import.meta.dirname, "..");
const photo = process.argv[2] || process.env.JUNO_PORTRAIT;
if (!photo || !existsSync(photo)) {
  console.error("Usage : npm run test:modeles -- <photo d'une personne, cadrée au centre>");
  process.exit(2);
}
const ffmpeg = [
  path.join(racine, "native", `${process.platform}-${process.arch}`, "ffmpeg"),
  path.join(racine, "native", "darwin-x64", "ffmpeg"),
].find(existsSync);
if (!ffmpeg) throw Error("FFmpeg embarqué introuvable dans native/.");
const essais = mkdtempSync(path.join(os.tmpdir(), "juno-contrats-"));
const photos = path.join(essais, "photos");
mkdirSync(photos);
const ff = (...args) => execFileSync(ffmpeg, ["-y", "-v", "error", ...args]);
console.log("Fabrication des médias d'essai…");
ff("-i", photo, "-q:v", "2", path.join(photos, "personne.jpg"));
// La personne dans le tiers droit d'un plan 16/9 : c'est le cas où un
// recadrage centré la couperait, et où les visages sont petits dans le cadre.
ff("-loop", "1", "-i", photo, "-f", "lavfi", "-i", "color=c=0x2b2b2b:s=1920x1080:r=25",
  "-filter_complex", "[0:v]scale=-2:900[p];[1:v][p]overlay=x=W-w-70:y=90:shortest=1,format=yuv420p",
  "-t", "4", "-c:v", "h264_videotoolbox", "-b:v", "8M", path.join(essais, "mariee-droite.mp4"));
// Un rush calme où l'on applaudit de 8 à 10,5 s.
ff("-loop", "1", "-i", photo, "-f", "lavfi", "-i", "anoisesrc=d=14:c=pink:a=0.02:r=48000",
  "-filter_complex", "[0:v]scale=-2:1080,pad=1920:1080:(ow-iw)/2:0:color=0x2b2b2b,format=yuv420p[v];[1:a]volume='if(between(t,8,10.5),18,1)':eval=frame[a]",
  "-map", "[v]", "-map", "[a]", "-t", "14", "-r", "25", "-c:v", "h264_videotoolbox", "-b:v", "6M",
  "-c:a", "aac", "-ac", "2", path.join(essais, "discours-applaudi.mp4"));
// Une photo de groupe : la même personne cinq fois en buste, en rang, visages
// à 5 % de la largeur de l'image, l'échelle d'une vraie photo de groupe. Sur
// la vignette de 480 px du tri d'avant, aucun n'était trouvé. Le buste est
// pris au centre haut de la photo (tête et épaules d'un portrait en pied) ;
// avec une photo cadrée autrement, ce contrat peut échouer sans défaut réel.
// Et un portrait serré, pour vérifier qu'on n'y invente ni clignement ni flou.
const tri = path.join(essais, "tri");
mkdirSync(tri);
ff("-i", photo, "-filter_complex",
  "color=c=0x6b6b5e:s=3000x2000[f];[0:v]crop=iw*0.48:ih*0.46:iw*0.285:ih*0.14,scale=370:-2,split=5[a][b][c][d][e];" +
  "[f][a]overlay=150:900[f1];[f1][b]overlay=700:880[f2];[f2][c]overlay=1250:900[f3];[f3][d]overlay=1800:880[f4];[f4][e]overlay=2350:900",
  "-frames:v", "1", "-q:v", "2", path.join(tri, "groupe.jpg"));
ff("-i", photo, "-q:v", "2", path.join(tri, "portrait.jpg"));
// Trois façades de lignes droites, penchées de 2°, droites, et penchées de 7°
// (ffmpeg tourne dans le sens horaire pour un angle positif, comme Juno) :
// le redressement doit poser la première, laisser la deuxième, proposer la
// troisième sans la poser.
const facades = path.join(essais, "facades");
mkdirSync(facades);
for (const a of [2, 0, 7])
  ff("-f", "lavfi", "-i", "color=c=0x5a5a55:s=4200x2800", "-vf",
    `drawgrid=w=300:h=230:t=14:c=0xd8d4c8,gblur=sigma=1.2,rotate=${a}*PI/180:c=0x5a5a55:bilinear=1,noise=alls=4:allf=t`,
    "-frames:v", "1", "-q:v", "2", path.join(facades, `facade-${a}.jpg`));
// Une rafale à main levée : quatre vues du même portrait décalées de quelques
// pixels, à 150 ms d'écart, dont une seule nette (les trois autres légèrement
// floues) ; puis une façade 0,6 s plus tard, et le portrait de nouveau 4 s
// après. L'heure au millième est écrite dans l'EXIF, comme un boîtier le fait.
const rafale = path.join(essais, "rafale");
mkdirSync(rafale);
/** Un segment EXIF minimal : Model, DateTimeOriginal et SubSecTimeOriginal. */
function avecHeure(fichier, date, fraction) {
  const ascii = (t) => Buffer.from(t + "\0", "latin1");
  const modele = ascii("Contrat Juno"), jour = ascii(date), sub = ascii(fraction);
  // TIFF : en-tête (8), IFD0 à 2 entrées (2 + 24 + 4), IFD Exif à 2 entrées (2 + 24 + 4), puis les textes.
  const ifd0 = 8, exif = ifd0 + 30, donnees = exif + 30;
  const tiff = Buffer.alloc(donnees + modele.length + jour.length);
  tiff.write("II", 0, "latin1"); tiff.writeUInt16LE(42, 2); tiff.writeUInt32LE(ifd0, 4);
  const entree = (o, tag, type, n, valeur) => { tiff.writeUInt16LE(tag, o); tiff.writeUInt16LE(type, o + 2); tiff.writeUInt32LE(n, o + 4); tiff.writeUInt32LE(valeur, o + 8); };
  tiff.writeUInt16LE(2, ifd0);
  entree(ifd0 + 2, 0x0110, 2, modele.length, donnees);
  entree(ifd0 + 14, 0x8769, 4, 1, exif);
  tiff.writeUInt16LE(2, exif);
  entree(exif + 2, 0x9003, 2, jour.length, donnees + modele.length);
  entree(exif + 14, 0x9291, 2, sub.length, 0);
  sub.copy(tiff, exif + 22);
  modele.copy(tiff, donnees);
  jour.copy(tiff, donnees + modele.length);
  const app1 = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const entete = Buffer.alloc(4);
  entete.writeUInt16BE(0xffe1, 0); entete.writeUInt16BE(app1.length + 2, 2);
  const jpeg = readFileSync(fichier);
  writeFileSync(fichier, Buffer.concat([jpeg.subarray(0, 2), entete, app1, jpeg.subarray(2)]));
}
[[0, 0, 1.4], [10, 6, 1.4], [20, 12, 0], [30, 8, 1.4]].forEach(([x, y, flou], i) => {
  const f = path.join(rafale, `rafale-${i + 1}.jpg`);
  ff("-i", photo, "-vf", `crop=iw-40:ih-24:${x}:${y}${flou ? `,gblur=sigma=${flou}` : ""}`, "-frames:v", "1", "-q:v", "2", f);
  avecHeure(f, "2026:09:19 15:04:05", String(i * 150).padStart(3, "0"));
});
ff("-i", path.join(facades, "facade-0.jpg"), "-q:v", "2", path.join(rafale, "facade.jpg"));
avecHeure(path.join(rafale, "facade.jpg"), "2026:09:19 15:04:05", "600");
ff("-i", photo, "-vf", "crop=iw-40:ih-24:0:0", "-frames:v", "1", "-q:v", "2", path.join(rafale, "plus-tard.jpg"));
avecHeure(path.join(rafale, "plus-tard.jpg"), "2026:09:19 15:04:09", "450");
const contrats = [
  { nom: "Détourage au clic (SlimSAM)", script: "verif-detourage.cjs", env: { JUNO_PHOTOS: photos } },
  { nom: "Recadrage vertical (MediaPipe par tuiles)", script: "verif-recadrage.cjs", env: { JUNO_FILM: path.join(essais, "mariee-droite.mp4") } },
  { nom: "Moments forts (ebur128)", script: "verif-moments.cjs", env: { JUNO_FILM: path.join(essais, "discours-applaudi.mp4") } },
  { nom: "Visages du tri photo (groupe et portrait)", script: "verif-tri-groupe.cjs", env: { JUNO_PHOTOS: tri } },
  { nom: "Redressement (lignes, palier, proposition)", script: "verif-redressement.cjs", env: { JUNO_PHOTOS: facades } },
  { nom: "Rafales (une seule image gardée, la plus nette)", script: "verif-rafales.cjs", env: { JUNO_PHOTOS: rafale } },
];
// L'envoi à Lightroom a besoin de vrais RAW : JUNO_RAWS=<dossier>. Ils sont
// copiés dans un dossier jetable avant l'essai, jamais modifiés sur place.
if (process.env.JUNO_RAWS && existsSync(process.env.JUNO_RAWS))
  contrats.push({ nom: "Envoi du tri à Lightroom (.xmp)", script: "verif-lightroom.cjs", env: { JUNO_RAWS: process.env.JUNO_RAWS } });
else console.log("Envoi à Lightroom non vérifié : indiquez un dossier de RAW dans JUNO_RAWS.");
const bilan = [];
for (const c of contrats) {
  process.stdout.write(`${c.nom}… `);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(racine, "tests", "modeles", c.script)], {
    cwd: racine,
    env: { ...process.env, ...c.env, JUNO_SORTIE: path.join(essais, "sortie") },
    encoding: "utf8",
    maxBuffer: 64 << 20,
  });
  const verdict = (r.stdout + r.stderr).split("\n").find((l) => / (OK|KO)\b/.test(l) && /^[A-ZÉ]+ /.test(l)) || "";
  const ok = r.status === 0;
  bilan.push({ nom: c.nom, ok, secondes: Math.round((Date.now() - t0) / 1000), verdict });
  console.log(ok ? "OK" : "KO", `(${bilan.at(-1).secondes} s)`);
  if (!ok) console.log("   " + (verdict || (r.stderr || r.stdout).trim().split("\n").slice(-3).join("\n   ")));
}
console.log("\nCaptures et rapports : " + path.join(essais, "sortie"));
const echecs = bilan.filter((b) => !b.ok).length;
console.log(echecs ? `${echecs} contrat(s) rompu(s) sur ${bilan.length}.` : `Les ${bilan.length} contrats tiennent.`);
process.exit(echecs ? 1 : 0);
