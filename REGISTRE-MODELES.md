# Registre des modèles

Chaque modèle embarqué dans Juno Studio, ce qu'il fait, et surtout **comment il peut échouer sans rien dire**. C'est la forme de panne qui a coûté le plus cher : sur les 26 et 27 septembre 2026, six défauts ont été trouvés dans les modèles, et **aucun ne levait d'erreur**.

La règle qui en découle : un modèle se vérifie en regardant ce qu'il rend (le masque, le cadre, le son livré), jamais seulement en constatant qu'il a répondu.

## Lancer les contrats

```bash
npm run test:modeles -- /chemin/vers/une-photo-de-personne.jpg
```

Une seule photo suffit : une personne en pied, cadrée au centre. Le lanceur en fabrique le reste (un plan 16/9 où elle est à droite, un rush où l'on applaudit à 8 s, une photo de groupe de cinq bustes). Chaque contrat lance la vraie application sur un profil jetable ; l'application refuse de démarrer s'il visait vos vrais projets.

Pour vérifier ce qu'on livre plutôt que les sources, ajoutez `JUNO_TEST_EXEC="/chemin/Juno Studio.app/Contents/MacOS/Juno Studio"`.

Pour vérifier aussi l'envoi à Lightroom, ajoutez `JUNO_RAWS=/chemin/vers/un/dossier/de/RAW` : trois RAW y sont **copiés** dans un dossier jetable avant l'essai. Ce contrat écrit des fichiers .xmp à côté des originaux ; il ne doit jamais viser le dossier d'un vrai reportage.

Ces contrats prennent quelques minutes et ne font donc pas partie de `npm test`, qui reste rapide.

---

## SlimSAM · détourage au clic

| | |
|---|---|
| Rôle | Détourer la personne qu'on désigne, pour ne retoucher qu'elle |
| Licence | Apache-2.0 |
| Poids | 38 Mo |
| Où | `src/modules/subject-worker.ts`, processeur graphique puis WebAssembly |
| Contrat | `tests/modeles/verif-detourage.cjs` : la personne s'éclaircit, le fond ne bouge pas d'un niveau |

**Pannes muettes observées**
- `pred_masks` sort en logits, et un logit négatif reste « vrai » en JavaScript : le masque prenait toute l'image. Réparé en passant par `post_process_masks`.
- Les embeddings de position étaient perdus en passant l'objet entier sous un seul nom.
- Une fausse image de 1 pixel envoyait le point cliqué dans un coin.
- Une photo pleine résolution envoyée au travailleur fermait l'application sans message.

Le symptôme commun : un message qui accusait l'utilisateur de mal viser.

## MediaPipe Face Landmarker · visages

| | |
|---|---|
| Rôle | Tri photo (yeux fermés, netteté du sujet, personnes) et recadrage vertical |
| Licence | Apache-2.0 |
| Poids | 3,6 Mo |
| Où | `public/vision-worker.js`, processeur central |
| Contrats | `tests/modeles/verif-recadrage.cjs` : sur une vraie livraison, plus aucune bande noire et la personne au centre. `tests/modeles/verif-tri-groupe.cjs` : « Préparer l'album » trouve les 5 visages d'une photo de groupe, et n'invente ni clignement ni flou sur un portrait |

**Pannes muettes observées**
- **Il ne voit pas les visages petits dans le cadre.** C'est un modèle « courte portée », fait pour les portraits. Mesuré : sur un plan 16/9 où la mariée tient le tiers droit, aucun visage ; sur la moitié droite seule, le visage est trouvé. Réparé par une lecture en morceaux qui se chevauchent (`public/face-tiles.js`), faite dans le travailleur lui-même, pour le recadrage comme pour le tri.
- **Le tri le faisait travailler sur la vignette de 480 px.** Sur 950 photos de sept mariages réels : 169 visages trouvés, contre 1 039 sur l'image d'analyse de 1 024 px relue par morceaux. La résolution seule n'apporte rien (170) ; ce sont les morceaux qui paient. Sur la vignette, un sourire plissé passait pour des yeux fermés dans près d'une alerte sur deux.
- **Deux images envoyées pendant son chargement le faisaient échouer** (`Identifier 'i' has already been declared`) : chaque message relançait `importScripts`. Le tri photo n'envoyait qu'une image à la fois et ne l'a jamais déclenché. Réparé en mémorisant le chargement.

**Depuis la 1.2.1, ce n'est plus cette mesure qui juge un visage flou** : voir « Netteté des visages » plus bas. Elle ne sert plus qu'à classer les images d'une même rafale, où les visages ont la même taille. Ce qui suit reste vrai pour ce classement.

**Le piège qui aurait fait une régression** : la même netteté de visage vaut 2,5 fois moins à 1 024 px qu'à 480, et le verdict « visage flou » repose sur un seuil absolu calibré sur les vignettes. Les visages sont donc cherchés à 1 024 px, mais leur netteté est mesurée à l'échelle de 480 px, réduite comme `resizeRaster` réduit les vignettes (bilinéaire sans préfiltre : un lissage propre ôterait le crénelage sur lequel le seuil a été calibré), puis recalée par `CALIBRATION_NETTETE` = 1,85. Ce facteur est mesuré sur 60 photos floutées à cinq degrés : de 1,8 à 1,9, 2 désaccords sur 254 visages, aucun flou manqué ; il s'explique par le bruit JPEG de la vignette, qui faisait un plancher sous les visages flous. À ne pas changer sans refaire cette mesure.

**Faux visages connus** : relue par morceaux, l'image fait parfois inventer un visage au détecteur (une épaule, un arrière de tête, un nuage). Aucun seuil de taille ne les écarte ; ils coûtent au pire une photo « à vérifier ».

## face-api · empreinte des visages

| | |
|---|---|
| Rôle | Reconnaître une même personne d'une photo à l'autre |
| Licence | MIT |
| Poids | 6,2 Mo |
| Où | `src/modules/face-embed-worker.ts` |
| Contrat | aucun pour l'instant |

**Panne muette plausible** : si le modèle ne charge pas, la reconnaissance retombe sur une signature géométrique, bien moins fiable, avec un simple avertissement en console. Rien ne le dit à l'utilisateur.

## SigLIP 2 · recherche par le sens

| | |
|---|---|
| Rôle | Chercher « mariée qui rit », « première danse » en français |
| Licence | Apache-2.0 |
| Poids | 393 Mo |
| Où | `src/modules/semantic-worker.ts`, WebAssembly (plus rapide que le processeur graphique en q8, mesuré) |
| Contrat | aucun pour l'instant |

**Pannes observées à l'intégration** : le premier appel charge 378 Mo et dépassait le délai prévu pour une image ; le découpeur de texte exige une longueur maximale explicite ; le nom du format quantifié est `q8`, pas `quantized`.

## Whisper base · transcription

| | |
|---|---|
| Rôle | Transcrire discours et témoignages, mot à mot |
| Licence | MIT |
| Poids | 141 Mo |
| Où | binaire natif, `native/models/ggml-base.bin` |
| Contrat | aucun pour l'instant |

## Qwen3 4B · formulations libres du pilote

| | |
|---|---|
| Rôle | Comprendre une consigne que le lecteur de consignes ne reconnaît pas |
| Licence | Apache-2.0 |
| Poids | 2,5 Go, **téléchargé à la demande depuis la 1.1.0** |
| Où | `llama-server`, modèle dans le dossier de l'utilisateur |
| Contrats | `tests/commandes-geometrie.test.ts` (aucune des 33 tournures mesurées ne le réveille), `tests/model-download-native.test.cjs` (empreinte, reprise, disque plein), `tests/planner-install-native.test.cjs` |

**Pannes observées**
- Il était réveillé par **toute** erreur du lecteur, y compris pour une consigne comprise mais impossible (« redresse de 2 degrés », avant que le redressement existe), et mettait plusieurs secondes à la reformuler vers une action qui n'existe pas. Réparé par une erreur `Refus` que le pilote rend telle quelle. Depuis la 1.2.0, « redresse », « redresse de 2 degrés à gauche » et « redressement 1,5 » sont compris sans lui.

Il pesait 70 % de l'application pour ne servir qu'en dernier recours ; c'est pourquoi il n'est plus embarqué. L'adresse de téléchargement vise un commit figé, et le fichier n'est mis en place qu'une fois son empreinte vérifiée.

## RNNoise · débruitage de la voix

| | |
|---|---|
| Rôle | Nettoyer une voix enregistrée dans le bruit |
| Licence | modèle non soumis au droit d'auteur, selon son auteur |
| Poids | 296 Ko |
| Où | filtre `arnndn` de FFmpeg, `native/models/juno-voice.rnnn` |
| Contrat | tests natifs du son |

## ebur128 · sonie et moments forts

Pas un modèle mais une mesure normalisée, rangée ici parce que deux fonctions en dépendent : la normalisation de sonie et la détection des moments forts.

| | |
|---|---|
| Contrats | `tests/moments-native.test.cjs` sur le vrai FFmpeg, `tests/modeles/verif-moments.cjs` dans l'application |

**Le choix à ne pas défaire** : un moment fort se juge contre son propre contexte (médiane glissante sur 30 s), pas en sonie absolue. Sinon le détecteur désigne le set du DJ à chaque fois et rate les applaudissements qui suivent un discours calme.

## Redressement par les lignes

Pas un modèle mais un détecteur géométrique écrit pour Juno (`src/modules/level.ts`). Aucun modèle publié ne faisait mieux : ceux qu'on a mesurés se trompent de 0,9 à 3° en médiane, plus que la correction utile (Aftershoot corrige de 0,66° en médiane).

| | |
|---|---|
| Rôle | Mesurer l'inclinaison d'une photo, la poser seule quand c'est sûr, la proposer sinon |
| Où | `src/modules/level.ts`, calculé dans `image-worker.ts` à l'import, environ 100 ms par photo |
| Version | `VERSION_NIVEAU` = `lignes-v1` : la changer fait remesurer les albums |
| Contrats | `tests/level.test.ts` (façades de synthèse, redressement puis remesure), `tests/modeles/verif-redressement.cjs` : trois façades fabriquées, la passe d'album pose la première, laisse la deuxième, propose la troisième, et l'aperçu redressé n'a aucun coin vide |

**Ce qu'il rend, mesuré sur 300 RAW de l'album Audrey-Ann et Clément par la chaîne de l'application** : posé seul sur 17 % des photos, proposé sur 27 %, « déjà droite » sur 4 %, abstention sur 52 %. Sur les photos posées seules, même sens qu'Aftershoot 44 fois sur 51, corrélation 0,86 ; Aftershoot corrige environ moitié moins (pente 0,56), et sur le plus gros désaccord vérifié à l'œil (1,6° contre −0,2°), c'est Juno qui a raison.

**Pannes muettes observées**
- **La médiane des angles se laisse tromper par une contre-plongée** : sur une mire tournée de 2° vue d'en bas, −0,32°. Réparé par le point de fuite des verticales (1,98°).
- **Réduire l'image par `resizeRaster` crénelle les lignes** : 9 photos « à proposer » sur 18 tombaient en abstention. Réparé par une réduction par moyenne de surface.
- **Des bords de toit ou d'auvent passent pour un horizon**, lus entre 2,9 et 3,7°. Garde : un horizon seul n'est jamais posé au-delà de 2°.
- **Le prototype ne voyait pas la même image que l'application** (aperçu de 1 620 px réduit par Lanczos, contre l'aperçu pleine taille réduit par blocs). Mesuré sur 300 photos : même palier 266 fois, angle à 0,015° près en médiane. Une réduction Lanczos dans l'application ne fait pas mieux (265) et coûte quatre fois plus.
- **Une image de test crénelée casse les lignes en morceaux** : avec 2 × 2 échantillons par pixel, une façade penchée de 2,4° ne donnait plus aucun segment. Les tests suréchantillonnent en 4 × 4, comme le rendu d'un objectif.

