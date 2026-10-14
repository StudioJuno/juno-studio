# Validation de Juno Studio 0.8.0

## Périmètre vérifié

- Compilation TypeScript, application Vite et portail de retours clients : sans erreur.
- Suite complète : **95 tests Vitest et 52 tests natifs**, zéro échec (80 et 45 en 0.7.1).
- Poignées de transformation : bornes de taille et de rotation, facteur d’un glissement non cumulatif, rotation qui se replie au lieu de coller à la limite, mise à l’échelle d’un texte et d’une forme sans mutation de la source.
- Plafond de taille des textes : refusé au-delà de la moitié de la hauteur de séquence, accepté en 4K, jamais plus bas que l’ancienne limite de 240 px. Vérifié côté interface et côté validateur natif.
- Masques : interpolation entre repères, repère unique préservé, coupe et changement de vitesse qui conservent la position vue au point de coupe, géométrie paire et bornée, refus des formes, intensités et repères impossibles.
- Suivi : simplification de trajectoire qui respecte le budget de repères, corrélation qui refuse une recherche hors cadre.
- Relief : dégradé de couleur borné, nombre de passes d’extrusion borné même sur un titre 4K.

## Preuves d’interface, sur profil temporaire isolé

Dossier `work/refonte-v072`, exécution sur macOS ARM.

- `transform-ui.json` : forme agrandie de 0,30 × 0,15 à 0,60 × 0,30 par glissement, proportions conservées ; rotation de 90° à la souris puis 89° et 79° au clavier ; Échap annule un glissement en cours ; Annuler puis Rétablir retrouvent les deux états ; titre de 420 px accepté et occupant 29,6 % de la hauteur de l’aperçu. Zéro erreur JavaScript, aucun débordement horizontal. Captures : `transform-handles.png`, `large-title.png`.
- `mask-ui.json` : import d’un plan réel, masque créé depuis l’onglet Masques, suivi lancé depuis l’interface. Suivi de 50 images, **confiance 0,97**, masque conduit de x = 0,173 à x = 0,583 en suivant le sujet. Captures : `mask-panel.png`, `mask-tracked.png`.
- `depth-ui.json` : relief activé sur un titre, panneau Motion design capturé (`depth-panel.png`).
- `ui-report.json` : le parcours complet de la 0.7.1 a été rejoué sur cette version (thèmes clair et sombre, 1440×900 et 1280×800, transcription Whisper locale, correction d’un repère de mot, sous-titres karaoké, déplacement graphique, annulation et rétablissement, mixeur, amélioration vocale, export réel). Zéro erreur JavaScript, aucun débordement. Export du film de test en 5 231 ms sur cette machine à cet instant : mesure locale, pas une garantie.

## Preuves d’export réel

- `transform-export.json` : face blanche d’un titre passée de 1 161 à 39 870 pixels après agrandissement ; barre de 0,3 à 0,6 de large, inclinée à 45°, dont la boîte passe de 0,30 × 0,06 à 0,40 × 0,68 de l’image. Images : `export-reference.png`, `export-transformed.png`.
- `mask-ui.json` : dans le fichier exporté, le détail local au cœur du masque tombe de 16,09 à 2,19 pendant que la zone hors masque reste identique (0,00 des deux côtés). Images : `mask-reference.png`, `mask-export.png`.
- `depth-ui.json` : 28 503 pixels de flancs orangés sur la version en relief contre 0 sur la version plate, face blanche préservée (20 757 contre 20 703 pixels). Images : `depth-flat.png`, `depth-relief.png`.
- Test natif `masks-native.test.cjs` : un masque mobile fait tomber le détail local de 66,3 à 7,0 dans sa zone, au début à gauche puis à la fin à droite, pendant que le reste de l’image ne bouge pas (0,5). Le cache plein peint sa couleur exacte au centre sans déborder ; la pixelisation détruit la texture fine dans sa seule zone.
- Test natif `track-native.test.cjs` : un sujet réel suivi sur 50 images, 25 repères après simplification, confiance 0,96, trajectoire de 0,156 à 0,819.

## Livraison et installation

Les paquets Mac ARM, Mac Intel et Windows x64 sont dans `release/v0.8.0`. Sur ce Mac ARM, la 0.8.0 a été installée le 23 septembre 2026 par `scripts/install-mac.mjs` : signature ad-hoc vérifiée, `app.asar` installé identique au paquet testé (SHA-256 `12d6706226ee73deb25307cc243ccd8f572355b3dc8add96088d9604eea1d4da`). Le catalogue utilisateur compte les mêmes 27 entrées et 257 originaux qu’avant l’installation, pour 2,7 Go. Le service local d’équipe est resté en service et signale toujours `setupRequired: true`.

Le démarrage de l’application installée sur un profil temporaire a chargé Montage sans erreur JavaScript, affiché l’onglet Masques, exposé l’API de suivi et constaté un moteur FFmpeg 9.0.2 disponible (`installed-smoke.json`, capture `installed-0800.png`).

## Limites de validation

Exécution native et parcours d’interface réalisés sur macOS ARM uniquement. Les paquets Mac Intel et Windows sont produits mais n’ont pas été lancés sur ces machines.

Aucun catalogue utilisateur n’a été touché : tous les scénarios utilisent des profils temporaires et des fixtures créées puis supprimées. Le catalogue de `~/Library/Application Support/Juno Studio` a été laissé intact.

Le suivi automatique n’a été mesuré que sur des sujets de synthèse à fort contraste et sur une translation. Il n’a pas été qualifié sur des visages réels, des voiles, des contre-jours, des coupes ni des mouvements de caméra rapides. Le rendu des masques n’a pas encore été mesuré sur du vrai 4K ou 6K, ni sur un montage long : le coût d’un masque s’ajoute à chaque image du plan concerné.

Le relief 3D n’a pas d’équivalent 3D réel : ni caméra, ni modèle importé, ni ombre portée volumétrique.
