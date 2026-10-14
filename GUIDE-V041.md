# Juno Studio 0.4.1 — affichage et import photo

## Affichage

Les vignettes de la grille, l’aperçu latéral et le bandeau de l’atelier affichent toute l’image, dans ses proportions. Les portraits restent verticaux et les paysages horizontaux ; des marges complètent les cases de la grille. Le survol ne zoome plus dans la photo. Aucun original n’est recadré ou converti par ce changement.

## Nouveaux imports

L’application native copie chaque nouvel original dans son dossier de données, sous `Originals`, avant de le décoder. La copie est vérifiée par son empreinte SHA-256, sa taille et une relecture ; le catalogue pointe vers cette copie uniquement après vérification. La suppression ultérieure du fichier de départ ne supprime donc pas la copie conservée par Juno.

Cette copie occupe autant d’espace que les fichiers importés. Elle ne remplace pas une sauvegarde sur un autre disque : utilisez aussi les sauvegardes Juno. Les imports anciens restent liés à leurs anciens emplacements ; cette mise à jour ne peut pas recréer un original disparu à partir d’une vignette. L’aperçu latéral indique si l’original est conservé, externe ou introuvable.

Dans le navigateur, les originaux restent dans le stockage local du navigateur, soumis à son quota et à son effacement. Utilisez l’application installée pour les grands albums.

## Lorsqu’un fichier échoue

Le panneau **Tâches** s’ouvre et conserve les incidents. Pour chaque fichier, il affiche son nom complet, la cause, l’étape et les détails techniques.

- **Vérifier le fichier** : contrôle sa présence à l’emplacement enregistré.
- **Retrouver l’original** : sélectionner l’original déplacé ; Juno contrôle son identité puis relance son import.
- **Réessayer** : reprend seulement ce fichier.
- **Reprendre les fichiers échoués** : reprend uniquement les échecs non résolus, sans retraiter les photos réussies ni effacer leurs retouches.
- **Exporter le diagnostic** : enregistre un rapport JSON local avec les noms, chemins, erreurs et tentatives. Il ne contient ni image ni clé API ; les chemins peuvent contenir des informations personnelles.

Les erreurs résolues restent identifiables dans l’historique. L’effacement des tâches terminées conserve les tâches dont les erreurs ne sont pas résolues. Un manque d’espace suspend l’import pour éviter une cascade d’échecs.

## Moteur RAW

Une panne du moteur et un dépassement du délai sont distingués. Le diagnostic précise l’étape en cause ; un délai dépassé ne signifie pas que le fichier est corrompu. Une panne transitoire déclenche une seconde tentative avec un moteur neuf. Les buffers RAW de l’import sont libérés entre les fichiers. Le décodage conserve la pleine définition et les données 16 bits du moteur.

## Limites de la correction

Les sept CR3 de l’import signalé n’étaient plus disponibles pour reproduire leur décodage. Le journal ancien indique sept erreurs « LibRaw disposed », correspondant à l’arrêt du décodeur après le délai de deux minutes de l’ancienne version. La raison initiale du blocage sur ces fichiers ne peut pas être établie sans eux.

La correction rend les incidents visibles et permet une reprise ciblée ; elle ne garantit pas qu’un fichier illisible, un disque déconnecté ou un format encore incompatible puisse être importé. La validation détaillée de cette version figure dans `VALIDATION-V041.md`.
