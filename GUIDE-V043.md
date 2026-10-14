# Juno Studio 0.4.3 — utilisation

Version pilote photo et vidéo, pour tous les types de projets. Les opérations locales fonctionnent hors ligne. La génération par un fournisseur en ligne demande une connexion et une clé configurée dans l’application.

## Un parcours plus direct

- **Photo / Vidéo** : changement d’espace dans la barre latérale.
- **Photos / Comparer / Retoucher** : les trois vues principales d’un projet photo.
- **⌘ K** sur Mac ou **Ctrl K** sur Windows : rechercher une action ou un projet. Flèches puis Entrée pour ouvrir ; Échap pour fermer.
- **F** : mode concentration en photo. Le même raccourci réaffiche les panneaux.
- Recherche des projets dans la barre latérale. Recherche et tri des photos par nom, date ou étoiles.
- Les images restent affichées en entier, dans leur rapport largeur/hauteur. Les espaces autour de certaines images sont normaux ; l’original n’est pas recadré par la grille.

## Sélection et retouche photo

La case sous chaque vignette sélectionne la photo pour une action groupée. « Sélectionner cette page » sélectionne les photos affichées. « Tout sélectionner » porte sur le résultat filtré. Garder, écarter et protéger peuvent ainsi s’appliquer à plusieurs images. Une photo protégée ne peut pas être écartée par cette action groupée.

Double-cliquer une image ouvre la retouche. Lumière, couleur, styles, cadrage et réglages locaux restent accessibles dans l’inspecteur. Le bouton d’information affiche les détails depuis la grille.

**Annuler / Rétablir**, ou ⌘/Ctrl Z et ⌘/Ctrl Maj Z, parcourent les réglages précédents. **Revenir à l’original** enlève les réglages de la photo active, y compris son cadrage et ses retouches locales. **Rétablir la retouche** récupère les réglages qui précédaient ce retour à l’original. L’historique conserve jusqu’à 40 étapes ; les versions nommées servent à garder des variantes durables.

Le bouton de comparaison affiche temporairement l’original. L’affichage à **100 %** utilise la résolution native de l’image ; un grand fichier peut demander davantage de temps au premier affichage. Les commandes de retouche ne réécrivent pas l’original.

Attendre « Enregistré ici » avant de quitter. Si l’écriture échoue, le bouton de reprise conserve les modifications en attente dans l’ordre, pendant cette session. Ne pas forcer la fermeture tant que ces changements ne sont pas enregistrés.

## Images, vidéo et audio

Le même import peut contenir des images, des vidéos et des sons. Les photos ouvrent dans l’espace photo ; les vidéos et sons sont rattachés au projet et disponibles dans l’espace vidéo.

L’import et la préparation hors ligne ont été vérifiés notamment avec **MP4 H.264, WAV, MP3, Opus, PNG, BMP, HEIC et PSD**. Les imports TIFF RGB 16 bits existants sont conservés ; les TIFF 16 bits en niveaux de gris sont maintenant lus sans conversion silencieuse en 8 bits. Les TIFF signés, flottants 32 bits ou certaines organisations 16 bits donnent une erreur explicite ; conserver l’original et importer une copie RGB 16 bits compatible.

MP4 est un conteneur : l’extension seule ne garantit pas le décodage du codec, du profil ou des métadonnées à l’intérieur. Les RAW photo dépendent des boîtiers pris en charge par LibRaw. R3D, BRAW, CRM et autres RAW vidéo propriétaires ne sont pas garantis par le simple fait qu’ils sont sélectionnables. Voir les diagnostics d’import et les limites de GUIDE-V042.md et GUIDE-V04.md.

Un fichier illisible est identifié dans **Tâches**, avec son nom, l’étape et la cause disponible. Utiliser le rapport d’import et **Reprendre les fichiers échoués** après correction. Le logiciel conserve les réussites et peut retrouver un média déplacé. Un original supprimé avant sa copie ne peut pas être reconstitué.

## Montage et livraison

La bibliothèque vidéo propose Tous / Vidéos / Sons / Images et affiche 80 médias par page. Un double-clic sur le bouton d’ajout ajoute un seul plan. Le montage garde les fonctions de coupe, déplacement, couleur, LUT, son, multicaméra jusqu’à 10 angles, transcription locale, titres, sous-titres, versions et export.

Chaque séquence accepte au maximum 20 000 plans, titres, sous-titres ou marqueurs par catégorie. Créer une nouvelle séquence pour aller au-delà. L’historique vidéo garde au plus 40 étapes et réduit ce nombre pour les séquences très volumineuses afin de limiter la mémoire ; les versions sauvegardées restent disponibles.

Les formats proposés à l’export dépendent d’un essai d’encodage réel au démarrage : H.264, HEVC 10 bits, ProRes 422 HQ et DNxHR HQX selon l’ordinateur. Un codec fonctionnel sur un petit essai ne garantit pas toutes les résolutions, les cadences ou les pilotes GPU. L’export final assemble les segments vidéo sans une seconde compression vidéo. Son, durée et images ont été contrôlés sur les fichiers de validation.

En cas d’interruption, reprendre la tâche dans le panneau des tâches. Si le fichier final avait déjà été publié, Juno vérifie son empreinte avant de le réutiliser. Une panne d’écriture arrête la file concernée ; libérer de l’espace ou corriger l’accès au disque puis reprendre.

## Diagnostic et sauvegardes

**État du studio** affiche l’espace libre, la mémoire, la version et les codecs disponibles. Le rapport exporté est local et n’inclut ni clé IA ni image. Les rapports d’import, eux, peuvent inclure les noms et emplacements des fichiers pour permettre leur dépannage.

Faire des sauvegardes régulières. Une copie de projet vidéo `.junofilm` contient les réglages, les LUT et les références des médias avec leurs empreintes ; elle ne contient pas tous les rushes. Conserver les sources séparément. Le registre des originaux ne sera plus remplacé silencieusement s’il est illisible : sauvegarder l’ensemble du dossier de données et demander une récupération à partir d’une sauvegarde du studio.

Cette version ne met pas en service le futur traitement automatique complet d’un album avec plafond IA de 5 €. Le cadrage de cette fonction reste distinct. Les styles Juno présents ne constituent pas une reproduction certifiée des profils privés Aftershoot.
