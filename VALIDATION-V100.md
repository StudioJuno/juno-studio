# Validation du lot 1 de la version 1.0

## Périmètre

- **162 tests Vitest et 93 tests natifs**, zéro échec (153 et 83 avant ce lot, 144 et 52 en 0.9.0).
- Compilation TypeScript et construction du portail clients sans erreur.
- Recette d'interface sur l'application, sur un profil temporaire isolé : `work/lot1-v100/verif-ui.json`.

## Ce qui a été mesuré, et pas supposé

Toutes les valeurs ci-dessous viennent d'exécutions réelles de FFmpeg sur cette machine, le 23 septembre 2026.

### L'atténuation de la musique

Enveloppe appliquée à un ton continu, parole de 2 s à 4 s, profondeur 0,75 :

| Instant | Niveau |
|---|---|
| 0,5 s, avant | −21,07 dB |
| 1,6 s, pendant la descente | −21,86 dB |
| 2,6 s, atténuation pleine | −33,11 dB |
| 4,4 s, pendant la remontée | −21,33 dB |
| 5,2 s, après | −21,07 dB |

L'écart mesuré est de **12,04 dB**, et 20·log₁₀(0,25) vaut exactement 12,04. La musique revient à son niveau d'origine au décibel près.

Dans un rendu complet, avec musique et voix réellement mixées et la musique isolée par sa fréquence, l'atténuation mesurée est de **10,46 dB pour une profondeur de 0,7**, soit la valeur attendue.

### La détection des silences

Fichier fabriqué : 1 s de son, 2 s de blanc, 1,5 s de son. `silencedetect` rapporte le silence de **0,999977 à 3,000023**. La parole déduite est 0 à 1 s puis 3 à 4,5 s. L'écart avec la construction est inférieur à trois centièmes de seconde.

### La normalisation de livraison

Source à −30,8 LUFS, cible réseaux sociaux :

| | Niveau |
|---|---|
| avant | −30,8 LUFS |
| après | **−14,0 LUFS** |

Sur un film assemblé à partir de deux segments de niveaux différents (−20 dB et −6 dB), la cible télévision est atteinte à moins d'un LUFS près, et le fichier reste à 48 kHz.

### Le débruitage

Chaque filtre appliqué à une source propre puis bruitée, comparé à l'original :

| Filtre | Qualité rendue | Vitesse 1080p |
|---|---|---|
| départ bruité | 31,4 dB | 111 i/s sans filtre |
| `removegrain=11` | 32,3 dB (+0,9) | 125 i/s |
| **`atadenoise` par défaut** | **31,4 dB (+0,1)** | 64 i/s |
| `atadenoise` réglé | 36,7 dB (+5,4) | 66 i/s |
| `fftdnoiz` | 34,2 dB (+2,8) | 58 i/s |
| `nlmeans` | 41,2 dB (+9,8) | 1,2 i/s |

**C'est la mesure la plus utile de ce lot.** Avec ses réglages d'origine, `atadenoise` gagne un dixième de décibel, c'est-à-dire rien. Livré tel quel, le bouton « débruitage moyen » aurait été purement décoratif. Réglé, il gagne 5,4 dB pour le même prix. `fftdnoiz` est battu sur la qualité comme sur la vitesse, il n'est donc pas proposé.

Un test compare désormais chaque niveau à l'image propre et exige un gain minimal : le piège ne peut plus revenir.

### Les autres filtres

`deshake` 39 i/s, `minterpolate` 5,5 i/s, contre 89 sans filtre sur la même mesure. C'est ce qui est annoncé dans l'interface.

### Le coût des transitions

La chaîne complète, motif compris, tourne à **200 i/s en 1080p**, contre 111 pour un rendu nu. Une alpha calculée par `geq` tombait à 19,5 i/s : c'est ce qui a écarté cette approche.

## Défauts trouvés et corrigés pendant le chantier

