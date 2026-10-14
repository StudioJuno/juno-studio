# Juno Studio 0.9.0

La 0.9.0 refond le tri et la retouche photo : analyse à 1 024 px, netteté mesurée sur le visage du sujet, rafales entières, verdict expliqué pour chaque image, balance des blancs automatique, cohérence par scène, apprentissage du style, reconnaissance des personnes et import multi-coeurs. Voir [le guide](GUIDE-V090.md), [la validation](VALIDATION-V090.md) et [l'audit](PLAN-V090.md).

Vérification de ce lot : `npm run test:culling`.

# Juno Studio 0.8.0

La version 0.8.0 ajoute les masques de plan avec suivi automatique (flou, pixelisation, cache plein), les poignées de redimensionnement et de rotation dans l’aperçu, une taille de titre qui suit enfin le format 4K/6K, et le relief 3D des titres et des formes. Voir [le guide](GUIDE-V080.md) et [la validation](VALIDATION-V080.md).

Vérification de ce lot : `npm run test:masks`. Paquets dans `release/v0.8.0`, installation Mac par `node scripts/install-mac.mjs` après avoir fermé Juno.

# Juno Studio 0.6.0

La version 0.6.0 ajoute le module Retours clients photo et vidéo. Voir [le guide](GUIDE-V060.md), [la qualification](VALIDATION-V060.md) et [le déploiement du portail](deploy/review/README.md). Le portail public n’est pas encore hébergé.

# Juno Studio 0.4.2

La version 0.4.2 ajoute l’import mixte de photos, vidéos et sons, leur conservation locale et des diagnostics par fichier.

Application locale de photo et vidéo pour les équipes Juno, pour tous les types de projets. La version 0.4 conserve l’espace photo 0.3 et ajoute montage, proxies, couleur Log/SDR, LUT, multicaméra, transcription, sous-titres, versions et rendus reprenables.

- [Importer photos, vidéos et sons](GUIDE-V042.md)
- [Validation médias 0.4.2](VALIDATION-V042.md)
- [Corrections affichage et import 0.4.1](GUIDE-V041.md)
- [Validation import 0.4.1](VALIDATION-V041.md)
- [Guide vidéo 0.4](GUIDE-V04.md)
- [Guide photo 0.3](GUIDE-V03.md)
- [Validation 0.4 et limites](VALIDATION-V04.md)
- [Installation du service local Mac](INSTALLATION-MAC.md)
- [Service équipe photo](server/README.md)
- [Composants vidéo](THIRD-PARTY-VIDEO.md) et [composants photo](THIRD-PARTY-V02.md)

Node.js 24 recommandé. `npm ci`, puis `npm run build` et `npm run desktop` pour l’application native. `npm run dev` affiche l’interface navigateur ; le moteur vidéo nécessite l’application native.

Les moteurs doivent être présents dans `native/darwin-arm64`, `native/darwin-x64` ou `native/win32-x64`, avec le modèle dans `native/models`. Le conditionnement copie les exécutables, le modèle et les transformations couleur hors de l’ASAR afin que les processus natifs puissent les lire.

Vérification : `npm test`, `npm run test:import`, `npm run test:media`, `npm run test:video`, `npm run test:team` et `npm run test:export`.

Construction : `npm run package:mac`, `npm run package:mac-intel`, `npm run package:win`. Les applications sont placées dans `release/<version>/`. Sur ce Mac, `node scripts/install-mac.mjs` installe la construction adaptée à l’architecture de Node après fermeture de Juno, sauvegarde le catalogue et conserve le service équipe.

Cette version est une alpha à qualifier sur les projets réels. Elle ne remplace pas encore toutes les fonctions des logiciels de production existants. Les comptes de génération, la notarisation, le déploiement d’équipe vidéo et les formats RAW vidéo propriétaires ne sont pas activés par la compilation.
