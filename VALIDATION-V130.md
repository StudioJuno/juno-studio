# Validation de la 1.3.0

Travail du 28 au 30 septembre 2026 sur le Mac ARM de Johan. Aucun vrai projet touché : tous les essais ont tourné sur des profils jetables, des copies du dépôt et des copies de médias. Les RAW de l'album d'Audrey-Ann et Clément ont été lus en lecture seule. Preuves dans `work/refonte-v130`.

## La méthode

1. **Six zones relues** en parallèle : tri photo, retouche et export, catalogue et sécurité, vidéo, pilote, interface. Pour chacune, un chercheur lit le code, l'exerce (tests copiés, scripts, parcours réels dans l'application construite) et rend des défauts démontrés. Puis un contradicteur tente de les réfuter.
2. **Corrections par zone**, chacune par un agent qui ne touche que ses fichiers, avec un test par défaut. Chaque nouveau test échoue sur le code d'avant la correction.
3. **Relecture contradictoire de chaque correction**, puis une seconde passe sur ce qu'elle a trouvé : des régressions introduites par les corrections elles-mêmes ont été rattrapées ainsi.
4. **Trois pistes d'amélioration du tri**, réglées sur le matin de l'album de mesure et vérifiées sur l'après-midi, chacune contredite par un second agent.

## Les défauts

| Zone | Constatés | Réfutés | Confirmés et corrigés | Trouvés en relisant les corrections |
|---|---|---|---|---|
| Tri photo | 15 | 5 | 9 (+ 1 corrigé quoique réfuté) | 0 |
| Interface | 19 | 8 | 11 | 6 |
| Pilote | 30 | 3 | 27 | 13 |
| Catalogue, équipe, portail | 19 | 5 | 14 | 5 |
| Retouche et export | 19 | 1 | 18 | 3 |
| Vidéo | 15 | 0 | 15 (+ 2 trouvés en corrigeant) | environ 60, sur huit passes de plus (voir plus bas) |

Les plus graves, tous corrigés :
- **Les HEIC, PSD, JPEG XL et JPEG 2000 étaient tous décodés en noir** (compression TIFF 32946 ignorée par UTIF, sans erreur). Réparés aussi dans les catalogues existants, à la prochaine passe.
- **« Préparer l'album » assombrissait les RAW** : exposition calculée sur l'aperçu JPEG du boîtier, appliquée au développement RAW. Sur 7 CR3, les exports passent de 0,298 à 0,467 de luminosité moyenne (cible 0,46), vus à l'œil sur une planche avant/après. La passe ne ralentit pas.
- **Une écriture ratée bloquait toute la séance**, sans bouton pour réessayer ni moyen de fermer.
- **L'export d'un RAW pleine résolution faisait planter la fenêtre.**
- **La retouche « Sujet détouré » manquait dans tous les exports** et les rendus du portail.
- **Export et sauvegarde échouaient sur exFAT et FAT32** (clés USB, disques externes).
- **Une sauvegarde de plus d'environ 1 800 photos ne se restaurait pas.**
- **Les exports vidéo étaient faux à l'image près** : images noires aux raccords et titres décalés en 23,976, 29,97 et 59,94.
- **Le pilote inversait le sens de « monte » et « descends »**, lisait « à N » comme un écart, et appliquait « écarte cette photo » à tout l'album quand la portée du panneau était restée sur « Tout le projet ».

## La vidéo : dix passes

Chaque passe : un correcteur par zone, qui ne touche que ses fichiers et prouve chaque test sur le code d'avant, puis un relecteur qui refait un parcours réel dans sa propre copie construite (profil jetable, rushes fabriqués par lui) et cherche d'abord les régressions. Une passe de plus tant qu'un défaut démontré restait.

| Passe | Ce qui a été corrigé |
|---|---|
| 3 | Moniteur juste sur les rushes à cadence variable (index de l'aperçu, instants gardés à la fabrication de l'aperçu) ; coupe dans une image sautée. |
| 4 | .mkv et MOV à trous compensés ; image noire en fin de .mkv ; erreur React « boucle de mises à jour » en maintenant une flèche. |
| 5 | MPEG-TS (AVCHD) figé sur l'image clé et décalé d'une image ; HEVC à GOP ouvert ; suivi de masque ; champ numérique de l'inspecteur. |
| 6 | Export .mpg/.vob à son MP2 bloqué sans fin, garde-fou d'export ; son des .mts en avance de 195 ms ; deux pistes son ; champ numérique qui écrivait sans saisie ; tête après la fin du film. |
| 7 | Changement de définition en cours de fichier ; tête après annulation ; 11 écritures qui contournaient le verrou d'une piste. |
| 8 | Rushes tournés qui changent de définition ; verrou côté moteur ; « Recadrer », pilote, glisser et LUT qui défaisaient un travail fait entre-temps ; cadence et tête ; refus muets. |
| 9 et 10 | Cadence annulée pendant la lecture ; glisser vers une piste verrouillée ; décision de réfection des anciens aperçus ; tests renforcés par mutation. |