- **`atadenoise` sans effet** avec ses réglages d'origine. Découvert en mesurant, pas en lisant la documentation.
- **Une expression d'atténuation écrite dans la mauvaise horloge.** Dans le graphe de rendu, chaque plan repart à zéro ; sans décalage explicite, l'atténuation serait tombée au mauvais endroit du montage.
- **Un sursaut à chaque frontière de segment.** Le rendu se fait par tranches de 250 images. Un filtre temporel y repart de zéro. Un préchauffage de six images a été ajouté, borné par ce que le média contient avant, et la continuité est vérifiée par comparaison avec un rendu d'une seule traite : l'écart est supérieur à 40 dB, donc les deux sont identiques à l'œil.
- **Un plan avec transition restait 0,3 % plus sombre que son voisin, pour toujours.** Le motif est calculé en 8 bits, son blanc vaut 255, qui devient 1020 en 10 bits et non 1023. L'alpha est désormais normalisée d'un facteur exact, et le test exige une égalité stricte, pas une approximation.
- **Une virgule non échappée** aurait coupé le graphe de filtres en deux. Un test l'interdit.
- **« mets un fondu » était ambigu** : ce mot désignait déjà le fondu d'entrée d'un plan. Les transitions demandent maintenant « fondu enchaîné » ou le nom du motif.
- **Le dernier blanc d'un média était perdu.** FFmpeg n'écrit pas de `silence_end` quand un fichier se termine en silence : un discours qui s'achève sur une longue pause gardait cette pause. Corrigé dans l'analyse existante.
- **Une mesure de niveau infinie** est refusée au lieu d'être propagée : `loudnorm` rapporte `-inf` sur un passage muet, et l'appliquer aurait cassé le son.

## Recette dans l'application

Sur un profil temporaire, avec deux médias fabriqués pour l'occasion, l'application a été pilotée comme Johan le ferait : import, pose des plans, sélection, ouverture des panneaux.

Les huit commandes nouvelles sont présentes et atteignables :

```
transition      ✓    nature du son   ✓
débruitage      ✓    atténuation     ✓
stabilisation   ✓    blancs          ✓
ralenti fluide  ✓    niveau livré    ✓
```

Les cinq cibles de niveau apparaissent correctement dans la fenêtre d'export. **Zéro erreur JavaScript, zéro manque.** Captures dans `work/lot1-v100/`.

## Limites

Le rendu d'un film entier avec toutes ces fonctions activées n'a pas été chronométré : les coûts annoncés viennent de mesures par filtre, pas d'un export complet.

Le débruitage fort et le ralenti fluide sont utilisables sur quelques plans, pas sur un film entier. Les chiffres le disent, l'interface aussi.

La stabilisation repose sur `deshake`, moins bon que `vid.stab`, qui reste exclu pour sa licence.

Les transitions n'ont été vérifiées en pixels que sur `wipeleft`. Les vingt-cinq autres motifs viennent du même mécanisme et sont validés par le catalogue, pas image par image.

Rien de tout cela n'a été exécuté sur Windows ni sur Mac Intel.

## Ce qui n'a pas bougé

Le catalogue de Johan est intact : 257 originaux. L'album Canon de 3 552 fichiers n'a été lu qu'en lecture seule, et sa date de modification est inchangée. Tous les scénarios utilisent des profils temporaires et des médias fabriqués puis supprimés.

# Validation du lot 2 : le style appris depuis Lightroom

## La mesure, et comment elle a été faite

L'album « Audrey-Ann et Clément » contient 3 552 CR3 Canon et 756 XMP, tous appairés. La mesure a été conduite ainsi :

1. Le style est appris sur **600 photos**.
2. Il est jugé sur **80 autres**, jamais vues pendant l'apprentissage. Noter un logiciel sur les exemples qui lui ont servi à apprendre ne prouve rien.
3. Pour chacune de ces 80, l'aperçu du CR3 est décodé, ramené à 1 024 px comme le fait Juno, et la vraie passe automatique du logiciel est exécutée dessus.
4. Sa proposition est comparée à ce que Johan avait réellement fait dans Lightroom.

Le code mesuré est celui de l'application (`auto-tone.ts`, `xmp.ts`), compilé et chargé tel quel : ce n'est pas une réimplémentation.

## Résultat, sur les réglages

Mesuré sur 60 photos jamais vues, style appris sur 600 autres.

| Réglage | Écart avant | Écart après |
|---|---|---|
| Clarté | 5 | **0** |
| Noirs | 13 | **4** |
| Vibrance | 2 | **1** |
| Contraste | 2 | **1** |

Somme des écarts, hors exposition : **41 avant, 25 après**.

