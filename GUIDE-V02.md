# Juno Studio 0.2 — prise en main

Fermez la version précédente avant d’ouvrir la 0.2. Sur Mac, décompressez puis ouvrez Juno Studio.app ; sur Windows, décompressez le dossier complet puis lancez Juno Studio.exe.

1. Créez un projet : mariage, portrait, produit, immobilier, événement, mode ou projet libre.
2. Importez les RAW, TIFF, JPEG, PNG ou WebP. Dans l’application de bureau, les originaux restent à leur emplacement. Conservez vos disques connectés.
3. Analysez le projet. Le modèle de visages est installé avec l’application et fonctionne hors ligne. Les yeux fermés restent une estimation, particulièrement incertaine sur petits visages, groupes, lunettes et profils. Aucune photo n’est supprimée ou écartée automatiquement. Les propositions se valident explicitement.
4. Choisissez un style Juno, ajustez la lumière puis appliquez la couleur aux photos gardées. Les cadrages et pinceaux restent propres à chaque photo.
5. Dans l’atelier, peignez la lumière ou la couleur, adoucissez une zone, utilisez le tampon et recadrez librement. Pour le tampon : choisissez une source, puis peignez ; Alt + clic change la source. Chaque geste crée un calque réversible. Enregistrez vos rendus dans « Versions enregistrées ».
6. Exportez en JPEG, PNG ou TIFF 16 bits. Juno crée un nouveau dossier et inclut les réglages. Les originaux restent intacts. Le TIFF conserve les nuances d’une source 16 bits ; il ne crée pas de nouveaux détails dans un JPEG. Les fichiers exportés ne conservent pas les métadonnées EXIF/GPS.

## IA créative

Enregistrez votre clé API OpenAI dans Paramètres. Elle est chiffrée par le système, jamais incluse dans les sauvegardes. Une clé enregistrée ne signifie pas que le compte dispose de crédits.

Dans IA, décrivez la retouche, ajoutez éventuellement une photo de référence et autorisez l’envoi et sa facturation. Utilisez « Masque pour l’IA » pour peindre une zone avant de lancer la demande. Vérifiez les visages et les détails : le modèle peut modifier des zones voisines et ne garantit pas l’identité d’une personne. Accepter crée une nouvelle photo. L’entrée est limitée à 1 536 px et la sortie dépend du modèle. Aucun appel payant n’a été lancé pendant les tests.

## Sauvegardes

« Sauvegarder ce projet et ses originaux » copie les fichiers et conserve réglages, calques et versions. Chaque original est vérifié par SHA-256. Le manifeste `juno-backup.json` est écrit à la fin ; un dossier interrompu n’est pas annoncé comme une sauvegarde complète.

Conservez ce dossier sur un disque indépendant. Pour restaurer, choisissez son manifeste. Juno vérifie et copie les originaux puis crée un nouveau projet. Vos projets existants sont conservés. L’export des réglages seuls n’est pas une sauvegarde complète.

« Relier des originaux déplacés ou partagés » retrouve les fichiers par leur empreinte exacte.

## Équipe

Un administrateur installe le service fourni dans `server/` ; les instructions figurent dans son README. Équipe Juno permet de connecter les comptes, partager un catalogue, attribuer les droits et commenter les photos. Les aperçus et réglages se synchronisent sur demande ; les originaux restent sur les postes. Une copie distante est marquée « aperçu partagé » jusqu’au rattachement des originaux. Un conflit de révision ne remplace pas le travail existant : récupérez une copie pour comparer.

## État de la version

Cette version est testable mais ne remplace pas encore intégralement Lightroom, Photoshop et Aftershoot en production. Restent notamment à qualifier ou développer : rendu des boîtiers et styles sur vos projets réels, chaîne ICC et épreuvage, profils optiques, fonctions PSD avancées, apprentissage des styles sur vos galeries, synchronisation des originaux, administration complète du service et distribution signée. Windows nécessite un essai sur Windows. Les réglages classiques, les pinceaux, les RAW et le tri local fonctionnent sans Internet.