**Six régressions introduites par une passe ont été rattrapées par la relecture de la suivante**, aucune n'est dans la 1.3.0 : moniteur des rushes à cadence variable (passe 2), plan noir sur une dernière image longue (passe 4), garde-fou qui coupait l'assemblage final sur exFAT et .ts à piste son vide refusé (passe 6), image recadrée par le fichier étirée (passe 7), aperçu faux jugé juste sur ses seuls passages forts (passe 9).

Mesures de la dernière relecture : 0 écart entre le moniteur et le film sur des milliers d'images comparées (25, 29,97, 23,976, 59,94, iPhone, écran, .mkv, .mts, HEVC à images B, débruitage, x0,25 à x4) ; son à 0 ms du moniteur sur .mov, .mts son avant et après l'image, deux pistes ; 0 flèche perdue et 0 erreur sur 30 rafales ; choix de la piste son des anciens aperçus rejoué exactement sur 99 combinaisons (ordre, canaux, « par défaut », piste vide, 14 conteneurs) contre le vrai moteur 1.2.0, et aucun aperçu faux gardé dans les parcours de relecture.

Laissé, démontré mais sans effet sur les fichiers des boîtiers courants : la décision de réfection d'un ancien aperçu écoute parfois le son pour rien (jusqu'à 12 s sur un .ts de 10 min à deux pistes identiques, une fois), et son chemin de repli (utilisé seulement si le moteur FFmpeg changeait) peut garder un aperçu faux dont la différence dure moins de 8 s.

## Les pistes du tri

| Piste | Verdict | Mesure |
|---|---|---|
| Rafales qui ne méritent rien | Écartée | La meilleure règle ne retire que 26 gardées sur 889 (précision 34,4 → 35,1 %). Les rafales sans livrée sont des morceaux d'une scène livrée juste à côté : 262 sur 289. |
| Expressions (52 formes MediaPipe) | Écartée | Environ 60 réglages : aucun ne tient sur l'après-midi. La lecture bouge autant par le bruit que par l'expression (même personne à 0,15 s d'intervalle : même dispersion qu'à 3 s). Sur les 24 lectures « bouche ouverte » les plus fortes, 12 sont des nuques ou des oreilles. |
| Alertes « à vérifier » | Retenue, amendée par le contradicteur | Seuil du visage brûlé ramené de 0,25 à 0,10, réglé sur le matin seul. |

Les alertes, sur l'album entier et avec le code livré :

| | 1.2.2 | 1.3.0 |
|---|---|---|
| Photos gardées d'office | 889 | 951 |
| Précision face aux livrées | 34,4 % | 34,2 % |
| Rappel face aux livrées | 40,5 % | 43,0 % |
| Meilleures images de rafale « à vérifier » | 164 | 102 |
| Livrées bloquées « à vérifier » | 47 | 28 |

- Les hautes lumières se jugent sur le cœur des visages comptés (part de blanc pur > 0,10), avec un garde-fou quand plus de la moitié de l'image est brûlée ou que la luminosité dépasse 0,94. 49 des 51 alertes de l'ancienne règle étaient du ciel.
- « Peu de détails » se juge sur la case la plus nette d'une grille de 8 × 8 : les 5 photos du matin sous le seuil sont floues partout à 100 %, et au-dessus la case la plus nette montre un détail net.
- « Image très sombre » s'aligne sur « presque noire » (0,08) : les 2 photos signalées étaient des soirées normales, livrées.

## Les tests

- `npx tsc --noEmit -p .` : aucune erreur.
- `npm run test:unit` : 620 tests sur 620 (63 fichiers). `npm run test:native` : 205 sur 205. Soit 825 tests, contre 480 en 1.2.2.
- `npm run build` : réussi.
- Les 7 contrats (`npm run test:modeles`) tiennent sur les sources : détourage, recadrage vertical, moments forts, visages du tri, redressement, rafales, envoi à Lightroom.
- Les 7 contrats tiennent aussi sur l'application livrée : la copie Mac ARM extraite de l'archive notarisée (`JUNO_TEST_EXEC`).
- Mac ARM et Mac Intel : signées Developer ID, notarisées, agrafées ; `spctl` répond « accepted, source=Notarized Developer ID » sur la copie extraite de chaque archive. Empreintes dans `release/v1.3.0/SHA256SUMS.txt`.

## Ce qui reste ouvert

- Un vêtement blanc brûlé au soleil n'est plus signalé tant que le visage est intact ; seul le garde-fou global le rattrape. À vérifier sur un album au soleil dur.
- Le pilote : une tournure inhabituelle est refusée avec un message. Un doute qu'elle soit appliquée de travers reste possible sur des formulations non essayées (environ 170 l'ont été pour les blancs).
- Aucun album Sony, Nikon ou Fuji n'a été mesuré.