Les ombres ne sont volontairement pas transposées, et c'est la découverte la plus importante de ce lot. Voir plus bas.

## La règle qui décide, et comment elle a été trouvée

**Un réglage que Juno calcule lui-même ne prend jamais la valeur de Lightroom, même quand le photographe la laisse constante.** Seuls les réglages que Juno laisse à zéro prennent la valeur apprise.

Cette règle n'a pas été posée par principe : elle a été mesurée, et elle contredit ce que j'avais livré d'abord.

La première version transposait « Ombres +21 » parce que Johan le fait sur toutes ses photos. Sur l'écart aux **réglages**, c'était le plus gros gain du lot : 13 points d'erreur ramenés à 1. Mais mesuré sur le **rendu**, en comparant l'image produite à ses albums réellement publiés, le même transfert éloignait le résultat de 0,056, à lui seul, quand les quatre autres réglages appris étaient neutres ou utiles :

| Réglage appris, appliqué seul | Effet sur l'écart au rendu livré |
|---|---|
| Ombres | **+0,056 : éloigne** |
| Noirs | 0,000 |
| Clarté | 0,000 |
| Vibrance | 0,000 |
| Contraste | −0,007 : rapproche |

L'explication est simple et vaut pour tout logiciel de retouche : **un réglage qui porte le même nom dans deux logiciels n'y fait pas la même chose**. C'était déjà la raison d'écarter la netteté ; je ne l'avais pas appliquée partout.

Et cela tranche une question de méthode : quand l'écart aux réglages et l'écart au rendu se contredisent, **c'est le rendu qui décide**. C'est lui que le client voit ; les réglages ne sont qu'un moyen.

## Défauts trouvés pendant le chantier

- **La netteté allait être apprise, à tort.** Lightroom pose 40 d'origine sur tout fichier brut : la constance de Johan à 38-39 n'était pas une décision mais un défaut d'Adobe. Et Lightroom la règle avec quatre paramètres liés que Juno n'a pas. Elle est désormais explicitement écartée, avec la raison affichée à l'écran.
- **Du bruit pur produisait un style.** Un test a montré qu'un dossier où chaque réglage prend n'importe quelle valeur donnait quand même un biais : la médiane du hasard. Une borne de dispersion a été ajoutée, et ce cas est couvert.
- **Un tableau passait pour un objet valide** dans la relecture du stockage local, donnant un style vide mais accepté. Corrigé et couvert.
- **Le composant d'album n'est monté qu'en mode compact.** Le bloc ajouté ne s'affichait donc jamais, alors que le code était juste. Trouvé par la recette d'interface, pas par les tests.

## Recette dans l'application

Sur un profil temporaire, l'application a lu le vrai dossier de Johan : **756 retouches apprises**, style enregistré correctement, zéro erreur JavaScript. Captures dans `work/lot2-v100/`.

L'album n'a pas été modifié : sa date reste celle du 22 septembre, et le catalogue de Johan conserve ses 257 originaux.

## Limites

Le style n'a été appris que sur un seul mariage. Un photographe dont la patte change selon le lieu ou la saison aurait intérêt à apprendre par dossier, ce que Juno permet mais ne fait pas automatiquement.

La conversion de la netteté et de la balance des blancs reste impossible, et c'est dit plutôt que contourné.

Le gain a été mesuré sur les réglages, pas sur des pixels : Juno et Lightroom n'appliquent pas exactement le même rendu pour une même valeur. L'écart de réglages est un indicateur honnête, pas une équivalence visuelle.

# Validation du lot 2 bis : le rendu appris des photos livrées

## Pourquoi un second chemin

Un dossier Lightroom donne les réglages appliqués. Un portfolio ne donne que le résultat. On ne peut donc pas en déduire la correction faite, mais on peut mesurer **à quoi ressemble** le rendu voulu.

Avantage décisif pour la diffusion : cela ne demande aucun fichier Lightroom, donc c'est le seul chemin pour la plupart des photographes.

## Ce que les albums publiés ont révélé

134 photos prélevées régulièrement dans les sept mariages en ligne sur wearejuno.fr.

