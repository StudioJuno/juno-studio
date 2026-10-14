# Validation de la 1.1.0

Mesuré le 27 septembre 2026 sur le Mac ARM de Johan. Chaque essai a tourné sur un profil jetable ; les vrais projets n'ont pas été touchés (aucun fichier du dossier de travail modifié depuis le 23 septembre).

## Les tests

| Suite | Résultat |
|---|---|
| `npm test` (rapides + natifs) | **389 tests au vert** : 268 + 121 |
| `npm run test:modeles` sur les sources | **4 contrats sur 4** : détourage 69 s, recadrage 65 s, moments 18 s, tri photo 42 s |

Avant cette version, `npm test` ne lançait que 215 des 308 tests existants.

**Les 4 contrats ont aussi été passés sur le paquet livré, puis sur l'application installée dans /Applications.** Livraisons : Mac ARM et Mac Intel notarisés, agrafés et réarchivés après agrafage (609 et 625 Mo), Windows archivé non signé (704 Mo). La 1.1.0 est installée sur le Mac de Johan depuis le 27 septembre 2026, catalogue sauvegardé avant.

## Garde des vrais projets

Application lancée en mode essai **sans** profil jetable :

- elle refuse de démarrer, code de sortie 9, avec le message « Cet essai allait écrire dans les vrais projets (…/Application Support/Juno Studio) » ;
- le dossier de travail réel n'a reçu aucun fichier.

Ce lancement visait réellement le vrai dossier : `os.homedir()` ignore `$HOME` sur macOS, et changer `$HOME` ne suffisait pas à l'en détourner. 9 tests natifs couvrent la décision.

## Recadrage vertical

Plan 16/9 d'essai, la mariée dans le tiers droit, séquence 1080×1920, bouton **Recadrer**, puis **vraie livraison FFmpeg** mesurée :

| Bande de l'image livrée | Avant | Après |
|---|---|---|
| haut | 0 | 27 |
| bas | 0 | 146 |
| gauche | 0 | 139 |
| droite | 9 | 107 |
| centre | 28 | 105 |

Avant : les bandes noires de la mise au format, et un centre qui ne montre que le fond. Après : plus aucune bande, la mariée au centre. Plan : échelle 5, position horizontale −1,56 (le cadre part chercher la mariée à droite), en 1,2 seconde. La bande du haut à 27 est le fond gris du film d'essai, pas une bande de rendu.

**Deux défauts du détecteur de visages trouvés en route**

- Sur l'image 16/9 entière, **aucun visage** ; sur sa moitié droite, **un**. Le modèle est fait pour les portraits. Réparé par la lecture en tuiles.
- `Identifier 'i' has already been declared` dès que plusieurs images arrivaient pendant le chargement. Réparé.

Une échelle retouchée à la main passe le plan en « Réglé à la main », et un second clic sur **Recadrer** ne la défait plus : vérifié dans l'application par le contrat du recadrage, et par 2 tests du choix par plan. Avant ce correctif, le second clic repassait tout sur le couple.

Géométrie : 16 tests, dont une vérification qui **inverse le filtre du rendu** plutôt que de répéter la formule. Application au plan : 6 tests (ralenti, images clés croissantes, limite de 32, autres animations conservées). Tuiles : 6 tests.

## Moments forts

Sur le **vrai FFmpeg embarqué**, 7 tests natifs, dont :

- des applaudissements après un calme sont trouvés, au bon endroit ;
- **une musique forte d'un bout à l'autre n'en produit aucun** (le cas du DJ) ;
- un cri au milieu d'une musique forte ressort quand même ;
- deux salves rapprochées ne font qu'un moment, un claquement de 0,15 s aucun.

Dans l'application, sur un rush où l'on applaudit de 8 à 10,5 s : **un moment trouvé de 7,7 à 10,9 s**, relief 25 LU ; le bouton « 1 moment fort · assembler » pose un plan qui commence à **5,2 s**, soit 2,5 s avant le pic, et dure 6,7 s. Les silences sont toujours relevés dans la même passe.

## Les visages du tri photo

Mesuré sur **950 photos de sept mariages réels** (les albums publics de wearejuno.fr/mariage), en reproduisant la chaîne de l'application : vignette de 480 px et image d'analyse de 1 024 px fabriquées par le code de `resizeRaster`, à partir des originaux.

| | Avant | 1.1.0 |
|---|---|---|
| Visages trouvés | 167 | **1 059** |
| Photos avec au moins un visage | 139 | **534** |
| Photos signalées « yeux fermés » | 0 | 10 |
| Temps par photo et par voie | 16 ms | 96 ms |

