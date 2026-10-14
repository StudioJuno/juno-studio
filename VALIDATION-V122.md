# Validation de la 1.2.2

Mesuré le 28 septembre 2026 sur le Mac ARM de Johan. Les RAW de l'album d'Audrey-Ann et Clément ont été lus sur place, en lecture seule ; aucun fichier n'a été écrit dans leur dossier. Les vrais projets n'ont pas été touchés. Preuves dans `work/refonte-v122`.

## Le problème

La 1.2.1 gardait 2 631 photos pour 756 livrées. La cause principale : elle ne reconnaissait pas les rafales. Sa règle (dhash à 8 bits près, 8 s d'écart au plus) ne réunissait que 17 % des images voisines d'une même série d'Aftershoot : une rafale à main levée bouge, et deux images successives diffèrent de 18 bits en médiane. Le regroupement ne valait que 44,9 % (F1 B³ face aux séries d'Aftershoot), et le choix dans une série trouvait la livrée 31,6 % des fois, contre 24,7 % au hasard.

## La méthode

1. **Signaux** mesurés sur les 3 552 RAW avec le vrai code de l'application : heure au millième (boîte CMT2 du CR3 ; LibRaw ne rend que la seconde), miniature grise de 48 px, histogramme de couleur, histogramme de contours, résumé SigLIP 2 de la vignette.
2. **Réglage sur le matin, vérification sur l'après-midi** tenu à l'écart. Les étiquettes d'Aftershoot (séries, livrées) ne servent qu'à mesurer ; aucun modèle n'a été entraîné dessus, seulement cinq seuils et six poids lisibles.
3. **Regroupement** : trois pistes explorées (temps + image, temps + SigLIP, combinaison de signaux). Retenue : la combinaison, qui domine les autres à nombre de rafales égal et fusionne deux fois moins à tort.

| | Rafales | F1 B³ | Voisines fusionnées à tort | Livrées atteignables en gardant une image par rafale |
|---|---|---|---|---|
| 1.2.1 (dhash) | 3 046 | 44,9 % | 1,7 % | 99,6 %, parce que presque rien n'est réuni (3 046 groupes pour 806 séries) |
| Temps + image | 698 | 84,7 % | 32 % | 77 % |
| **Combinaison (retenue)** | **1 053** | **82,7 %** (après-midi 85,0) | **16 %** | **91 %** |

4. **Choix de la meilleure image** : règles de photographe, chaque personne suivie et comparée à elle-même. Sur les 610 séries d'Aftershoot : **35,7 %** de livrées choisies (1.2.1 : 31,6 % ; hasard : 24,7 %), 62 séries gagnées pour 37 perdues face à la 1.2.1 (p = 0,015). Des résumés SigLIP (« sourire », « yeux ouverts ») ont été essayés : ils ne tiennent pas sur l'après-midi, écartés.

## Le choix de Juno est-il moins bon quand il diffère ?

Dans les rafales qui contiennent une livrée, Juno prend exactement la livrée 51 % des fois, sa voisine immédiate 22 %, une autre image de la même série 23 %. Compter ne suffit donc pas : il faut regarder.

80 rafales tirées au hasard parmi celles où Juno ne prend pas la livrée (moitié voisines immédiates, moitié plus éloignées). Chaque planche montre les deux images entières et le visage principal à 100 %, en A et B tirés au sort. Trois juges indépendants, sans savoir laquelle est livrée ; 76,7 % d'accord deux à deux.

| Verdict à la majorité | Voisine immédiate (40) | Plus éloignée (40) | Total |
|---|---|---|---|
| Juno meilleur | 10 | 13 | **23** |
| Équivalent | 20 | 11 | **31** |
| Livrée meilleure | 9 | 15 | **24** |
| Pas de majorité | 1 | 1 | 2 |

Les 11 cas où la livrée est nettement meilleure : des yeux fermés ou un visage caché sur un visage de profil (le lecteur de visages les dit ouverts), un invité qui se détourne, une expression en pleine phrase. Ce sont des limites de la lecture des visages, pas des règles.

## Parité entre le banc et l'application

L'empreinte calculée par l'application (inspect servi par Vite, 3 552 RAW) a été comparée à celle du banc : couleur et contours identiques sur toutes les photos ; heure identique au millième (à un décalage de fuseau constant près) ; miniature identique à un niveau de gris près sur 97 cases sur 705 000 (arrondi en double précision).

## Sur l'album entier, avec le vrai code

