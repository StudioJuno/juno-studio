# Plan : le dérushage automatique

Rédigé le 1er octobre 2026 (décisions de Johan intégrées le même jour, partie 9), à la demande de Johan : « analyser tous les rushes, mettre en non visible les moments flous, bougés ou inutilisables, et classer les rushes, pour gagner un maximum de temps au montage ». **Accord de Johan (« go ») le 1er octobre ; ce qui est construit et les écarts au plan sont dans la partie 11.**

Il s'appuie sur trois analyses de l'existant (architecture vidéo, contraintes et décisions passées, mesures de vitesse sur ce Mac). Les chiffres viennent de mesures faites le 1er octobre sur des films d'essai : elles sont à refaire sur de vrais rushes (voir la partie 6).

---

## 1. Ce que vous obtenez

**À l'import, sans rien faire de plus**, Juno regarde chaque rush et le découpe en passages :

- **bons** : visibles normalement ;
- **à vérifier** : visibles, avec une pastille et la raison (« bougé léger », « un peu flou ») ;
- **masqués** : cachés par défaut, avec leur raison (« flou », « bougé », « noir », « image figée », « surexposé », « déclenchement »). Rien n'est supprimé : un clic les remontre.

**Dans la bibliothèque**, chaque rush affiche une bande colorée (ses bons et ses mauvais passages), sa durée utile (« 4 min 12 utiles sur 6 min »), et ses étiquettes de classement :

- **le moment** : les rushes sont regroupés en blocs de la journée d'après leur heure de tournage, et chaque bloc reçoit un nom proposé (Préparatifs, Cérémonie, Le couple, Réception, Soirée pour un mariage ; les chapitres du type de projet sinon), que vous renommez ;
- **le plan** : gros plan, plan moyen, plan large, sans visage ;
- **le mouvement** : fixe, mouvement maîtrisé (panoramique, travelling, drone), à la main ;
- **la parole** : rush avec voix (discours, interview) ou sans ;
- **la caméra** : Sony, Canon, drone, téléphone…

On filtre d'un clic : « les plans larges de la cérémonie, sans les passages masqués ».

**Trois gestes qui font gagner le temps :**

1. **Ajouter un rush** à la timeline n'ajoute que ses bons passages, à la suite (réglable : « le rush entier »).
2. **« Pré-monter »** : une nouvelle séquence avec tous les bons passages, dans l'ordre de la journée, un repère par moment. C'est le bout-à-bout de départ : il ne reste qu'à choisir et raccourcir.
3. **« Retirer les passages inutilisables »** sur des plans déjà posés, comme « Retirer les blancs » aujourd'hui, en une seule annulation.

Et le pilote : « dérushe les rushes », « montre les plans larges de la cérémonie », « pré-monte la soirée ».

**Vos décisions priment toujours** : un passage que vous avez remontré ou masqué à la main ne bouge plus, même si l'analyse est refaite (même règle que les statuts des photos).

---

## 2. Ce qui existe déjà et qu'on réutilise

| Existant | Où | Ce qu'on en garde |
|---|---|---|
| Aperçu de chaque rush, 960×540, Log déjà développé en Rec.709, instants de la source conservés | `electron/video/engine.cjs` (`proxy`) | L'analyse lit l'aperçu, ou se greffe sur sa fabrication |
| Analyse des scènes, silences, moments forts | `electron/video/index.cjs` (`doAnalyze`), `moments.cjs` | Même file de tâches, mêmes patrons (mesure FFmpeg lue en flux, plages, bouton « assembler ») |
| « Retirer les blancs » | `src/video/edit.ts` (`silenceCuts`, `removeSilence`, `closeGap`) | Le modèle exact de « Retirer les passages inutilisables » |
| Visages (MediaPipe) appliqués aux images de film | `src/modules/culling.ts` (`analyzeFacesOn`), `src/video/reframe-scan.ts` | Le type de plan (taille et nombre des visages) |
| SigLIP 2, compris en français, et les 9 « moments » déjà écrits | `src/modules/semantic.ts` (`MOMENTS`, `classifyMoment`, jamais branchés) | Nommer les blocs de la journée, et la recherche par phrase dans les rushes |
| Chapitres par type de projet | `src/model.ts` (`PROJECT_TYPES`, `chaptersFor`) | Les noms proposés pour les blocs |
| Transcription (whisper) | `index.cjs` (`doTranscribe`) | La parole, plus tard le texte |
| Tâche de fond qui cède la place aux tâches demandées | `index.cjs` (`healProxies`, `pump`, `makeWay`) | Le dérushage ne retarde jamais un export |
| La méthode de validation du tri photo | `COMPARAISON-AFTERSHOOT.md`, `VALIDATION-V122.md` | Mesurer contre ce que vous avez vraiment monté |

