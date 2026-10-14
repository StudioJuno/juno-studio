# Juno Studio 1.2.2 : une seule photo par rafale, la meilleure

## Ce qui change pour vous

« Préparer l'album » reconnaît enfin les rafales, et n'en garde qu'une image.

- **Une rafale est reconnue même à main levée.** Juno regarde l'heure au millième (une rafale tient dix images dans la seconde), puis vérifie que les images se ressemblent vraiment : même scène, même cadrage à quelques pixels près. Avant, il fallait des images presque identiques au pixel : 17 % seulement des images voisines d'une même rafale étaient réunies.
- **Une seule image est gardée, la meilleure.** Juno suit chaque personne d'une image à l'autre et la compare à elle-même : un clignement coûte, un sourire compte, un visage qui se détourne ou sort du cadre aussi, et la plus nette l'emporte. Sur un baiser, où les yeux sont fermés partout, ce n'est plus un défaut : c'est la netteté qui départage.
- **Les autres images de la rafale ne sont pas écartées.** Elles restent « à vérifier », avec la raison « Autre image de la rafale : comparez avant d'écarter » et une phrase qui dit pourquoi une autre a été préférée (« plus nette », « yeux mieux ouverts », « plus beau sourire »…). « Comparer les rafales » les montre côte à côte.
- **Une longue rafale est coupée en tranches de 2,5 s**, comme le fait Aftershoot : une image par tranche. Une rafale de quatre secondes donne donc deux images.
- **Une personne que vous avez nommée compte autant que le plus grand visage** dans le choix, même si elle est petite dans le cadre.
- **Deux boîtiers de modèles différents ne se mélangent pas** : chacun a ses rafales. Deux boîtiers du même modèle se distinguent seulement par l'image.

Vos albums seront relus à la prochaine « Préparer l'album » : c'est ce qui leur donne la nouvelle empreinte. Sur un album déjà préparé, vos statuts ne bougent pas (Juno ne défait jamais un tri déjà posé) : la nouvelle sélection se voit avec « Voir les propositions » et « Comparer les rafales ».

## Ce qu'on a mesuré

Sur l'album entier d'Audrey-Ann et Clément (3 552 RAW, 756 livrées), avec le vrai code de l'application :

| | 1.2.1 | 1.2.2 |
|---|---|---|
| Rafales reconnues (Aftershoot en voit 806) | presque aucune : 3 046 groupes | **1 053** |
| Photos gardées d'office | 2 631 | **889** |
| Part des gardées que vous avez livrées | 23 % | **34 %** |
| Vos photos livrées gardées telles quelles | environ 590 | 306 |

La dernière ligne baisse, et c'est voulu : Juno ne garde plus qu'une image par rafale. Dans 353 des 691 rafales qui contiennent une photo livrée, il garde exactement la vôtre ; dans les 338 autres, il en garde une voisine. La vraie question est donc de savoir si cette voisine vaut la vôtre.

Et la question qui compte : **quand Juno ne prend pas la photo que vous avez livrée, son choix est-il moins bon ?** 80 rafales tirées au hasard, les deux images côte à côte, visage à 100 %, sans savoir laquelle est la vôtre ; trois juges indépendants :

| Verdict à la majorité | Rafales |
|---|---|
| Le choix de Juno est meilleur | 23 |
| Les deux se valent | 31 |
| Votre photo livrée est meilleure | 24 |
| Pas de majorité | 2 |

Autrement dit, quand il diverge, Juno ne choisit ni mieux ni moins bien que vous. Rapporté à l'album : dans environ 580 des 691 rafales (84 %), la photo gardée par Juno vaut la vôtre ; dans une centaine, la vôtre est meilleure. Les vrais ratés (votre photo nettement meilleure) sont 11 sur 80 : une expression manquée (bouche ouverte en pleine phrase), une personne qui se détourne ou cache son visage, un œil fermé sur un visage de profil. La lecture des visages ne voit pas ces cas-là.

## Ce que ça ne change pas

- **Le tri garde encore un peu plus que vous** : 889 photos pour vos 756. Juno garde une image de chaque rafale, même d'une scène que vous avez jugée sans intérêt ; il ne sait pas encore dire qu'une rafale entière ne mérite rien.
- **164 meilleures images de rafale restent « à vérifier »** plutôt que gardées : un visage flou, des yeux peut-être fermés, des hautes lumières. C'est à vous de trancher.
- **16 % des images voisines de deux rafales différentes sont réunies à tort** : surtout des rafales continues qu'Aftershoot coupe en deux, sans rien de visible à l'image.
- **L'heure au millième n'est lue que sur les CR3 Canon et les fichiers dont l'EXIF la porte** (JPEG, HEIC, DNG, la plupart des NEF et ARW). Sans elle, Juno compte à la seconde près et peut couper une rafale en deux.
- **Aucun album Sony, Nikon ou Fuji n'a été mesuré.**