| Mariage | luminosité médiane | chaleur | saturation |
|---|---|---|---|
| chloe-augustin | 0,612 | 0,096 | 0,245 |
| isabelle-nicolas | 0,329 | 0,022 | 0,182 |
| juliette-victor | 0,367 | 0,147 | 0,357 |
| manel-kevin | 0,500 | 0,109 | 0,311 |
| marine-raphael | 0,506 | 0,075 | 0,196 |
| mathilde-hector | 0,461 | 0,125 | 0,290 |
| sophie-frederic | 0,431 | 0,102 | 0,254 |
| **médiane générale** | **0,443** | **0,090** | **0,256** |

**La luminosité n'est pas un style.** Elle va de 0,329 à 0,612 selon le mariage : ce sont les lieux et les heures, pas la patte du photographe. La viser a été essayé et dégradait le résultat.

## Le vrai écart, mesuré sur cinquante RAW

| Mesure | Livré | Juno, passe automatique | Écart |
|---|---|---|---|
| Noirs | 0,051 | 0,055 | −0,004 |
| Médiane | 0,443 | 0,443 | **0,000** |
| Hautes lumières | 0,792 | 0,828 | −0,036 |
| Contraste | 0,649 | 0,671 | −0,022 |
| **Saturation** | **0,256** | **0,181** | **+0,075** |
| **Chaleur** | **0,090** | **0,007** | **+0,083** |

La tonalité de Juno était déjà juste. Deux écarts réels : la passe automatique **neutralisait la dominante chaude que Johan garde**, et rendait 30 % moins saturé.

## Le résultat

| Variante | Écart au rendu livré |
|---|---|
| Aperçu brut, sans rien faire | 0,535 |
| Passe automatique | 0,411 |
| Avec le style Lightroom | 0,418 |
| **En visant le rendu livré** | **0,315** |
| Les deux ensemble | 0,320 |

Après correction : chaleur **0,089 pour 0,090 visé**, saturation 0,242 pour 0,256.

## Les gains, calibrés et non estimés

Un cran de « chaleur » déplace la mesure de 0,00356, un cran de « saturation » de 0,00202, mesuré sur vingt photos livrées. D'où des gains de 281 et 496, amortis à 0,7.

L'amortissement n'est pas une marge de confort : sans lui, la correction dépassait la cible de 40 %, parce qu'une correction calibrée sur des photos déjà livrées porte plus loin sur une photo qui sort du boîtier.

## Deux défauts trouvés en mesurant

- **La visée remplaçait la balance des blancs au lieu de s'y ajouter.** Le résultat dépassait la cible du double exactement. `combineLook` rend l'addition explicite, et un test l'interdit désormais.
- **La visée se calculait sur l'image de départ et s'appliquait au résultat de la passe.** Corriger un écart mesuré ailleurs que là où on l'applique ne pouvait pas marcher, et dégradait le rendu.

## Recette dans l'application

Sur un profil temporaire, l'application a lu les deux sources : **756 retouches Lightroom** et **134 photos livrées**. Le rendu mesuré dans l'application (chaleur 0,0891, saturation 0,2542) correspond à la mesure hors ligne (0,090 et 0,256), ce qui confirme au passage que la conversion BGRA d'Electron est correcte. Zéro erreur JavaScript.

## Limites

Les deux apprentissages restent locaux et effaçables. Aucun n'est activé par défaut.

Le rendu de référence a été appris sur des photos exportées pour le web, redimensionnées et recompressées. La saturation et la chaleur y survivent ; un jugement fin du grain ou de la netteté n'y survivrait pas.

Le gain est mesuré sur des mesures d'image, pas sur un jugement d'œil. C'est un indicateur honnête, pas une équivalence visuelle.

# Validation du lot 3 : la recherche par le sens

## Le choix du modèle, et pourquoi il a changé

Le plan annonçait CLIP ViT-B/32, « MIT ». La vérification a montré que c'était faux, et que l'erreur était sérieuse pour un logiciel destiné à d'autres postes.

Le code d'OpenAI est bien sous MIT. Le **modèle** ne l'est pas : sa carte officielle écrit qu'« aucun cas de déploiement, commercial ou non, n'entre dans son cadre » et que « les utilisateurs visés sont des chercheurs en intelligence artificielle ». Les dépôts qui en distribuent une conversion ONNX ne déclarent, eux, aucune licence.

