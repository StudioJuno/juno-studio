# Juno Studio, analyse complète

Version 1.0.0, le 26 septembre 2026. Tout ce qui suit est mesuré sur ce Mac, pas estimé.

## Ce que pèse et ce que vaut le logiciel aujourd'hui

| | |
|---|---|
| Application installée | 3,3 Go |
| Code, hors tests | 35 000 lignes (26 800 interface, 8 200 natif) |
| Tests | 308, tous au vert (215 rapides, 93 natifs) |
| Démarrage, écran prêt | 3,0 à 3,3 s |
| Ouverture de l'éditeur photo | 2,6 s |
| Premier détourage sur une photo | 1,8 s, puis quelques dizaines de millisecondes par clic |

Répartition du poids : Qwen3 4B **2,3 Go**, SigLIP 393 Mo, Whisper 141 Mo, SlimSAM 38 Mo, le reste du logiciel environ 400 Mo.

---

## 1. Précision

### Ce qui est prouvé

**Le détourage au clic marche.** Sur la photo de mariée, le sujet gagne +27,5 niveaux de luminosité et le fond **ne bouge pas d'un seul niveau**, des deux côtés du cadre. Couverture 37 % de l'image, confiance 95 %. Le bord de l'épaule est net, sans halo ni marbrage.

**Le style appris vise juste, parce qu'il vise peu.** Juno n'apprend que la chaleur et la saturation depuis vos photos livrées. Viser aussi la luminosité dégradait le résultat : la luminosité d'un album dépend d'abord des scènes photographiées, pas d'un parti pris. Cette limite est écrite dans l'interface, elle n'est pas cachée.

**Le lecteur de consignes comprend tout le vocabulaire des réglages.** Mesuré sur 33 tournures réalistes : 30 comprises sans réveiller le modèle de langue.

### Ce qui manque

**Les 3 tournures refusées sont toutes géométriques** : « recadre en 16/9 », « pivote de 90 », « redresse de 2 ». Le lecteur ne connaît que les réglages de lumière et de couleur. C'est le seul trou du vocabulaire, et il est petit à combler.

**Le détourage ne sait pas se corriger.** Un clic, un masque. S'il prend trop ou trop peu, il n'y a pas de second clic pour retirer une zone, alors que SlimSAM sait le faire (un point marqué « fond »). C'est l'amélioration la plus rentable de cette partie : le modèle est déjà chargé, le code du travailleur accepte déjà une liste de points.

---

## 2. Fiabilité

### L'enseignement le plus net de la journée

Les trois défauts qui rendaient le détourage inutilisable **étaient tous dans le seul fichier de logique qu'aucun test n'atteignait**, et **aucun des trois ne levait d'erreur** :

1. `pred_masks` sort en logits, et un logit négatif reste « vrai » en JavaScript : tous les pixels étaient retenus.
2. `get_image_embeddings` rend deux tenseurs ; les passer en bloc sous un seul nom privait le décodeur des embeddings de position.
3. Le processeur recevait une fausse image de 1 pixel au moment du clic : le point partait dans un coin.

Le symptôme visible était un message qui accusait l'utilisateur de mal viser. C'est la définition d'une panne coûteuse : silencieuse, et qui accuse quelqu'un d'autre.

### L'état réel des tests

69 fichiers sur 127 sont atteints par au moins un test. Ce qui reste :

- **16 250 lignes d'interface** (36 fichiers `.tsx`). Couvertes autrement, par les parcours Playwright.
- **2 388 lignes de logique** (21 fichiers). L'essentiel est de la plomberie Electron (`main.cjs`, `preload.cjs`) et **les quatre travailleurs qui pilotent les modèles** : détourage, recherche par le sens, visages, image.

Ces quatre travailleurs sont le point faible, et pour une raison structurelle : on ne peut pas les tester sans charger un vrai modèle, ce qu'une suite rapide ne peut pas faire. C'est précisément là que se sont logés les trois défauts.

