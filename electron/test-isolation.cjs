/**
 * Empêcher un essai d'écrire dans les vrais projets.
 *
 * Les scripts de vérification lancent l'application avec un profil temporaire
 * (`--user-data-dir`). Rien ne garantissait qu'un nouveau script y pense : il
 * aurait travaillé, sans le dire, dans les projets et les originaux de la
 * personne qui utilise Juno.
 *
 * La garde est ici plutôt que dans un test, parce qu'un test ne protège que ce
 * qu'il connaît. Placée dans l'application, elle arrête n'importe quel script,
 * écrit hier ou demain, qui oublierait l'isolement.
 */
const path = require("node:path");
const os = require("node:os");
/** Le dossier de travail réel, calculé sans passer par Electron. */
function dossierReel(nom, plateforme = process.platform, maison = os.homedir()) {
  if (plateforme === "darwin")
    return path.join(maison, "Library", "Application Support", nom);
  if (plateforme === "win32")
    return path.join(process.env.APPDATA || path.join(maison, "AppData", "Roaming"), nom);
  return path.join(process.env.XDG_CONFIG_HOME || path.join(maison, ".config"), nom);
}
/** Vrai si `enfant` est le dossier `parent` ou se trouve dedans. */
function dedans(enfant, parent) {
  if (!enfant || !parent) return false;
  const a = path.resolve(enfant),
    b = path.resolve(parent);
  if (a === b) return true;
  return a.startsWith(b.endsWith(path.sep) ? b : b + path.sep);
}
/**
 * Le verdict, sans effet de bord, pour qu'il soit vérifiable par un test.
 *
 * Hors essai, on ne juge rien : c'est l'usage normal, il doit écrire dans ses
 * propres projets.
 */
function verdict({ essai, userData, appData, nom = "Juno Studio", plateforme, maison }) {
  if (!essai) return { ok: true };
  if (!userData)
    return { ok: false, raison: "Le dossier de travail n’est pas connu." };
  const interdits = [dossierReel(nom, plateforme, maison)];
  // La valeur rendue par Electron sert de second filet : si un jour
  // `--user-data-dir` cessait d'agir, la comparaison ci-dessus passerait et
  // celle-ci rattraperait le coup.
  if (appData) interdits.push(path.join(appData, nom));
  for (const interdit of interdits)
    if (dedans(userData, interdit))
      return {
        ok: false,
        raison:
          "Cet essai allait écrire dans les vrais projets (" +
          interdit +
          "). Relancez-le avec --user-data-dir sur un dossier temporaire.",
      };
  return { ok: true };
}
/** Vrai quand l'application tourne pour un essai et non pour de bon. */
function enEssai(argv = process.argv, env = process.env) {
  return argv.includes("--juno-test-hidden") || env.JUNO_TEST === "1";
}
module.exports = { verdict, enEssai, dossierReel, dedans };
