# Validation de la 1.4.0 : le dérushage

Demande de Johan (1er octobre 2026) : « analyser tous les rushes, mettre en non visible les moments flous, bougés ou inutilisables, et classer les rushes ». Plan et décisions : `PLAN-DERUSHAGE.md` (parties 9 et 11). Guide : `GUIDE-V140.md`.

## Les tests

| Suite | Résultat |
|---|---|
| `npm run test:unit` (vitest) | 629 tests, tous verts (dont `tests/derush-edit.test.ts` : passages et décisions, morceaux utiles, ajout au montage, retrait des passages inutilisables, pré-montage, blocs de la journée, type de plan, consignes du pilote) |
| `npm run test:native` | 223 tests, tous verts, dont : |
| · `tests/derush.test.cjs` | les règles sur des relevés fabriqués : noir (et la soirée sombre qui n'en est pas), caméra oubliée en marche, flou passager masqué, flou tenu ou entre deux coupes à vérifier, tremblement masqué et panoramique bon, rush accidentel, départ agité, bon passage trop court, coupes, corrélation de phase par zones (un sujet qui bouge devant une caméra fixe ne la fait pas bouger), lecture de `metadata=print` |
| · `tests/derush-native.test.cjs` | la vraie chaîne (mire filmée, aperçu du moteur, lecture par tranches, règles) : les défauts retrouvés à leur place, le jumeau propre entièrement bon, la même découpe d'une traite ou par tranches, la reprise à la tranche suivante après interruption, la relecture complète quand l'aperçu change |
| · `tests/derush-job-native.test.cjs` | la file de tâches : dérushage parti seul après l'import, qui cède sa place à une tâche demandée, décisions enregistrées puis gardées quand l'aperçu est refait, rien de relu pour un rush déjà dérushé ; un aperçu illisible noté en échec sans bloquer les autres ni être relu ; un dérushage annulé qui ne repart pas pour ses rushes |
| Parcours réel dans l'application, sur les sources construites puis sur le paquet notarisé (profil jetable) | import de trois rushes, dérushage en fond, onglet Dérush, lecture d'un passage masqué, « Garder », raccourcis du montage bloqués dans le lecteur, pré-montage (nouvelle séquence listée), ajout d'un rush entièrement masqué refusé avec sa raison, Maj + clic, « Retirer les passages inutilisables » ; type de plan relevé en fond |

## Les relectures contradictoires

Deux relecteurs indépendants, l'un sur le moteur et la file de tâches, l'autre sur l'interface et la logique de montage, chacun en reproduisant ses constats. 22 constats ; tous les fondés corrigés, avec un test chacun.

Moteur :
- **Un aperçu illisible bloquait le dérushage de tous les rushes suivants du projet**, à chaque relance. Chaque rush est maintenant traité à part : son échec est noté (`derushEchec`), il n'est relu que si son aperçu change, et la tâche continue.
- **Le catalogue entier était réécrit à chaque tranche** pour l'avancement : l'avancement reste en mémoire, il est écrit avec les résultats.
- **Le mouvement était décalé quand l'image d'un fichier commence après son son** (0,5 s mesuré) : les coupes n'étaient plus vues. Corrigé (l'image n de la lecture est à ss + n/12, cadence constante imposée).
- **Un dossier avec une apostrophe (« O'Brien ») faisait échouer FFmpeg** : le chemin perdait son apostrophe. Corrigé pour le dérushage, et du même coup pour les LUT et le débruitage de la voix, qui avaient le même défaut.
- **Une étiquette de fichier comme « Foo (Bar » faisait échouer la lecture du média** (import compris) : plus d'expression construite sur l'étiquette.
- Un dérushage demandé à la main retardait les exports : il passe en fond, comme l'automatique. Un dérushage annulé repartait au premier import suivant : seuls les nouveaux rushes sont prévus. Une passe de nouvelles règles ignorait « céder la place » : corrigé. Deux prévisions simultanées dupliquaient les tâches : elles se suivent.
- Le calcul tournait par blocs de 130 ms sur le processus qui sert l'interface : par blocs de 2 s de rush, la main rendue entre deux ; les règles d'un rush de 2 h passent de 1,0 s à 0,36 s.
- Un rush vertical était écrasé dans la miniature du mouvement : on en garde la bande centrale.

Interface :
- **« Pré-monter » pendant un enregistrement perdait le dernier geste** du montage ouvert, et « annuler » juste après pouvait écraser ce montage : refusé pendant un enregistrement, l'annulation repart de zéro sur la nouvelle séquence.
- **« Retirer les passages inutilisables » laissait les passages du début et de la fin**, les plus fréquents (l'appui sur le bouton), et une image noire au bout : ils partent, et un plan entièrement masqué aussi.
- **Les raccourcis du montage (supprimer, couper, lire) agissaient depuis l'onglet Dérush** après un clic sur « Garder » : ils y sont coupés, et le clavier revient au lecteur après chaque décision ; une touche tenue n'ajoute plus un plan par répétition.
- **« supprime les masques » et « enlève les flous » coupaient des passages** au lieu de viser les masques de flou : le pilote demande « les passages… », « les inutilisables » ou « les flous et bougés ».
- **Un rush sans heure de tournage mélangeait le pré-montage** : les rushes datés passent d'abord, dans l'ordre de leurs heures.
- L'onglet tient des centaines de rushes (lignes mémorisées, pages de 80, bandes sans un bouton par passage) ; les types de plan s'écrivent par lots ; la carte d'un rush ouvre le Dérush sur lui ; Maj au lâcher pose le rush entier ; le pré-montage prend le format du film, pas celui d'une version verticale ouverte ; le pilote dit vrai quand le pré-montage n'a pas pu se faire.

## Le banc (sans vrais rushes)

Aperçus fabriqués par le moteur de l'app, puis relevés et règles de `electron/video/derush.cjs`.

| Média | Résultat |
|---|---|
| Rush d'essai d'une seule prise, 60 s, sept défauts | bougé masqué 100 % ; flou fort masqué 90 % (bords en fondu à vérifier) ; noir masqué 100 % ; surexposé à vérifier 100 % ; flou léger à vérifier 96 % ; panoramique bon 100 % ; image figée bonne (non cherchée, voir plus bas) |
| Son jumeau propre | 100 % bon |
| 5 films publiés de Juno (3 min 12, déjà montés) | aucun passage utilisable masqué ; seuls de vrais noirs (fondus) le sont ; à vérifier de 0 à 14 % selon le film |
| Drone (panoramique lent qui tourne), main posée, marche modérée | rien de masqué |
| Marche très secouée | masquée en entier |
| Vitesse | 4,3 à 5,6 s par minute de rush (tâche de fond limitée à 2 fils) |

## Trois règles du plan changées par les mesures

- **L'image figée n'est pas cherchée.** L'encodeur de l'aperçu efface le bruit du capteur : une image figée et un plan sur pied d'un objet immobile donnent les mêmes mesures (0,001 à 0,035 de différence moyenne des miniatures, l'un comme l'autre). Remplacée par « rien ne bouge depuis plus de 2 min », à vérifier (la caméra oubliée en marche).
- **Le flou fort n'est masqué que passager**, à côté d'un passage net du même plan : un plan volontairement flou du film de mariage publié était masqué.
- **Le mouvement de la caméra se mesure sur six zones** : un jongleur filmé sur pied passait pour un bougé fort.

## Ce qui reste à mesurer

Les seuils sont réglés sur des défauts fabriqués et des films montés : **le réglage sur de vrais rushes Sony, Canon et DJI reste à faire** (lot 0 du plan). Les types de plan (seuils de taille de visage) aussi.

## Le paquet

`release/v1.4.0/` : Mac puce Apple et Mac Intel **signés, notarisés, agrafés et acceptés par Gatekeeper** (vérifié sur les archives distribuées, après réarchivage), Windows non signé comme les versions précédentes. Empreintes dans `SHA256SUMS.txt`. Le parcours réel a été rejoué sur l'application Mac (puce Apple) empaquetée et notarisée : mêmes résultats que sur les sources.

**Installé le 1er octobre 2026** avec l'accord de Johan (catalogue sauvegardé avant), et proposé sur la page de téléchargement du site ; les trois archives retéléchargées depuis le bucket ont la même SHA-256 que les originales.

Après l'empaquetage, une correction mineure est entrée dans les sources : dans l'application, un média importé est lu dans sa copie sûre, sous un autre nom, et la caméra ne se devinait plus par le nom du fichier (C0001.MP4, MVI_…, DJI_…) ; les étiquettes de fichier (Sony XAVC, DJI, iPhone) marchaient. Elle partira avec la version suivante.
