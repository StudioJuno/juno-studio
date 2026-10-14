# Juno Studio 0.8.0 — masques suivis, poignées de transformation et relief 3D

## Cacher une zone d’un plan : flou, pixelisation ou cache plein

Dans Montage, sélectionnez un plan vidéo dans la timeline, puis ouvrez l’onglet **Masques**. Le bouton **+** ajoute un masque au plan. Choisissez l’effet (flou, pixelisation, cache plein), la forme (ovale ou rectangle), la taille, l’intensité et la douceur du contour. Le cache plein permet de choisir sa couleur.

Dans l’aperçu, une poignée bleue apparaît au centre du masque sélectionné. Glissez-la pour poser la position du masque sur l’image affichée ; les flèches du clavier ajustent finement, Maj élargit le pas. Chaque déplacement pose un repère sur l’image courante. Le bouton **Poser un repère** fait la même chose sans souris, **Retirer** enlève le repère de l’image courante.

Entre deux repères, Juno interpole la position en ligne droite. Un masque garde toujours au moins un repère : il ne peut pas disparaître silencieusement.

## Suivre automatiquement un sujet

Placez le masque sur le sujet à la première image, puis **Suivre le sujet**. Juno analyse le plan hors ligne, image par image, sur une copie réduite en niveaux de gris, et remplit les repères. Le calcul se déroule comme une tâche d’arrière-plan : vous pouvez continuer à monter.

Le suivi retient l’aspect du sujet à l’image de départ et le recherche autour de sa dernière position connue. Il rafraîchit sa référence tant que la ressemblance reste élevée. La trajectoire est ensuite simplifiée pour rester lisible et légère au rendu.

Vérifiez toujours le résultat : un sujet qui sort du cadre, une coupe, un changement d’éclairage fort ou un décor très répétitif peuvent faire dériver le masque. Dans ce cas, corrigez à la main en posant des repères aux endroits qui dérivent.

## Redimensionner et pivoter un titre ou une forme dans l’aperçu

Sélectionnez un élément dans Motion design. À l’arrêt, trois poignées apparaissent dans l’aperçu : déplacement au centre, redimensionnement en bas à droite, rotation au-dessus. Glissez-les, ou utilisez les flèches du clavier ; Maj donne des paliers (10 % pour la taille, 15° pour la rotation). Échap annule un glissement en cours. Un glissement terminé compte pour une seule modification dans Annuler.

Sur un texte, la poignée règle la taille de police ; sur une forme, elle change sa largeur et sa hauteur en conservant les proportions. Quand un élément dépasse du cadre, ses poignées restent accessibles au bord de l’aperçu.

La taille maximale d’un texte suit désormais le format de la séquence au lieu d’être bloquée à 240 pixels : la moitié de la hauteur de l’image, et jamais moins que l’ancienne limite. Un titre plein cadre devient possible en 4K et en 6K.

## Relief 3D des titres, logos et formes

Dépliez **Relief 3D** dans les réglages d’un élément. La profondeur épaissit le texte ou la forme, la direction choisit l’axe du relief, la lumière dose le dégradé des flancs, et la couleur des flancs peut être choisie. Le relief est appliqué au titre comme à la forme et au cartouche de fond.

## Limites actuelles

La taille d’un masque reste constante sur toute sa durée ; seule sa position est animée. Un sujet qui s’approche ou s’éloigne fortement demande un masque plus large ou un découpage du plan. Le masque est ancré à l’image du plan : si vous zoomez ou déplacez le plan, le masque suit ce cadre.

L’aperçu approxime le traitement des masques : la pixelisation y est représentée par un flou équivalent. Le fichier exporté applique le vrai traitement, pixelisation comprise.

Le relief 3D est calculé à plat, par extrusion. Il n’y a ni caméra 3D animée, ni éclairage volumétrique, ni import de modèles 3D. Le suivi automatique suit une translation, pas une rotation ni un changement d’échelle. Les masques animés de forme libre, les expressions et les infographies pilotées par données restent à développer. Cette version ne constitue pas une parité avec After Effects, Resolve ou Premiere.
