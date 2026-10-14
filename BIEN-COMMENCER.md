# Juno Studio 0.3 — gros projets, rafales et couleurs

Cette version de travail concerne tous les projets photo. Fermez l’ancienne application avant sa mise à jour. L’installateur Mac conserve une copie du catalogue précédent dans Application Support/Juno Studio Backups avant de migrer les données. Après migration, utilisez la 0.3 avec ce catalogue ; la 0.2 ne sait pas lire son nouveau schéma.

## Catalogue et navigation

Seul le projet actif est chargé. Les vignettes sont stockées séparément des réglages et chargées pour les images visibles. La migration conserve les originaux, les sélections, les calques et les versions.

Le moteur photo calcule les aperçus et les exports en dehors de l’interface. Un cache limité en mémoire conserve les images développées ; l’image suivante peut être préparée pendant la consultation. Le cache de données développées est plafonné à 512 Mo et celui des fichiers source à 128 Mo ; ces limites ne représentent pas la mémoire totale de l’application, qui comprend aussi les traitements et les moteurs WASM.

## Tâches en arrière-plan

Importez, analysez, équilibrez ou exportez un lot, puis poursuivez le tri et les retouches. Le bouton **Tâches**, en bas à droite, montre l’avancement et les erreurs.

- **Pause** et **Annuler** prennent effet après la photo en cours.
- Les tâches locales sont traitées une à une pour limiter la pression mémoire. Les demandes d’aperçu passent avant les tâches d’image encore en attente.
- Après fermeture ou interruption, les tâches en cours et en attente restent à reprendre explicitement.
- L’export utilise une copie des réglages au moment de sa demande. Vos retouches suivantes ne modifient pas les images de cet export.
- Une reprise d’export retrouve le dossier autorisé. Un fichier déjà écrit n’est réutilisé que si son contenu est identique ; un fichier différent n’est pas écrasé.
- Les originaux doivent rester disponibles sur leur disque pour reprendre un traitement.
- L’équilibrage ignore les photos dont les réglages ont changé depuis la demande du lot.
- Consultez les erreurs avant livraison. Un lot terminé peut contenir des fichiers non traités. Les erreurs détaillées de l’écran sont limitées aux 100 premières.

Un import navigateur stocke les fichiers dans le catalogue et dépend du quota du navigateur. Pour un gros projet RAW, utilisez l’application native. Les ZIP du navigateur sont limités à 100 photos et recommencent leur encodage lors d’une reprise ; les exports natifs reprennent par fichier. Sauvegarde, restauration et génération distante conservent leur fonctionnement propre ; elles ne sont pas encore intégrées à cette file.

## Comparer les rafales

Dans la grille, choisissez **Comparer**, ou utilisez **C**. Les rapprochements utilisent la ressemblance visuelle, l’heure de capture lorsqu’elle est disponible et le modèle de boîtier.

Choisissez deux, trois ou quatre images. **Zoom lié** agrandit les vues ensemble ; cliquez et glissez pour déplacer le point observé. Après une analyse des visages, **Visages** centre chaque vue sur son visage principal détecté. Il s’agit d’une estimation géométrique, pas d’une reconnaissance d’identité.

Gardez, écartez ou protégez chaque image. Une image protégée ne peut pas être écartée. Les propositions ne suppriment aucun original et le regroupement reste à vérifier, notamment si les horloges des boîtiers sont décalées.

## Couleur et export

- Développement RAW en RGB 16 bits avec sortie et courbe sRGB explicites.
- Conversion des profils ICC intégrés aux TIFF RGB vers sRGB avec Little CMS. Un profil illisible ou un TIFF ICC non RGB provoque un message d’erreur.
- Un TIFF sans profil est traité comme sRGB et indiqué comme tel. Les autres images sont décodées via la gestion couleur du navigateur puis dessinées dans un espace sRGB.
- Export JPEG avec profil ICC sRGB intégré ; PNG avec déclaration sRGB ; TIFF RGB 16 bits avec profil ICC sRGB intégré.
- Réglages d’export initiaux : résolution d’origine, JPEG, qualité 100. Ils restent modifiables.

Le développement RAW et la prise en compte des ICC peuvent donner un rendu différent de la 0.2, qui n’appliquait pas cette conversion TIFF. Vérifiez vos images de référence avant livraison. Une profondeur de 16 bits ne crée pas de détails absents d’un fichier 8 bits.

La chaîne de travail est actuellement limitée à sRGB : elle ne propose pas encore d’épreuvage d’impression, de travail en large gamut, de profils d’objectifs ni de reproduction du moteur Adobe Color. Les exports n’incluent pas encore les métadonnées EXIF/GPS/IPTC. Les styles Juno fournis restent des recettes de départ ; aucun profil IA Aftershoot n’a été importé.

## Installation et limites

L’accès équipe et la clé IA se configurent comme en 0.2.1. Les originaux restent locaux ; le service équipe partage les réglages et les aperçus. Un serveur HTTPS est nécessaire pour travailler entre différents ordinateurs.

Les contrôles sont décrits dans VALIDATION-V03.md. Le lot de 5 001 entrées utilisé pour la navigation et la reprise est synthétique ; il ne remplace pas une qualification sur 5 000 RAW différents provenant de vos boîtiers.
