# Validation de Juno Studio 0.9.0

## Périmètre vérifié

- Compilation TypeScript, application Vite et portail de retours clients : sans erreur.
- Suite complète : **138 tests Vitest et 52 tests natifs**, zéro échec (95 et 52 en 0.8.0).
- Le parcours vidéo complet de la 0.7.1 a été rejoué sans erreur JavaScript ni débordement, export réel compris.
- Audit d’interface sur tous les espaces avant le chantier : zéro erreur JavaScript, zéro erreur console, aucun débordement (`work/audit-v080/audit-ui.json`).

## La mesure qui justifiait le chantier

Sur une photo réelle du catalogue et sa version floutée (gaussienne sigma 2,5) :

| Largeur d’analyse | Photo nette | Photo floue | Écart |
|---|---|---|---|
| 128 px (0.8.0) | 4 964 | 4 028 | **1,23×** |
| 1 024 px (0.9.0) | 1 126 | 66 | **17,1×** |

À 128 pixels, une photo franchement floue conservait 81 % du score d’une photo nette : le tri ne pouvait pas les distinguer.

## Preuve dans l’application, sur le paquet 0.9.0

`work/refonte-v090/culling-ui.json`, obtenu en lançant le paquet `release/v0.9.0` sur un profil temporaire isolé, avec une rafale réelle de six images de plus en plus floues :

- Netteté mesurée, du net au plus flou : **547, 424, 148, 36, 12, 4**. La décroissance est monotone et le rapport entre la plus nette et la plus floue atteint **136,8×**.
- Les six images sont analysées à 1 024 px. Les photos plus étroites que 1 024 px (683, 713, 819 px) sont mesurées à leur largeur native : elles ne sont pas ré-analysées en boucle.
- La dominante de couleur est mesurée sur toutes les photos.
- Import et analyse des six images : 1 057 ms. Zéro erreur JavaScript.

Le démarrage du paquet sur profil temporaire charge Montage, expose l’API de suivi et trouve le moteur FFmpeg 9.0.2 (`work/refonte-v072/installed-smoke.json`).

## Ce que les tests couvrent

**Tri.** Comparabilité d’une netteté selon la largeur mesurée, netteté lue dans une région et non sur le cadre, sujet défini comme le plus grand visage, netteté du sujet qui l’emporte sur celle du fond, yeux fermés pondérés par la taille du visage, sourire et visage tourné qui pèsent sans jamais décider seuls, deux images nettes qui se départagent encore, exposition ratée pénalisée mais photo volontairement sombre épargnée, phrase de verdict pour chaque cause, rafale de quarante images restée d’un seul tenant, changement de scène qui ouvre un groupe, photo protégée jamais reléguée, analyse ancienne sans détail par visage encore jugée sur son compte d’yeux fermés.

**Vitesse.** Dimensionnement des deux pools selon le nombre de cœurs, et garantie qu’ensemble ils ne réclament jamais toute la machine.

**Retouche.** Absence de correction sur une image neutre, dominante bleue réchauffée et dominante orange refroidie, correction bornée, pixels brûlés et bouchés exclus du calcul, exposition préservée sur une image volontairement sombre dont la dominante est tout de même corrigée, profil qui ne pilote qu’au-delà de douze corrections, apprentissage par médiane insensible à un album aberrant, convergence sans dépassement, scène coupée par un écart de temps ou de lumière, réglages ramenés vers la médiane sans effacer l’intention, correction comptée une seule fois, profil stocké relu et nettoyé de valeurs corrompues.

**Personnes.** Signature d’une longueur fixe, invariance à l’échelle et à la position, deux visages différents plus éloignés que le même visage deux fois, refus de signer un visage malformé, distance bornée, album de deux personnes regroupé en deux identités, profil qui rejoint une identité connue sans jamais en créer une, nom conservé pendant que le centre continue d’apprendre, priorité d’une personne nommée sur un inconnu plus grand dans le cadre, yeux fermés d’une personne nommée qui coûtent même sur un petit visage, image sans les personnes suivies qui le dit et perd du terrain.

**Commandes IA.** Les cinq nouvelles commandes reconnues, masque réellement ajouté au plan, suivi refusé sans masque, masque refusé sur une piste son, relief appliqué au seul graphique sous le curseur.

## Défauts trouvés et corrigés pendant le chantier

- Un test existant a montré qu’une analyse d’avant la 0.9.0, dépourvue de détail par visage, n’était plus jugée du tout sur ses yeux fermés. Un repli sur le compte agrégé a été ajouté et couvert.
- La première version exigeait une analyse à 1 024 px pour toutes les photos : celles qui sont plus étroites auraient été ré-analysées à chaque passe, indéfiniment. La comparabilité tient désormais compte de la largeur de la photo.
- La balance des blancs pouvait produire un zéro négatif, affiché « -0 » dans l’interface.
- Le scénario de vérification laissait passer un import inachevé : une fonction asynchrone passée à `waitForFunction` renvoie une promesse, toujours vraie. L’attente est maintenant menée côté Node.

## Reconnaissance des personnes : le modèle embarqué

La 0.9.0 embarque le réseau d'empreinte faciale de face-api (ResNet-34 dérivé de dlib, 6,15 Mo, licence MIT côté bibliothèque). Provenance et repli : `THIRD-PARTY-FACES.md`.

Mesures faites dans l'application installée, sur de **vrais visages** extraits des projets Aftershoot de Johan, lus en lecture seule :

- Le même visage, posé sur trois fonds différents, obtient une distance moyenne de **0,141**.
- Deux personnes différentes sont à **0,768**.
- Le seuil de reconnaissance est 0,6 : la marge est de 4,3 fois d'un côté et de 1,3 fois de l'autre.
- Six photos, six visages, **six empreintes calculées, zéro erreur** (`work/refonte-v090/faces-in-app.json`).