**Pourquoi 1 024 px et des morceaux, et pas autre chose** (première mesure, 5 configurations) : à 1 024 px sans morceaux, 170 visages, la résolution seule n'apporte rien ; à 480 px avec morceaux, 991 visages mais une alerte « yeux fermés » sur deux était fausse (un sourire plissé) ; à 1 600 px, moins de visages qu'à 1 024 (1 014) et plus lent.

**Justesse des alertes « yeux fermés », vérifiée visage par visage** sur la planche des découpes : à 1 024 px avec morceaux, 12 justes sur 15 (rires, regards baissés, clignements) ; les 3 fausses sont des visages imaginés par le détecteur, une épaule et un arrière de tête, et un homme aux yeux ouverts.

**La calibration de netteté.** La même netteté de visage vaut 2,5 fois moins mesurée à 1 024 px : brancher l'image d'analyse tel quel aurait déclaré flous des visages nets. Elle est donc mesurée à l'échelle de 480 px, puis recalée par un facteur mesuré sur 60 photos floutées à cinq degrés (0, 2, 4, 8 et 16 px) :

| Facteur | Désaccords sur le verdict « visage flou » (254 visages) |
|---|---|
| 1,0 | 10 |
| 1,5 | 5 |
| **1,8 à 1,9** | **2** |
| 2,0 à 3,0 | 2 à 3, dont des flous manqués |

Retenu : 1,85. Les 2 désaccords sont deux visages floutés à 16 px que l'ancien disait nets de justesse (13,2 et 12,6 pour un seuil à 12). Aucun flou vu par l'ancien n'est manqué. Sur les photos nettes, livrées, aucun verdict ne change : 134 sujets sur 134.

**Dans l'application**, contrat `verif-tri-groupe.cjs` : « Préparer l'album » trouve les **5 visages sur 5** d'une photo de groupe où l'ancien tri n'en trouvait aucun, et juge le portrait « Visage net et souriant », sans faux clignement.

**La pondération des visages dans la note** : 5 tests, dont le cas qui la motive (sur un plan moyen, un invité du fond qui cligne coûte moins de 3 points ; la mariée qui cligne, plus de 25).

## Le pilote comprend la géométrie

Les 33 tournures mesurées le 26 septembre : **aucune ne réveille plus l'IA locale**. 32 sont exécutées ; « redresse de 2 » est comprise et refusée tout de suite. 11 tests couvrent les rotations, les formats, et le cas d'une photo tournée où un 16/9 doit rester un 16/9 à l'écran.

## Une application trois fois plus légère

| | 1.0.0 | 1.1.0 |
|---|---|---|
| Application installée | 3,3 Go | **1,0 Go** |
| Archive à télécharger | 3,03 Go | **635 Mo** |
| Modèles embarqués | 2,6 Go | 148 Mo |

**Installation de l'IA locale, sur le paquet livré** :

- avant : absente, et le pilote la propose ;
- pendant : « 0,1 Go sur 2,5 Go · Interrompre » ;
- **2 497 280 256 octets en 45 s**, empreinte SHA-256 vérifiée, mise en place ;
- puis « rends-la un peu plus chaude, façon coucher de soleil » reçoit en 30 s la proposition **« Augmente la chaleur de 5 »**, présentée pour validation.

Constantes vérifiées : l'empreinte du fichier local est celle attendue ; l'adresse réelle répond 206 avec une taille totale de 2 497 280 256 octets, accepte la reprise, et ses 8 premiers Mo sont identiques au fichier local. Téléchargeur : 7 tests contre un serveur local (fichier altéré jeté, coupure puis reprise, serveur qui ignore la reprise, disque plein annoncé avant de commencer, fichier trop gros refusé). Emplacement et désinstallation : 5 tests, dont « on ne retire jamais la copie de l'application ».

## Ce qui n'a pas été vérifié

- **Mac Intel et Windows** : construits et, pour Intel, notarisés, mais pas lancés sur une machine Intel ou Windows.
- **Des rushes de mariage réels** : les films d'essai sont fabriqués à partir d'une vraie photo, avec un visage réel, mais pas tournés en conditions réelles (mouvement, contre-jour, groupes).
- La calibration de netteté est mesurée sur des originaux de 2 560 px. Sur des originaux d'appareil de 6 000 px, l'ancienne vignette était encore plus crénelée ; la nouvelle chaîne, elle, ne dépend plus de la résolution de l'appareil.
