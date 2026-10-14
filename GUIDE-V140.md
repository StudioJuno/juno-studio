# Juno Studio 1.4.0 : le dérushage automatique

Juno regarde chaque rush à votre place, découpe ses passages en **bons**, **à vérifier** et **masqués**, et ne vous propose plus que ce qui est utilisable. Rien n'est supprimé : un passage masqué se remontre d'un clic. Le détail technique et les mesures sont dans `PLAN-DERUSHAGE.md` (partie 11).

## Ce qui change pour vous

### Sans rien faire
- **À l'import, chaque rush vidéo est dérushé en fond.** Environ 5 s par minute de rush, soit un quart d'heure pour 3 h de rushes. La tâche cède toujours la place à vos exports et reprend où elle s'était arrêtée. Les rushes déjà importés sont dérushés à l'ouverture du projet.
- **Sous chaque rush de la bibliothèque**, une fine bande montre ses passages : vert, bon ; ocre, à vérifier ; hachuré, masqué. Et sa durée utile.

### Ce qui est masqué, ce qui est à vérifier

Tant que les réglages n'ont pas été mesurés sur vos propres rushes, **seul l'inutilisable évident est masqué** :

| Masqué | À vérifier (visible) |
|---|---|
| Noir (cache d'objectif, caméra retournée) | Flou léger, ou flou long, ou flou d'un plan entier (souvent voulu) |
| Flou fort et passager à côté d'un passage net (mise au point qui décroche) | Bougé léger |
| Bougé fort (secousses, caméra portée entre deux plans) | Mouvement brusque (souvent voulu) |
| Début ou fin d'enregistrement agités (l'appui sur le bouton) | Surexposé |
| Rush de moins d'une seconde | Rien ne bouge depuis plus de 2 min (caméra oubliée en marche) |
| | Bon passage très court coincé entre deux défauts |

Un panoramique, un travelling ou un plan de drone ne sont jamais pris pour du bougé.

### L'onglet « Dérush »
- **Tous les rushes, rangés par blocs de la journée** (une pause de plus de 20 min ouvre un bloc), avec leur bande de passages, leur durée utile, leur **type de plan** (gros plan, plan moyen, plan large, sans visage), leur **mouvement** (fixe, maîtrisé, à la main) et leur **caméra**.
- **Des filtres** : avec du masqué, à vérifier, en attente ; par mouvement, type de plan, caméra.
- **Un lecteur de passage** : cliquez un passage, il se lit et s'arrête à sa fin (ou en boucle). **Garder**, **Masquer**, **Rendre à l'analyse**, **Ajouter** au montage, **Suivant à revoir**. Au clavier : espace, flèches, G (garder), M (masquer), A (ajouter). Vos choix priment toujours, même si le rush est relu plus tard.
- **« Pré-monter »** : une nouvelle séquence avec les passages utiles des rushes affichés, dans l'ordre de la journée. C'est le bout-à-bout de départ ; votre montage en cours reste dans la liste des séquences.

### Dans le montage
- **Ajouter un rush** (clic, double-clic ou glisser sur la timeline) **ne pose que ses passages utiles**, à la suite, et vous dit ce qui a été laissé de côté. **Maj + clic** pose le rush entier.
- **« Retirer les passages inutilisables »**, dans les réglages d'un plan déjà posé : comme « Retirer les blancs », en une seule annulation.
- **Le pilote** comprend « dérushe les rushes », « pré-monte les rushes » et « retire les passages inutilisables » (ou « retire les flous et bougés »).

### Corrigé au passage
- Une séquence nouvellement créée (copie de secours, pré-montage) apparaît tout de suite dans la liste des séquences ; on ne pouvait plus y revenir avant de rouvrir le projet.

## Ce que cette version ne fait pas encore
- **Nommer les blocs de la journée** (« Cérémonie », « Soirée »…) et **chercher une phrase dans les rushes** : prévus avec le moteur d'IA local, après le réglage sur vos rushes.
- **La parole** : l'analyse « scènes, silences & moments forts » reste à lancer rush par rush.
- Les heures de tournage viennent des caméras : une caméra mal réglée range ses rushes au mauvais moment de la journée.

## Ce qu'il nous faut de vous
Un dossier de vrais rushes d'un ou deux tournages (Sony, Canon, drone), même sans le projet de montage : Juno les lit sans rien y écrire, et les réglages seront ajustés sur ce que vous auriez gardé.
