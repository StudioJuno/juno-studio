# Juno Studio 0.7.1 — sous-titres synchronisés et placement graphique

Dans Montage, transcrivez un média depuis le panneau Transcription, puis créez les sous-titres à partir du plan sélectionné. Le moteur local conserve maintenant les repères temporels estimés par mot. Aucun service en ligne ni coût IA n’est nécessaire pour cette transcription.

Dans Motion design → Sous-titres, choisissez **Social · karaoké** ou **Social · un mot à la fois**. Le premier conserve la phrase et colore le mot prononcé ; le second affiche uniquement ce mot, avec des pauses transparentes. La couleur du mot actif est personnalisable. Les autres réglages de police, contour, fond, position et animation restent disponibles. Ces effets sont intégrés dans la vidéo exportée ; un fichier SRT conserve uniquement les phrases et leurs temps.

Dépliez un sous-titre puis **Synchronisation des mots** pour ajuster le début et la fin de chaque mot en secondes. Cliquez sur le mot pour vous y rendre dans l’aperçu. Les repères sont bornés par les mots voisins et la durée du sous-titre. Les modifications s’enregistrent dans la séquence et bénéficient de l’annulation existante.

Une ancienne transcription peut être précisée avec **Préciser les mots localement**. Une transcription modifiée manuellement est protégée contre son remplacement. Les sous-titres sans repères, notamment les SRT importés, restent affichés par phrase : Juno n’invente pas leur synchronisation. Modifier le texte complet d’un sous-titre retire ses anciens repères pour éviter un surlignage erroné ; Annuler les restaure. Pour raccourcir sa durée, seuls les repères encore visibles sont conservés.

Pour déplacer un élément graphique, sélectionnez-le dans Motion design ou sur sa piste graphique. À l’arrêt, une poignée apparaît dans l’aperçu. Glissez-la, ou utilisez les flèches du clavier ; Maj permet un déplacement plus ample. Échap annule un déplacement en cours. Un glissement terminé constitue une seule modification pour Annuler. Il déplace la position de base et conserve la trajectoire animée relative.

Les changements de cadence vidéo recalculent les repères de mots, les images clés des plans et celles des éléments graphiques. L’animation d’apparition conserve son horloge à travers les changements de mot et les reprises d’export.

## Limites actuelles

Les temps de parole restent des estimations du modèle local : vérifiez les noms propres, langues, chevauchements de voix et enregistrements bruités. Les anciens sous-titres doivent être régénérés depuis la transcription précisée pour bénéficier des repères. Les exports avec beaucoup de mots demandent plus de préparation ; un contrôle refuse plus de 20 000 étapes graphiques par export avant de produire les images.

La poignée proposée ici règle la position, pas encore la taille ou la rotation par glissement. Le suivi automatique de mouvement, la 3D, les masques animés et les expressions After Effects restent à développer. Cette version ne constitue pas une parité avec ces logiciels.