**Le choix à ne pas défaire** : une erreur de redressement se voit plus qu'une absence de correction. D'où l'abstention sur la moitié des photos, la proposition au-delà de 5°, et l'abstention au-delà de 10°, tenus pour voulus.

## Envoi du tri à Lightroom (.xmp)

Pas un modèle non plus, mais une écriture à côté des originaux du photographe, donc la fonction la plus risquée de Juno pour ses fichiers.

| | |
|---|---|
| Où | `electron/xmp-sidecar.cjs` (fusion pure), `electron/lightroom.cjs` (plan, écriture, annulation) |
| Contrats | `tests/lightroom.test.cjs` (11 cas : octets conservés, conflits, disque débranché, lecture seule, lien, annulation), `tests/modeles/verif-lightroom.cjs` avec `JUNO_RAWS` |

**Panne trouvée par les tests avant livraison** : quand une note posée par Aftershoot était gardée, Juno la retenait comme « la sienne », et l'écrasait au second envoi. Réparé : Juno ne retient que ce qu'il a lui-même écrit.

**Ce qui n'est pas vérifié sur un vrai Lightroom** : que la couleur en français (« Vert ») s'affiche bien avec le jeu de libellés actif, et le libellé exact du menu « Lire les métadonnées à partir des fichiers ». Le code de Lightroom le dit ; aucun catalogue jetable ne l'a encore confirmé.

