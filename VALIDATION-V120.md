# Validation de la 1.2.0

Mesuré le 27 septembre 2026 sur le Mac ARM de Johan. Chaque essai a tourné sur un profil jetable ; les vrais projets n'ont pas été touchés. Les RAW de l'album d'Audrey-Ann et Clément (`~/Downloads/2026-09-19---clement-julienne-et-audrey-ann--faa6ff69`) ont été **lus sur place ou copiés** : aucun fichier n'a été écrit dans ce dossier, ni dans `~/AfterShoot Projects`, ni dans les catalogues Lightroom.

## Les tests

| Suite | Résultat |
|---|---|
| `npm run test:unit` | **296 tests au vert** (44 fichiers), dont 9 pour le détecteur d'inclinaison, 14 pour la géométrie et le rendu redressés, 6 pour les consignes du pilote |
| `npm run test:native` | **132 tests au vert**, dont 11 nouveaux pour l'envoi à Lightroom |
| Contrat `verif-redressement.cjs` | façades de synthèse : **au vert** |
| Contrat `verif-lightroom.cjs` | trois RAW réels copiés : **au vert** |
| `npm run test:modeles` sur les sources | **6 contrats sur 6** : détourage, recadrage, moments, tri photo, redressement, Lightroom |
| `npm run test:modeles` sur le paquet livré | **6 contrats sur 6**, sur l'application ARM notarisée de `release/v1.2.0` |

Livraisons, dans `release/v1.2.0/` : Mac ARM et Mac Intel **signés, notarisés, agrafés et réarchivés après agrafage** (635 et 643 Mo), archives réextraites puis acceptées par Gatekeeper (`source=Notarized Developer ID`) ; Windows archivé non signé (722 Mo). **La 1.2.0 n'est pas installée** : la 1.1.0 reste dans /Applications en attendant l'accord de Johan.

## Redressement

### Le détecteur, porté du prototype

Porté à l'identique : sur 300 photos, **même palier et même angle au 1e-9 près** que le prototype mesuré en scratchpad.

### Dans l'application

Contrat sur trois façades fabriquées par FFmpeg (penchées de 2°, droites, penchées de 7°), import puis « Préparer l'album » :

| Photo | Mesure | Après la passe d'album | Dans l'éditeur |
|---|---|---|---|
| penchée de 2° | posée seule, 1,999° | redressée de −2° | aperçu sans coin vide |
| droite | déjà droite | rien | bouton **Redresser** : « Cette photo est déjà droite. » |
| penchée de 7° | proposée, 6,999° | rien | « Redresser de 7,0° vers la gauche ? », un clic pose −7, curseur à −7, aucun coin vide |

Sur 7 vrais CR3 de l'album : les angles concordent au centième près avec le prototype quand les deux mesurent (−1,006 contre −1,009 ; −2,182 contre −2,190 ; −1,196 contre −1,197), la passe d'album pose exactement la correction mesurée sur les photos sûres et rien sur les autres, et le bouton répond « Pas assez de lignes fiables » sur une photo sans lignes.

### La chaîne de l'application contre celle du prototype

Le prototype mesurait sur l'aperçu de 1 620 px réduit par Lanczos ; l'application mesure sur l'aperçu pleine taille réduit par blocs. Banc sur 300 RAW :

| Réduction | Même palier que le prototype | Écart d'angle médian | Temps par photo |
|---|---|---|---|
| par blocs (livrée) | **266 / 300** | 0,015° | **111 ms** |
| Lanczos | 265 / 300 | 0,016° | 432 ms |

Paliers de l'application : posée seule 17 %, proposée 27 %, déjà droite 4 %, abstention 52 %. Sur les photos posées seules : même sens qu'Aftershoot 44 fois sur 51, corrélation 0,86, pente 0,56 (Aftershoot corrige environ moitié moins). Le plus gros désaccord (Juno 1,6°, Aftershoot −0,2°) a été vérifié à l'œil sur une grille : le chambranle est vertical chez Juno, penché chez Aftershoot.

### Défaut trouvé en route

Une image de test lissée par 2 × 2 échantillons par pixel cassait les lignes en morceaux (aucun segment à 2,4°). Ce n'était pas le détecteur : à 4 × 4, 0,6° est lu 0,60°, 2,4° est lu 2,40°. Les tests suréchantillonnent désormais en 4 × 4.

## Tri de Juno contre Aftershoot, sur l'album entier

Les 3 552 RAW de l'album, lus sur place en lecture seule par le vrai code de Juno (Vite et Chromium, sans import) : **3 552 analysées, aucun échec**, en une quarantaine de minutes après une première tentative saturée (voir plus bas). Résultats et diagnostic dans `COMPARAISON-AFTERSHOOT.md`, données dans `work/refonte-v120/banc-tri`.

Défaut du banc, pas de l'application : Chromium sature sa réserve de fichiers au bout d'une soixantaine de RAW de 35 Mo, et refuse ensuite les lectures (« Failed to fetch »). Réparé par un ramasse-miettes forcé et de nouvelles tentatives ; les 896 lectures refusées de la première tentative ont été refaites.

## Envoi du tri à Lightroom

Contrat sur trois vrais CR3, copiés dans un dossier jetable ; le troisième porte déjà un .xmp noté 5 étoiles Vert par Aftershoot, avec ses réglages :

| Photo | Noté dans Juno | .xmp écrit |
|---|---|---|
| 1 | 5 étoiles, gardée | Rating 5, Label « Vert », Juno › Tri › Gardée |
| 2 | 2 étoiles, écartée | ni note ni couleur, Juno › Tri › Écartée |
| 3 | 4 étoiles, gardée | **note d'Aftershoot gardée** (5, Vert), mot-clé ajouté, réglages `crs:` intacts |

Le bilan avant envoi annonçait « 2 nouveaux fichiers, 1 photo déjà notée ailleurs » ; les trois originaux sont identiques à l'octet après l'envoi ; **Annuler l'envoi** a supprimé les deux fichiers créés et remis le troisième à l'identique.

### Défaut trouvé par les tests avant livraison

Après un conflit, Juno retenait la note gardée d'Aftershoot comme la sienne, et l'aurait écrasée au second envoi. Réparé : Juno ne retient que ce qu'il a lui-même écrit.

### Ce qui n'est pas vérifié

- L'affichage de la couleur « Vert » dans un Lightroom réel et le libellé exact du menu de lecture des métadonnées : tirés du code de Lightroom, à confirmer sur un catalogue jetable.
- L'écriture sur une carte en exFAT (repli par copie prévu, non essayé faute de carte).
