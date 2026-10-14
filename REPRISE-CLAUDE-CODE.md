# État courant au 10 octobre 2026 : sources et application installée 1.5.1

Cette section remplace les indications de version historiques ci-dessous. Lire `CLAUDE.md`, `MISES-A-JOUR.md`, `VALIDATION-V151.md` et les preuves `../../work/updates-v151` ; les fonctionnalités photo/montage précédentes sont dans `GUIDE-V150.md` et `VALIDATION-V150.md`. Vérifier la version installée et les journaux de livraison avant toute intervention.

La recherche de mises à jour est intégrée, mais l’adresse HTTPS de distribution est en attente du choix de Johan. Les paquets signés pour import manuel sont prêts dans `release/v1.5.1/updates`. Préserver impérativement la clé privée de publication `signing/updates-private.pem`, sans la lire ni l’afficher, et la clé publique correspondante. Les installations 1.5.0 et précédentes doivent être remplacées une première fois manuellement. Mac ARM : remplacement testé sur copie isolée 1.5.0 → 1.5.1 avec photo, réglage, original et sauvegarde conservés. Windows : moteur fourni, qualification réelle encore nécessaire. Les services publics et l’administrateur restent à activer avec les informations de Johan. Le prompt actualisé est `PROMPT-CLAUDE-CODE.md`.

# Passation Juno Studio, 1er octobre 2026 (mise à jour après le dérushage, 1.4.0 en préparation)

## Où travailler

Dossier principal : `/Users/johan/Documents/Codex/2026-09-22/ridge-2/outputs/juno-studio`.
Dossier des preuves de la version 0.9.0 : `/Users/johan/Documents/Codex/2026-09-22/ridge-2/work/refonte-v090`, plus l'audit dans `work/audit-v080`.
Preuves de la version 0.8.0 : `work/refonte-v072`.
Preuves de la version 0.7.1 : `work/refonte-v071`.
Anciennes versions et historique technique : `GUIDE-V070.md`, `VALIDATION-V070.md` et `work/refonte-v070` dans le dossier parent. Avant 0.7.1, les sources ont été archivées dans `work/refonte-v071/source-before-v071.tar.gz`. Il n’y a pas de dépôt Git dans ce dossier ; ne suppose pas que `git status` soit disponible. Aucun fichier `AGENTS.md` ou `CLAUDE.md` applicable trouvé dans l’application lors de la passation ; revérifier au démarrage.

Le code est une application de bureau Electron + React + TypeScript/Vite. Ce n’est pas un site Sites. Le rendu et les traitements vidéo utilisent des binaires natifs FFmpeg et Whisper, et les projets sont conservés localement. Le portail de retours clients utilise un service local. Les fichiers du catalogue utilisateur sont dans `~/Library/Application Support/Juno Studio` ; les scénarios de test doivent utiliser des profils temporaires. Ne jamais supprimer ce catalogue ni les originaux.

## Intention produit exprimée par Johan

Juno Studio doit devenir le poste de production photo, vidéo et audio de l’équipe Juno, pour tout type de projet photo, pas uniquement les mariages. La cible initiale est environ 50 photographes, avec jusqu’à 5 000 photos par projet. Johan souhaite une navigation très simple sur ordinateur portable 15–16 pouces, thèmes clair/sombre personnalisables, autosauvegarde, annulation et saisie numérique des valeurs. L’application doit fonctionner sur Mac et Windows ; tri et édition sans IA doivent rester possibles hors ligne. Plusieurs styles colorimétriques Juno au choix, avec prise en compte éventuelle de profils enregistrés dans Aftershoot. Les originaux doivent rester récupérables, y compris après une correction automatique prudente. Les traitements IA en ligne d’un album sont plafonnés à 5 € par défaut.

Le parcours visé : import robuste d’images, vidéos et sons ; tri d’album et première retouche globale en un clic ; retouche individuelle avancée ; génération et modification d’image par IA. En vidéo : rushes FX3/Canon R5/RED et autres caméras, 4K/6K Log, parfois jusqu’à 10 caméras ; timeline distincte image/son, mixage et amélioration vocale ; titres, sous-titres sociaux et motion design ; commandes texte ou voix pour toutes les actions à terme. Les clients doivent pouvoir commenter photos et vidéos à travers un lien privé, avec code facultatif, choisir des photos et valider ; Juno décide si le téléchargement est autorisé. L’ambition évoque Lightroom, Photoshop, Aftershoot, DaVinci Resolve, Premiere et After Effects, sans supposer que leur parité fonctionnelle soit déjà atteinte.

## Ce que la 1.4.0 ajoute : le dérushage (1er octobre 2026)

Demande de Johan : « analyser tous les rushes, mettre en non visible les moments flous, bougés ou inutilisables, classer les rushes ». Lire `PLAN-DERUSHAGE.md` (parties 9 et 11), `GUIDE-V140.md`, `VALIDATION-V140.md`. Paquets 1.4.0 notarisés dans `release/v1.4.0/` (Mac puce Apple, Mac Intel, Windows) ; **installée le 01/10/2026** avec l'accord de Johan, et proposée sur wearejuno.fr/juno-studio (commit `47672276f` du site). Après l'empaquetage, une correction est entrée dans les sources : la caméra se devine aussi sur le nom d'origine d'un média copié dans la bibliothèque (`doImport`, `doDerush`). Les sources sont donc un peu en avance sur la 1.4.0 installée.

