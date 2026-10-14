# Juno Studio 1.3.0 : tout relu, tout retesté

Cette version reprend la 1.2.2 (une photo par rafale) et y ajoute une relecture complète de l'application, zone par zone, chacune vérifiée par un contradicteur puis corrigée et relue une seconde fois. Plus de cent cinquante défauts corrigés, chacun avec son test. La vidéo a demandé dix passes de correction et de relecture. Le détail est dans `VALIDATION-V130.md`.

## Ce qui change pour vous

### Le tri
- **Les photos HEIC (iPhone, Canon et Sony en HIF), PSD, JPEG XL et JPEG 2000 ne sont plus noires.** Elles l'étaient toutes, sans message : vignette, analyse, retouche et export. Celles déjà importées sont refaites à la prochaine « Préparer l'album ».
- **Moins de fausses alertes « à vérifier »**, sans vraie alerte perdue. Sur l'album d'Audrey-Ann et Clément :
  - 951 photos gardées d'office au lieu de 889 ;
  - 102 meilleures images de rafale à vérifier au lieu de 164 ;
  - 28 de vos livrées bloquées à vérifier au lieu de 47.
  - Les hautes lumières se jugent sur les visages : 49 alertes sur 51 étaient du ciel ou un fond blanc, que le RAW récupère.
  - « Peu de détails » se juge sur la zone la plus nette : un gros plan de mains ou d'alliances net sur fond flou n'est plus signalé.
  - Une soirée sombre n'est plus « très sombre » ; seule une image presque noire l'est.
- **Le choix d'une rafale suit vos notes.** Écartez la photo proposée : la suivante est proposée. Gardez-en une autre à la main : c'est elle le choix, et la passe n'en garde pas une seconde.
- **La raison « Autre image de la rafale » tient d'une passe à l'autre**, et le compte de photos de chaque personne ne double plus à chaque passe.
- **La passe d'album est plus rapide** : chaque photo était décodée deux fois.

### La retouche et l'export
- **« Préparer l'album » n'assombrit plus les RAW.** L'exposition était calculée sur l'aperçu JPEG du boîtier, plus clair que le développement RAW de Juno. Sur 7 CR3, la luminosité des exports passe de 0,30 à 0,47 pour une cible de 0,46.
- **La retouche « Sujet détouré » est enfin dans les fichiers exportés** et dans les images du portail client. Le détourage marche aussi sur les RAW et les TIFF.
- **L'export d'un RAW en pleine résolution ne fait plus planter la fenêtre.**
- **L'export vers une clé USB ou un disque externe (exFAT, FAT32) marche.** Il échouait pour toutes les photos.
- Le style appris de Lightroom lit les valeurs écrites « +0,30 » ; le style appris de vos corrections ne s'arrête plus à mi-chemin.

### L'interface
- **Une sauvegarde qui échoue ne bloque plus la séance.** Un bandeau propose « Réessayer l'enregistrement ». Si elle échoue encore, vous pouvez abandonner le changement bloqué. Fermer l'application demande « Rester / Quitter quand même ».
- **Sous un filtre, c'est la bonne photo qui s'ouvre**, et changer de projet par ⌘K repart d'une vue propre.
- **Les étoiles au clavier marchent en AZERTY**, sans Maj. Y montre l'original dans l'atelier.
- L'historique dit ce qu'on annule : Tri, Étoiles ou Réglage manuel. Les Paramètres affichent la vraie version.

### Le pilote (« Demander à Juno »)
- **« monte », « descends », « abaisse » ne remplacent plus la valeur** : ils l'augmentent ou la baissent.
- **« baisse à 20 » vise 20, « baisse de 20 » retire 20.** Dans « baisse les ombres de 20 et les hautes lumières de 10 », le verbe vaut pour les deux.
- **« cette photo » et « ce plan » priment sur la portée du panneau.** Écarter, noter ou remettre à l'original plusieurs photos demande une confirmation avec leur nombre.
- Une proposition de l'IA locale ne s'applique qu'à ce qui est encore à l'écran.
- En vidéo : « raccourcis de 2 s » retire 2 s, les transitions durent 1 s par défaut et respectent leur sens, « baisse la musique de 6 dB » baisse bien de 6 dB, et les pistes verrouillées sont respectées.

### Le catalogue, l'équipe et le portail client
- **Une sauvegarde de gros album se restaure.** Au-delà d'environ 1 800 photos, elle était écrite mais refusée à la restauration.
- **Le partage d'équipe tient jusqu'à environ 5 000 photos** analysées, au lieu d'environ 320.
- **Le portail client** : une validation « doit valider » révoquée et remplacée attend le nouveau destinataire. Les freins contre les essais de code en série ne peuvent plus être contournés, et ne ferment plus le portail à tout le monde quand ils débordent. Une publication de 10 000 photos passe.
- Réimporter une carte ne recopie plus les originaux déjà gardés.

