# Juno Studio 1.2 : les photos redressées, et le tri envoyé à Lightroom

Ce que la version apporte, dans l'ordre où vous le rencontrerez.

## Les photos se redressent seules, quand c'est sûr

C'était le vrai écart avec Aftershoot : il redresse et recadre chaque photo, Juno ne savait pas.

Juno mesure maintenant l'inclinaison de chaque photo à l'import, sur ses lignes : les verticales (murs, colonnes, chambranles) et l'horizon, reconstitué même quand des personnes le coupent. Puis il décide :

| Ce que Juno voit | Ce qu'il fait |
|---|---|
| Des lignes sûres, jusqu'à 5° | **« Préparer l'album » redresse la photo**, et la recadre juste assez pour qu'aucun coin ne soit vide |
| Des lignes moins sûres, ou plus de 5° | Il **propose** : dans l'éditeur, « Redresser de 1,4° vers la gauche ? » ; un clic l'applique |
| Une photo déjà droite | Rien |
| Pas de lignes fiables (portrait serré, nature, foule) | Rien, il s'abstient |
| Plus de 10° | Rien : l'inclinaison est tenue pour voulue (une danse, un plan de biais) |

Juno s'abstient sur environ la moitié des photos. C'est voulu : une photo redressée de travers se voit bien plus qu'une photo pas redressée. Sur 300 photos de l'album d'Audrey-Ann et Clément, quand il redresse seul, il va dans le même sens qu'Aftershoot 44 fois sur 51, et sur le plus gros désaccord vérifié à l'œil, c'est lui qui avait raison.

Une photo déjà retouchée n'est jamais redressée par la passe d'album.

### À la main

Dans **Cadrage & finition** :

- le curseur **Redressement**, de −45° à 45°, au dixième de degré (positif : dans le sens des aiguilles d'une montre) ;
- le bouton **Redresser** pose l'angle mesuré, proposition comprise ; sur une photo sans lignes, il le dit ;
- le cadre se réduit tout seul pour qu'aucun coin ne soit vide, et garde le format de la photo ou celui que vous avez choisi.

Le redressement n'est pas copié par **Copier sur les photos gardées** : chaque photo a sa propre inclinaison.

### Au pilote

| Vous écrivez | Juno fait |
|---|---|
| « redresse », « redresse la photo », « redresse l'horizon » | L'angle mesuré, proposition comprise |
| « redresse de 2 degrés à gauche », « tourne de 1,5° à droite » | Ajoute cet angle au redressement actuel |
| « redressement 0 » | Remet la photo d'aplomb d'origine |
| « recadre en 16/9 » sur une photo redressée | Le plus grand 16/9 sans coin vide |

Les photos importées avant la 1.2 sont mesurées la première fois qu'on les redresse, ou à la prochaine « Préparer l'album ».

## Le tri part dans Lightroom

**Exporter ▾** propose maintenant deux choses : **Exporter les photos…**, comme avant, et **Envoyer le tri à Lightroom…**.

Juno écrit un petit fichier .xmp à côté de chaque RAW. Lightroom Classic y lit :

- **les étoiles** ;
- **la couleur**, selon les étoiles, comme vous le faites avec Aftershoot : 5 Vert, 4 Bleu, 3 Jaune, 2 Rouge, 1 Violet (Juno lit les noms dans votre Lightroom, pour qu'ils s'affichent en couleur et non en blanc) ;
- **des mots-clés** : Juno › Tri › Gardée, Écartée, Protégée, et les personnes que vous avez nommées.

Une photo écartée ne reçoit ni note ni couleur, mais le mot-clé « Écartée » : Lightroom ne sait pas lire le drapeau « Rejetée » dans un .xmp. Filtrez ce mot-clé, puis appuyez sur X.

**Avant d'envoyer, Juno montre le bilan** : combien de fichiers seront créés, complétés, et ce qui bloque. Rien n'est écrit avant que vous cliquiez **Envoyer à Lightroom**.

Ce que Juno ne fait jamais :

- **toucher à un original**, ni à un JPEG, un TIFF ou un DNG (ils portent leurs métadonnées en eux : ils sont comptés « non concernés ») ;
- **effacer vos retouches** : dans un .xmp existant, Juno ne change que ses étoiles, sa couleur et ses mots-clés ; les réglages d'Aftershoot ou de Lightroom gardent leurs octets ;
- **écraser une note posée ailleurs** sans que vous l'ayez demandé : une case le propose quand c'est le cas.

**Annuler l'envoi** remet chaque fichier comme avant, sauf ceux que vous avez modifiés depuis dans Lightroom.

### Si les originaux ont bougé

Juno retient désormais où vous rangez chaque fichier importé. Pour les photos importées avant la 1.2, ou si vous avez déplacé le dossier :

- **Retrouver le dossier des originaux…** : choisissez le dossier, Juno reconnaît chaque fichier à son empreinte, même renommé ailleurs ;
- **Préparer un dossier pour Lightroom…** : Juno copie ses propres copies vérifiées des originaux, avec leur .xmp, dans un nouveau dossier à importer. Utile quand la carte est rendue.

Un disque débranché est nommé dans le bilan.

### Si les photos sont déjà dans Lightroom

1. Dans Lightroom, **Cmd+S** (Enregistrer les métadonnées dans le fichier).
2. Envoyez depuis Juno.
3. Dans Lightroom, **Lire les métadonnées à partir des fichiers**.

Sans l'étape 1, Lightroom remplacerait vos retouches récentes par celles du fichier.

Au pilote : « envoie le tri à Lightroom » ouvre la fenêtre.

## Juno face à Aftershoot, sur votre album entier

Les 3 552 RAW du mariage d'Audrey-Ann et Clément sont passés dans le tri de Juno, sans rien écrire dans leur dossier. Le détail est dans `COMPARAISON-AFTERSHOOT.md` ; l'essentiel :

- **Le tri de Juno ne remplace pas Aftershoot.** Il garderait 2 707 photos quand vous en avez livré 756 : il ne reconnaît presque pas les rafales, et dans une rafale, il choisit votre photo une fois sur trois, à peine mieux que le hasard.
- **Le redressement, si** : quand Juno redresse seul, il va dans le sens d'Aftershoot neuf fois sur dix.
- **Deux corrections sont identifiées et mesurables** : juger la netteté d'un visage quelle que soit sa taille (aujourd'hui, un visage flou passe pour net), et reconnaître les rafales par le sens de l'image plutôt que par une empreinte de 64 bits. Elles ne sont pas dans cette version : elles changent le tri de tous les albums et demandent votre accord.

## Ce qui reste ouvert

- La couleur en français et le libellé exact du menu de Lightroom sont tirés du code de Lightroom, pas encore vus dans un catalogue d'essai.
- L'envoi à Lightroom est fait pour macOS ; sous Windows, les noms de couleur sont les noms français par défaut.
- Juno ne recadre pas encore pour la composition : il ne recadre que ce que le redressement impose. Aftershoot, lui, a recadré pour la composition 276 des 756 photos livrées de l'album d'Audrey-Ann et Clément, plus d'une sur trois.