**Ce qui n'existe pas** et qu'il faut créer : aucune mesure de flou, de bougé, de noir ou d'image figée en vidéo ; aucune notion de passage masqué, ni de point d'entrée et de sortie sur un rush ; aucun moniteur source. C'est le gros du travail d'interface.

---

## 3. Comment ça marche

### 3.1 Une seule lecture de chaque rush

Une commande FFmpeg (filtres présents dans le FFmpeg LGPL livré, vérifiés) lit l'image une fois et en tire, image par image :

| Mesure | Filtre | Sert à repérer |
|---|---|---|
| Flou | `blurdetect`, `siti` (détail spatial) | flou, mise au point ratée |
| Luminance (moyenne, hautes et basses lumières), différence d'une image à l'autre | `signalstats` | noir, surexposé, sous-exposé, image figée |
| Noir | `blackdetect` | cache d'objectif, noir |
| Changement de plan | `scdet` | coupes à l'intérieur d'un rush |
| Mouvement de la caméra | miniatures grises 96×54 à pleine cadence, corrélation de phase en Node | bougé, mouvement brusque, panoramique |
| Son : sonie, silences, écrêtage | `ebur128`, `silencedetect`, `astats` | parole, saturation (le son ne masque jamais l'image) |

**Ce que ça coûte, mesuré :**

- **Greffée sur la fabrication de l'aperçu** (à l'import) : de 0 à 0,4 s de plus par minute de rush. Presque gratuit.
- **Sur un aperçu existant** (rushes déjà importés) : 4 s par minute de rush, soit environ 13 min pour 3 h de rushes.
- **Mouvement** : environ 1 s de calcul par minute de rush.
- Relire les originaux 4K à la place serait 6 à 8 fois plus lent : on lit l'aperçu.

**Ce que les mesures ont montré sur un rush d'essai** (7 défauts fabriqués) : les sept sont nettement lisibles. Bougé et panoramique se distinguent sans ambiguïté par la régularité du mouvement et le nombre d'inversions de sens (bougé : 14 à 17 inversions par seconde ; panoramique : aucune).

### 3.2 Des règles lisibles, pas une boîte noire

Comme pour le tri photo, des règles simples, chacune avec sa raison affichée, réglées sur vos vrais rushes :

| Raison | Règle de départ (à calibrer) | Verdict |
|---|---|---|
| Noir | `blackdetect`, ou luminance très basse sur au moins 0,3 s | masqué |
| Image figée | aucune différence d'une image à l'autre pendant au moins 0,5 s | masqué |
| Flou | flou nettement au-dessus de **la norme de ce rush** et détail en chute, pendant au moins 0,7 s | masqué ; à vérifier si léger |
| Bougé | tremblement fort, mouvement irrégulier (inversions répétées), pendant au moins 0,5 s | masqué ; à vérifier si léger |
| Mouvement brusque | déplacement très rapide et saccadé | à vérifier (souvent voulu) |
| Surexposé | hautes lumières écrêtées sur une grande part de l'image pendant au moins 1 s | à vérifier |
| Déclenchement | début et fin de rush agités (appui sur le bouton) | masqué |
| Rush accidentel | rush de moins d'une seconde | masqué |

