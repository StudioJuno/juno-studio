# Juno Studio — audit complet et plan 0.9.0

Audit réalisé le 23 septembre 2026 sur la 0.8.0 installée. Preuves dans `work/audit-v080`.

## 1. Ce qui va bien

- Build sans erreur, **95 tests Vitest et 52 tests natifs au vert**.
- Parcours d’audit sur tous les espaces : Photos, Comparer, Retoucher, les 7 onglets de Montage, Livraisons, trois tailles d’écran, thèmes clair et sombre. **Zéro erreur JavaScript, zéro erreur console, aucun débordement horizontal.**
- L’architecture est saine : moteurs natifs isolés, jobs durables et reprenables, écritures atomiques, validation stricte côté natif, historique d’annulation borné, originaux jamais réécrits.
- Le socle IA local existe déjà et fonctionne : Qwen3-4B en GGUF pour le pilote texte et voix, Whisper pour la transcription, MediaPipe pour les visages, RNNoise pour la voix.

Ce n’est pas un logiciel malade. C’est un logiciel dont **le tri et la retouche photo sont sous-dimensionnés** par rapport au reste.

## 2. Diagnostic : pourquoi le tri ne vaut pas Aftershoot

### 2.1 La netteté est mesurée sur une image de 128 pixels

`src/modules/image-worker.ts` réduit chaque photo à **128 px de large** avant de l’analyser (`small = resizeRaster(raster, 128)`). La netteté est la variance du laplacien sur cette miniature.

Mesure faite sur une photo réelle du catalogue, comparée à sa version floutée (gaussienne sigma 2,5, un flou franc) :

| Largeur d’analyse | Photo nette | Photo floue | Écart |
|---|---|---|---|
| **128 px (actuel)** | 4 964 | 4 028 | **1,23×** |
| 480 px | 2 485 | 513 | 4,84× |
| 1 024 px | 1 126 | 66 | **17,1×** |

À 128 pixels, une photo franchement floue conserve **81 % du score d’une photo nette**. Le tri ne peut pas faire la différence. C’est la cause racine.

Coût de la correction, mesuré : le laplacien à 1 024 px prend **2,0 ms par photo, soit 10 secondes pour 5 000 photos sur un seul cœur**. Le gain de discrimination est de 1,23× à 17×. Autrement dit, la qualité du tri peut être multipliée pour un coût négligeable.

### 2.2 La netteté est globale, jamais celle du sujet

Le score de `culling.ts` :

```
score = (protégée ? 10000 : 0)
      + min(100, log2(1 + netteté) × 7)
      − |luminosité − 0,48| × 50
      − écrêtage × 50
      − yeux fermés × 25
```

Rien ne dit où est le sujet. Une photo dont l’arrière-plan est net et les mariés flous gagne contre une photo où seuls les mariés sont nets. C’est l’inverse de ce qu’un photographe veut.

**Le plus frustrant : les boîtes des visages sont déjà calculées et jetées.** `public/vision-worker.js` produit `regions` (les rectangles de chaque visage), le type `Analysis.faces.regions` existe dans `model.ts`, et `withFaces()` ne les recopie pas. Tout est là, rien n’est branché.

### 2.3 Les signaux de visage sont réduits à un seul

MediaPipe FaceLandmarker renvoie 52 blendshapes par visage. Juno n’en lit que deux, `eyeBlinkLeft` et `eyeBlinkRight`. Sont ignorés : le sourire, l’orientation de la tête, le regard vers l’objectif, l’ouverture de bouche. Ce sont exactement les critères qui font trancher entre deux photos d’une même rafale.

### 2.4 Aucune notion d’identité

Rien ne permet de dire « les mariés ». Impossible d’exprimer « garde les photos où Camille et Louis sont nets et ont les yeux ouverts », qui est la demande réelle d’un photographe de mariage. C’est le cœur de ce que fait Aftershoot.

### 2.5 Le groupement de rafales est fragile

`groupSuggestions` compare chaque photo aux **24 précédentes** dans une fenêtre de **8 secondes**, avec un dhash 8×8 et une tolérance de Hamming ≤ 6. Une rafale de 10 images/seconde dépasse la fenêtre de 24 en 2,4 secondes : une même rafale est coupée en plusieurs groupes, et chaque morceau garde sa propre « meilleure », donc Juno propose des doublons.