C'est la même raison qui avait fait écarter RMBG-1.4 au moment du plan.

Retenu à la place : **SigLIP 2 de Google**, licence Apache 2.0 déclarée, sans restriction d'usage. Avantage supplémentaire décisif ici : il est multilingue par construction, donc il comprend le français sans passer par une traduction.

| | Poids embarqué |
|---|---|
| Encodeur d'images | 94,6 Mo |
| Encodeur de texte | 283,4 Mo |
| Tokeniseur | 34,4 Mo |
| **Total** | **412 Mo** |

Les empreintes SHA-256 des trois fichiers sont consignées dans `public/models/siglip2/LICENCE.txt`, avec la chaîne de licence.

## Ce que ça sait faire, mesuré sur de vraies photos

Trente photos des albums publiés de Johan ont été indexées, puis interrogées en français. Deux d'entre elles ont été **regardées** pour en connaître le contenu avec certitude, plutôt que de le supposer :

| Requête | Rang de la bonne photo |
|---|---|
| « une mariée en robe de dentelle blanche tenant un bouquet » | **1** |
| « des verres à vin sur une table de restaurant » | **1** |
| « des invités assis autour d'une table, à l'intérieur » | 2 |
| « un homme en costume debout derrière des convives » | 3 |
| « une porte en bois peinte en vert » | **20** |

Deux sur cinq en première place, quatre sur cinq dans les trois premiers.

**L'échec est le plus instructif.** La porte en bois verte est le fond de la photo qui arrive première pour la mariée au bouquet. Le modèle encode le **sujet** d'une image, pas chacun de ses éléments. Ce n'est pas un réglage à corriger, c'est la limite de la méthode, et elle est écrite dans le guide plutôt que découverte à l'usage.

## Vitesse et précision : le choix a été tranché par la mesure

Quatre configurations ont été mesurées dans le navigateur de l'application, sur les mêmes photos et les mêmes recherches à vérité connue.

| Configuration | Poids | 5 000 photos | Premières places |
|---|---|---|---|
| **q8 sur WebAssembly** | **378 Mo** | 90 min | **3 sur 4** |
| q8 sur processeur graphique | 378 Mo | 103 min | 3 sur 4 |
| fp16 sur processeur graphique | 469 Mo | 16 min | 1 sur 4 |
| q4f16 sur processeur graphique | 497 Mo | 15 min | 1 sur 4 |

Les formats que le processeur graphique accélère vraiment sont **six fois plus rapides**, et c'est considérable : quinze minutes au lieu de quatre-vingt-dix sur un album de mariage.

Mais ils perdent en précision. Sur quatre recherches dont la bonne réponse avait été vérifiée à l'œil, la version rapide n'en place qu'une en tête là où la version lente en place trois. L'hypothèse d'un désaccord entre les deux tours du modèle a été testée en les quantifiant pareil : cela ne change rien, la tour image q4f16 est simplement moins fidèle.

**Retenu : q8.** Plus précis, et plus petit de 119 Mo. Une recherche rapide qui sort la mauvaise photo ne sert à rien, et l'indexation tourne une fois par album, en arrière-plan.

Contre-intuitif au passage : sur ce format quantifié, **WebAssembly bat le processeur graphique** (1 077 ms contre 1 231). Le travailleur vise donc WebAssembly en premier, et non l'inverse.

## Défauts trouvés pendant le chantier

- **La vignette ne pouvait pas être chargée.** Les vignettes sont rangées en URL `data:`, et la politique de sécurité de l'application interdit à `fetch` de les lire. Le symptôme était un « Fetch API cannot load data:image/jpeg » sans rapport apparent avec la recherche, et l'indexation échouait en silence sur toutes les photos. La conversion existait déjà dans le code du tri : elle est maintenant partagée au lieu d'être réécrite, et couverte par un test.
- **Taper une phrase vidait la grille.** Tant que la touche Entrée n'était pas pressée, le texte était traité comme un nom de fichier, et une phrase ne correspond à aucun nom. L'album reste désormais entier, avec une invite à valider.
- Le modèle refusait de charger : `dtype: "quantized"` n'existe pas, c'est `"q8"`. Et le tokeniseur exige une longueur de contexte explicite.
- **Le premier appel charge 378 Mo** et se voyait appliquer le délai d'une image ordinaire : il expirait, et l'album entier repartait sans index sans qu'aucune erreur ne l'explique. Il a désormais son propre délai.

