# Validation de la 1.2.1

Mesuré le 28 septembre 2026 sur le Mac ARM de Johan. Les RAW de l'album d'Audrey-Ann et Clément ont été lus sur place, en lecture seule ; aucun fichier n'a été écrit dans leur dossier. Les vrais projets n'ont pas été touchés. Preuves dans `work/refonte-v121`.

## La mesure retenue, et comment

1. **Jeu de visages** : les visages des 2 296 photos à visage de l'album, recadrés dans l'image d'analyse de 1 024 px (exactement comme l'application la fabrique) et à pleine résolution.
2. **Vérité à l'œil** : 200 visages tirés au hasard, par moitié parmi les photos qu'Aftershoot dit floues et parmi les livrées, toutes tailles ; zone des yeux à 100 % ; trois juges indépendants. 166 étiquettes unanimes, 199 à la majorité, 92 à 95 % d'accord deux à deux. 189 exploitables (110 nets, 79 flous). Constat au passage : 39 des 105 photos qu'Aftershoot dit floues sont nettes à l'œil.
3. **Quatre familles de mesure** explorées en parallèle, réglées sur le matin, vérifiées sur l'après-midi. AUC à l'œil sur l'image de 1 024 px :

| Mesure | AUC à l'œil |
|---|---|
| Ancienne (laplacien à 480 px) | 0,799 |
| **Zone des yeux** (retenue) | **0,965** [0,939 ; 0,987] |
| Multi-échelle | 0,931 |
| Largeur des bords | 0,918 |
| Taille fixe | 0,699 |

4. **Vérification contradictoire**, trois angles :
   - stabilité : tient aux décalages de boîte et de grille, au gris non arrondi et à l'assombrissement ; le bruit la fait monter (flous manqués, jamais de fausse alerte) ;
   - contrôle à l'œil en aveugle de 154 visages non étiquetés, autour du seuil ; c'est lui qui a fixé les deux seuils (0,262 et 0,27) ;
   - flou de synthèse : la mesure décroît avec le flou et se déclenche au même flou en pixels quelle que soit la taille du visage.
5. **Domaine** : la source réduite à 1 024 px doit faire au moins 3 000 px, mesuré en simulant des sources plus petites sur les visages jugés à l'œil (nets signalés à tort : 0 depuis 6 720 px, 3 depuis 3 072, 22 depuis 2 048, 37 depuis 1 616).

## Relecture du code : 7 défauts trouvés et corrigés avant livraison

- Les raisons « à vérifier » étaient calculées sans la personne désignée, le verdict avec : une mariée floue derrière un invité net restait gardée d'office.
- Une lecture faite sur la vignette, faute d'original, était marquée à jour pour toujours.
- Un visage très flou, sans bord mesurable, échappait à « à vérifier » alors que le verdict le disait flou.
- La bande des yeux glissait vers le nez sur un visage coupé par le haut du cadre.
- Les petites sources (aperçu Sony de 1 616 px) faisaient passer des visages nets pour flous.
- « Visages non vérifiés » restait collé après une relecture réussie.
- Défaut plus ancien : les photos verticales étaient redécodées à chaque passe.

Chacun a son test.

## Les tests

| Suite | Résultat |
|---|---|
| `npm test` | **443 au vert** : 311 rapides (dont 15 pour la netteté des visages) + 132 natifs |
| `npm run test:modeles` sur les sources | **6 contrats sur 6** ; le contrat du tri exige désormais la nouvelle mesure : portrait à 0,313, les 5 visages du groupe de 0,294 à 0,298, verdict « Visage net et souriant », aucune raison |
| `npm run test:modeles` sur le paquet livré | **6 contrats sur 6**, sur l'application ARM notarisée de `release/v1.2.1` |

Livraisons, dans `release/v1.2.1/` : Mac ARM et Mac Intel signés, notarisés, agrafés et réarchivés après agrafage (635 et 643 Mo), archives réextraites puis acceptées par Gatekeeper (`source=Notarized Developer ID`, version 1.2.1) ; Windows archivé non signé (722 Mo). Deux envois à Apple ont été coupés par le réseau, repris automatiquement. **La 1.2.1 n'est pas installée** : la 1.2.0 reste dans /Applications en attendant l'accord de Johan.

## Sur l'album entier, avec le vrai code

| | 1.2.0 | 1.2.1 |
|---|---|---|
| Visages flous à l'œil signalés « à vérifier » | 0 / 79 | **46 / 79** |
| Visages nets à l'œil signalés à tort | 0 / 110 | **0 / 110** |
| Livrées « peu de détails » | 50 / 756 | **17 / 756** |
| Livrées « visage flou » ou « à vérifier » | 0 / 756 | 32 / 756 |
| Non livrées « visage flou » ou « à vérifier » | 0 / 2 796 | 150 / 2 796 |
| Photos gardées d'office | 2 707 | 2 631 |
| Précision / rappel face aux livrées | 22 % / 79 % | 23 % / 78 % |

Des 33 visages flous non signalés : 12 épargnés à raison (vérifié à l'œil : un invité flou devant la personne nette), 21 flous légers que la mesure ne voit pas.