- Moteur : `electron/video/derush.cjs`. Lecture de l'aperçu par tranches de 180 s (`lireTranche`, 1 s relue avant), qualité à 6 i/s (`blurdetect`, `signalstats`, `siti` écrits par `metadata=print` dans un fichier), mouvement à 12 i/s (miniatures grises 96×54 dans un fichier brut, corrélation de phase sur six zones, `creerMouvement`), `mesurer` (reprise par tranche, relevés gardés dans `cache/<id>/derush-mesure-v1.json`), `decouper` (règles et passages). Deux versions : `VERSION_MESURE` relit les rushes, `VERSION_REGLES` refait seulement le découpage.
- File de tâches (`electron/video/index.cjs`) : tâche `derush` de fond (`doDerush`, résultats écrits par lots de 15 s au plus), `planDerush` après import, aperçu refait, restauration, et à l'ouverture d'un projet (une fois par session ; pas si un dérushage y a été annulé dans la session). Gestionnaires `video-derush`, `video-derush-decision`, `video-derush-plan`. **`registerVideo({ autoDerush })` est faux par défaut** (les tests natifs comptent leurs écritures) ; `main.cjs` passe `true`.
- Résultat sur le média : `asset.derush = { mesure, regles, marque (taille|date de l'aperçu), plages, resume, mouvement, plan, decisions, date }` ; les décisions et le type de plan survivent à toute relecture. `asset.recorded` et `asset.camera` (`recordedAt`, `cameraOf` dans engine.cjs) sont lus à l'import, et relus sur l'original au dérushage pour les anciens médias (l'aperçu perd `creation_time`).
- Interface : `src/video/derush.ts` (passages et décisions, morceaux utiles, `ajouterUtiles`, `retirerInutilisables` sur `rangeCuts`/`removeCuts` d'edit.ts, `preMontage`, `blocs`), `src/video/DerushView.tsx` (onglet Dérush, `BandeDerush`, lecteur de passage), `src/video/derush-plans.ts` (type de plan par la taille des visages, en fond dans l'interface), `VideoStudio.tsx` (`append` ne pose que les morceaux utiles, Maj pour le rush entier ; `preMonter` ; `UnusableTrim`), pilote (`video.derush`, `video.premontage`, `video.unusable`).
- Corrigé au passage : `drain()` ajoute à `project.sequences` une séquence neuve enregistrée (elle n'apparaissait pas dans le sélecteur).

Pièges rencontrés :

- **Une image figée est indétectable sur l'aperçu** : l'encodeur efface le bruit du capteur, figé et plan sur pied immobile donnent les mêmes mesures. Règle retirée, remplacée par « rien ne bouge depuis plus de 2 min ».
- **Le mouvement d'un sujet passe pour celui de la caméra** sur une corrélation de l'image entière (décor à rayures verticales). D'où les six zones et l'`accord`.
- **Un flou voulu d'un film monté était masqué** : masqué seulement passager avec un voisin net du même plan, sans coupe (`coupes` : corrélation perdue ET différence d'image ×3).
- **Une mire PNG est en pleine échelle** : sans `scale=out_range=tv`, l'aperçu ramène son blanc écrêté à 218 et la surexposition ne se voit pas (piège de test, pas de l'app).
- **`lireTranche` : un nom de variable réutilisé** (`avant`) a donné une erreur de zone morte au premier essai natif.

## Ce que la 1.3.0 a changé, du 28 au 30 septembre 2026

Demande de Johan : « améliore encore tout, teste tout, règle les bugs ». Lire `GUIDE-V130.md` et `VALIDATION-V130.md`. Preuves et scripts de chaque agent : `work/refonte-v130`.