### 2.6 La retouche automatique tient en trois lignes

`autoSettings()` dans `model.ts`, intégralement :

```js
exposure   = log2(0,46 / luminosité), borné à ±1 IL
highlights = écrêtage > 2,5 % ? −20 : −8
shadows    = luminosité < 0,35 ? +18 : +7
```

Puis un style Juno fixe. Il n’y a **aucune balance des blancs**, aucun contraste adaptatif, aucune analyse de la peau, aucune cohérence entre les photos d’une même scène, et surtout aucun apprentissage de ce que Johan corrige ensuite. Aftershoot construit un profil à partir de milliers de retouches passées ; Juno applique la même formule à tout le monde.

### 2.7 Tout est strictement séquentiel

- La boucle de job traite **une photo à la fois** (`while (job.cursor < job.total)`).
- `image-client.ts` n’instancie **qu’un seul worker** et refuse toute tâche tant que la précédente tourne (`if (active || !tasks.length) return;`).
- `culling.ts` n’instancie **qu’un seul worker MediaPipe**.

Sur un Mac à 10 ou 12 cœurs, Juno en utilise un. Le débit d’import et d’analyse est donc plusieurs fois inférieur à ce que la machine peut faire.

## 3. Plan 0.9.0

Quatre lots. Chacun est livrable seul, testé dans l’interface et mesuré sur un jeu de photos réel.

**Décisions de Johan, 23 septembre 2026 :** albums surtout en RAW Sony et Canon ; reconnaissance des personnes avec nommage ; retouche qui apprend de ses corrections, plus balance des blancs automatique et cohérence par scène, sans import de presets Lightroom ; ordre de livraison **A, puis D, puis C, puis B**.

### Vérifications faites avant de chiffrer

- **L’aperçu intégré aux RAW est accessible sans nouvelle dépendance.** `libraw-wasm` expose déjà `thumbnailData()` (« Fetch the embedded thumbnail preview »). Juno ne l’appelle jamais : `raster.ts` fait `imageData()`, qui décode le RAW entier. Le gain de vitesse du tri est donc à portée, sans rien ajouter.
- **Le bundle MediaPipe déjà embarqué (23 Mo) expose `ImageEmbedder`, `FaceDetector`, `ImageSegmenter` et `ObjectDetector`**, en plus du `FaceLandmarker` utilisé. La reconnaissance des personnes peut donc démarrer **sans nouvelle dépendance ni nouvelle licence**, avec un modèle d’embedding de l’ordre de 9 Mo.

### Lot A — Rendre le tri crédible (le plus rentable)

A0. **Analyser l’aperçu JPEG intégré aux RAW** via `thumbnailData()` au lieu de décoder le fichier complet. Décoder le RAW entier reste réservé à la retouche et à l’export. À mesurer : gain réel sur un album Sony ou Canon de Johan.


A1. **Analyser à 1 024 px au lieu de 128.** Conserver la miniature 128 px pour le dhash de groupement (elle y suffit), porter la netteté et l’exposition à 1 024. Coût mesuré : 10 s pour 5 000 photos.

A2. **Brancher les régions de visage déjà calculées.** Les stocker dans `Analysis.faces.regions`, puis mesurer la netteté **dans la boîte du plus grand visage** et non sur l’image entière. Un score « sujet net » distinct du score « image nette ».

A3. **Lire tous les signaux de visage utiles** : sourire, orientation de la tête, regard, par visage et non en agrégat. Un visage fermé sur douze invités ne doit pas peser autant qu’un marié aux yeux fermés : pondérer par la taille du visage.

A4. **Réparer le groupement de rafales** : fenêtre glissante sans plafond fixe, liaison par proximité temporelle et visuelle, et un seul choix par rafale réelle.

A5. **Expliquer chaque décision.** Chaque photo écartée affiche pourquoi, en français, avec le critère qui a tranché. C’est ce qui rend un tri utilisable : on corrige au lieu de subir.

### Lot B — Reconnaître les personnes