### Corrigé aujourd'hui

- **`npm test` ne lançait que 215 tests sur 308.** Les 93 tests natifs n'étaient lancés que par `test:all`, que personne ne tape. `npm test` lance maintenant les deux.
- **Un style appris pouvait disparaître en silence.** Si la réserve locale est pleine, l'écriture échouait sans un mot : on retrouvait le style perdu au démarrage suivant. Elle annonce maintenant clairement le refus.
- **Une version de montage abîmée s'effaçait de la liste.** Un fichier illisible faisait disparaître la version comme si elle n'avait jamais existé. Elle s'affiche maintenant, signalée comme abîmée, sans empêcher les autres.

### Ce qui va bien, contrairement aux apparences

Le code contient 66 attrapes d'erreur muettes. **Elles sont pour l'essentiel légitimes** : sur les 10 de la chaîne vidéo, 9 sont du nettoyage de fichiers temporaires dans un `finally`, ou une mise à jour de progression qui ne doit pas faire échouer un rendu. Le compte brut est trompeur ; c'est le sens de chaque attrape qui compte.

Aucun des 67 canaux natifs n'est mort : tous sont appelés depuis l'interface.

---

## 3. Efficacité

### Le chiffre qui domine tous les autres

**Qwen3 4B pèse 2,3 Go, soit 70 % de l'application, et ne sert que de filet.** Il n'est réveillé que lorsque le lecteur de consignes échoue, c'est-à-dire pour 3 tournures sur 33 mesurées, toutes géométriques.

Le sortir de l'installation ferait passer Juno Studio de **3,3 Go à environ 1 Go**. Téléchargement, disque, temps d'installation, tout est divisé par trois.

La façon propre de le faire, dans l'ordre :

1. Ajouter les verbes géométriques au lecteur de consignes (recadrage, rotation, redressement). Petit travail, il supprime les 3 refus connus.
2. Faire du modèle un **téléchargement optionnel**, proposé à qui veut parler librement, absent par défaut.
3. Garder un message clair quand une consigne n'est pas comprise et que le modèle n'est pas installé.

### Le reste

Démarrage à 3 s et éditeur à 2,6 s sont corrects pour un logiciel de cette taille, et ne sont pas le sujet tant que l'installation pèse 3,3 Go.

`App.tsx` (3 403 lignes) et `VideoStudio.tsx` (3 095 lignes) sont trop gros. Ce n'est pas un problème pour vous à l'usage, c'en est un pour la suite du développement : ce sont les deux fichiers où une modification risque le plus d'en casser une autre.

---

## Ce qui en a été fait

Le 27 septembre 2026, dans la 1.1.0 : le point 1 (verbes géométriques, puis l'IA locale en téléchargement vérifié, **3,3 Go → 1,0 Go**, archive de 3 Go → 635 Mo), le point 2 pour trois modèles, et la suite complète lancée par `npm test`. Les points 3 et 4 restent à faire.

## Ce que je ferais, dans cet ordre

| | Travail | Gain |
|---|---|---|
| 1 | Verbes géométriques dans le lecteur de consignes, puis Qwen3 en téléchargement optionnel | 3,3 Go → 1 Go |
| 2 | Une suite « contrat des modèles » : charger chaque modèle une fois, vérifier les formes et la couverture des masques. Lente, donc à part de `npm test` | Aurait attrapé les 3 défauts du détourage |
| 3 | Second clic au détourage, pour retirer une zone | Précision du masque, sans coût de chargement |
| 4 | Découper `App.tsx` et `VideoStudio.tsx` | Vitesse et sûreté du développement à venir |

## La règle à retenir

**Une attrape d'erreur qui cache un résultat visible par vous doit parler.** Les trois défauts du détourage, le style perdu et la version disparue avaient tous la même forme : le logiciel savait que ça n'allait pas, et ne le disait pas. Le nettoyage d'un fichier temporaire peut rester muet ; un résultat que vous attendez, jamais.
