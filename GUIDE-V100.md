# Juno Studio 1.0 — le son et le montage d'un poste professionnel

Ce que la version apporte, dans l'ordre où vous le rencontrerez.

## La musique baisse toute seule sous les discours

Dans l'onglet **Son**, chaque plan porte désormais une **nature** : voix, musique, ambiance ou effet. Marquez vos discours en « Voix » et votre bande-son en « Musique », puis cochez **« Baisser la musique sous la voix »**.

Vous réglez quatre choses : la profondeur de l'atténuation, le temps de descente, le temps de remontée, et le maintien après la dernière syllabe. La profondeur est affichée en décibels, pas en pourcentage abstrait.

Deux précisions qui comptent. Une voix coupée ou à volume zéro n'atténue rien : il n'y a rien à couvrir. Et si vous **analysez le média** au préalable, l'atténuation suit les silences réels du discours au lieu de rester basse pendant toute la durée du plan, respirations comprises.

Techniquement, ce n'est pas un compresseur latéral. Juno calcule une enveloppe à partir du temps du montage, ce qui la rend continue d'un bout à l'autre du film. Un compresseur se serait réinitialisé toutes les dix secondes, à chaque frontière de rendu, avec une remontée audible à chaque fois.

## Retirer les blancs d'un discours

Toujours dans **Son**, sur un plan analysé : réglez le **blanc minimum à retirer**, et Juno vous annonce **combien de blancs il trouve et combien de temps cela représente**, avant de toucher à quoi que ce soit.

Quand vous validez, les morceaux se referment, l'image liée au son suit, et ce qui vient après sur les mêmes pistes est décalé d'autant. Une marge est gardée autour de chaque mot : aucun début de syllabe n'est rogné.

## Un niveau sonore juste à la livraison

La fenêtre d'export porte un choix **Niveau sonore livré** :

| Cible | Niveau |
|---|---|
| Réseaux sociaux | −14 LUFS |
| Podcast | −16 LUFS |
| Télévision (EBU R128) | −23 LUFS |
| Cinéma | −27 LUFS |

Le film est **mesuré en entier**, puis ramené à la cible. Deux passes, à la fin du rendu. C'est la seule façon d'être juste : le niveau d'un film n'est pas la moyenne des niveaux de ses morceaux.

Vous pouvez aussi choisir « Ne pas normaliser » et livrer le montage tel quel.

## Vingt-six transitions

Chaque plan vidéo porte une **transition d'entrée** et sa durée : fondu enchaîné, volets, glissements, cercles, iris, rideaux, diagonale, balayage circulaire, pixelisation, flou de passage, zoom, écrasements.

La transition se pose sur le plan **entrant**, pas entre deux plans. C'est ce qui permet d'en avoir une même quand le plan précédent est sur une autre piste ; il suffit que les deux se chevauchent pendant la transition.

## Débruitage, stabilisation, ralentis fluides

Sur un plan vidéo, trois réglages nouveaux, avec leur coût annoncé **avant** le rendu, parce qu'il est mesuré et non estimé :

| Réglage | Ce que ça fait | Ce que ça coûte |
|---|---|---|
| Débruitage léger | enlève le grain fin | gratuit |
| Débruitage moyen | **recommandé** pour les rushes d'église | rendu 1,7× plus long |
| Débruitage fort | la meilleure qualité disponible | rendu 90× plus long |
| Stabilisation | rattrape un plan à main levée | rendu 2,3× plus long |
| Ralenti fluide | images intermédiaires calculées | ce plan 16× plus long |

La stabilisation **recadre l'image** pour compenser les secousses : les bords sont perdus, d'autant plus que le réglage est fort. Juno le dit dans le panneau.

Le ralenti fluide n'est proposé qu'en dessous de 1× de vitesse, là où il a un sens.

## Le pilote IA connaît tout cela

En français, dans « Demander à Juno » :

- « baisse la musique sous la voix », « désactive le ducking »
- « retire les blancs », « supprime les silences de 1 seconde »
- « mets un fondu enchaîné de 2 secondes », « mets un volet », « mets un cercle »
- « débruite ce plan », « débruite fort », « débruite un peu »
- « stabilise à 80 »
- « ralenti fluide »

