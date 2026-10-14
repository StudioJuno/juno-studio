# Juno Studio 1.1 : le vertical, les moments forts, les visages des groupes, et une application trois fois plus légère

Ce que la version apporte, dans l'ordre où vous le rencontrerez.

## Si vous venez de la 1.0

L'IA locale du pilote n'est plus livrée avec l'application. Les commandes des exemples marchent sans elle ; pour les formulations libres, installez-la une fois depuis le pilote (voir plus bas). C'est ce qui fait passer Juno Studio de 3,3 Go à 1 Go.

## Des teasers verticaux où l'on voit les mariés

Jusqu'ici, un plan 16/9 posé dans une séquence verticale était réduit pour tenir en entier : deux grandes bandes noires, et les mariés minuscules au milieu.

Dans **Montage**, après **Version verticale**, cliquez **Recadrer**. Juno repère les visages sur quelques images de chaque plan, zoome pour remplir le cadre, et place les personnes au bon endroit, avec de l'air au-dessus des têtes. Quand quelqu'un traverse le plan, le cadre le suit en douceur ; le zoom, lui, ne bouge jamais pendant un plan, parce qu'un zoom qui respire se voit tout de suite.

Plan par plan, dans les réglages, **Cadrage automatique** propose :

| Choix | Ce que fait Juno |
|---|---|
| Sur le couple | Serre sur les deux visages les plus marqués ; les invités du fond peuvent sortir du cadre |
| Sur tout le monde | Recule pour garder chaque visage |
| Réglé à la main | Ne touche plus à rien ; l'échelle et la position restent les vôtres |

Retoucher à la main l'échelle ou la position d'un plan recadré le passe de lui-même en « Réglé à la main ». Un nouveau clic sur **Recadrer** respecte le choix de chaque plan : il ne défait jamais une retouche.

Un 16/9 recadré en vertical ne laisse voir qu'un tiers de sa largeur. Quand un groupe est trop étalé pour y tenir, Juno vous le dit au lieu de faire semblant.

Ce qu'on a mesuré sur une vraie livraison 1080×1920 : avant, les bandes du haut et du bas étaient noires (niveau 0) ; après, plus aucune bande, et la mariée au centre du cadre.

## Les moments forts, trouvés à l'oreille

Le bouton de la bibliothèque s'appelle désormais **Analyser scènes, silences & moments forts**. En plus des coupes et des blancs, Juno relève les passages où le son ressort nettement : applaudissements, cris, rires, entrée de la musique.

Sur la carte du rush apparaît alors **« N moments forts · assembler »**, qui les pose sur la timeline.

Deux choix à connaître :

- **Chaque extrait commence 2,5 secondes avant le pic.** On applaudit après le baiser, et c'est le baiser qu'on veut voir.
- **Un moment se juge contre ce qui l'entoure**, pas en volume absolu. Le set du DJ est fort d'un bout à l'autre : il n'est pas un moment fort. Des applaudissements après un discours calme, si.

## Le tri voit enfin les visages des photos de groupe

Le tri cherchait les visages sur la vignette de 480 px, avec un détecteur fait pour les portraits. Sur une photo de groupe ou un plan large, il ne voyait presque personne : sur 950 photos de vos sept albums, **167 visages trouvés, sur 139 photos**.

Il les cherche maintenant sur l'image d'analyse de 1 024 px, relue par morceaux qui se chevauchent : **1 059 visages, sur 534 photos**. Concrètement :

- **« Yeux fermés » se déclenche là où il le doit** : sur les photos de groupe, sur les rires, sur les clignements. Sur la vignette, un sourire plissé passait souvent pour des yeux fermés ; à 1 024 px, 12 alertes sur 15 étaient justes à la vérification visuelle, les 3 autres étant des visages imaginés par le détecteur (une épaule, un arrière de tête). L'alerte met la photo « à vérifier », elle ne l'écarte pas.
- **Un invité minuscule au fond ne fait plus écarter un portrait** : on ne juge les yeux que des visages d'au moins 40 % de la largeur du plus grand.
- **Le visage principal pèse vraiment plus** dans la note : chaque visage compte selon sa taille rapportée au plus grand. Avant, sur un plan moyen, le clignement d'un invité du fond comptait autant que celui de la mariée.
- **Les personnes sont reconnues sur bien plus de photos**, puisqu'elles y sont enfin trouvées.

La netteté des visages garde sa calibration : sur 60 photos floutées à cinq degrés, le verdict « visage flou » ne diffère de l'ancien que sur 2 visages sur 254, deux visages floutés que l'ancien disait nets de justesse, et n'en manque aucun.

**Vos albums seront relus** à la prochaine « Préparer l'album » : la version d'analyse des visages a changé. Comptez environ un dixième de seconde de plus par photo.

## Le pilote comprend la géométrie des photos

| Vous écrivez | Juno fait |
|---|---|
| « pivote de 90 », « tourne à droite » | Un quart de tour dans le sens des aiguilles d'une montre |
| « tourne à gauche », « tourne d'un demi-tour » | Un quart de tour dans l'autre sens, ou un demi-tour |
| « recadre en 16/9 », « au format 4:5 », « recadre au carré » | Le plus grand cadre centré à ce format |
| « enlève le recadrage » | La photo entière |

Le format s'entend tel que vous voyez la photo : un « 16/9 » sur une photo tournée reste un 16/9 à l'écran.

« Redresse de 2 degrés » est compris, mais le redressement fin n'existe pas encore : Juno le dit tout de suite, au lieu de faire travailler l'IA locale pour rien.

## L'IA locale se télécharge à la demande

Dans le pilote, **Exemples et fonctionnement** propose **Installer l'IA locale** : 2,5 Go, une seule fois. Ensuite tout reste sur cet ordinateur, comme avant.

- Une coupure réseau n'oblige pas à tout recommencer : **Reprendre** repart là où le téléchargement s'est arrêté.
- Le fichier n'est mis en place qu'une fois vérifié octet pour octet contre l'original publié. Un fichier abîmé est jeté.
- S'il manque de place, Juno le dit avant de commencer, pas à 90 %.
- **Retirer** libère les 2,5 Go.

## Ce qui a changé sous le capot

- **La détection de visages voit enfin les visages petits dans le cadre.** Le modèle embarqué est fait pour les portraits ; sur un plan moyen, il ne trouvait personne. Juno relit maintenant l'image par morceaux qui se chevauchent.
- **Elle ne tombe plus quand plusieurs images arrivent en même temps.**
- **Un essai ne peut plus écrire dans vos vrais projets.** Lancée pour une vérification, l'application refuse de démarrer si elle vise votre dossier de travail.
- **Tous les tests se lancent d'un coup** (389 aujourd’hui) ; une partie n'était lancée que par une commande que personne ne tapait.
- **Les modèles ont leurs contrats** : voir `REGISTRE-MODELES.md`.

## Ce qui reste ouvert

- Le **redressement fin** d'une photo n'existe pas.
- Trois modèles n'ont pas encore de contrat : recherche par le sens, empreinte des visages, transcription.
