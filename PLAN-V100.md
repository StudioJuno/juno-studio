# Juno Studio — passe complète et plan 1.0

Établi le 23 septembre 2026 sur la 0.9.0 installée. Toutes les vérifications de licences, de tailles et de disponibilité ont été faites en direct.

## 1. État constaté

- **210 tests Vitest et 93 tests natifs**, zéro échec (144 et 52 en 0.9.0). Compilation et portail clients sans erreur.
- Audit d'interface sur tous les espaces : zéro erreur JavaScript, zéro erreur console, aucun débordement.
- 24 219 lignes côté interface, 7 385 côté natif, 2 516 côté serveur, 5 247 de tests.
- L'application installée pèse 2,9 Go, dont 2,5 Go de modèles (Qwen3-4B, Whisper, RNNoise) et 35 Mo de vision.

Le logiciel est sain. Ce qui suit ne répare pas des pannes : cela ajoute ce qui manque encore à un poste de production.

## 2. Le gisement immédiat : ce que FFmpeg sait déjà faire

J'ai inventorié les filtres réellement compilés dans le moteur embarqué. **Sept fonctions attendues d'un logiciel de montage professionnel sont disponibles et ne sont pas utilisées :**

| Fonction | Filtre présent | Ce que ça change pour un film de mariage |
|---|---|---|
| **Ducking automatique** | `sidechaincompress` | La musique baisse toute seule sous les voix des discours. Aujourd'hui c'est manuel, plan par plan. |
| **Normalisation de livraison** | `loudnorm`, `ebur128` | Un film livré à -14 LUFS pour les réseaux, -23 pour la télévision. Aujourd'hui le niveau dépend du montage. |
| **Suppression des silences** | `silenceremove`, `silencedetect` | Les blancs d'un discours de témoin disparaissent en une commande. |
| **Transitions** | `xfade` (fondu, volet, glissement, cercle, et une cinquantaine d'autres) | Juno ne sait faire qu'un fondu au noir. |
| **Débruitage vidéo** | `nlmeans`, `atadenoise`, `removegrain` | Les rushes d'église à haute sensibilité deviennent utilisables. |
| **Stabilisation** | `deshake` | Rattrape un plan à main levée. |
| **Ralentis fluides** | `minterpolate` | Un ralenti à 25 % sans saccade, images intermédiaires calculées. |

**Coût : zéro dépendance, zéro téléchargement, zéro licence à vérifier.** C'est de loin le meilleur rapport travail/résultat du plan.

Absents de cette compilation, car sous licence GPL : `vidstab` (la vraie stabilisation), `hqdn3d`. Voir les points de blocage.

## 3. Les briques externes qui valent le coup

Vérifiées une par une : licence, taille réelle, popularité.

| Brique | Licence | Taille | Ce qu'elle apporte |
|---|---|---|---|
| **CLIP ViT-B/32** (via transformers.js) | MIT (OpenAI) | 147 Mo | **Recherche par le sens** : « les photos du gâteau », « les photos de danse », « les plans larges de l'église ». Et un classement automatique par moment. |
| **transformers.js** `@huggingface/transformers` | Apache 2.0 | 9,4 Mo | Le moteur qui fait tourner ces modèles. Embarque ONNX Runtime. |
| **MODNet** | Apache 2.0 | **6 Mo** | Détoure une personne du fond. Ouvre les masques photo et les retouches localisées au sujet. |
| **DINOv2-small** | Apache 2.0 | 23 Mo | Similarité visuelle fine : regrouper des photos qui se ressemblent sans dépendre du temps de prise de vue. |
| **Real-ESRGAN** | BSD-3 (36 900 étoiles) | ~65 Mo | Débruitage et agrandissement des photos à haute sensibilité. |
| **LaMa** | Apache 2.0 (10 300 étoiles) | ~200 Mo | Suppression d'objet : le panneau de sortie, le fil qui traverse le ciel. |

Toutes ces licences autorisent un usage commercial. **RMBG-1.4 a été écarté** : sa licence interdit le commercial sans accord, alors que son détourage est excellent. MODNet le remplace pour 6 Mo.

## 3 bis. Une question ouverte depuis la 0.9.0, enfin tranchée

La 0.9.0 lisait l'aperçu JPEG intégré aux RAW au lieu de les décoder, mais **cela n'avait jamais été vérifié sur un vrai fichier**. C'est fait, sur six CR3 Canon de l'album réel :

| | Aperçu intégré | Décodage complet |
|---|---|---|
| Temps moyen | **86 ms** | 2 053 ms |
| Définition | 6 720 × 4 480 | 6 742 × 4 498 |
| Lisibles | 6 sur 6 | 6 sur 6 |

**23,9 fois plus rapide**, et ce n'est pas une vignette : l'aperçu fait la définition complète à 22 pixels près. Sur les 3 552 photos de l'album, l'analyse passe d'environ **2 heures à 5 minutes**. Le chemin fonctionne, rien à corriger.

Une réserve : cet aperçu porte le rendu du boîtier. Il sert au tri et à l'affichage, jamais de base à une retouche, qui garde le décodage 16 bits.

## 3 ter. La découverte de cette passe : le style de Johan est déjà écrit

Dans `~/Downloads`, l'album « Audrey-Ann et Clément » contient **3 552 fichiers CR3 Canon (119 Go) et 756 fichiers XMP**. Les XMP ne sont pas des presets : ce sont **les réglages Lightroom réellement appliqués par Johan, photo par photo**, et chacun est appairé à son CR3.

Leur lecture donne son style, mesuré sur 756 images :

| Réglage | Médiane | p10 | p90 | Lecture |
|---|---|---|---|---|
| Température | 5 472 K | 4 814 | 5 839 | **varie** : c'est la balance des blancs de chaque scène |
| Teinte | +18 | 12 | 23 | quasi fixe : une signature magenta |
| Exposition | −0,33 | −0,87 | +0,33 | **varie** : ajustée image par image |
| Hautes lumières | −11 | −22 | −5 | **varie** : récupération des blancs |
| Ombres | +21 | 18 | 23 | **fixe** : signature |
| Noirs | −12 | −18 | −4 | signature |
| Contraste | +2 | 0 | 4 | fixe |
| Vibrance | +2 | 1 | 3 | fixe |
| Clarté | −5 | −5 | −4 | **fixe** : la douceur de sa patte |
| Texture | +4 | 4 | 5 | fixe |
| Netteté | 38 | 38 | 39 | fixe |

La structure est exactement celle d'Aftershoot Edit : **un socle constant qui est la signature, et trois réglages qui s'adaptent à chaque image** (température, exposition, hautes lumières).

Conséquence directe : l'apprentissage du style n'a plus besoin d'attendre douze corrections dans Juno. Il peut partir de ces 756 décisions réelles dès la première utilisation. Presque tous ces champs existent déjà dans le modèle de Juno.

Un point demande une conversion honnête : Lightroom exprime la balance des blancs en kelvins, Juno en chaleur relative. Le lien se fera par l'écart à la température médiane de la scène, et sera documenté comme une approximation.

## 4. Plan 1.0, par lots

### Lot 1 — Le son et le montage professionnels — **LIVRÉ le 23/09/2026**

Les six fonctions sont construites, mesurées, testées et vérifiées dans l'application. Voir `GUIDE-V100.md` et `VALIDATION-V100.md`. Deux surprises en cours de route : `atadenoise` ne faisait rien avec ses réglages d'origine, et le rendu par segments laissait un sursaut que les filtres temporels rendaient visible toutes les dix secondes. Les deux sont corrigés et couverts par des tests.


1. **Ducking automatique** : une case dans le mixeur, la musique s'efface sous la voix. Réglage de la profondeur et du temps de retour.
2. **Normalisation à la livraison** : choix entre réseaux sociaux, télévision et cinéma, mesure affichée avant et après.
3. **Suppression des silences** : sur un plan ou sur une sélection, avec un seuil et une marge visibles.
4. **Transitions** : une dizaine de transitions choisies et nommées en français, posées entre deux plans.
5. **Débruitage et stabilisation** : deux réglages par plan, avec l'avertissement que la stabilisation recadre l'image.
6. **Ralentis fluides** : quand un plan passe sous 50 % de vitesse, proposer les images intermédiaires.

Chaque fonction entre dans le catalogue du pilote IA le jour de sa livraison.

### Lot 2 — Apprendre le style depuis les vraies retouches — **LIVRÉ le 23/09/2026**

Deux chemins livrés : apprendre depuis les fichiers Lightroom, et apprendre depuis les photos déjà livrées. Écart aux réglages de Johan : 41 → 25. Écart au rendu de ses albums publiés : 0,411 → 0,315. Détail dans `VALIDATION-V100.md`.


7. **Lire les XMP d'un dossier** et en extraire un profil : le socle fixe d'un côté, les réglages adaptatifs de l'autre.
8. **Partir de ce profil** dès la première passe d'album, au lieu des zéros actuels.
9. **Mesurer l'écart** entre ce que Juno propose et ce que Johan avait fait dans Lightroom, sur ces mêmes 756 photos. C'est la seule note objective possible pour la retouche automatique.

### Lot 3 — La recherche par le sens — **LIVRÉ le 23/09/2026 avec SigLIP 2**

Johan a tranché pour Google. **SigLIP 2**, Apache 2.0 déclarée, multilingue par construction donc utilisable en français sans traduction. 412 Mo embarqués, empreintes consignées dans `public/models/siglip2/LICENCE.txt`.

Ce qui suit reste vrai et explique pourquoi CLIP a été écarté.

### Pourquoi CLIP d'OpenAI a été écarté

Le plan annonçait « CLIP ViT-B/32, MIT ». **C'était faux, et je le corrige.** Le code d'OpenAI est sous MIT ; le modèle ne l'est pas. Sa carte officielle dit :

> « **Any** deployed use case of the model, whether commercial or not, is currently out of scope. »

Et : « The primary intended users of these models are AI researchers. » Les dépôts ONNX qui le convertissent ne déclarent, eux, aucune licence.

Pour un logiciel installé chez d'autres photographes, c'est rédhibitoire, exactement comme RMBG-1.4 écarté plus tôt. Trois options existent et demandent votre arbitrage :

| Option | Licence | Remarque |
|---|---|---|
| **LAION CLIP ViT-B/32** | MIT déclarée, 3,8 M de téléchargements | Pas de conversion ONNX officielle : il faut la produire et la vérifier |
| **SigLIP** (Google) | Apache-2.0 déclarée | Meilleure qualité, plus lourd, même problème de conversion |
| Renoncer à la recherche par le sens | | Le tri par visages et par moment existe déjà |

**Retenu : SigLIP 2.**

La brique `@huggingface/transformers` (Apache-2.0) a été installée puis retirée : elle pèse 440 Mo et le paquetage embarque `node_modules` entier.

### Ce qui reste du lot 3

10. **Chercher une photo en français** : « les photos où on voit le gâteau ». L'index se construit pendant la passe d'album.
11. **Classement automatique par moment** : préparatifs, cérémonie, cocktail, repas, soirée. Proposé, jamais imposé.
12. **Recherche dans les rushes vidéo** : le même index sur les images clés d'un plan. *Non commencé.*

Le classement par moment est écrit et testé dans `semantic.ts` mais n'est pas encore branché dans l'interface.

### Lot 4 — La qualité d'image — **NON LIVRÉ, et c'est mesuré**

Le détourage a été construit puis retiré. MODNet tourne (336 ms par photo) mais ses masques sont inutilisables sur de vraies photos de mariage : intérieur troué sur un couple, taches sans forme sur un groupe. C'est un modèle de portrait isolé. BiRefNet, meilleur, ne démarre pas dans ce moteur. Un masque troué donne des retouches marbrées, donc rien n'est livré. Détail et images dans `VALIDATION-V100.md`.

Le débruitage et la suppression d'objet étaient conditionnés à la réussite du détourage : ils n'ont pas été commencés.

### Lot 4 — le détail du plan initial

13. **Détourage du sujet** (MODNet) : masques photo qui suivent la personne, retouche localisée réelle.
14. **Débruitage haute sensibilité** (Real-ESRGAN) : sur une photo ou sur une sélection.
15. **Suppression d'objet** (LaMa) : uniquement si le lot précédent démontre sa valeur ; c'est le plus lourd.

### Lot 5 — La distribution — **LIVRÉ sauf la notarisation**

Version 1.0.0. Les trois paquets sont construits, les deux Mac signés et archivés. L'archive Mac ARM passe `codesign --verify --deep --strict` et Gatekeeper ne reproche plus que l'absence de ticket. Trois pièges de signature documentés dans `VALIDATION-V100.md`, dont celui-ci : **on ne peut pas signer depuis `~/Documents`**.

Restent hors de ma portée : la notarisation (Apple doit activer App Store Connect), la signature Windows (certificat distinct que Johan n'a pas), et les essais sur Windows et Mac Intel (machines auxquelles je n'ai pas accès).

### Lot 5 — le détail du plan initial

16. **Notarisation macOS** : sans elle, l'application sera bloquée sur les Mac des autres photographes.
17. **Vérification réelle sur Windows et Mac Intel**, jamais faite.
18. **Mesure sur l'album Canon réel** déjà présent sur le disque : débit d'import sur 3 552 CR3, qualité du tri, précision de la reconnaissance des mariés.

## 4 bis. Décisions prises par Johan le 23 septembre 2026

- **Le logiciel sera installé chez d'autres photographes.** La notarisation Apple devient donc un prérequis de diffusion, et tout composant sous licence GPL ou non commerciale est définitivement exclu. La stabilisation restera `deshake`.
- **Les modèles seront tous embarqués**, pas téléchargés à la demande : l'application fonctionnera hors ligne dès l'installation, au prix d'environ 400 Mo supplémentaires.
- **Les cinq lots sont retenus.**
- **Un vrai album est disponible** pour les mesures.

## 5. Points de blocage

1. **La notarisation : moins bloquante que prévu.** Le compte Apple Developer existe déjà (équipe « Juno », `542CN5886Z`), avec deux certificats valides jusqu'en septembre 2027. Il manque le certificat « Developer ID Application », le seul qui vaille hors App Store, et une clé de notarisation. Toute la chaîne est écrite, testée et branchée ; restent deux démarches de trois minutes sur le site d'Apple, qui demandent votre mot de passe et que je ne ferai donc pas à votre place. Marche à suivre : `NOTARISATION.md`.

2. **La vraie stabilisation est sous licence GPL.** `vid.stab` n'a pas de licence claire et n'est pas compilé. Recompiler FFmpeg en GPL contaminerait la distribution de Juno. Je propose `deshake`, moins bon, et je le dirai clairement dans l'interface.

3. **Le poids de l'application.** Elle fait déjà 2,9 Go et passera à environ 3,3 Go, tout étant embarqué comme décidé. Le téléchargement des modèles se fera au moment de la construction, avec vérification d'empreinte, jamais au moment de l'usage.

4. **Le temps de calcul sur 5 000 photos.** CLIP demande environ 50 à 100 ms par image sur le processeur graphique, soit 5 à 8 minutes pour un album. Acceptable en tâche de fond, à condition de l'annoncer.

5. **Windows n'a jamais été lancé.** Tout ce qui touche au processeur graphique et aux workers doit y être vérifié avant d'être promis.

6. **Le service d'équipe reste inactivé** (`setupRequired: true`) depuis trois versions. Il attend vos identifiants.

7. **Plafond de 32 images clés** par propriété en motion design, contre 240 pour les masques. Incohérent, à aligner.

## 6. Ce que je n'intègre pas, et pourquoi

- **Demucs** (séparation voix/musique) : les modèles pèsent plus de 300 Mo pour un besoin rare en mariage.
- **RMBG-1.4** : meilleur détourage du marché, licence non commerciale. Exclu.
- **SigLIP** : 201 Mo pour un gain marginal sur CLIP à 147 Mo.
- **Un modèle de jugement esthétique entraîné** : il faudrait des albums annotés et une chaîne d'entraînement. Hors de portée raisonnable.
