# Juno face à Aftershoot : où on en est, mesuré

## Le 28 septembre 2026 (1.2.2) : une photo par rafale

Les défauts 1 et 2 ci-dessous sont traités (voir `VALIDATION-V122.md`), sur le même album, avec le vrai code :

| | 1.2.1 | 1.2.2 | Aftershoot, donc Johan |
|---|---|---|---|
| Photos gardées | 2 631 | **889** | 756 |
| Séries ou rafales | 3 046 | **1 053** | 806 |
| Regroupement, F1 B³ face aux séries d'Aftershoot | 44,9 % | **82,7 %** | |
| Part des gardées livrées | 23 % | **34 %** | |
| Rafales contenant une livrée où Juno propose la livrée | | 353 sur 691 | |
| À l'aveugle, quand ce n'est pas la livrée : Juno meilleur / égal / moins bon | | 23 / 31 / 24 sur 80 | |

Le défaut 2 n'a pas été comblé par un modèle entraîné, contrairement à ce que prévoyait la recommandation : des règles de photographe (chaque personne comparée à elle-même dans la rafale) trouvent la livrée 35,7 % des fois contre 31,6 %, et surtout, regardées à l'aveugle, leurs autres choix valent ceux de Johan. Ce qui reste : Juno garde une image de chaque rafale, même d'une scène sans intérêt (889 contre 756), et ne voit pas une expression manquée.

## Mesuré sur un album entier, le 27 septembre 2026 (1.2.0)

Pour la première fois, un album complet est passé dans le vrai code de Juno : les **3 552 RAW** du mariage d'Audrey-Ann et Clément, dont Johan a livré **756** photos. Les 756 livrées sont exactement celles qu'Aftershoot avait gardées : la référence est donc « ce que Johan a livré ».

Méthode : les RAW ont été lus sur place, en lecture seule, sans import ni copie ; les modules de tri de Juno (aperçu RAW, analyse, visages par morceaux, séries, choix) ont tourné tels quels dans Chromium. Aucun fichier n'a été écrit dans le dossier de l'album. Banc, données et vérifications à l'œil : `work/refonte-v120` (voir son `LISEZMOI.md`), relançable.

### Ce que ça donne

| Sujet | Juno | Aftershoot, donc Johan | Lecture |
|---|---|---|---|
| Photos gardées | **2 707** | 756 | Juno ne trie presque pas |
| Séries de doublons | 3 131 « séries » | 806 | Juno ne regroupe presque rien |
| Livrées que Juno garde aussi | 598 sur 756 (79 %) | | |
| Dans une série, même photo choisie | 31 % | | le hasard ferait 25 % |
| Flou | 187 signalées, 48 en commun | 1 139 | |
| Yeux fermés | 85 signalées, 22 en commun | 454 | |
| Redressement, sur les 756 livrées | posé sur 151, même sens 132 fois sur 150, corrélation 0,78 | redressées : 643, de 0,58° en médiane | Juno corrige environ deux fois plus fort, et s'abstient sur la moitié |
| Recadrage de composition | aucun | 276 des 756 | écart ouvert |
| Exposition | corrélation 0,48 | médiane −0,32 IL, Juno −0,06 | le rendu d'Aftershoot est plus sombre ; l'apprentissage du style de Johan est fait pour ça |
| Balance des blancs | corrélation 0,64 avec la température d'Aftershoot | | même sens le plus souvent |

### Trois défauts diagnostiqués

**1. Les séries.** Deux photos se regroupent si elles sont prises à moins de 8 s d'écart **et** se ressemblent à 8 bits près sur 64 (`dhash`). Mais une rafale à main levée bouge : deux voisines d'une même série Aftershoot diffèrent de **18 bits en médiane**, deux séries différentes de 28. À 8 bits, seules 17 % des voisines d'une même série sont réunies. Le chiffre de 99,1 % annoncé en 0.9.0 ne mesurait que l'écart de temps.

Élargir ne suffit pas : à 16 bits, 59 % des voisines sont réunies et 9 % le sont à tort ; à 24 bits, 89 % et 29 %. Et comme le choix dans la série est proche du hasard, le tri final ne bouge presque pas (F1 de 35 à 37). Réglé sur le matin, vérifié sur l'après-midi : même conclusion. Le seuil n'a donc pas été changé : ce serait un arbitrage, pas une correction. **Piste mesurable** : une ressemblance par le sens (SigLIP, déjà dans Juno pour la recherche) au lieu d'une empreinte de 64 bits.