Attention à un mot : **« mets un fondu »** reste le fondu d'entrée du plan, comme avant. Pour une transition, dites **« fondu enchaîné »** ou nommez le motif.

## Ce que le pilote refuse, et pourquoi

Il ne vous laisse pas poser une transition plus longue que le plan, ni un ralenti fluide sur un plan qui ne ralentit pas, ni un débruitage sur une piste son. Il refuse d'activer l'atténuation s'il n'existe aucun plan marqué « Voix ». Et si vous demandez à retirer les blancs d'un média jamais analysé, il vous dit de l'analyser plutôt que de ne rien faire en silence.

## Juno apprend votre style depuis Lightroom

Dans l'espace Photos, à côté de « Préparer l'album », un bouton **« Mon style Lightroom »**. Choisissez un dossier que vous avez retouché dans Lightroom : Juno lit les fichiers `.xmp` et en tire votre patte. Le dossier n'est jamais modifié, rien ne sort de cet ordinateur.

Vous n'avez plus à attendre douze corrections dans Juno pour qu'il commence à vous ressembler.

### Ce qu'il apprend, et ce qu'il refuse d'apprendre

Sur votre album « Audrey-Ann et Clément », 756 retouches réelles :

| Ce qu'il retient | Valeur |
|---|---|
| Ombres | +21 |
| Noirs | −12 |
| Clarté | −5 |
| Vibrance | +2 |
| Contraste | +2 |

Ce sont les réglages que vous posez sur **toutes** vos photos : votre signature.

Trois réglages sont volontairement laissés de côté, et Juno vous le dit à l'écran :

- **L'exposition et les hautes lumières.** Vous les ajustez photo par photo, parce qu'elles dépendent de l'image. Juno continue donc de les mesurer plutôt que de copier une habitude.
- **La balance des blancs.** Lightroom l'écrit en kelvins absolus. Sans la balance d'origine du boîtier, le décalage que vous avez appliqué est indéterminable. Juno la mesure sur l'image, ce qui est plus sûr.
- **La netteté.** Lightroom la règle avec quatre paramètres liés, et pose 40 d'origine sur tout fichier brut. Le nombre n'aurait pas le même sens dans Juno.

### Ce que ça change, mesuré

Sur 60 photos de votre album **que Juno n'avait jamais vues** (le style appris sur 600 autres), l'écart entre ce que Juno propose et ce que vous aviez fait :

| Réglage | Écart avant | Écart après |
|---|---|---|
| Clarté | 5 | **0** |
| Noirs | 13 | **4** |
| Vibrance | 2 | **1** |
| Contraste | 2 | **1** |

## Juno apprend aussi le rendu de vos photos livrées

Deuxième bouton, **« Mon rendu livré »** : choisissez un dossier de photos que vous avez déjà données à vos clients. Juno mesure leur rendu, sans rien modifier.

C'est le chemin pour un photographe qui n'a pas de fichiers Lightroom, donc pour la plupart d'entre eux.

### Ce que vos albums publiés ont révélé

J'ai mesuré 134 photos de vos sept mariages en ligne. Votre tonalité, Juno la trouvait déjà : sa médiane tombe à **0,000** de la vôtre, vos noirs à 0,004 près, votre contraste à 0,022.

Deux écarts réels, en revanche :

| | Vos photos livrées | Juno avant |
|---|---|---|
| Chaleur | 0,090 | 0,007 |
| Saturation | 0,256 | 0,181 |

**Juno neutralisait la dominante chaude que vous gardez, et rendait 30 % moins saturé que vous.** C'est précisément ce que vos fichiers Lightroom ne pouvaient pas dire, puisque la balance des blancs y est écrite en kelvins absolus.

Corrigé, Juno tombe maintenant à **0,089 de chaleur pour 0,090 visé**, et 0,242 de saturation pour 0,256.

### Ce qu'un portfolio ne peut pas apprendre

La luminosité. Vos sept mariages vont de 0,329 à 0,612 de luminosité médiane : ce n'est pas votre style qui varie, ce sont les lieux et les heures. Viser une luminosité moyenne a été essayé, **et ça dégradait le résultat**. Juno continue donc de la mesurer sur chaque photo.

### Si ça ne marche pas### Si ça ne marche pas