- Méthode : six zones relues (tri, retouche, catalogue, vidéo, pilote, interface), chaque constat contredit, chaque correction faite par un agent limité à ses fichiers puis relue, et une seconde (parfois troisième) passe sur les régressions trouvées en relisant. Plus de cent défauts corrigés, un test chacun.
- Tri : `raster.ts` (compression TIFF 32946 = deflate, les HEIC n'étaient plus noirs ; `convertieEnNoir` et `reparerConversion` dans `jobs.ts` refont les photos déjà importées), préchargement de passe réparé, `choisirDansRafale` / `rechoisirRafale` (`culling.ts`, appelé par `rate` dans App.tsx), alertes (voir `REGISTRE-MODELES.md`, « Alertes à vérifier »).
- Retouche : `analysis.rendu` (développement RAW réduit mesuré pendant la passe d'album, `auto-tone.ts` : `ecartDuRendu`, `toneExporte`, `sensible`), masques de sujet joints à chaque export, `Photo.proposalProfile` et `learnWhenLeaving` (le style appris des corrections n'apprenait jamais rien).
- Interface : `photo-writer.ts` (`abandon`, bandeau de reprise), `workbench/interface.ts`, `workbench/version.ts` (`__JUNO_VERSION__`), étiquettes d'historique par champ (`db.ts`), `preload.cjs` retire le préfixe « Error invoking remote method ».
- Pilote : `commands.ts` (sens des verbes, « à » / « de », blancs, négations, `cibleDite`), `intent-check.ts` (confirmation des actions destructrices, `relireProposition`, `cibleInchangee`), `journal.ts`.
- Catalogue et serveurs : `catalog-validation.ts` reconstruit chaque fiche champ par champ, `export.cjs` sans lien dur sur exFAT, restauration jusqu'à 1 Go, `TeamPanel.tsx` compacte les descripteurs de visage (`deplier` à la réception), `JUNO_TRUST_PROXY` pour croire X-Forwarded-For (portail et service d'équipe), événement `validated` du portail.
- Vidéo : exports calés à l'image, moniteur aligné sur l'export, `history.ts` pour « annule » du pilote vidéo, `will-quit` au lieu de `before-quit` partout (« Rester » ne laisse plus l'application à moitié arrêtée). Puis huit passes de plus (détail dans `VALIDATION-V130.md`, « La vidéo : dix passes ») :
  - Moniteur : `src/video/frame-index.ts` lit l'index moov de l'aperçu (fetch par plages) et `monitorFrameTime` / `exportLimit` (`edit.ts`) posent le moniteur au milieu de l'image que l'export posera ; l'aperçu garde les instants du rush (`-enc_time_base:v demux`).
  - Film (`electron/video/engine.cjs`, `render.cjs`) : `sampleTable` (stts/ctts/stss, gap, GOP ouvert), `seekPoint` (remontée avant l'image clé : MPEG-TS/PS, RASL du HEVC, trous), `videoTrack` (zéro, lead, shift, audioLead), `pictureEnd` (durée de l'image d'un .mkv), `pictureShape` (taille décodée après recadrage du conteneur, entrée figée avec `-reinit_filter:v 0`, rotation posée par l'app avec `-noautorotate` et `turnFilters`), un petit graphe son par entrée (apad puis atrim : plus de blocage amix), `retime` compté depuis le point d'entrée.
  - Garde-fou d'export (`engine.run`, option `stall`) : fondé sur le suivi `-progress` seulement tant que FFmpeg en donne (la réécriture `+faststart` est muette, et sur exFAT sous FSKit ni la taille ni la date du fichier ne bougent).
  - Son : `soundOf` = première piste son UTILISABLE, la même pour aperçu, rendu, onde, zéro, voix, transcription. `healProxies` (index.cjs) + `proxyStale` / `legacySound` : rejoue le choix de piste de FFmpeg 9.0.2 de la 1.2.x (`Stream mapping` avec les options exactes de la 1.2.x) pour savoir quels anciens aperçus refaire ; réfections en priorité basse (`pump` sert d'abord les tâches demandées), marque `proxySound` posée seulement à la fin réelle.
  - Montage (`VideoStudio.tsx`) : `show()` est le seul chemin de mise à jour de la séquence (borne la tête, convertit la tête au changement de cadence, arrête la lecture) ; `touchesLocked` dans `change()` refuse tout geste sur une piste verrouillée ; `memeContenu` évite les enregistrements vides ; `reporterCadrage` (`reframe-run.ts`) pose le recadrage sur la séquence d'aujourd'hui ; `playhead-state.ts` (`useHeld`, `stepFrame`) ; `NumericRange.tsx` n'écrit rien si le texte n'a pas changé et reprend la valeur après un refus (`onChange` peut rendre false).

Pièges rencontrés :

- **Deux sessions coupées en plein travail** : les workflows se reprennent avec `resumeFromRunId` (les agents finis reviennent du cache), mais le script doit être copié dans le bloc-notes, pas relu depuis le dossier du projet d'une autre session.
- **Des agents qui corrigent en parallèle** doivent avoir des fichiers disjoints ; un fichier partagé (App.tsx, catalog-validation.ts) se corrige après, par un seul.
- **Relire les corrections trouve des régressions** : sept sur les premières passes (seuil des blancs, portail validé par révocation, moniteur vidéo, photos sensibles…), puis cinq de plus sur les passes vidéo 4 à 9 (dernière image longue, exFAT, piste son vide, image recadrée par le conteneur, aperçu jugé sur ses passages forts). Ne jamais livrer une correction non relue.
- **Erreur React #185 (« Maximum update depth exceeded »)** : un effet qui fait un setState à chaque image laisse un rendu en attente après chaque flèche ; au 51e d'affilée, React lève l'erreur et perd la touche. Aucun effet qui dépend de la tête ne doit appeler un setter : ajuster l'état pendant le rendu (`useHeld`) ou là où la séquence change (`show()`). Le test « éditeur entier » de `tests/video-corrections-clavier.test.ts` monte VideoStudio et envoie 200 flèches par flushSync.
- **Des agents en parallèle doivent avoir chacun leur dossier de travail imposé** : deux agents ont partagé le même dossier du bloc-notes et l'un a écrasé la copie construite de l'autre.
- **Disque** : chaque copie construite par un agent pèse 1 à 4 Go ; 45 Go ont dû être libérés le 29/09. Imposer une seule copie par agent, supprimée à la fin.
- **Les pistes du tri écartées le sont avec leurs mesures** : ne pas relancer « rafales sans intérêt » ni « expressions » sans un signal nouveau (voir `VALIDATION-V130.md`).

## Ce que la 1.2.2 a changé, le 28 septembre 2026

Demande de Johan : « L'outil de tri doit sélectionner 1 seule photo lors d'une rafale, la meilleure. » Lire `GUIDE-V122.md`, `VALIDATION-V122.md` et la section « Rafales » de `REGISTRE-MODELES.md`. Preuves : `work/refonte-v122`.

- `src/modules/rafales.ts` (nouveau) : `empreinteDe` (miniature grise 48 px en base64, histogramme de couleur 64, contours 128), `lireCR3` (heure au millième et numéro du boîtier dans la boîte CMT2), `instantExif` (heure du boîtier comptée en UTC : seuls les écarts servent), `grouperRafales` (2,5 s depuis la première image, 2 signaux sur 3 avec la précédente, partition album × modèle × boîtier, caches `WeakMap` par objet empreinte), `noterRafale` et `raisonPreference` (chaque personne suivie et comparée à elle-même).
- `image-worker.ts` range `analysis.empreinte` (`VERSION_EMPREINTE` = `rafale-v1`) ; l'EXIF des formats convertis (HEIC) est lu sur l'original passé en `exif` (`inspectPhoto`, `originalExif` dans `image.ts`).
- `jobs.ts` : `avecMesures` relit niveau et empreinte d'un coup pour les vieilles analyses ; le préchargement en tient compte ; les raisons de fin de passe viennent de `raisonsDePasse` (`culling.ts`).
- `culling.ts` : `groupSuggestions` utilise `grouperRafales` et `noterRafale`, remet le verdict à zéro, retire les anciennes raisons de variante. `burstGroups` et `burstScores` (`quality.ts`) sont supprimés.
- `catalog-validation.ts` : valide `empreinte` ; `resumeDeSens` rend son Float32Array au résumé SigLIP après un aller-retour JSON. `TeamPanel.tsx` n'envoie pas l'empreinte (plafond de 8 Mo). `ComparePanel.tsx` passe les personnes désignées.

Pièges rencontrés, à ne pas redécouvrir :

- **Ne jamais modifier `src/` pendant un banc servi par Vite** : la page se recharge et la passe s'arrête (les bancs sont reprenables).
- **`groupId` est l'identifiant de la PREMIÈRE image de la rafale**, pas de la gagnante : pour savoir si une photo est une variante, tester `suggested`.
- **LibRaw ne rend que la seconde** : une rafale tient dix images dans la seconde. Le CR3 porte le millième dans CMT2 ; les autres formats dans SubSecTimeOriginal (exifr).
- **Compter les livrées ne suffit pas** : quand Juno ne prend pas la livrée, c'est presque toujours sa voisine, et à l'aveugle elle vaut la livrée deux fois sur trois. Toute retouche du choix se revalide à l'œil (planches A/B, trois juges), pas seulement au taux de livrées.

## Ce que la 1.2.1 a corrigé, le 28 septembre 2026

Le « défaut 3 » de la mesure contre Aftershoot, validé par Johan (« Oui 1 et 2 ») : la netteté d'un visage ne dépend plus de sa taille. Lire `GUIDE-V121.md` et `VALIDATION-V121.md`, et la section « Netteté des visages » de `REGISTRE-MODELES.md`.

- `public/face-sharpness.js` : 95e centile du gradient / étendue locale dans la bande des yeux, sur une grille fixe de 3 072 px ; seulement sur l'image d'analyse de 1 024 px tirée d'une source d'au moins 3 000 px (`visionSource`, transmis de `image-worker.ts` jusqu'au travailleur par `lireVisages` dans `jobs.ts`). Nouveau champ `FaceRead.nettete`. L'ancien `sharpness` reste, pour classer les images d'une rafale.
- `quality.ts` : `NETTETE_FLOU` 0,262, `NETTETE_DOUTE` 0,27, `jugementNettete` (règle de l'autre visage net, moitié de la largeur au moins, sauf personne désignée), `jugementVisage` (repli sur l'ancien seuil 12 quand la mesure manque).
- `culling.ts` : `raisonsVisage(analysis, priority)` refait d'un bloc les raisons de visage et « Peu de détails » (redérivé par `peuDeDetails` de `pixels.ts`) ; appelée par `withFaces` sans priorité et par `groupSuggestions` avec ; les deux boucles de `jobs.ts` recopient `reasons` et `advice`. `VERSION_VISAGES` = `mediapipe-face-v5`, suffixe `-vignette` quand les visages ont été lus sur la vignette de secours.

Pièges rencontrés, à ne pas redécouvrir :

- **Les étiquettes « floue » d'Aftershoot ne sont pas une vérité** : 39 des 105 tirées sont nettes à l'œil. La mesure « taille fixe », la meilleure sur ces étiquettes (AUC 0,83), n'était qu'à 0,70 à l'œil. Toujours valider sur des visages regardés à 100 %.
- **La mesure ne vaut qu'à 1 024 px et depuis une grande source** : elle repose sur le crénelage d'une forte réduction sans préfiltre. Sur la vignette, tous les visages nets tomberaient à 0,14 ; depuis 1 616 px, un tiers des nets passent pour flous.
- **Un estimateur de bruit simple mesure la texture de peau**, plus forte sur les visages nets : ne pas s'en servir comme garde.
- **Baisser le plancher d'étendue** corrigerait les flous peu contrastés mais dégrade la mesure (AUC 0,965 → 0,915).
- **Mesurer tout l'album sans l'importer** : banc `work/refonte-v121` (visages recadrés, étiquettes, évaluateur, avant/après). Une page Vite ouverte sur un fichier de `public/` n'a pas de client HMR : modifier les sources pendant une mesure ne la recharge pas.

## Ce que la 1.2.0 a ajouté, le 27 septembre 2026

Issue de l'audit des dépôts d'Aftershoot (`AUDIT-AFTERSHOOT.md`), trois chantiers validés par Johan (« go »). Lire `GUIDE-V120.md` et `VALIDATION-V120.md`.

1. **Redressement et recadrage automatiques.** `src/modules/geometry.ts` est désormais le seul endroit de la géométrie : redressement fin `straighten` (degrés, positif = horaire, autour du centre, dans un « repère redressé » de même taille), puis cadre (`cropRect` exprimé dans ce repère), puis quart de tour. Le cadre sans coin vide se calcule (`effectiveCrop`), il n'est jamais stocké. Retouches locales, détourage et masques restent en coordonnées de la source. Rendu : `redresser` dans `pipeline.ts` (bilinéaire, 16 bits conservés). Détecteur : `src/modules/level.ts` (segments au sous-pixel, point de fuite des verticales, horizon reconstitué, paliers auto / suggest / level / abstain), calculé dans `image-worker.ts` à l'import, rangé dans `analysis.level` avec `VERSION_NIVEAU`. La passe d'album pose le palier sûr (`redressementAuto` dans `jobs.ts`) ; l'éditeur a le curseur « Redressement », le bouton « Redresser » et la proposition ; le pilote comprend « redresse », « redresse de 2 degrés à gauche », « redressement 1,5 ».
2. **Envoi du tri à Lightroom Classic.** `electron/xmp-sidecar.cjs` (fusion pure qui ne remplace que quelques plages), `electron/lightroom.cjs` (plan, écriture atomique avec copie de sauvegarde, annulation, recherche des originaux par empreinte, dossier prêt pour Lightroom), `src/modules/LightroomPanel.tsx`, menu « Exporter ▾ ». Nouveau registre `userData/origins.json` : où le photographe range chaque fichier, rempli à l'import (`media-import.cjs`), par « Retrouver » (`imports.cjs`) et « Relier » (`backup.cjs`). `assets.json` reste « d'où Juno lit ».
3. **Mesure de Juno contre Aftershoot** sur l'album d'Audrey-Ann et Clément (3 552 RAW, 756 livrés) : voir `COMPARAISON-AFTERSHOOT.md`, banc et données dans `work/refonte-v120`. Verdict : le tri de Juno garde 2 707 photos pour 756 livrées. Trois défauts diagnostiqués, **aucun corrigé dans la 1.2.0** faute d'accord de Johan (ils changent le tri de tous les albums) : (1) séries, `dhash` ≤ 8 trop strict mais l'élargir ne fait qu'échanger réunions et fusions à tort ; (2) choix dans la série à 31 % contre 25 % au hasard, aucune pondération des mesures actuelles ne fait mieux sur données tenues à l'écart ; (3) la netteté d'un visage dépend de sa taille (AUC 0,47 brute, 0,70 rapportée au carré de la taille), et le seuil « visage flou » de 12 laisse passer des visages flous mesurés 38 à 116. Prochaine étape recommandée : netteté des visages mesurée à taille fixe, puis recalibrage sur ce banc.

Pièges rencontrés, à ne pas redécouvrir :

- **`straighten` n'est pas dans `DEFAULT`** : `jobs.ts` compare `p.adjustments` à `DEFAULT` pour savoir si une photo est déjà retouchée ; l'ajouter y ferait passer toutes les anciennes photos pour retouchées. Un angle nul s'écrit `undefined`, jamais 0.
- **Sans angle, l'ancienne formule du cadre est gardée à l'identique** : `(1 − 0,8) / 2` ne vaut pas `0,2 / 2` en virgule flottante, et le rendu doit rester identique au pixel près.
- **Le redressement n'est pas copié par « Copier sur les photos gardées »** : chaque photo a sa propre inclinaison (`applySeries` l'écarte).
- **Mesurer l'inclinaison sur `resizeRaster` crénelle les lignes** : réduction par moyenne de surface dans `luminanceReduite`, parcourue ligne par ligne (deux fois plus rapide).
- **Une image de synthèse lissée en 2 × 2 casse les lignes du détecteur.** Suréchantillonner en 4 × 4 dans les tests.
- **Juno ne doit retenir comme « sa » note Lightroom que ce qu'il a écrit** : une note gardée parce qu'elle venait d'Aftershoot, retenue par erreur, aurait été écrasée au second envoi (trouvé par `tests/lightroom.test.cjs`).
- **Le contrat Lightroom écrit à côté des originaux** : il copie les RAW dans un dossier jetable. Ne jamais l'orienter vers un vrai dossier de reportage.
- **Mesurer le tri sur un album entier sans l'importer** : l'import copierait tout (124 Go pour cet album). Le banc sert les RAW en lecture seule et fait tourner les vrais modules de Juno servis par Vite dans Chromium (voir la méthode dans `COMPARAISON-AFTERSHOOT.md`). Chromium sature sa réserve de fichiers au bout d'une soixantaine de RAW de 35 Mo : forcer le ramasse-miettes (`--js-flags=--expose-gc`) et réessayer.

## Ce que la 1.1.0 a ajouté, le 27 septembre 2026

Issue de l'audit d'OpenMontage (`AUDIT-OPENMONTAGE.md`) et de l'analyse du 26 septembre (`ANALYSE.md`). Lire `GUIDE-V110.md` et `VALIDATION-V110.md`.

1. **Recadrage vertical qui suit les visages** : bouton « Recadrer » du montage, choix par plan « sur le couple / sur tout le monde / réglé à la main ». Code : `src/video/reframe.ts` (géométrie pure), `reframe-apply.ts`, `reframe-scan.ts`, `reframe-run.ts`. Le zoom est fixe sur un plan, seule la position suit.
2. **Moments forts à l'oreille** : ebur128 relu dans la même passe que `silencedetect`. Code : `electron/video/moments.cjs`, `src/video/moments.ts`.
3. **Le pilote comprend la géométrie** (pivote, tourne, recadre en 16/9, enlève le recadrage) et une erreur `Refus` qui ne réveille pas l'IA locale.
4. **L'IA locale n'est plus embarquée** : 3,3 Go → 1,0 Go, archive 3 Go → 635 Mo. Téléchargée depuis le pilote, adresse à commit figé, empreinte vérifiée, reprise après coupure. Code : `electron/model-download.cjs`, `local-planner.cjs`.
5. **Garde des vrais projets** : lancée avec `--juno-test-hidden`, l'application refuse de démarrer si elle vise le dossier de travail réel. Code : `electron/test-isolation.cjs`.
6. **Contrats des modèles** : `npm run test:modeles -- <photo>` (4 contrats), registre dans `REGISTRE-MODELES.md`.
7. **Le tri voit les visages des photos de groupe**, décidé par Johan le 27/09 (« le système le plus performant possible ») : image d'analyse de 1 024 px rendue par `inspect` (option `vision`), relue par morceaux dans le travailleur, version `mediapipe-face-v4`. Sur 950 photos réelles : 167 → 1 059 visages. Netteté recalée par `CALIBRATION_NETTETE` (1,85, mesuré) ; pondération des visages par `poidsVisages` dans `quality.ts`. Voir `VALIDATION-V110.md`.

Pièges rencontrés, à ne pas redécouvrir :

- **MediaPipe ne voit pas les visages petits dans le cadre** (modèle courte portée). Mesuré : image 16/9 entière, 0 visage ; moitié droite, 1. D'où la lecture par morceaux de `public/face-tiles.js`, faite dans le travailleur.
- **Changer la résolution d'une mesure déplace ses seuils absolus.** La netteté d'un visage vaut 2,5 fois moins à 1 024 px qu'à 480, et « Visage principal flou » est un seuil fixe (12). Chercher les seuils (`verdictFor`, `qualityScore`) avant de toucher à une résolution.
- **Le catalogue refuse plus de 20 régions de visage** et un compte au-delà de 100 : le travailleur plafonne.
- **Le travailleur de vision échouait si deux images arrivaient pendant son chargement** (`importScripts` relancé). Réparé en mémorisant le chargement dans `public/vision-worker.js`.
- **`os.homedir()` ignore `$HOME` sur macOS** : changer `$HOME` ne détourne pas Electron de votre vrai dossier. La garde s'appuie dessus.
- **Toute erreur du lecteur de consignes partait vers l'IA locale**, même pour une consigne comprise mais impossible. Lever `Refus` pour ces cas.
- **En développement, le modèle de langue est toujours dans `native/models`** : l'état « non installé » ne se voit que sur le paquet. Tester avec `JUNO_TEST_EXEC`.
- **Le bouton « Bibliothèque » du montage est une bascule** : un script qui clique sans vérifier le referme.
- **Le bandeau `.toast` s'efface tout seul** : pour le lire dans un test, le relever en continu pendant l'action.
- **Empaqueter une version déjà notarisée écrase ses archives** : monter la version avant `npm run package:mac`.

## Ce que la 0.9.0 a ajouté, le 23 septembre 2026

Le tri et la retouche photo ont été refondus après un audit complet (`PLAN-V090.md`). Lire `GUIDE-V090.md` et `VALIDATION-V090.md`.

1. **Le tri voit enfin le sujet.** L'analyse passe de 128 à 1 024 px, la netteté est mesurée dans le visage du sujet, et les rafales ne sont plus coupées par une fenêtre fixe. Mesuré dans l'application : la discrimination entre une image nette et la même floutée passe de **1,23× à 136,8×**. Code : `src/modules/quality.ts`, `culling.ts`, `public/vision-worker.js`.
2. **Les RAW sont triés sur leur aperçu intégré** (`decodeRawPreview` dans `raster.ts`, `thumbnailData()` dans `raw-session.ts`) au lieu d'être décodés entièrement. **Pas encore mesuré sur de vrais RAW Sony ou Canon** : à faire en premier sur un album réel.
3. **La retouche corrige la couleur et tient la scène** : balance des blancs pondérée par la peau, scènes découpées par le temps et la lumière, réglages ramenés vers la médiane de leur scène. Code : `src/modules/auto-tone.ts`.
4. **Juno apprend le style de Johan** à partir de l'écart entre ce qu'il propose et ce que Johan garde, au-delà de douze corrections. Local, par médiane. Code : `src/modules/style-profile.ts`.
5. **Les personnes sont reconnues** par un réseau d'empreinte faciale embarqué (face-api, ResNet-34 dérivé de dlib, 6,15 Mo, `public/models/face-api`). Mesuré sur de vrais visages : même visage 0,141, personnes différentes 0,768, seuil 0,6. Une signature géométrique sert de repli si le modèle ne démarre pas. Code : `src/modules/people.ts`, `face-embed.ts`, `face-embed-worker.ts`, `people-store.ts`, `PeoplePanel.tsx`, provenance dans `THIRD-PARTY-FACES.md`.
6. **L'import et les passes d'album utilisent plusieurs cœurs** : pool de voies dans `image-client.ts`, pool de vision dans `culling.ts`, préchargement glissant dans `jobs.ts`.
7. **Le pilote IA connaît enfin les fonctions de la 0.8.0** : masque, suivi, relief, plus la description de la nouvelle passe d'album.

Pièges rencontrés, à ne pas redécouvrir :

- **La netteté dépend de la largeur d'analyse.** `comparableSharpness(analysis, photoWidth)` refuse une vieille mesure, mais accepte une photo plus étroite que 1 024 px mesurée à sa largeur native : sans cela elle serait ré-analysée à chaque passe, indéfiniment.
- **MediaPipe calculait déjà les boîtes de visage, et Juno les jetait.** Vérifier ce que le worker renvoie avant d'ajouter un modèle.
- Une **fonction asynchrone passée à `waitForFunction`** renvoie une promesse, toujours vraie : l'attente d'un import doit être menée côté Node.
- **face-api ne démarre pas dans un Web Worker** sans qu'on lui fournisse son environnement : il teste `isBrowser()` et `isNodejs()` et échoue sur les deux. Voir `setEnv` dans `face-embed-worker.ts`. Sans cela, chaque empreinte échoue en silence.
- Le chemin des modèles se construit avec `new URL("./", document.baseURI)` : `document.baseURI` seul désigne `index.html`, pas son dossier.
- Le GPU divise le coût d'une empreinte par près de trois (127 ms contre 358) : le worker tente `webgl` avant `cpu`.
- Les **bases `result.db` des projets Aftershoot de Johan** (`~/AfterShoot Projects`) contiennent ses décisions de dédoublonnage sur 10 010 photos réelles : c'est le seul jeu de référence disponible pour régler les seuils. Les bases `cull_*.db` sont chiffrées, et les originaux sont sur une carte SD absente. Toujours lire ces fichiers **en copie**.
- Le **catalogue vit dans IndexedDB `juno-studio-v1`**, store `photos` : c'est le seul moyen de lire l'état réel depuis un paquet, les sources TypeScript n'étant pas servies.

## Ce que la 0.8.0 a ajouté, le 23 septembre 2026

Trois chantiers livrés et prouvés dans l’interface puis dans un fichier exporté. Lire `GUIDE-V080.md` et `VALIDATION-V080.md`.

1. **Poignées de transformation dans l’aperçu.** La limite « la poignée règle la position, pas la taille ni la rotation » est levée : trois poignées (déplacer, redimensionner, pivoter), au clavier comme à la souris, Échap pour annuler, un glissement = une modification pour Annuler. Code : `src/video/transform.ts`, `MotionHandle.tsx`, `titleBounds` dans `title-render.ts`.
2. **Plafond de taille des textes lié au format.** Le plafond fixe de 240 px bridait la 4K et la 6K ; il vaut maintenant la moitié de la hauteur de séquence, sans jamais descendre sous 240. Changé ensemble dans `transform.ts`, `TitlesPanel.tsx`, `CaptionStyles.tsx`, `caption-presets.ts` et le validateur `electron/video/model.cjs` (`titleSizeLimit`). Un seul de ces endroits oublié et l’export part en erreur de validation.
3. **Masques avec suivi automatique.** Nouvel onglet Masques : flou, pixelisation ou cache plein, ovale ou rectangle, contour doux, repères de position interpolés, et un suivi hors ligne qui remplit ces repères. Code : `src/video/masks.ts`, `MaskPanel.tsx`, `MaskLayer.tsx`, `electron/video/masks.cjs` (chaîne FFmpeg), `electron/video/track.cjs` (suivi), job `track` dans `electron/video/index.cjs`.
4. **Relief 3D à plat** des titres, formes et cartouches : profondeur, direction, lumière, couleur des flancs (`depth` sur `Title`, rendu dans `drawTitle`).

Pièges rencontrés, à ne pas redécouvrir :

- Le FFmpeg fourni est LGPL : **pas de `boxblur` ni de `libx264`**. Utiliser `gblur`, `pixelize` et `h264_videotoolbox` pour fabriquer des fixtures.
- Dans ce FFmpeg, `crop` n’a plus d’option `eval` : ses `x` et `y` sont déjà évalués à chaque image.
- Les masques sont appliqués **avant** que le plan reçoive son alpha, sinon l’overlay détruirait les fondus du plan.
- Les formes de masque sont des PNG produits par le renderer et transmis à l’export par `maskImages` ; un export sans ces images est refusé plutôt que rendu sans masque.
- Une expression FFmpeg est imbriquée par image clé : la trajectoire d’un suivi est simplifiée (Douglas-Peucker) et bornée à 240 repères, sinon le filtre devient ingérable.
- Une coupe de plan ne doit pas recopier la clé voisine : `retimeMask` insère la position interpolée au nouveau bord.
- Un export refuse une source vidéo dont le profil couleur n’est pas confirmé (`api.space`) : tout scénario de test qui exporte doit le confirmer d’abord.

## Version livrée dans les sources

`package.json` annonce **1.1.0**, et c'est la version **installée** dans `/Applications` depuis le 27 septembre 2026, à la demande de Johan : notarisée, les 4 contrats passés sur l'application installée, catalogue sauvegardé avant dans `~/Library/Application Support/Juno Studio Backups`. L'IA locale n'y est plus : elle se réinstalle depuis le pilote. Archives notarisées ARM et Intel et archive Windows dans `release/v1.1.0/`. L'installateur exige Node 24 et refuse de remplacer une application ouverte : fermer Juno, puis `PATH=/Users/johan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH node scripts/install-mac.mjs`. L’installateur exige Node 24 : le Node système du terminal de Johan est en 20, il faut donc préfixer le PATH (`PATH=/Users/johan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH node scripts/install-mac.mjs`).

La 0.7.1 avait ajouté : La 0.7.1 ajoute : transcription Whisper locale avec vrais repères estimés par mot ; sous-titres karaoké ou un mot à la fois ; couleur du mot actif et presets sociaux ; correction manuelle des repères, autosauvegarde et annulation ; déplacement des éléments graphiques à la souris ou aux flèches, avec annulation/rétablissement ; conversion des repères et des images clés lors d’un changement de cadence ; horloge d’animation conservée entre les mots et les segments d’export ; images de texte recadrées et exports karaoké par blocs plus courts. Voir `GUIDE-V071.md` et `VALIDATION-V071.md` pour les commandes utilisateur, les preuves et les limites.

Le test de production de six secondes à 1080p, avec titre, flèche animée, sous-titres karaoké et voix nettoyée, passait de 126 942 ms à 20 271 ms après optimisation, sur ce Mac chargé par d’autres applications. Les pixels exportés confirment un mot jaune à 1,2 s et 2 s, absent pendant la pause à 1,6 s (`work/refonte-v071/export-pixels.json`). Le parcours Electron n’a relevé aucune erreur JavaScript ni débordement horizontal (`work/refonte-v071/ui-report.json`). La première suite complète a réussi : 80 tests Vitest + 45 tests natifs. Les contrôles ciblés ont été relancés après les optimisations. Le matériel Windows et Mac Intel n’a pas été testé physiquement ici.

## Architecture à lire en premier

- `src/video/VideoStudio.tsx` : état du montage, autosauvegarde, undo/redo, export et outils.
- `src/video/types.ts`, `edit.ts`, `Timeline.tsx`, `Preview.tsx` : modèle séquence et interface.
- `src/video/TranscriptPanel.tsx`, `caption-timing.ts`, `CaptionStyles.tsx`, `CaptionWords.tsx`, `caption-presets.ts`, `title-render.ts`, `TitleCanvas.tsx` : transcription et sous-titres.
- `src/video/TitlesPanel.tsx`, `MotionControls.tsx`, `MotionHandle.tsx`, `motion.ts` : titrage et motion design.
- `src/video/AudioMixer.tsx`, `VoiceEnhance.tsx` : mixage et traitement vocal.
- `src/assistant/video-actions.ts` : commandes vidéo textuelles.
- `electron/video/index.cjs` : API IPC, jobs durables, import, transcription, export.
- `electron/video/transcript-words.cjs`, `model.cjs`, `render.cjs`, `motion.cjs`, `engine.cjs`, `store.cjs` : validation et moteurs natifs.
- `server/review` : portail client ; `server/team-server.mjs` et `server/local-service.mjs` : équipe.
- `tests` : suites unitaires et natives ; `work/refonte-v071/ui.cjs` : scénario Electron avec profil temporaire.
- `scripts/package.mjs` et `scripts/install-mac.mjs` : fabrication Mac ARM, Mac Intel, Windows et installation Mac sécurisée.

## Environnement et commandes

Utiliser Node 24 dans `/Users/johan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin`. Exemple :

```sh
cd /Users/johan/Documents/Codex/2026-09-22/ridge-2/outputs/juno-studio
export PATH=/Users/johan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH
npm run build
npm test                # les 389 tests, rapides et natifs
npm run test:modeles -- <photo d'une personne>   # contrats des modèles, quelques minutes
npm run package:mac
npm run package:mac-intel
npm run package:win
```

Le Node système 20 ne convient pas à `node:sqlite`. Les tests natifs et l’export demandent les binaires déjà présents dans `native`. Le script d’installation Mac refuse de remplacer une application Juno ouverte ; il sauvegarde le catalogue et conserve les fichiers de l’utilisateur. Vérifier l’état réel de l’installation avant de la lancer à nouveau. Pour tout scénario destructif, commencer par les fixtures et un profil temporaire. La QA Electron testée est `node work/refonte-v071/ui.cjs` depuis le dossier parent `ridge-2`.

## Travail restant et décisions

La version ne reproduit pas encore tous les outils de Lightroom, Photoshop, Resolve, Premiere ou After Effects. La 3D réelle (modèles importés, caméra), les expressions, les infographies pilotées par données, les plugins audio avancés et les commandes texte/voix universelles restent des chantiers. Le suivi automatique existe depuis la 0.8.0 mais ne suit qu’une translation, sur une taille de masque constante, et n’a été mesuré que sur des sujets de synthèse. Les sous-titres d’anciens SRT n’ont pas de temps par mot : ils restent affichés par phrase. Les repères Whisper sont des estimations à contrôler pour voix superposées, bruit et noms propres. Le rendu de certains effets doit encore être évalué sur du vrai 4K/6K, du Log/RAW et des montages longs, y compris multicaméra. L’import de formats courants fonctionne selon les moteurs présents, mais ne promettre aucun codec universel sans matrice de tests. Les profils Juno d’Aftershoot ne doivent être importés qu’après localisation et vérification des fichiers par Johan.

**Johan a répondu le 23 septembre 2026 sur la 3D : « les deux »**, relief d’abord puis import de modèles 3D. Le relief est livré en 0.8.0 ; l’import de modèles 3D (glTF/OBJ, caméra animée, éclairage) reste entièrement à faire et demande un vrai moteur de rendu : ne pas le présenter comme commencé.

Le même jour, Johan a demandé, dans cet ordre de citation : masques et floutage suivi (livré en 0.8.0), commandes texte et voix étendues, tri et retouche d’album photo sur gros volumes, fiabilité 4K/6K et montages longs avec une vraie matrice de tests codecs. Les trois derniers ne sont pas commencés.

## Discipline de reprise

Lire les guides et le code avant de modifier. Respecter l’autorisation déjà donnée pour continuer le développement, sans redemander un « go » de principe. Protéger les originaux et le catalogue. Prouver chaque fonctionnalité par un test pertinent, puis un parcours Electron isolé et un rendu réel quand l’effet concerne l’export. Être honnête sur les limites et sur ce qui n’a été testé que sur Mac ARM. Conserver les preuves et mettre à jour ce document lors de chaque nouvelle version.

## État final de la livraison 0.8.0

Le 23 septembre 2026, la suite complète passe : **95 tests Vitest et 52 tests natifs**, zéro échec. Le parcours Electron de la 0.7.1 a été rejoué intégralement sur cette version sans erreur JavaScript ni débordement, export réel compris. Les nouveaux parcours `transform-ui.cjs`, `mask-ui.cjs` et `depth-ui.cjs` de `work/refonte-v072` prouvent chaque fonction dans l’interface puis dans les pixels d’un fichier exporté. Aucun fichier du catalogue utilisateur n’a été touché.

L’application **0.8.0 est installée** dans `/Applications/Juno Studio.app` : elle passe `codesign --verify --deep --strict`, et son `app.asar` porte la même empreinte SHA-256 que le paquet testé, `12d6706226ee73deb25307cc243ccd8f572355b3dc8add96088d9604eea1d4da`. Un démarrage sur profil temporaire a chargé Montage, affiché l’onglet Masques, exposé l’API de suivi et trouvé le moteur FFmpeg 9.0.2 disponible (`installed-smoke.json`, `installed-0800.png`).

Le catalogue utilisateur est identique avant et après l’installation : 27 entrées, 257 originaux, 2,7 Go. Le service local d’équipe est resté actif et répond toujours `setupRequired: true` : son activation demande les identifiants de Johan et n’a pas été faite.

## État final de la livraison 0.7.1

Le 23 septembre 2026, les trois paquets `release/v0.7.1/Juno Studio-darwin-arm64`, `Juno Studio-darwin-x64` et `Juno Studio-win32-x64` ont été fabriqués. L’application Mac ARM est installée dans `/Applications/Juno Studio.app`, affiche la version 0.7.1 et passe `codesign --verify --deep --strict`. L’empreinte SHA-256 du `app.asar` installé correspond au paquet testé : `a5e204303db7bf00a1d48c9cbba5a1fb8d19760bb1f71cf59cd40df481a98ae4`. Le script de comparaison a trouvé **392 fichiers utilisateur identiques** avant et après l’installation (`work/refonte-v071/catalog-before.json`, `catalog-after.json`). Un démarrage de l’application installée dans un profil temporaire a confirmé l’ouverture de Montage et de l’API vidéo sans erreur JavaScript (`installed-smoke.json`).

Le service local répond à `http://127.0.0.1:8787/health` avec `ok: true` et `setupRequired: true` lors de cette passation. Il fonctionne, mais son administrateur doit encore terminer l’activation dans l’interface si cela est nécessaire pour l’usage équipe. Ne pas inventer de mot de passe ni déclarer l’activation déjà faite. L’adresse administrateur voulue par Johan dans l’historique est `contact@studio-juno.fr` ; ne pas inscrire de secret dans les sources ou la conversation.

## Lot 1 de la version 1.0, livré le 23 septembre 2026

Six fonctions construites sur des filtres FFmpeg déjà compilés : atténuation automatique de la musique sous la voix, suppression des blancs, normalisation du niveau à la livraison, vingt-six transitions, débruitage, stabilisation et ralentis fluides.

Trois choses à savoir avant d'y toucher :

1. **Le rendu se fait par segments de 250 images.** Tout filtre temporel y repart de zéro. C'est pourquoi l'atténuation est une enveloppe calculée sur le temps absolu et non un `sidechaincompress`, et pourquoi les filtres temporels reçoivent six images de préchauffage (`cleanup.cjs`, `lead()`).
2. **`atadenoise` ne fait rien avec ses réglages d'origine** : +0,1 dB mesuré. Les seuils ouverts de `cleanup.cjs` lui font gagner 5,4 dB pour le même prix. Ne pas les « simplifier ».
3. **Les transitions passent par un `xfade` entre noir et blanc** posé en couche alpha. Le blanc 8 bits vaut 1020 en 10 bits, pas 1023 : la normalisation qui suit l'`alphamerge` n'est pas cosmétique, sans elle chaque plan avec transition reste 0,3 % plus sombre pour toujours.

Le niveau de livraison se pose dans `finishRender`, sur le film entier, jamais par segment.

Preuves et captures : `work/lot1-v100/`. Mesures détaillées : `VALIDATION-V100.md`.

## Signature et notarisation

Le certificat **Developer ID Application: Juno (542CN5886Z)** est installé et la chaîne de signature est prouvée : 34 binaires sur 34, exécution durcie partout. La notarisation est **bloquée chez Apple** : le compte de Johan n'est pas activé pour App Store Connect, et le service de notarisation s'authentifie à travers lui. Marche à suivre et diagnostic complet : `NOTARISATION.md`. Ne pas rechercher une cause locale, il n'y en a pas.

## Lot 2, livré le 23 septembre 2026 : le style appris depuis Lightroom

`src/modules/xmp.ts` lit les fichiers `.xmp` d'un dossier retouché et en tire le style du photographe. Mesuré sur l'album réel de Johan : l'écart avec ses vraies retouches passe de 38 à 10, sur des photos jamais vues pendant l'apprentissage.

Trois décisions à ne pas défaire :

1. **La netteté n'est pas transposée.** Lightroom pose 40 d'origine sur tout fichier brut et la règle avec quatre paramètres liés. La constance d'un photographe autour de 38-39 n'est pas un choix.
2. **La balance des blancs non plus.** Lightroom l'écrit en kelvins absolus avec `WhiteBalance="Custom"` : sans la balance d'origine du boîtier, le décalage appliqué est indéterminable.
3. **Un réglage que Juno calcule lui-même (exposition, hautes lumières, ombres, chaleur, teinte) n'est écrasé que s'il est invariable chez le photographe.** Sinon il est laissé à la mesure de l'image. La liste est `COMPUTED` dans `xmp.ts`.

Deux bornes protègent l'apprentissage : `SIGNATURE_VARIATION` (en deçà, un réglage est constant) et `BIAS_MAX_VARIATION` (au-delà, la médiane ne décrit plus qu'un hasard). Sans la seconde, un dossier mélangeant plusieurs mariages fabriquait un « style » qui n'était celui de personne.

L'outil de mesure est `work/lot2-v100/ecart-lightroom.cjs`. Il apprend sur une partie de l'album et juge sur une autre : ne jamais le laisser noter le logiciel sur ses propres exemples d'apprentissage.

Piège d'interface rencontré : `AlbumAction` n'est monté qu'en mode **compact**. Tous ses blocs `{!compact && ...}` sont du code mort dans la disposition actuelle.

## Lot 2 bis : le rendu appris des photos livrées, et la règle qui prime

`src/modules/look.ts` mesure le rendu de photos déjà livrées et sert de cible de couleur. C'est le seul chemin pour un photographe sans fichiers Lightroom.

**La règle la plus importante de ces deux lots, trouvée en mesurant :** un réglage que Juno calcule lui-même ne prend jamais la valeur de Lightroom, même constante. Transposer « Ombres +21 » gagnait 13 points sur l'écart aux réglages et en perdait 0,056 sur l'écart au rendu réellement livré. Un même nom ne désigne pas le même algorithme dans deux logiciels.

**Quand les deux mesures se contredisent, le rendu décide.** C'est lui que le client voit.

Trois choses à ne pas défaire dans `look.ts` :

1. **La luminosité n'est jamais visée.** Les sept mariages de Johan vont de 0,329 à 0,612 de luminosité médiane : ce sont les lieux, pas le style. La viser dégradait le résultat.
2. **La visée s'ajoute, elle ne remplace pas** (`combineLook`). Écraser la balance des blancs déjà calculée dépassait la cible du double.
3. **L'amortissement de 0,7 est mesuré**, pas confortable : une correction calibrée sur des photos livrées porte 1,42 fois plus loin sur une photo qui sort du boîtier.

Electron rend ses images en BGRA : `learnLookFromImages` remet le rouge à sa place, et un test le vérifie.

## Lot 3 bloqué sur une licence

Le plan annonçait CLIP ViT-B/32 « MIT ». C'est faux : le code d'OpenAI est MIT, le modèle déclare tout déploiement hors de son cadre, et les conversions ONNX ne déclarent aucune licence. Ne pas l'embarquer. Alternatives et arbitrage à demander à Johan : voir `PLAN-V100.md`.

## Lot 3 : la recherche par le sens, avec SigLIP 2

`src/modules/semantic.ts` et son travailleur indexent chaque photo pendant la passe d'album, et `App.tsx` cherche en français quand on valide par Entrée.

**Le modèle est SigLIP 2 de Google, Apache 2.0, et surtout pas CLIP d'OpenAI** : la carte officielle de CLIP exclut explicitement tout déploiement, commercial ou non, et les conversions ONNX qui circulent ne déclarent aucune licence. SigLIP 2 est en plus multilingue, donc le français passe sans traduction. 412 Mo dans `public/models/siglip2`, empreintes dans son `LICENCE.txt`.

Trois pièges rencontrés, tous silencieux :

1. **Les vignettes sont des URL `data:` que `fetch` ne peut pas lire** sous la politique de sécurité de l'application. Utiliser `thumbnailBitmap` de `thumbnail-bitmap.ts`, jamais `fetch` directement.
2. **Le premier appel charge 378 Mo** : il a son propre délai (`DELAI_PREMIER_APPEL`). Avec le délai d'une image ordinaire, la première demande échouait et l'album entier repartait sans index.
3. `dtype: "quantized"` n'existe pas dans transformers.js, c'est `"q8"` ; et le tokeniseur veut une longueur de contexte explicite (64 pour SigLIP).

**Le format q8 a été retenu contre les formats rapides, et il ne faut pas le « optimiser ».** Mesuré : fp16 et q4f16 sur processeur graphique indexent en 15 minutes au lieu de 90, mais ne placent la bonne photo en tête qu'une fois sur quatre au lieu de trois. Quantifier les deux tours pareil ne corrige rien. Et sur q8, WebAssembly bat le processeur graphique (1 077 ms contre 1 231).

Ce que le modèle sait : le sujet d'une photo. Ce qu'il ne sait pas : un détail du fond, un texte dans l'image, l'identité d'une personne. Mesuré : « une mariée en robe de dentelle tenant un bouquet » sort en 1re place, « une porte en bois verte » (le fond de la même photo) en 20e.

## Lot 4 : le détourage au clic, livré le 26 septembre 2026

**SlimSAM** (Apache-2.0, 38 Mo) : un clic sur une personne, et la retouche ne touche qu'elle. Mesuré dans l'application : le sujet gagne +27,5 niveaux, le fond ne bouge pas d'un seul. MODNet avait été rejeté en regardant ses masques (troués sur un couple, informes sur un groupe) ; BiRefNet ne démarre pas ici.

Trois défauts de branchement le rendaient inutilisable sans lever d'erreur, tous dans `subject-worker.ts` : logits seuillés comme des booléens, embeddings de position perdus, fausse image de 1 pixel au clic. Voir `REGISTRE-MODELES.md`. Contrat : `tests/modeles/verif-detourage.cjs`.

## Lot 5 : trois pièges de signature macOS

1. **On ne peut pas signer dans `~/Documents`.** macOS y pose `com.apple.provenance` et codesign refuse de sceller les bundles auxiliaires. `scripts/package.mjs` signe donc dans un dossier temporaire, puis livre une archive.
2. Ce n'est pas l'attribut qui gêne : après `ditto` codesign accepte malgré sa présence, après `cp -R` il refuse.
3. Un `.app` recopié dans un dossier protégé reprend `com.apple.FinderInfo` **sur ses dossiers** de frameworks. Un balayage qui ne regarde que les fichiers passe à côté. Le livrable est une archive, ce qui règle le problème et correspond à ce qu'Apple demande.

Le message « resource fork, Finder information, or similar detritus » ne nomme ni le fichier ni l'attribut : chercher avec `find -type d -print0 | xargs -0 xattr -l`.