## Netteté des visages

Pas un modèle : une mesure écrite pour Juno (`public/face-sharpness.js`), chargée par le travailleur de vision. Elle décide seule qu'un visage est flou depuis la 1.2.1.

| | |
|---|---|
| Rôle | Dire si le visage principal est net, à vérifier ou flou, quelle que soit sa taille |
| Où | `public/face-sharpness.js`, appelée par `public/vision-worker.js` ; seuils et règles dans `src/modules/quality.ts` (`jugementNettete`, `jugementVisage`), raisons dans `src/modules/culling.ts` (`raisonsVisage`) |
| Version | `VERSION_VISAGES` = `mediapipe-face-v5` : la changer fait relire les visages des albums |
| Contrats | `tests/face-sharpness.test.ts` (15 cas), `tests/modeles/verif-tri-groupe.cjs` exige la mesure sur le portrait et 4 visages du groupe |

**Pourquoi elle a remplacé l'ancienne** : la variance du laplacien à 480 px dépendait surtout de la taille du visage (un petit visage mesurait 7 000, un grand 1 800). Sur les 2 296 photos à visage de l'album Audrey-Ann et Clément, elle séparait les visages flous des nets moins bien que le hasard (AUC 0,455), et son seuil de 12 laissait passer des visages vraiment flous, mesurés de 38 à 116.

