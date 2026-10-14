# Qualification Juno Studio 0.6.0

Date : 23 septembre 2026. Tests réalisés sur Mac Apple Silicon, dans des profils temporaires distincts du catalogue du photographe. Pas d’envoi à de vrais clients, pas d’appel IA payant, pas de modification du DNS.

## Résultats

- 68 tests TypeScript, 15 fichiers : tous réussis.
- 37 tests natifs : tous réussis, aucun sauté. Ils couvrent aussi les régressions photo, import, montage, export, serveur équipe et historique de la version précédente.
- Relecture serveur : séparation des projets, code et rôles, notes internes cachées, sélections, idempotence, liens révoqués, plages HTTP, validation par version, publication incomplète/stale refusée, réservations de budget concurrentes et annulation des préparations.
- Relecture native : perte simulée de l’accusé d’upload après réception réelle, fermeture/réouverture de la base, reprise sans doublon, file de publications et refus de relancer une tâche terminée.
- Vrai montage H.264/AAC : import, rendu, miniature, publication et vérification SHA-256 ; cadence 30 000/1 001, 100 images, copie figée de la correspondance temporelle.
- Sauvegarde/restauration : seconde instance refusée, sauvegarde à froid, restauration des médias/commentaires, base contrôlée, fichier altéré détecté.
- Charge : 5 000 fiches médias synthétiques, sélection de 5 000 photos et 50 clients effectuant des envois concurrents avec sélections isolées. Pages de 60 médias. En exécution dédiée, séquence envois/manifestes/pagination mesurée à 338 ms ; 794 ms pendant la suite parallèle. Il ne s’agit pas d’un test de transfert ou décodage de 5 000 RAW, ni d’une mesure réseau Internet ou d’un p95 de production.
- Parcours photo Electron/Chrome : retouche sauvegardée incluse dans 12 vrais rendus, publication avec code, détail pointé, brouillons après rechargement, retours dans Juno, note interne invisible côté client, validation, affichage mobile 390 px et fenêtre Juno 1 100 px sans débordement horizontal, texte proposé au pilote sans exécution automatique. Aucune erreur JavaScript capturée.
- Parcours vidéo Chrome : vraie lecture H.264/AAC, déplacement à l’image 17 puis conservation après rechargement, remarque de l’image 17 à la borne 45, comparaison V1/V2, envoi et validation avec stockage navigateur désactivé. Aucune erreur JavaScript capturée.

Les tests ont détecté et corrigé : arrondi de seek pouvant rester sur l’image précédente à cadence fractionnaire ; contrainte HTML de pas décimal qui empêchait l’ajout d’une plage vidéo ; perte de texte à la fermeture du lecteur ; impossibilité d’envoyer lorsque localStorage refuse l’écriture ; accord ancien modifié par l’ajout d’un destinataire ; double instance possible sur le même stockage ; accès à une sélection issue d’un autre projet ; tâches de publication séparées de l’activité commune.

## Périmètre et limites

Le serveur livré utilise SQLite WAL et un volume local, avec une seule instance. Ce pilote n’est pas la plateforme PostgreSQL/S3/CDN évoquée comme cible dans le plan. Les exemples systemd/Caddy, les certificats publics, le DNS, les sauvegardes hors site et l’exploitation Linux réelle doivent être qualifiés lors du déploiement.

L’affichage a été testé sur Chrome macOS. Safari/iOS, Firefox, Edge, Android et le matériel Windows/Intel restent à qualifier. Les vidéos sont des rendus SDR H.264/AAC de relecture, pas une preuve de conformité HDR ou de colorimétrie de moniteur. Les tests de timecode utilisent des médias CFR produits par Juno ; pas de promesse de seek exact pour tout lecteur et tout format externe.

Ni authentification nominative du client par email, ni preuve de signature électronique, ni protection DRM. Le code protège l’accès ; il ne prouve pas l’identité et ne retire pas une copie déjà reçue. Aucun email automatique. Brouillons navigateur, retours serveur et notes internes ont des périmètres distincts.

Le bouton vers le pilote aide le photographe à préparer une correction. Résumé automatique de l’ensemble des retours, résolution de contradictions et correction autonome d’une livraison restent ouverts. Le registre de budget du portail est testé mais non connecté aux anciens appels IA payants : il ne constitue pas encore un plafond partagé global de 5 €.

## Reproduction et traces

- `npm run build` construit Juno et son portail ; Node.js 24 requis pour les outils serveur/natifs.
- `npm run test:all` : suites TypeScript et natives.
- `npm run test:review` : contrôles ciblés de relecture.
- Les scripts et journaux `work/review` dans l’espace de travail décrivent les parcours Electron/Chrome, les tests de charge et les captures. L’intégrité des archives et l’installation sont consignées dans le reçu de livraison extérieur à l’application.