## Limites

Le modèle ne trouve pas un détail du fond, ni un texte écrit dans l'image, ni l'identité d'une personne. Pour les personnes, la reconnaissance des visages existe et est faite pour cela.

**L'indexation d'un album de cinq mille photos demande environ une heure et demie.** C'est le prix de la précision, et il est annoncé plutôt que découvert. Elle tourne en arrière-plan.

Le parcours complet a été vérifié dans l'application : le vecteur de 768 nombres est bien écrit dans le catalogue, la recherche affiche sa pastille de résultats, zéro erreur JavaScript. La mesure de précision, elle, a été faite hors de l'interface, sur trente photos et quatre recherches : c'est peu, et un jeu de photos étiquetées plus large donnerait un chiffre plus solide.

L'index se construit pendant la passe d'album. Une photo qui n'y est pas passée n'est pas trouvable, et Juno le dit au lieu de renvoyer une liste vide.

Le classement par moment de la journée est écrit et testé, mais n'est pas encore branché dans l'interface.

# Validation du lot 4 : la qualité d'image

## Le détourage du sujet n'est pas livré, et c'est un constat mesuré

Deux modèles ont été essayés sur de vraies photos des albums de Johan, le 24 septembre 2026.

**MODNet** (Apache 2.0, licence qui couvre explicitement les modèles, 6,6 Mo) tourne sans difficulté : 336 ms par photo sur le processeur graphique, 89 à 98 % des pixels tranchés nettement. Sur le papier, tout va bien.

Les masques ont été **regardés**, et ils ne vont pas :

- Sur un couple enlacé, la silhouette est juste mais l'intérieur est troué de plaques noires, sur la robe et les visages. Une retouche « éclaircir le sujet » y serait marbrée.
- Sur un discours en extérieur, avec six invités à des profondeurs différentes, il ne reste que des taches sans forme.

Le second cas n'est pas une faiblesse du modèle mais un malentendu : MODNet est un modèle de **portrait isolé**, et un album de mariage est fait de groupes et de plans larges. La photo en question n'a pas de sujet unique.

**BiRefNet** (MIT), nettement meilleur en qualité, ne démarre pas dans ce moteur : erreur de shader sur le processeur graphique, mémoire épuisée en WebAssembly avec le modèle en 16 bits.

**Conclusion : rien n'est livré.** Un masque troué donnerait des retouches marbrées, ce qui est pire qu'une fonction absente. Les deux modèles ont été retirés du paquet.

## Ce qui reste, et pourquoi

Le point de branchement est en place et testé : la lecture d'un masque à l'échelle de l'image (`subject.ts`) et l'outil de retouche qui l'emploie (`local-edits.ts`, outil `subject`). Sept tests le couvrent, dont l'inversion pour agir sur le fond et le cas où aucun masque n'existe.

C'est du code inerte tant qu'aucun modèle ne produit de masque. Il est conservé parce qu'il est prouvé et que c'est exactement là qu'un modèle viable se branchera, mais c'est un choix assumé, pas un oubli.

Le débruitage haute sensibilité et la suppression d'objet n'ont pas été commencés : le plan les conditionnait à la réussite du détourage.

# Validation du lot 5 : la distribution

## Les trois paquets sont construits et signés

Version portée à **1.0.0**.

| | État |
|---|---|
| Mac ARM | construit, **signé**, archivé |
| Mac Intel | construit, signé, archivé |
| Windows x64 | construit, non signé |

Les deux archives Mac, extraites ailleurs puis vérifiées, donnent le même résultat :

```
codesign --verify --deep --strict : valid on disk
                                    satisfies its Designated Requirement
34 binaires, 34 en Developer ID, 34 en exécution durcie
spctl : rejected — source=Unnotarized Developer ID
```

Ce dernier message est le seul reproche qui reste, et il ne peut pas être levé ici.

Le paquet Windows pèse 3,5 Go et contient bien tout ce qu'il doit contenir : l'exécutable, l'archive de l'application, FFmpeg pour Windows et les modèles. Il n'a pas été lancé, faute de machine.