Sur 120 visages réels et 7 140 paires, le modèle produit des distances allant de 0,061 à 0,967 : il discrimine réellement, là où la géométrie donnait un continuum étroit. **Ces 120 visages n'étaient pas étiquetés** : impossible d'en tirer un taux d'erreur, seulement la preuve que le signal existe.

Coût mesuré : **127 ms par visage sur le GPU**, contre 358 ms sur le processeur. Le worker tente le GPU puis retombe sur le processeur. Seuls les visages d'au moins 0,4 % du cadre sont décrits, au plus quatre par photo : décrire tous les invités d'un mariage coûterait des heures pour rien.

## Le seuil de rafale, réglé sur les albums de Johan

Les 27 bases `result.db` d'Aftershoot ont été lues en copie : 10 010 photos, 2 157 groupes de doublons, 5 211 paires consécutives. Leur écart médian est d'une seconde, de trois secondes au 95e centile et de huit au 99e.

Le seuil initial de trois secondes ne gardait que **95,6 %** des paires groupées ; huit secondes en gardent **99,1 %**. Corrigé, testé, livré. La similarité visuelle reste exigée en plus du temps.

## Défauts trouvés pendant l'intégration du modèle

- **face-api refuse de s'initialiser dans un Web Worker** : il cherche un navigateur ou Node et ne trouve ni l'un ni l'autre. L'environnement (OffscreenCanvas, fetch) doit lui être fourni explicitement. Sans cela, chaque empreinte échouait en silence.
- Le chemin des poids était construit sur `document.baseURI`, qui désigne `index.html` et non son dossier : le modèle n'était jamais trouvé.
- Ces deux pannes étaient **invisibles** : la reconnaissance se dégradait sans rien dire. Le panneau des personnes affiche désormais la raison, et des compteurs de diagnostic sont exposés pour la recette.
- Le scénario de recette concluait avant la fin du calcul, les empreintes arrivant après les visages.

## L'aperçu intégré des RAW, mesuré sur de vrais CR3

Mesure faite le 23 septembre 2026 sur six fichiers de l'album « Audrey-Ann et Clément » (3 552 CR3 Canon, 119 Go), lus en lecture seule par un serveur local, dans un Electron sur profil temporaire (`work/refonte-v090/raw-bench.json`).

| | Aperçu intégré | Décodage complet |
|---|---|---|
| Temps moyen par fichier | **86 ms** | 2 053 ms |
| Définition obtenue | 6 720 × 4 480 | 6 742 × 4 498 |
| Fichiers lisibles | **6 sur 6** | 6 sur 6 |

**Le gain est de 23,9 fois**, et l'aperçu n'est pas une vignette : c'est un JPEG à la définition quasi complète, à 22 pixels près. Rapporté à l'album entier, l'analyse passe d'environ **2 heures à 5 minutes**.

Le chemin utilisé est celui de la 0.9.0, inchangé (`src/modules/raster.ts`, `decodeRawPreview`). Zéro erreur, zéro repli sur le décodage complet.

Réserve à garder en tête : cet aperçu est **le rendu du boîtier**, style d'image Canon appliqué. Il convient au tri, à l'affichage et à la mesure de netteté. Il ne peut pas servir de base à une retouche RAW, qui continue de passer par le décodage complet en 16 bits.

## Limites de validation

Exécution et parcours réalisés sur macOS ARM uniquement. Les paquets Mac Intel et Windows sont produits mais n’ont pas été lancés sur ces machines.

Aucun catalogue utilisateur n’a été modifié : tous les scénarios utilisent des profils temporaires et des fixtures créées puis supprimées. Une photo du catalogue a été lue en copie, en lecture seule, pour la mesure de netteté.

Le gain du décodage par aperçu intégré est désormais **mesuré sur de vrais Canon CR3** : voir la section ci-dessous.

La reconnaissance des personnes a été vérifiée sur de vrais visages, mais **pas sur un album complet de mariage** : ni le taux de faux regroupements, ni la tenue sur des profils marqués ou des visages semblables n'ont été mesurés, faute d'étiquettes. La retouche apprise n’a pas encore vu de vraies corrections de Johan : le mécanisme est testé, le style ne l’est pas.

## Livraison et installation

Les paquets Mac ARM, Mac Intel et Windows x64 sont dans `release/v0.9.0`. Sur ce Mac ARM, la **0.9.0 est installée** dans `/Applications/Juno Studio.app` : elle passe `codesign --verify --deep --strict` et son `app.asar` porte la même empreinte SHA-256 que le paquet testé, `e049abdacb0590832f2d121680fe1ce35e47183e126e0cf7ec5ddd0726693954`. Le modèle d'empreinte faciale est bien présent dans le paquet (`dist/models/face-api`).

Vérifications faites sur l’application installée, chacune sur un profil temporaire isolé :

- Démarrage : Montage se charge, l’onglet Masques est présent, l’API de suivi répond, le moteur FFmpeg 9.0.2 est disponible, zéro erreur JavaScript.
- Tri : la rafale de six images donne **547, 424, 148, 36, 12, 4**, soit une discrimination de **136,8×**, avec la dominante de couleur mesurée partout et zéro erreur JavaScript.
- Vidéo : le parcours complet de la 0.7.1 rejoué sans erreur ni débordement, export réel compris.

Le catalogue utilisateur est inchangé : 257 originaux, 2,7 Go. Le service local d’équipe est resté actif et signale toujours `setupRequired: true` ; son activation demande les identifiants de Johan et n’a pas été faite.
