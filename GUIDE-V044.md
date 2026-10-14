# Juno Studio 0.4.4 — retouche et activité

## Régler une photo

Cliquez sur le nombre à droite d’un réglage. Saisissez par exemple `0,35` pour l’exposition ou `-20` pour les ombres, puis Entrée ou cliquez ailleurs. Échap annule la saisie en cours. Le curseur reste disponible.

Les réglages sont enregistrés automatiquement dans le catalogue local. « Enregistrement… » signifie qu’une écriture reste en cours ; « Enregistré sur cet ordinateur » confirme la fin. En cas d’erreur d’écriture, la modification reste en attente dans la session et le bouton Réessayer est proposé. Ne quittez pas l’application tant qu’une erreur d’enregistrement subsiste.

Les fichiers d’origine ne sont jamais écrasés par ces réglages. Exporter crée des photos avec le rendu choisi.

## Annuler et retrouver l’original

La barre près de la photo contient Annuler, Rétablir, Voir l’original et Versions. Un déplacement continu d’un curseur correspond à une étape d’historique. ⌘/Ctrl Z fonctionne également quand un curseur a le focus ; dans un champ texte, il conserve son comportement d’édition de texte.

Voir l’original sert à comparer. Revenir à l’original réinitialise les réglages ; Rétablir la retouche permet de retrouver le rendu précédent. Jusqu’à 40 étapes sont conservées par photo, avec les versions nommées en complément.

## Aperçus

L’image s’affiche d’abord à partir d’un aperçu rapide, puis est affinée depuis l’original. Le libellé distingue ces étapes. L’affichage rapide ne prouve pas que l’original est disponible : si le rendu précis échoue, une erreur est affichée.

Les miniatures de la grille tiennent compte des retouches. Les calculs d’import ne bloquent plus la file d’aperçu et les mouvements des réglages ne détruisent plus systématiquement le cache du décodeur RAW.

## Réglages ajoutés

Les sections repliables proposent blancs, noirs, vibrance et clarté, courbes globale/RVB à points, mélangeur TSL de huit couleurs, netteté et réduction classique du bruit. La finition propose aussi les noirs adoucis.

Les courbes acceptent le déplacement de points et la saisie de leur entrée/sortie. Les valeurs et points sont sauvegardés, annulables et pris en compte dans les exports. Il s’agit d’un moteur Juno : aucun rendu identique aux algorithmes Adobe n’est annoncé.

Les pinceaux proposent une taille et une opacité saisissables ; l’opacité d’un calque de retouche existant peut également être modifiée.

## Tâches photo

Le bouton Activité est dans l’en-tête. En cours, À vérifier et Historique séparent opérations, incidents et résultats. Retirer une ligne ou Vider l’historique ne supprime ni les photos ni les diagnostics ; Annuler cette action rétablit l’affichage. Archiver l’incident conserve son diagnostic sans le présenter comme résolu.

Les anciennes tâches sont accessibles par pagination. Fermer le panneau n’arrête pas les traitements. Les préférences d’affichage sont conservées sur cet ordinateur. L’activité vidéo reste dans son panneau actuel ; la fusion des deux moteurs est un chantier distinct.

## Limites

Cette version ne contient pas encore les calques de composition, objets dynamiques, sélections avancées, déformations, profils d’objectifs et tous les autres outils de Lightroom/Photoshop. Le plan détaillé les distingue des outils effectivement construits.

Les performances mesurées sont celles des cas de validation décrits dans VALIDATION-V044 ; elles ne garantissent pas un délai identique sur toutes les photos et machines.