| Livrable | Taille |
|---|---|
| `Juno Studio-1.0.0-darwin-arm64.zip` | 3,03 Go, signé |
| `Juno Studio-1.0.0-darwin-x64.zip` | 3,04 Go, signé |
| `Juno Studio-win32-x64/` | 3,5 Go, non signé |

## Trois pièges de signature, trouvés en construisant

1. **On ne peut pas signer dans `~/Documents`.** macOS y appose `com.apple.provenance` sur tout ce qui s'écrit, et `codesign` refuse alors de sceller les bundles auxiliaires. Le même paquet, signé depuis `/private/tmp`, passe sans qu'on change rien d'autre. La construction signe donc dans un dossier temporaire.
2. **Ce n'est pas l'attribut lui-même qui gêne.** Après un aller-retour par `ditto`, codesign accepte le paquet bien que `com.apple.provenance` soit toujours là ; après un `cp -R`, il refuse. Mesuré sur les quatre méthodes de copie.
3. **Un `.app` recopié dans un dossier protégé reprend `com.apple.FinderInfo` sur ses dossiers de frameworks**, et `xattr -cr` ne l'en débarrasse pas durablement. Le livrable est donc une **archive**, où ces attributs n'existent pas, et qui est de toute façon la forme qu'Apple demande pour la notarisation.

Le diagnostic a coûté du temps parce que le message d'erreur, « resource fork, Finder information, or similar detritus », ne nomme ni le fichier ni l'attribut, et parce que mon premier balayage ne regardait que les fichiers alors que l'attribut était posé sur un **dossier**.

## Ce qui reste bloqué, et ne dépend pas de moi

**La notarisation.** Le compte Apple de Johan n'est pas activé pour App Store Connect, et le service de notarisation s'authentifie à travers lui. Diagnostic complet et marche à suivre dans `NOTARISATION.md`. Tant qu'Apple n'a pas ouvert cet accès, les paquets restent installables mais afficheront un avertissement sur le Mac d'un autre photographe.

**La signature Windows.** Elle demande un certificat de signature de code Windows, distinct de celui d'Apple, que Johan ne possède pas. Le paquet Windows est donc produit non signé.

**Les essais sur Windows et sur Mac Intel.** Les paquets sont construits mais n'ont été lancés sur aucune de ces machines, faute d'y avoir accès. Tout ce qui est écrit dans ces documents a été vérifié sur macOS ARM uniquement.

## Installation sur ce Mac, le 24 septembre 2026

La **1.0.0 est installée** dans `/Applications/Juno Studio.app`, à partir de l'archive signée et non du dossier de construction.

```
version                      1.0.0
Authority                    Developer ID Application: Juno (542CN5886Z)
                             Developer ID Certification Authority
                             Apple Root CA
flags                        0x10000(runtime)
codesign --verify --deep --strict : conforme
spctl                        rejected — source=Unnotarized Developer ID
```

L'empreinte de `app.asar` installée est identique à celle de l'archive : `81ffa163b07dce71f96a9ac114c4de6dcae22367e5ef332eb22438f07ebe678e`. Ce qui tourne est bien ce qui a été construit et signé.

Le catalogue de Johan est intact, 257 originaux, et l'installateur en a fait une sauvegarde avant de remplacer l'application. Le service local d'équipe répond et signale toujours `setupRequired: true` : son activation demande les identifiants de Johan.

Vérifications faites sur l'application installée, chacune sur un profil temporaire :

- Les huit commandes du lot 1 sont présentes et atteignables, trois plans posés, export actif, les cinq cibles de niveau affichées.
- Les deux apprentissages de style répondent : 756 retouches Lightroom lues.
- **Zéro erreur JavaScript.**

### Un défaut trouvé pendant l'installation

L'installateur **resignait l'application en ad hoc**, ce qui détruisait la signature Developer ID. C'était sans conséquence tant que les paquets n'étaient pas signés ; ce ne l'est plus.

La première correction n'a pas marché pour une raison déjà rencontrée ailleurs : `codesign` écrit son rapport sur la **sortie d'erreur**, même quand il réussit. Ne lire que la sortie standard rend une chaîne vide, et fait conclure que le paquet n'est pas signé. L'application a donc été installée une fois en ad hoc avant d'être réinstallée correctement.