Si Juno dit qu'il ne trouve aucun `.xmp` : dans Lightroom, sélectionnez vos photos et faites « Métadonnées → Enregistrer les métadonnées dans le fichier ». Les `.xmp` apparaissent à côté des RAW.

S'il dit qu'il ne trouve aucune régularité : c'est probablement un dossier qui mélange plusieurs mariages très différents. Un seul mariage donne un meilleur résultat.

# Chercher ses photos en écrivant ce qu'on cherche

Dans l'espace Photos, le champ de recherche accepte désormais une phrase. Tapez ce que vous cherchez, appuyez sur `Entrée` :

- « une mariée qui tient un bouquet de fleurs »
- « des verres à vin sur une table »
- « la pièce montée »

Juno classe l'album du plus proche au plus loin et n'affiche que ce qui ressemble vraiment. Une pastille indique combien de photos ont été trouvées ; un clic dessus revient à l'album entier.

Le nom de fichier continue de fonctionner comme avant : c'est la touche `Entrée` qui bascule en recherche par le sens.

## Ce qu'il faut faire d'abord

L'index se construit pendant **« Préparer l'album »**. Une photo qui n'est pas passée par là n'est pas trouvable, et Juno vous le dit plutôt que de renvoyer une liste vide.

Comptez environ **une heure et demie pour cinq mille photos**, en arrière-plan. C'est lent, et c'est un choix : une version six fois plus rapide existe, mais elle sort la bonne photo en première place une fois sur quatre au lieu de trois fois sur quatre.

## Ce que ça sait faire, et ce que ça ne sait pas

Le modèle encode le **sujet** d'une photo, pas chacun de ses détails.

Vérifié sur de vraies photos de vos albums : « une mariée en robe de dentelle blanche tenant un bouquet » sort la bonne photo en première place. « Une porte en bois peinte en vert », qui est le fond de cette même photo, arrive vingtième. Ce n'est pas un réglage à corriger, c'est la limite de la méthode.

Ce qui marche bien : les scènes, les objets qui occupent l'image, les actions. Ce qui marche mal : un détail du fond, un texte écrit sur une pancarte, l'identité d'une personne. Pour les personnes, utilisez la reconnaissance des visages, qui est faite pour ça.

## Le modèle, et pourquoi celui-là

SigLIP 2, publié par Google sous licence Apache 2.0, embarqué avec l'application. Rien ne part sur le réseau : ni vos photos, ni vos recherches.

Il est **multilingue**, donc il comprend le français directement, sans traduction.

J'avais d'abord annoncé CLIP d'OpenAI dans le plan. En vérifiant sa licence, j'ai trouvé que sa carte officielle exclut explicitement tout déploiement, commercial ou non, et que les conversions techniques qui circulent ne déclarent aucune licence. Pour un logiciel que vous installerez chez d'autres photographes, c'était rédhibitoire.

# Ce qui n'est pas dans cette version, et pourquoi

## Le détourage du sujet

Il a été construit, essayé sur vos photos, et retiré.

Le modèle qui tourne vite (MODNet, 336 ms par photo) est fait pour des portraits isolés. Sur votre couple enlacé, il trouve la bonne silhouette mais laisse des trous à l'intérieur, sur la robe et les visages. Sur votre photo de discours, avec six invités à des profondeurs différentes, il ne rend que des taches sans forme.

Un masque troué donnerait une retouche marbrée : pire qu'une fonction absente. Le modèle qui ferait mieux (BiRefNet) ne démarre pas dans le moteur de l'application.

Le débruitage haute sensibilité et la suppression d'objet en dépendaient : ils n'ont pas été commencés.

## La notarisation

Toujours bloquée chez Apple, pour la raison expliquée dans `NOTARISATION.md` : votre compte n'est pas activé pour App Store Connect.

Vos paquets sont signés correctement — l'archive Mac passe toutes les vérifications d'Apple sauf celle du ticket. Sur le Mac d'un autre photographe, macOS affichera un avertissement tant que ce ticket manque.

## Windows

Le paquet est produit mais **non signé** : cela demande un certificat Windows, distinct de celui d'Apple, que vous n'avez pas encore.

Et il n'a été lancé ni sur Windows ni sur un Mac Intel : je n'ai accès à aucune de ces deux machines. Tout ce qui est écrit ici a été vérifié sur ce Mac ARM.
