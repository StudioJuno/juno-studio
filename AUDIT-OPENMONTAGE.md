# OpenMontage, audit pour Juno Studio

`github.com/calesthio/OpenMontage`, cloné et lu le 27 septembre 2026. Dernier commit du dépôt : 5 septembre 2026. 61 000 étoiles, environ 50 contributeurs, créé en mars 2026.

## Verdict

**Rien ne peut être copié.** La licence l'interdit, et le logiciel ne fait pas le même métier. En revanche **trois idées valent le détour**, et Juno a déjà toutes les briques pour les réaliser sans rien emprunter.

---

## Ce que c'est réellement

Ce n'est pas un logiciel de montage. C'est un système d'agents en Python qui **fabrique** des vidéos à partir de rien : voix de synthèse, images générées, avatars parlants, composition Remotion. L'intelligence est dans 1 096 fichiers de consignes markdown que lit un assistant IA ; le Python ne fait que les outils.

- 517 fichiers Python, 1 096 markdown, 12 chaînes de production.
- Les chaînes : talking-head, explainer animé, démo d'écran, extraction de clips courts, repurposing de podcast, avatar présentateur, doublage.
- **Aucune photo.** Aucun traitement de prise de vue réelle. Aucun mariage.

Juno Studio fait l'inverse : il **post-produit du réel**, photo et film, en local.

---

## Blocage 1, la licence : AGPL-3.0

C'est le point dur, et il est définitif.

L'AGPL est un copyleft fort. Toute œuvre dérivée doit être publiée sous AGPL, code source compris, à quiconque reçoit le logiciel. Le dépôt **n'offre aucune exception commerciale** et aucune double licence.

Concrètement : reprendre ne serait-ce qu'une fonction de leur code dans Juno Studio obligerait à **publier l'intégralité du source de Juno Studio**, à tout photographe à qui vous le livrez, concurrents compris. Juno Studio est signé, notarisé et distribué comme un logiciel propriétaire. Les deux sont incompatibles.

Vérifié dans le dépôt : **aucun fichier source ne porte d'en-tête de licence différent**. Les seuls éléments permissifs sont une police d'écriture (OFL) et des données de capture de mouvement CMU, sans rapport avec votre usage.

**Ce qui reste légal, et qui est ce que je propose :** lire pour comprendre. Une technique, un seuil, un choix de filtre FFmpeg sont des faits, pas une œuvre. Ce qui est protégé, c'est leur écriture. On réimplémente depuis les bibliothèques d'origine, qui sont permissives.

---

## Blocage 2, ce n'est pas le même métier

Sur la centaine d'outils, l'écrasante majorité appelle des services payants de génération : Kling, HeyGen, Sora, Veo, ElevenLabs, Flux, Runway, Seedance. Ils coûtent de l'argent à chaque appel et font sortir les médias de l'ordinateur.

C'est l'exact contraire de la promesse de Juno Studio, qui travaille en local et ne fait rien sortir. Pour un studio de mariage, ces outils ne servent à rien : vous filmez le réel, vous ne le générez pas.

---

## Blocage 3, des modèles sous licence non commerciale

Leur outil `face_restore` s'appuie sur **CodeFormer** et **GFPGAN**. CodeFormer est publié sous la licence S-Lab, qui restreint l'usage à la recherche non commerciale, et les poids de GFPGAN descendent de StyleGAN2.

**Le dépôt ne signale aucune de ces restrictions.** C'est en soi un avertissement sur la rigueur juridique de l'ensemble : un outil proposé comme utilisable peut vous mettre en faute si vous vendez vos films.

Deux exceptions propres, si le besoin se présente un jour : Real-ESRGAN (agrandissement) est en BSD-3, rembg (détourage) est en MIT.

---

## Blocage 4, hygiène de l'assistant

Le dépôt contient plus de 900 fichiers écrits pour piloter un assistant IA, dont 323 dans `.claude/skills/`. Les déposer dans un projet revient à faire lire à votre assistant les consignes d'un tiers.

Je n'ai trouvé **aucun déclencheur automatique** (pas de hook, pas de `settings.json` exécutable) : le risque est modéré, pas aigu. La règle simple reste de garder ce dépôt **hors** de Juno Studio, en lecture seule, ce que j'ai fait.

---

## Ce que Juno sait déjà faire, et qu'il ne faut surtout pas refaire

J'ai vérifié chaque équivalence dans le code :

| Chez eux | Chez vous, déjà |
|---|---|
| `silence_cutter` | `silencedetect` lu et découpé, `electron/video/index.cjs:837` |
| `scene_detect` | `select='gt(scene,0.28)',showinfo`, `electron/video/index.cjs:883` |
| `audio_energy` (ebur128) | ebur128 et loudnorm, `electron/video/loudness.cjs` |
| `subtitle_gen`, `transcriber` | Whisper avec horodatage par mot, `electron/video/transcript-words.cjs` |
| `face_tracker` | MediaPipe et face-api, déjà embarqués |
| `bg_remove` (rembg) | SlimSAM au clic, mieux adapté à votre usage |
| `color_grade` | `lut.cjs` et `autocolor.cjs` |
| `video_stitch`, transitions | `render.cjs`, `transitions.cjs`, `multicam.cjs` |

**Les trois gains les plus évidents d'OpenMontage existent déjà dans Juno.** C'est le principal résultat de cet audit.

---

## Les trois idées qui valent le détour

### 1. Le recadrage vertical qui suit les visages

**C'est le seul vrai manque.**