**Comment elle a été choisie** : quatre familles de mesure explorées en parallèle, réglées sur le matin, vérifiées sur l'après-midi ; 200 visages étiquetés à l'œil par trois juges indépendants (166 à l'unanimité) ; puis une vérification contradictoire sous trois angles (stabilité, contrôle à l'œil en aveugle de 154 visages, flou de synthèse). Retenue : le 95e centile du gradient divisé par l'étendue locale, dans la bande des yeux, sur une grille fixe. AUC à l'œil **0,965** [0,939 ; 0,987], contre 0,799 pour l'ancienne sur le même jeu.

**Seuils** : sous 0,262, flou (81 flous et 0 net en aveugle) ; de 0,262 à 0,27, à vérifier (9 flous, 12 nets) ; au-dessus, net. Le 5e centile des visages nets est à 0,275 : ne pas monter ces seuils.

**Domaine, à ne pas élargir sans mesurer** : l'image d'analyse de 1 024 px exactement, tirée d'une photo d'au moins 3 000 px. Depuis une petite source, la mesure baisse et des visages nets passent pour flous (simulé sur les visages jugés à l'œil : 0 sur 110 depuis 6 720 px, 3 depuis 3 072, 22 depuis 2 048, 37 depuis 1 616, l'aperçu d'un ARW Sony). Hors domaine, elle rend `undefined` et l'ancien seuil décide.

**Pannes muettes trouvées avant livraison**
- Sur la vignette de 480 px, tous les visages nets tomberaient à 0,14 : d'où la garde de taille.
- Une bande sans bord rendait 0, donc « très flou » : 4 des 5 cas de l'album étaient de fausses détections (un bâtiment). Elle rend maintenant `undefined`.
- Une boîte de visage rognée au cadre faisait glisser la bande des yeux vers le nez sur un gros plan coupé par le haut : la mesure reçoit la boîte entière des repères.
- Les raisons « à vérifier » étaient calculées sans la personne désignée, le verdict avec : une mariée floue derrière un invité net restait gardée d'office sous le verdict « Visage principal flou ». Recalculées ensemble.
- Une lecture faite sur la vignette, faute d'original, était marquée à jour pour toujours : elle porte une version distincte et sera relue.

**Limites connues** : le bruit (soirée à haute sensibilité) fait monter la mesure, donc manquer des flous, jamais créer de fausse alerte ; un visage flou très peu contrasté peut passer pour net (un plancher d'étendue plus bas le corrigerait, mais dégrade la mesure sur les vrais visages : AUC 0,915 à 1 contre 0,965 à 8) ; la bande des yeux suit la boîte, pas les repères, et une tête très inclinée peut la faire sortir des yeux. Aucun album Sony ou Fuji n'a été mesuré.


## Rafales : reconnaître, puis garder la meilleure

Pas un modèle : des règles écrites pour Juno (`src/modules/rafales.ts`), sur des signaux calculés à l'inspection (`analysis.empreinte`, dans `image-worker.ts`) et le résumé SigLIP 2 quand il existe. Depuis la 1.2.2, c'est ce qui décide quelle image d'une rafale est proposée, donc gardée par « Préparer l'album ».

| | |
|---|---|
| Rôle | Réunir les images d'une même rafale, et n'en proposer qu'une : la meilleure |
| Où | `src/modules/rafales.ts` (`empreinteDe`, `lireCR3`, `instantExif`, `grouperRafales`, `noterRafale`) ; appelé par `groupSuggestions` (`culling.ts`) ; raisons de la passe d'album dans `raisonsDePasse` |
| Version | `VERSION_EMPREINTE` = `rafale-v1` : la changer fait relire les empreintes des albums |
| Contrats | `tests/rafales.test.ts` (dont une copie du calcul du banc, qui épingle l'empreinte), `tests/modeles/verif-rafales.cjs` (une rafale de quatre vues fabriquée avec l'heure au millième dans l'EXIF : une seule proposée, la nette, et gardée) |

**Regroupement** : dans l'ordre de prise de vue, par album, modèle et numéro de boîtier, une image rejoint la rafale si elle a été prise au plus 2,5 s après sa PREMIÈRE image et si elle ressemble à la précédente sur deux signaux sur trois : SigLIP (cosinus ≥ 0,945) ou, à défaut, couleur (intersection ≥ 0,96) ; miniature grise de 48 px (corrélation ≥ 0,90 à ±2 px) ; contours (L1 ≤ 0,30). Sans empreinte (analyse ancienne), la règle de la 1.2.1 (dhash à 8 bits). Sans heure, la photo reste seule.

**Choix** : chaque personne suivie d'une image à l'autre (centre à moins d'une largeur de visage, taille de 0,6 à 1,6 fois) et comparée à elle-même : sourire, clignement, orientation, bande des yeux ; absence ; netteté décisive rapportée à la plus nette (poids 2) ; image presque noire ou brûlée (−2). Une personne désignée pèse autant que le plus grand visage.

**Mesures** (album Audrey-Ann et Clément, 3 552 RAW, réglé sur le matin) : F1 B³ 82,7 % contre 44,9 % en 1.2.1 ; 889 photos gardées pour 756 livrées (2 631 en 1.2.1) ; à l'aveugle, quand la proposée n'est pas la livrée, elle est meilleure 23 fois, équivalente 31, moins bonne 24 sur 80. Détail : `VALIDATION-V122.md`.

**Pannes muettes trouvées avant livraison**
- La meilleure image recevait la raison « Autre image de la rafale » dès qu'elle n'était pas la première : `groupId` désigne la première image, pas la gagnante (défaut hérité de la 1.2.1, 469 rafales sur 727).
- À la même seconde (RAF, analyse ancienne), l'ordre venait de l'identifiant, tiré au hasard : les rafales se coupaient différemment à chaque import.
- Les HEIC n'avaient ni heure ni rafale : l'EXIF était lu sur leur conversion TIFF.
- L'heure lue dans le fuseau du Mac confondait 2 h 30 et 3 h 30 la nuit du passage à l'heure d'été.
- « Comparer les rafales » proposait sans les personnes désignées une autre image que celle gardée.
- Après restauration d'une sauvegarde, le résumé SigLIP devenait un objet sans longueur : ni la recherche ni les rafales ne le lisaient plus, et il n'était jamais recalculé.

**Limites connues** : 16 % des images voisines de deux séries d'Aftershoot sont réunies à tort, surtout des rafales continues qu'Aftershoot coupe sans rien de visible ; les 11 vrais ratés jugés à l'aveugle sont des expressions (bouche ouverte en pleine phrase), une personne qui se détourne ou cache son visage, un œil fermé sur un visage de profil : la lecture des visages ne les voit pas ; sans heure au millième (RAF, boîtiers sans SubSecTimeOriginal), une rafale se juge à la seconde près ; aucun album Sony, Nikon ou Fuji n'a été mesuré.

## Alertes « à vérifier » du tri

Pas un modèle : des règles (`src/modules/quality.ts` : `hautesLumieres`, `peuDeDetails`, `TRES_SOMBRE` ; raisons redérivées dans `raisonsVisage`, `culling.ts`), réglées le 29/09/2026 sur le matin de l'album d'Audrey-Ann et Clément, vérifiées sur l'après-midi et à l'œil, contredites par un second agent qui a ramené le seuil du visage de 0,25 à 0,10.

| | |
|---|---|
| Hautes lumières | Luminosité > 0,94, ou plus de la moitié de l'image en blanc pur, ou un visage compté (au moins 40 % de la largeur du plus grand) dont le cœur (60 % central de la boîte) a plus de 10 % de blanc pur (`FaceRead.ecrete`, mesurée par `public/face-sharpness.js`) |
| Peu de détails | La case la plus nette d'une grille de 8 × 8 sous 150 (`Analysis.nettetePointe`), l'ancienne règle faute de mesure |
| Très sombre | Luminosité < 0,08, aligné sur « presque noire » |

**Pourquoi** : l'ancienne règle des hautes lumières signalait 49 fois sur 51 du ciel ou un fond blanc, que le RAW récupère ; « peu de détails » signalait des gros plans nets sur fond flou ; « très sombre » des soirées normales. Effet : 164 → 102 meilleures images à vérifier, 47 → 28 livrées bloquées, précision inchangée.

**Pannes muettes à connaître** : un vêtement blanc brûlé au soleil n'est plus signalé tant que le visage est intact (seul le garde-fou de la moitié de l'image le rattrape) ; le volet visage ne repose que sur un vrai cas positif de l'album de mesure, à revérifier sur un album au soleil dur ; il dépend du lecteur de visages, qui en rate sur les groupes à contre-jour.