Empreintes calculées par l'application sur les 3 552 RAW (0 erreur), visages de la 1.2.1, résumés SigLIP des vignettes, puis `groupSuggestions` et la règle de la passe d'album (garder la proposée qui n'a aucune raison « à vérifier »).

| | 1.2.1 | 1.2.2 | 1.2.2 sans SigLIP |
|---|---|---|---|
| Rafales | 3 046 | **1 053** | 1 154 |
| F1 B³ face aux séries d'Aftershoot | 44,9 % | **82,7 %** | 80,8 % |
| Photos gardées d'office | 2 631 | **889** | 973 |
| Précision face aux livrées | 23 % | **34,4 %** | 33,5 % |
| Rappel face aux livrées | 78 % | 40,5 % | 43,1 % |
| Rafales où la livrée est atteignable | | 691 | 699 |
| … où Juno propose exactement la livrée | | 353 (51 %) | |

Le rappel baisse par construction : une seule image par rafale. Des 450 livrées non gardées, 403 le sont parce qu'une autre image de leur rafale est proposée : c'est le cas jugé à l'aveugle ci-dessus (aussi bonne deux fois sur trois), plus 65 livrées qui ont une sœur livrée dans la même rafale de Juno. Les 47 autres sont proposées mais portent une raison « à vérifier » : visage flou 17, hautes lumières 12, peu de détails 8, yeux possiblement fermés 5, netteté à vérifier 4, très sombre 1.

Temps : le premier regroupement de l'album prend 0,44 s, les suivants 0,02 s (caches par empreinte), ce qui compte pour l'écran « Comparer les rafales », qui regroupe à chaque note posée.

## Relecture contradictoire : 10 défauts corrigés avant livraison

Trois relecteurs (fidélité du portage, intégration, tests), chacun suivi d'un contradicteur chargé de réfuter. Corrigés, chacun avec son test :

- **La meilleure image recevait la raison « Autre image de la rafale »** et passait « à vérifier » dès qu'elle n'était pas la première de sa rafale : 469 des 727 rafales de l'album. Défaut hérité de la 1.2.1, rendu majoritaire par les rafales plus longues.
- **À la même seconde, l'ordre venait de l'identifiant**, tiré au hasard à l'import : sans millième (RAF, analyse ancienne), une rafale se coupait différemment à chaque fois (F1 de 83,1 à 79,2-79,9 selon le tirage, en simulant des heures à la seconde). L'ordre des noms de fichiers départage désormais.
- **Les HEIC n'avaient plus aucune rafale** : leur EXIF était lu sur la conversion TIFF, qui n'en porte pas. L'original est maintenant lu à côté.
- **Deux boîtiers du même modèle se coupaient leurs rafales** : le numéro de série (lu dans CMT2 ou l'EXIF) sépare désormais les photographes.
- **La nuit du passage à l'heure d'été**, 2 h 30 et 3 h 30 tombaient au même instant : l'heure du boîtier est comptée sans fuseau.
- **« Comparer les rafales » ignorait les personnes désignées** et proposait une autre image que celle gardée.
- **Une image écartée gardait « Meilleure de la rafale »** d'une passe précédente.
- **Un panorama de plus de 96:1** donnait une miniature de 0 case, que la restauration du catalogue refusait.
- **Le résumé SigLIP ne survivait pas à une sauvegarde** (Float32Array devenu objet) et n'était jamais recalculé : la recherche par le sens était aussi touchée. Il est reconstruit à la restauration.
- **Un catalogue piégé pouvait geler l'application** (résumé de longueur démesurée, milliers de visages) : bornes de 4 096 nombres, 20 visages suivis par image, 60 images par rafale (la plus longue de l'album en a 15).

Aussi : la publication d'équipe n'envoie plus l'empreinte (3,4 ko par photo, plafond de 8 Mo). Et neuf tests trop faibles, prouvés par mutation, ont été renforcés (personne désignée, netteté des yeux, visage tourné, image brûlée, heure au millième, chaîne comparée à la précédente, raison la plus forte, suivi des personnes, empreinte épinglée au calcul du banc).

## Les tests

| Suite | Résultat |
|---|---|
| `npm test` | **480 au vert** : 348 rapides (dont 37 pour les rafales) + 132 natifs |
| `npm run test:modeles` sur les sources | **6 contrats sur 6**, dont le nouveau contrat « Rafales » : une rafale de quatre vues à 150 ms d'écart relue au millième, une seule proposée (la nette), gardée, verdict « Meilleure de la rafale (4 images) », les trois autres « à vérifier » avec la raison de variante, la façade et la photo prise 4 s plus tard à part |
| `npm run test:modeles` sur le paquet livré | **7 contrats sur 7**, sur l’application ARM notarisée réextraite de son archive, envoi à Lightroom compris (RAW copiés dans un dossier jetable) |

Livraisons, dans `release/v1.2.2/` : Mac ARM et Mac Intel signés, notarisés, agrafés et réarchivés après agrafage (635 et 643 Mo), archives réextraites puis acceptées par Gatekeeper (`source=Notarized Developer ID`, version 1.2.2) ; Windows archivé non signé (722 Mo). **La 1.2.2 n'est pas installée** : la 1.2.0 reste dans /Applications en attendant l'accord de Johan.