**2. Le choix dans la série.** Sur les 595 séries où Johan a livré une seule photo, Juno choisit la même 31 % du temps, contre 25 % au hasard. Aucune pondération de ce que Juno mesure (netteté, yeux, sourire, profil, taille du visage, exposition, position dans la rafale) ne fait mieux : apprise sur le matin, elle retrouve 30 % l'après-midi, contre 28 % pour le score actuel. Le choix d'Aftershoot dépend de ce que Juno ne mesure pas : l'expression, le moment. **Les règles ne combleront pas cet écart** ; seul un modèle entraîné le peut (voir plus bas).

**3. La netteté des visages dépend de leur taille.** Juno mesure la netteté d'un visage sur une image réduite : un petit visage mesure 7 000 en médiane, un grand 1 800. Brute, elle ne distingue pas les photos qu'Aftershoot juge floues (AUC 0,47, le hasard) ; rapportée au carré de la taille du visage, 0,70. Vérifié au pixel près : les visages qu'Aftershoot dit flous le sont, et Juno les mesure entre 38 et 116, alors qu'il ne déclare un visage flou que sous 12. Même défaut dans l'autre sens : la règle « peu de détails » juge l'image entière, et met « à vérifier » 50 photos livrées, des portraits nets sur fond flou. **Corrigé en 1.2.1** (voir `VALIDATION-V121.md`) : une mesure de la bande des yeux, indépendante de la taille (AUC à l'œil 0,965). Sur l'album : 46 des 79 visages flous à l'œil signalés au lieu de 0, aucun des 110 nets, et 17 livrées « peu de détails » au lieu de 50. Le tri global bouge peu (2 631 gardées au lieu de 2 707) : les défauts 1 et 2 restent.

### Ce qu'il faut en retenir

- Sur cet album, **le tri de Juno n'est pas utilisable à la place d'Aftershoot** : il garde trois photos et demie pour une livrée.
- **Le redressement l'est** : quand Juno redresse seul, il va dans le sens d'Aftershoot neuf fois sur dix, et sur le plus gros désaccord vérifié, Juno avait raison.
- Les deux corrections réalistes, par ordre de gain : la netteté des visages (défaut 3, **faite en 1.2.1**), puis les séries par ressemblance de sens (défaut 1). Elles se mesurent avec le même banc, sur le même album.

---

## Mesuré le 23 septembre 2026 (0.9.0)

Établi le 23 septembre 2026 sur la 0.9.0, avec les données réelles des 27 projets Aftershoot de Johan (10 010 photos de mariage, 2 157 groupes de doublons, 3 997 images élues). Les bases `result.db` ont été lues en copie, jamais modifiées. Les fichiers RAW d'origine sont sur une carte absente ; seules les décisions d'Aftershoot et les horodatages étaient exploitables.

## Ce qui est réglé, avec la mesure

| Sujet | Avant (0.8.0) | Maintenant (0.9.0) | Comment c'est mesuré |
|---|---|---|---|
| Distinguer net et flou | **1,23×** | **136,8×** | Rafale réelle de six images floutées progressivement, dans l'application installée |
| Où la netteté est lue | image entière, 128 px | **visage du sujet, 1 024 px** | Test de région : la moitié texturée mesure 1 000 fois la moitié unie |
| Signaux de visage lus | 2 sur 52 | **yeux, sourire, orientation, netteté, par visage** | Pondérés par la taille du visage |
| Regroupement des rafales | 24 images, 8 s | **chaîne sans plafond, 8 s** | **99,1 % des 5 211 paires** d'Aftershoot restent groupées, contre 95,6 % à 3 s. **Corrigé le 27/09** : mesure faite sur le temps seul ; avec la ressemblance exigée, 17 % seulement (voir plus haut) |
| Départager deux images nettes | échelle log saturée | **score relatif à la rafale** | Deux images à 1 300 et 650 se séparent de plus de 15 points |
| Balance des blancs | **aucune** | dominante corrigée, pondérée peau | Bleu réchauffé, orange refroidi, correction bornée |
| Cohérence d'une scène | aucune | médiane par scène | Scène coupée par 4 min ou un saut de lumière |
| Apprentissage du style | aucun | médiane des corrections, dès 12 | Insensible à un album aberrant, converge sans dépasser |
| Vitesse | 1 cœur | pool dimensionné sur la machine | Les deux pools ne prennent jamais toute la machine |

Le seuil de rafale a été **corrigé grâce à tes propres albums** : 3 secondes cassaient 4,4 % des groupes qu'Aftershoot forme, 8 secondes n'en cassent plus que 0,9 %.

## Ce qui n'est pas au niveau, et pourquoi

### 1. Aftershoot juge, Juno applique des règles

Aftershoot a entraîné des modèles sur des millions de photos de mariage pour apprendre **ce qu'un photographe garde**. Juno applique des critères explicites : netteté du sujet, yeux, sourire, orientation, exposition.

Les règles couvrent bien les échecs techniques. Elles ne savent rien de la composition, du moment décisif, de l'émotion d'une image, ni du fait qu'une photo floue peut être la meilleure du mariage. **C'est l'écart principal, et il ne se comble pas avec des seuils.**

### 2. La reconnaissance des personnes n'est pas du même ordre

Aftershoot a produit **453 839 crops de visages** et **1 044 visages classés par personne** sur tes albums : il a un vrai modèle d'empreinte faciale. Juno compare la géométrie du visage à partir des points que MediaPipe fournit déjà, sans modèle supplémentaire.

Cela suffit à regrouper quelques personnes dans un album pris au même endroit. Cela ne tiendra pas sur des centaines d'invités, des profils marqués, des changements de coiffure ou de lumière.

### 3. La retouche apprend sept réglages, pas un style

> **Corrigé le 27 septembre 2026** (voir `AUDIT-AFTERSHOOT.md`) : mesuré sur 3 000 retouches réelles d'Aftershoot sur vos albums, il ne prédit **ni les courbes ni les couleurs** photo par photo, qui viennent d'un préréglage fixe. Il ajuste l'exposition, la balance des blancs, et **recadre et redresse** chaque photo. Le vrai écart est le redressement et le recadrage automatiques, que Juno n'a pas.

Aftershoot Edit reproduit un style à partir de milliers de photos que tu as éditées dans Lightroom, avec courbes, HSL par couleur et masques. Juno apprend l'écart médian sur exposition, contraste, hautes lumières, ombres, chaleur, teinte et saturation.

C'est utile et honnête, mais ce n'est pas le même objet : Juno rattrape une dérive, il ne reproduit pas une signature.

### 4. Le matériel

Aftershoot exploite le GPU. Juno calcule sur le processeur, en WebAssembly. Même parallélisé, l'écart de débit restera net sur des albums de plusieurs milliers de RAW.

## Ce qu'il faudrait pour combler chaque écart

| Écart | Ce que ça demande | Réaliste ? |
|---|---|---|
| Jugement esthétique | Un modèle entraîné sur des albums annotés. Tes 10 010 photos avec les choix d'Aftershoot sont un début de jeu d'entraînement, mais il faut les fichiers, une chaîne d'entraînement et une évaluation. | Long, et dépendant de données que tu n'as plus sur disque |
| Reconnaissance faciale | Embarquer un modèle d'empreinte dédié (ArcFace ou équivalent) via onnxruntime. 20 à 90 Mo, licence à vérifier. | **Faisable, c'est le meilleur rapport gain/effort** |
| Style de retouche | Étendre l'apprentissage aux courbes et au mixeur de couleurs, et lire tes presets Lightroom. | Faisable, mais tu l'avais écarté |
| Vitesse GPU | Portage des calculs sur WebGPU. | Lourd, gain réel surtout sur gros volumes |

## Ma recommandation

Le tri de Juno est passé d'inutilisable à réellement fonctionnel sur les critères techniques, et c'est mesuré. Il n'égale pas Aftershoot sur le jugement, et prétendre le contraire serait faux.

Avant d'investir dans un modèle entraîné, la seule chose qui compte est de **passer un vrai album dans Juno** et de comparer ses choix aux tiens. Si l'écart porte sur des échecs techniques, les règles peuvent encore progresser. S'il porte sur le goût, alors seul un modèle entraîné le comblera, et il faudra en décider en connaissance du coût.