Deux principes tirés des mesures :

- **Le flou se juge par rapport au rush lui-même.** Le flou « normal » varie de 4,7 à 7,5 d'un plan à l'autre ; un seuil fixe se tromperait. Même leçon que la netteté des visages photo.
- **Prudent par défaut.** Un passage court entre deux mauvais devient « à vérifier » plutôt que masqué. Un réglage « Prudent / Normal / Strict » change la sévérité.

### 3.3 Le classement : des signaux fiables d'abord, l'IA pour nommer

L'essai de SigLIP seul, sans apprentissage, est faible : 51 % de bons « moments » sur 45 images (le hasard donne 11 %), 38 % sur la valeur de plan, et il ne sait pas reconnaître un défaut. On ne lui confie donc pas le classement seul :

| Classement | Signal principal | Fiabilité attendue |
|---|---|---|
| Moment de la journée | **l'heure de tournage** : les rushes sont regroupés en blocs (une pause de plus de 20 min ouvre un bloc) ; SigLIP propose un nom par bloc en votant sur toutes ses images, vous renommez | bonne pour les blocs ; nom proposé, à confirmer |
| Plan | **les visages** (nombre et taille dans l'image) | bonne avec visages ; « sans visage » sinon |
| Mouvement | **la mesure du mouvement** (§ 3.1) | bonne |
| Parole | silences et sonie, puis la transcription si vous la lancez | bonne pour « voix ou pas » ; whisper confond une chanson et un discours (mesuré) |
| Caméra | métadonnées et nom des fichiers | bonne |

**En prime, avec les mêmes calculs** : la recherche par phrase dans les rushes (« la mariée qui descend l'escalier »), notée « non commencée » dans `PLAN-V100.md`.

**La vitesse de SigLIP est le point dur** : 1 s par image dans l'application aujourd'hui (une seule voie de calcul), soit environ 1 h 30 pour 3 h de rushes à une image toutes les 2 s. Avec le moteur ONNX natif (onnxruntime-node, licence MIT, 43 Mo), mesuré à 40 ms par image : **environ 4 min**. Johan l'a accepté (partie 9) ; il devrait aussi accélérer la recherche photo (les essais restent à faire de bout en bout).

---

## 4. L'interface

- **Bibliothèque, mode « Dérush »** (un nouveau composant, pas dans `VideoStudio.tsx`, déjà trop gros) :
  - une ligne par rush : vignette, bande colorée des passages, durée utile, étiquettes ;
  - filtres en pastilles : Qualité (bons seulement / tout), Moment, Plan, Mouvement, Parole, Caméra ;
  - un clic sur un passage le lit dans un petit lecteur (l'aperçu) ; boutons « Garder », « Masquer », « Remontrer » ;
  - « Afficher les passages masqués » pour tout revoir ;
  - « Pré-monter » (toute la sélection filtrée ou un moment).
- **Ajouter à la timeline** : les bons passages, en plans consécutifs.
- **Inspecteur d'un plan** : « Retirer les passages inutilisables », à côté de « Retirer les blancs ».
- **Activité** : la tâche « Dérushage » avance en fond, cède la place à vos exports, reprend où elle s'est arrêtée.
- **Pilote** : quelques consignes (voir partie 1).

---

## 5. Données et performances

- **Sur le média** (dans `catalog.json`) : seulement le résultat compact : `asset.derush = { version, aperçu analysé, plages [début, fin, état, raisons], classement, décisions de l'utilisateur }`. Quelques kilo-octets par rush.
- **Dans le cache du média** (`cache/<id>/`) : les relevés image par image en binaire compact (environ 0,9 Mo par heure) et les images clés pour le classement. Rien de lourd dans le catalogue, qui est réécrit en entier à chaque modification.
- **Un champ à part** : `asset.derush`, jamais dans `asset.analysis`, que « Analyser les scènes » remplace d'un bloc.
- **Une constante de version** (`VERSION_DERUSH`) : la changer fait refaire l'analyse, jamais vos décisions.
- **Reprise** : l'analyse range ses relevés par tranche ; une tâche interrompue ou qui cède sa place reprend à la tranche suivante (aujourd'hui une tâche de fond repart de zéro).
- **Si l'aperçu change** (profil Log confirmé, aperçu refait), l'analyse est refaite pour ce rush.
- **Temps** : les instants viennent de l'aperçu, qui garde ceux de la source, cadence variable comprise ; on lit le temps de chaque image, jamais un numéro d'image multiplié par la cadence.

**Ordre de grandeur pour 3 h de rushes 4K** : analyse comprise dans la fabrication des aperçus à l'import ; environ 13 min pour des rushes déjà importés ; classement environ 4 min avec le moteur ONNX natif (environ 1 h 30 sans).

---

## 6. Comment on saura que ça marche

La méthode qui a fonctionné pour le tri photo, transposée :

1. **La référence, c'est votre montage.** Sur un ou deux mariages déjà livrés dont les rushes sont encore sur disque, on lit le projet de montage (Premiere, Final Cut ou DaVinci : export XML) pour savoir quels passages de rushes vous avez réellement utilisés. Lecture seule de vos disques, comme pour l'album photo.
2. **Le chiffre qui compte : ce que Juno masquerait de ce que vous avez monté.** Il doit être quasi nul (objectif : moins de 1 % de la durée montée). Le second chiffre : la part masquée de l'ensemble (le temps gagné).
3. **Réglage sur un mariage (ou une moitié de journée), vérification sur l'autre**, jamais sur les mêmes images.
4. **À l'œil et à l'aveugle** : un échantillon de passages masqués présenté en planches, jugé par trois relecteurs (et par vous si vous le souhaitez) : « inutilisable » ou « utilisable ».
5. **Un contrat** dans `npm run test:modeles` : un rush d'essai fabriqué avec ses sept défauts, passé dans la vraie application, qui doit les retrouver à 0,2 s près.
6. **Tests unitaires** des règles et du découpage, tests natifs de la passe FFmpeg, relecture contradictoire de chaque lot.

---

## 7. Les lots, dans l'ordre

| Lot | Contenu | Livrable vérifiable |
|---|---|---|
| **0. Banc et réglages** | Banc reprenable qui passe vos rushes réels (Sony, Canon, DJI) en lecture seule ; premiers réglages à l'œil ; plus tard, comparaison à vos projets de montage | Un rapport chiffré : part masquée, part à vérifier, planches à l'aveugle (et, quand un projet sera fourni, masqué parmi le monté). **Rien dans l'application à ce stade.** |
| **1. Moteur** | `electron/video/derush.cjs` (mesures, mouvement, règles, découpage), tâche « Dérushage » de fond, greffe sur la fabrication de l'aperçu, rangement, reprise, version | Tests unitaires et natifs ; le contrat des sept défauts |
| **2. Interface** | Mode « Dérush » de la bibliothèque, lecteur de passage, décisions, ajout des bons passages, « Pré-monter », « Retirer les passages inutilisables », pilote | Parcours réels dans l'application, captures, une annulation par geste |
| **3. Classement** | Blocs de la journée, plan, mouvement, parole, caméra, noms proposés par SigLIP ; recherche par phrase dans les rushes | Mesure sur vos mariages : blocs justes, plans justes |
| **4. Validation et livraison** | Passe sur des mariages entiers, relecture contradictoire, guides, paquet, notarisation | Les chiffres de la partie 6, sur le paquet livré |

Le lot 0 décide de la suite : si les planches montrent que les règles masquent des plans utilisables, on corrige avant d'écrire la moindre interface.

---

## 8. Points de blocage et parades

| Risque | Pourquoi | Parade |
|---|---|---|
| **Masquer un plan voulu** : flou artistique, bascule de mise au point, filé volontaire, fumée, stroboscopes de soirée, contre-jour | Ces effets ressemblent à des défauts | Jugement relatif au rush ; prudent par défaut ; « à vérifier » plutôt que masqué ; rien n'est supprimé ; mesure contre votre montage réel (partie 6) |
| **Pas de référence pour l'instant** | Sans vos montages passés, les seuils sont réglés à l'œil | Planches à l'aveugle sur vos rushes réels ; seul l'inutilisable évident est masqué tant que la mesure contre un vrai montage n'est pas faite (partie 9) |
| **Flous fins invisibles sur l'aperçu** | L'aperçu fait 960×540 | La v1 vise l'inutilisable évident ; un contrôle fin sur l'original pourra venir après, rush par rush |
| **macOS 26 obligatoire** | FFmpeg et whisper livrés sont construits pour macOS 26 au minimum (non documenté jusqu'ici) | Le dérushage aura la même limite que le montage tant que FFmpeg n'est pas recompilé (tâche déjà proposée) |
| **Windows et Mac Intel** | Jamais lancés ; les filtres du FFmpeg Windows ne sont pas vérifiés | Vérifier les filtres Windows au lot 1 ; annoncer « essayé sur Mac à puce Apple » |
| **Une seule file de tâches** | Imports, aperçus, exports et analyses passent un par un | Tâche de fond prioritaire en dernier, reprise par tranche, greffe à l'import pour ne rien relire |
| **Catalogue réécrit en entier** | `catalog.json` est réécrit à chaque modification, progression comprise | Relevés dans le cache, résultat compact, progression écrite moins souvent |
| **Classement par l'IA faible** | 51 % sur les moments, 38 % sur les plans en zéro-shot | Signaux fiables d'abord (heure, visages, mouvement, son) ; l'IA ne fait que proposer un nom de bloc |
| **SigLIP lent dans l'application** | Une seule voie de calcul : 1 s par image | Moteur ONNX natif, accepté (partie 9) ; à vérifier sur Windows et Mac Intel, qui demandent leurs propres binaires |
| **Heures de tournage fausses** | Horloges des caméras non réglées, fuseaux | Regroupement par caméra puis recalage par le son (la synchro multicaméra existe) ; vous pouvez déplacer un rush d'un bloc à l'autre |
| **Aucun moniteur source aujourd'hui** | On ne choisit un passage qu'en posant le rush entier | Le lecteur de passage du mode Dérush (lot 2) ; c'est le plus gros chantier d'interface |
| **RED R3D et Blackmagic RAW** | Pas lus par Juno | Hors champ : à transcoder avant, comme aujourd'hui |
| **Son inutilisable mais image bonne** (vent, saturation) | Fréquent sur les plans d'illustration | Le son ne masque jamais l'image : étiquette « son à vérifier » seulement |

---

## 9. Décisions prises par Johan (1er octobre 2026)

1. **La référence** : pas de projet de montage disponible pour l'instant ; Johan pourra en ajouter plus tard. Conséquences :
   - le lot 0 se fait sur de **vrais rushes sans projet** (un dossier de rushes Sony, Canon et DJI, en lecture seule), réglés à l'œil sur des planches à l'aveugle, plus le contrat des défauts fabriqués ;
   - **jusqu'à la mesure contre un vrai montage, seul l'inutilisable évident est masqué** (noir, image figée, déclenchement, rush accidentel, flou ou bougé très forts) ; tout le reste est « à vérifier » ;
   - le jour où un projet est fourni, le banc mesure ce que Juno aurait masqué de ce qui a été monté, avant de rendre le réglage plus sévère.
2. **Les caméras prioritaires** : Sony (FX3, FX30, A7S, S-Log3), Canon (R5, R6, C70, C-Log) et drone DJI. Points d'attention :
   - un rush Log dont le profil n'est pas confirmé a un aperçu non développé, plat : le jugement relatif au rush le supporte, et l'analyse est refaite quand le profil est confirmé (l'aperçu change) ;
   - le drone : longs mouvements réguliers, souvent sans son, horizon qui tourne ; il doit sortir « mouvement maîtrisé », jamais « bougé » (cas à mettre dans le contrat).
3. **Un passage douteux** reste visible, avec la pastille « à vérifier » et sa raison.
4. **Le moteur ONNX natif** (onnxruntime-node, MIT, 43 Mo) est accepté pour le classement et la recherche dans les rushes.

**Ce qu'il faut de Johan pour démarrer le lot 0** : un dossier de rushes réels, même sans projet, d'un ou deux tournages (Sony, Canon, drone), qui restera lu en lecture seule.

## 10. Ce qui n'est pas dans la v1

- Choisir à votre place la meilleure prise d'un même moment parmi plusieurs (à partir de la v1, on pourra le mesurer contre vos montages).
- Le choix de l'angle en multicaméra.
- Un montage « narratif » complet : la v1 donne un bout-à-bout propre, pas un film.
- Le contrôle fin de la mise au point sur l'original 4K/6K.

---

## 11. Ce qui est construit (1er octobre 2026)

Lots 1 et 2 construits, lot 3 en partie. Rien n'est encore livré : pas de paquet, pas d'installation (à demander à Johan).

### Le moteur (`electron/video/derush.cjs`)

- **Une lecture de l'aperçu par tranches de 3 min** (1 s relue avant chaque tranche), rangées dans le cache du média dès qu'elles sont lues : une analyse qui cède sa place à un export ou que la fermeture interrompt reprend à la tranche suivante. Mesuré : **4,3 à 5,6 s par minute de rush** sur ce Mac (environ 15 min pour 3 h de rushes), en tâche de fond qui cède toujours la place.
- **Deux versions** : `VERSION_MESURE` (la lecture) et `VERSION_REGLES` (les règles). Changer les règles refait le découpage depuis les relevés gardés, sans relire un rush. Les décisions de l'utilisateur et le type de plan survivent à toute relecture.
- **Une tâche de fond séparée, pas une greffe sur la fabrication de l'aperçu** (écart au plan, partie 3.1) : la fabrication des aperçus est le chemin le plus délicat de l'app (pistes son, profils Log, réparations au démarrage), et la greffe ne faisait gagner que les 5 s par minute du dérushage. La tâche part seule après un import, après un aperçu refait et à l'ouverture d'un projet (une fois par session) ; un dérushage annulé n'est pas relancé à l'ouverture.

### Ce que les mesures ont changé au plan

| Règle du plan | Ce qui est construit | Pourquoi |
|---|---|---|
| Image figée masquée | **Pas cherchée.** Remplacée par « rien ne bouge depuis plus de 2 min », à vérifier | L'encodeur de l'aperçu efface le bruit du capteur : une image figée et un plan sur pied d'un objet immobile (les alliances sur la table) donnent les mêmes mesures (0,001 à 0,035). Une caméra ne fige pas son image ; une caméra oubliée en marche, si. |
| Flou fort masqué | Masqué seulement **passager** (moins de 8 s) et **à côté d'un passage net du même plan** (moins de 3 s, sans coupe entre les deux) ; sinon à vérifier | Sur le film de mariage publié, un plan volontairement flou (silhouettes derrière des herbes) était masqué. Le flou artistique tenu, la brume, le ciel restent visibles. |
| Mouvement de la caméra sur l'image entière | **Six zones**, le mouvement retenu est celui sur lequel elles s'accordent | Un jongleur filmé sur pied devant un décor à rayures passait pour un bougé fort. |
| Coupes (`scdet`) | Détectées par deux signes à la fois : corrélation perdue et différence d'image trois fois la normale | Un plan pauvre en détails (ciel) perd aussi la corrélation ; un mouvement rapide fait aussi monter la différence. |
| Noir | Luminance au ras du noir **et aucune lumière** dans l'image | Une soirée sombre traversée de projecteurs, un feu d'artifice. |

### Le banc (lot 0, sans vrais rushes)

Banc reprenable dans le dossier de travail de la session (`derushage-mesures/banc-derush.cjs`) : aperçu fabriqué par le vrai moteur, puis relevés et règles.

- **Rush d'essai d'une seule prise** (60 s, sept défauts fabriqués) : bougé masqué à 100 %, flou fort masqué à 90 % (ses bords en fondu « à vérifier »), noir 100 %, surexposé « à vérifier » 100 %, flou léger « à vérifier » 96 % ; le panoramique et l'image figée restent bons. **Son jumeau propre : 100 % bon.**
- **Films publiés de Juno** (5 films montés, 3 min 12) : **aucun passage utilisable masqué** ; seuls de vrais noirs (fondus au noir) le sont. « À vérifier » de 0 à 14 % selon le film (plans volontairement doux).
- **Plans types** : drone (panoramique lent qui tourne), main posée, marche modérée : rien de masqué. Marche très secouée (±60 px à 2 Hz) : masquée en entier.
- Ce banc ne remplace pas les vrais rushes : **le réglage reste à faire sur des rushes Sony, Canon et DJI de Johan** (partie 9).

### L'interface (lot 2)

- **Onglet « Dérush »** : les rushes, par blocs de la journée (une pause de plus de 20 min ouvre un bloc), chacun avec sa bande de passages (bons, à vérifier en ocre, masqués hachurés), sa durée utile, son type de plan, son mouvement et sa caméra ; filtres. **Lecteur de passage** : lit le passage et s'arrête à sa fin (ou en boucle), « Garder », « Masquer », « Rendre à l'analyse », « Ajouter », « Suivant à revoir » ; clavier : espace, flèches, G, M, A (les raccourcis du montage n'y agissent pas).
- **Ajouter un rush** (clic, double-clic, glisser) ne pose que ses morceaux utiles, et le dit ; **Maj + clic** pose le rush entier ; un rush entièrement masqué n'est pas posé, avec la raison.
- **« Pré-monter »** : une nouvelle séquence avec les morceaux utiles des rushes affichés, dans l'ordre de la journée ; la séquence en cours reste dans la liste.
- **« Retirer les passages inutilisables »** dans les réglages du plan, en une annulation, comme « Retirer les blancs ».
- **Pilote** : « dérushe les rushes », « pré-monte les rushes », « retire les passages inutilisables » (ou « les flous et bougés »).
- **Défaut existant corrigé au passage** : une séquence neuve (copie de secours, pré-montage) n'apparaissait dans la liste des séquences qu'au chargement suivant du projet.

### Le classement (lot 3, en partie)

Construit : **type de plan** (taille des visages, relevée en fond par le détecteur du tri photo), **mouvement** (fixe, maîtrisé, à la main), **caméra** (étiquettes et noms de fichiers : Sony, Canon, DJI, GoPro, iPhone, téléphone), **heure de tournage** (lue à l'import ; pour les médias plus anciens, relue sur l'original au dérushage), **blocs de la journée**.

Pas construit, et pourquoi :
- **Les noms proposés par SigLIP et la recherche par phrase dans les rushes** : demandent le moteur ONNX natif dans l'application (un module natif de plus à signer et notariser, pour trois plateformes), pour un classement mesuré faible sans apprentissage (51 % sur les moments). À faire après le réglage sur vrais rushes, qui dira si ça vaut ce risque.
- **La parole** : demande une lecture du son ; l'analyse existante (« Analyser scènes, silences & moments forts ») la donne déjà, rush par rush.

### Ce qui reste

1. Le réglage sur de vrais rushes (lot 0 complet) : un dossier de rushes d'un ou deux tournages, en lecture seule.
2. Le lot 4 : paquet 1.4.0, notarisation, guide ; **l'installation attend l'accord de Johan**.
