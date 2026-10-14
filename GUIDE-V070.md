# Juno Studio 0.7.0 — première étape de la refonte

## Une navigation commune
Le bouton Projets ouvre le tiroir des projets. Médias rassemble les photos et les médias du film associé ; Photos ouvre l’album ; Montage ouvre le film du même projet ; Livraisons ouvre les retours clients. Les thèmes Clair, Sombre et Système se choisissent en haut à droite. L’assistant et l’activité occupent un panneau latéral exclusif.

## Montage image et son
Les vidéos avec du son sont représentées par un bloc vidéo et un bloc audio liés. Déplacer, couper, raccourcir, dupliquer ou supprimer l’un affecte le groupe. Dissocier permet de les éditer indépendamment. Une musique importée se place sur une piste audio. Les pistes peuvent être verrouillées. Les anciens montages sont convertis en mémoire puis enregistrés par le mécanisme habituel de versions ; les sources ne sont pas réécrites.

Son ouvre le mixeur : nom de piste, volume en dB, Muet et Solo ; jusqu’à dix pistes audio dans le modèle actuel. Le volume du plan et les fondus restent dans l’inspecteur. Les commandes IA de volume ciblent le son lié, et les commandes de durée et de vitesse conservent les deux composantes.

## Voix améliorée hors ligne
Sélectionnez un bloc audio, puis Son → Améliorer la voix. Réglez la réduction de bruit IA, le coupe-bas, les graves, la présence, les aigus et la compression. Préparer une version améliorée crée une tâche locale. À la fin, choisissez la version dans « Version du son ». Le WAV 24 bits / 48 kHz est utilisé à la lecture et au rendu. « Revenir au son original » rétablit la source sans effacer le résultat. Les changements de version bénéficient aussi de l’annulation habituelle.

Le moteur RNNoise réduit le bruit ; il ne garantit pas la suppression de toute réverbération ni la récupération d’une voix saturée ou inaudible. Le traitement porte sur le média source complet. Aucun envoi en ligne ni coût API pour ce traitement. Les traitements et tâches conservés permettent de retrouver les résultats après redémarrage.

## Titres
Motion design → Éléments graphiques → Ajouter un titre. Quatre modèles de départ : sobre, cartouche de présentation, cinéma et étiquette. Réglages : police, graisse, italique, alignement, taille, position horizontale/verticale, largeur de texte, interligne, rotation, opacité, contour, fond, marge et ombre. Les retours à la ligne sont conservés. Les valeurs peuvent être saisies au clavier. Le même dessin canvas produit l’aperçu et les images des titres à l’export.

## Sous-titres et presets sociaux
Motion design → Sous-titres : Classique, Social blanc, Social jaune, Cartouche, Éditorial ou Juno. Personnalisez police, graisse, italique, majuscules, couleur, contour, fond, position, largeur et taille. Les presets sociaux proposent une apparition Pop ; Fondu, Glissement et Apparition par le bas sont aussi disponibles. Ces réglages s’appliquent à toute la séquence. Les textes et leurs temps restent éditables individuellement. Créez un sous-titre, importez un SRT ou utilisez la transcription existante. Le fichier vidéo contient les styles et effets ; un SRT seul transporte uniquement texte et temps.

## Motion design
Ajoutez un texte, rectangle, cercle, flèche ou barre de progression, avec ou sans texte. Réglez couleur, largeur/hauteur et valeur de la barre. Animation propose des presets et des images clés de déplacement X/Y, échelle, rotation et opacité. Les déplacements sont des fractions du cadre ; l’échelle 1 représente la taille initiale. Les interpolations sont linéaires, douces ou par maintien. Placez le curseur dans l’élément pour créer ou modifier une clé. Les points peuvent être supprimés et les modifications annulées.

Les graphiques simultanés occupent plusieurs lignes G de la timeline : cliquez un bloc pour ouvrir ses réglages. Les éléments sont paginés par 20 et un seul est déplié à la fois. L’export calcule chaque image, y compris après reprise d’un rendu interrompu. Une limite de 32 clés par propriété et des bornes de taille protègent le moteur contre les rendus trop lourds.

## Limites de cette livraison
Il s’agit d’une étape fonctionnelle, pas d’une parité avec Lightroom, Photoshop, Premiere, Resolve ou After Effects. L’édition graphique par poignées, le suivi de mouvement, les masques animés, la 3D, les expressions et les graphiques liés à des données restent à développer, ainsi que la suppression de réverbération spécialisée et les plugins audio. Le karaoké mot à mot n’est pas disponible : la transcription actuelle fournit des temps par segment. La voix utilise un modèle local fixe ; sa qualité doit être évaluée sur vos enregistrements. Le limiteur général de l’export n’est pas reproduit dans l’écoute du mixage. Les actions texte/voix disponibles restent celles du moteur de commandes existant, pas toutes les actions de l’interface.