B1. Calculer une **empreinte de visage** par visage détecté avec l’`ImageEmbedder` déjà présent dans le bundle, et regrouper les visages identiques dans un projet. Mesurer la précision réelle sur un album de Johan avant d’aller plus loin : si un embedding généraliste ne suffit pas à distinguer deux invités, basculer vers un modèle facial dédié, avec la licence à vérifier à ce moment-là et pas avant.

B2. Permettre de **nommer une ou deux personnes** (« les mariés ») en cliquant sur une photo, et propager le nom à tout l’album.

B3. Ajouter au tri les critères qui en découlent : « les mariés sont présents », « les mariés sont nets », « les mariés ont les yeux ouverts ». Et au pilote IA les commandes correspondantes.

### Lot C — Une retouche qui apprend

C1. **Balance des blancs automatique**, pondérée par les zones de peau détectées. C’est ce qui manque le plus visuellement aujourd’hui.

C2. **Cohérence par scène** : regrouper par lumière et horodatage, calculer un réglage médian par scène, l’appliquer à la scène entière pour que 200 photos d’un vin d’honneur ne partent pas dans huit directions.

C3. **Apprentissage du style de Johan** : chaque fois qu’une photo est corrigée après la passe automatique, Juno enregistre l’écart entre ce qu’il avait proposé et ce que Johan a fait, par type de scène. Au bout de quelques albums, la proposition part déjà de son style. Cent pour cent local, aucun modèle à entraîner, aucune donnée qui sort.

C4. *Écarté par Johan pour cette version : l’import de presets Lightroom et Aftershoot.* À rouvrir si l’apprentissage par écarts ne converge pas assez vite.

### Lot D — La vitesse

D1. **Paralléliser les workers d’image** : un pool dimensionné sur le nombre de cœurs au lieu d’un worker unique.

D2. **Paralléliser l’analyse des visages** de la même façon.

D3. **Traiter les jobs par lots** au lieu d’une photo à la fois, en gardant la reprise après interruption qui fonctionne déjà.

D4. **Mesurer et afficher un débit réel** (photos par minute, temps restant) plutôt qu’une simple barre.

## 4. Points de blocage à lever

1. **Le décodage RAW domine tout, et c’est le cas ici** puisque les albums sont surtout en RAW. Parade confirmée : `thumbnailData()`. Risque restant : certains aperçus intégrés sont en basse résolution selon le réglage boîtier. À vérifier sur de vrais fichiers de Johan dès le début du lot A ; si l’aperçu d’un fichier est trop petit, retomber sur le décodage complet pour celui-là plutôt que de dégrader le tri en silence.

2. **Mémoire sur 5 000 photos.** Le catalogue vit dans IndexedDB côté renderer. Ajouter les empreintes de visage et les régions augmente la taille par photo. Il faut mesurer avant de décider où les stocker.

3. **Le poids du modèle d’identité est maîtrisé** : l’`ImageEmbedder` de MediaPipe ajoute environ 9 Mo à une application qui en embarque déjà 2 500. Le vrai risque n’est pas la taille mais la précision d’un embedding généraliste sur des visages : à mesurer avant de promettre « les mariés ».

4. **Windows et Mac Intel ne sont jamais testés réellement.** Les paquets sont produits, rien ne les lance. Tout gain de parallélisme doit être vérifié ailleurs que sur ce Mac ARM.

5. **Le plafond de 32 images clés par propriété** en motion design est très bas pour du motion sérieux. Les masques en acceptent 240. À aligner.

6. **Les fonctions livrées en 0.8.0 ne sont pas pilotables par l’IA.** Le catalogue de commandes du pilote local ignore les masques, le suivi, le relief, les poignées. « IA first » suppose que toute fonction nouvelle entre dans le catalogue le jour où elle est livrée. À intégrer dans la définition de terminé.

## 5. Ce que je ne recommande pas maintenant

- L’import de modèles 3D : très coûteux, sans usage immédiat pour un film de mariage.
- La parité After Effects : hors d’atteinte et sans intérêt commercial ici.
- Un modèle de retouche entraîné : Aftershoot a des millions d’images d’entraînement. L’apprentissage par écarts du lot C donne 80 % du bénéfice pour 2 % du coût.