### La vidéo
- **Les exports sont justes à l'image près** : plus d'image noire aux raccords ni de titre décalé, en 23,976, 29,97 et 59,94 i/s. Le son n'est plus en avance.
- **Le moniteur montre l'image que l'export posera**, image par image, aux coupes et après un arrêt, y compris sur les rushes d'iPhone et les enregistrements d'écran dont la cadence varie. Une coupe tombée dans une image sautée par le téléphone n'ouvre plus le plan une image trop tard.
- **Les .mts et .m2ts des caméscopes (AVCHD) s'exportent justes** : un plan coupé au milieu ne reste plus figé sur l'image clé suivante, n'est plus décalé d'une image, et son son n'est plus en avance de 0,2 s. L'export de 100 plans en .m2ts est même 22 % plus rapide.
- **Le HEVC à images B, les .mkv, les fins figées et les images recadrées par le fichier** s'ouvrent aussi sur la bonne image. Un .mkv dont le son dure plus que l'image ne finit plus sur des images noires.
- **Un export ne reste plus bloqué sans fin.** Les .mpg et .vob à son MP2 se bloquaient souvent, les DVD et enregistrements TV qui changent de définition aussi : ils s'exportent. Et si le moteur cesse un jour d'avancer, l'export s'arrête avec un message et peut être repris, au lieu d'attendre toujours. Un long film livré sur une clé ou un disque exFAT n'est jamais coupé à la fin.
- **Le son du moniteur est celui du film.** Sur un rush à plusieurs pistes son (micro caméra et micro-cravate), le moniteur pouvait faire entendre l'autre micro. Les anciens aperçus concernés sont refaits une fois, en tâche de fond, sans jamais retarder vos exports. Un .ts dont la première piste son est vide s'importe avec son son.
- **Cliquer dans un champ puis en sortir sans rien taper ne change plus rien.** Avant, la valeur était arrondie en silence : une image clé apparaissait sur un plan animé, un plan recadré passait en « Réglé à la main », et 7 réglages de retouche photo bougeaient. Une valeur refusée ne reste plus affichée.
- **Maintenir une flèche ne perd plus d'image** et ne fait plus d'erreur, même sur un plan animé. La tête ne dépasse plus la fin du film, ni par les flèches, ni en annulant, ni en changeant de cadence.
- **Une piste verrouillée l'est vraiment** : masques, ajout de médias, glisser-déposer, assemblage des scènes, recadrage, suivi et harmonisation couleur ne la respectaient pas tous. Chaque refus le dit.
- **« Recadrer » ne défait plus ce que vous faites pendant l'analyse des visages**, et le pilote ou une LUT ne défont plus un suivi terminé entre-temps.
- **Le suivi d'un masque** part de la même image que le film.
- **Une photo s'importe dans le montage**, et une transition ne bloque plus l'enregistrement après une coupe.
- **Un masque (flou de visage) reste à sa place à l'export** d'un plan zoomé ou déplacé.
- La stabilisation marche pour toutes les valeurs, et « Retirer les blancs » déplace aussi titres, sous-titres et marqueurs.

## Ce qui a été essayé et écarté

- **Dire qu'une rafale entière ne mérite rien.** Écarté, mesures à l'appui : les rafales sans photo livrée sont presque toujours un morceau d'une scène livrée juste à côté, et rien ne dit lequel des deux morceaux sacrifier. Gain possible : un point de précision, pour 26 photos sur 889.
- **Lire les expressions (bouche ouverte, regard ailleurs).** Écarté aussi. Le détecteur de visages en lit bien 52, mais d'une image à l'autre d'une même rafale elles bougent autant par le bruit que par l'expression. Un baiser se lit « bouche ouverte », un rire plissé « yeux fermés ». Aucun des 60 réglages essayés ne tient sur l'après-midi.

## Ce qui reste

- Un vêtement blanc brûlé en plein soleil n'est plus signalé tant que le visage est intact ; seul un écrêtage de plus de la moitié de l'image l'est.
- Le pilote comprend les formulations courantes ; une tournure inhabituelle est refusée avec un message, jamais appliquée de travers.
- Aucun album Sony, Nikon ou Fuji n'a été mesuré.
- Un rush à cadence variable importé avant la 1.3.0 garde son ancien aperçu, et un .mkv sa durée d'avant : réimportez-le, ou reconnectez le média, pour que le moniteur suive l'export à l'image près.
- Au premier lancement, la 1.3.0 relit en tâche de fond chaque rush à plusieurs pistes son (moins d'une seconde par rush) et refait les aperçus faux.
- Un enregistrement TV qui passe de la définition standard à la HD en cours de fichier est montré et exporté à la définition de son début.