Aujourd'hui, un plan 16/9 placé dans une séquence 1080×1920 est mis à l'échelle avec `force_original_aspect_ratio=decrease` (`electron/video/render.cjs:151`). Résultat : des bandes noires, et les mariés minuscules au milieu. Un teaser Instagram fabriqué comme ça n'est pas publiable.

Tout ce qu'il faut est déjà là :
- un plan porte déjà `scale`, `x`, `y`, `rotation` (`src/video/types.ts`) ;
- la détection de visages est déjà embarquée ;
- le rendu applique déjà ces valeurs.

**Il ne manque que le calcul.** Pour chaque plan d'une séquence verticale : échantillonner quelques images, y détecter les visages, lisser la trajectoire sur une fenêtre glissante pour éviter le tremblement, puis écrire `scale`, `x` et `y` dans le plan. Repli sur un cadrage centré quand aucun visage n'est trouvé, et valeurs modifiables à la main après coup.

Les deux réglages qui décident du résultat : la **marge autour des visages** (trop serré, on coupe les fronts ; trop large, on retombe sur le plan large) et la **longueur de la fenêtre de lissage** (trop courte, l'image tremble ; trop longue, le cadre décroche sur un mouvement).

Coût : moyen. Valeur : haute, et immédiate à chaque livraison.

### 2. Trouver les moments forts par le son

Leur `audio_energy` lit la sonie instantanée d'ebur128 toutes les 100 ms et en tire la fenêtre la plus forte d'un enregistrement.

Sur un mariage, les pics de sonie sont exactement ce qu'on cherche : applaudissements, cris, rires, entrée des mariés, moment où la musique part. **Juno mesure déjà avec ebur128** ; il s'agit d'une nouvelle lecture d'une mesure existante, pas d'un nouvel outil.

Deux usages : proposer des points de coupe pour un teaser, et classer les rushes dans l'écran de tri.

Coût : faible. Valeur : moyenne à haute.

### 3. Leur méthode de recette, pas leur code

Trois pratiques valent d'être reprises, et aucune n'est du code :

- **Regarder la sortie, jamais seulement ses métadonnées.** Leur protocole impose de voir l'image et d'écouter le son avant de déclarer un outil bon. C'est exactement la règle qui a évité de livrer MODNet, dont les chiffres étaient bons et les masques mauvais.
- **Un test qui prouve que la suite ne peut pas nuire.** Ils ont un test dont le seul rôle est de prouver que les tests ne peuvent pas appeler le réseau et dépenser de l'argent. L'équivalent pour Juno : **un test qui prouve que la suite ne peut pas toucher vos projets** dans `~/Library/Application Support/Juno Studio`. Je l'ai vérifié à la main hier ; ça devrait être un test.
- **Un registre des risques par outil.** Leur plan qualité liste, outil par outil, ce qui peut mal tourner et comment le vérifier. C'est exactement la forme qui manque à la suite « contrat des modèles » proposée dans `ANALYSE.md`.

---

## Ce que je ne prendrais pas

- **Leurs préréglages de plateforme** (`lib/media_profiles.py`) : une table triviale, et elle vise `libx264`, que le FFmpeg LGPL de Juno n'a pas.
- **Leur savoir-faire de montage** (`skills/creative/`) : compétent mais général, et écrit pour de la vidéo d'entreprise. Vous êtes professionnel du mariage ; ça ne vous apprend rien.
- **L'agrandissement Real-ESRGAN** : juridiquement propre, mais il demande PyTorch. Ce serait un portage ONNX et un modèle de plus, dans une application dont je viens de recommander de diviser le poids par trois. Pas maintenant.
- **Tous les outils de génération.** Hors sujet et contraires à la promesse du local.

---

## Plan proposé, et ce qui en a été fait

Lancé le 27 septembre 2026 sur votre accord (« fais tout »), livré dans la 1.1.0. Le détail pour l'utilisateur est dans `GUIDE-V110.md`.

| Lot | État |
|---|---|
| A | **Livré.** Prouvé sur une vraie livraison 1080×1920 : bandes noires à 0 avant, plus aucune après. Il a fallu réparer deux défauts du détecteur de visages en route (visages petits dans le cadre, charge concurrente) |
| B | **Livré.** Moments trouvés contre leur contexte, pas en volume absolu : le set du DJ n'en est pas un |
| C | **Livré.** La garde est dans l'application elle-même ; elle a arrêté un lancement qui visait réellement vos projets |
| D | **Livré** pour trois modèles (`npm run test:modeles`, `REGISTRE-MODELES.md`). Trois restent sans contrat |

Plan d'origine :

| Lot | Contenu | Dépend de |
|---|---|---|
| A | Recadrage vertical suivant les visages, avec marge et lissage réglables, repli centré, valeurs reprenables à la main | rien, tout existe |
| B | Lecture des pics de sonie, points de coupe proposés et classement des rushes | rien, ebur128 déjà en place |
| C | Test d'isolation prouvant que la suite ne touche pas vos projets réels | rien |
| D | Suite « contrat des modèles » avec registre des risques, hors `npm test` car lente | C de préférence |

Le lot C est le moins spectaculaire et le plus rentable : c'est le seul qui protège vos données pendant que le reste avance.

## Ce qui reste à trancher avec vous

1. Livrez-vous réellement des teasers verticaux ? Le lot A n'a de sens que si oui.
2. Faut-il faire cela avant ou après le chantier d'`ANALYSE.md` (Qwen3 en téléchargement optionnel, 3,3 Go vers 1 Go) ?
3. Sur le recadrage : quand plusieurs visages sont à l'écran et qu'ils s'éloignent, préférez-vous que Juno élargisse pour les garder tous, ou qu'il choisisse le couple et laisse sortir les invités ?
