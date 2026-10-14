# Validation de Juno Studio 0.2 — 22 septembre 2026

## Vérifié

- Compilation TypeScript et build Vite.
- 16 tests unitaires : identité du rendu neutre, monochrome, bornes, précision 16 bits, encodage TIFF, pinceaux limités à leur masque, coordonnées de cadrage/rotation, propositions de sélection, validation des catalogues et historique.
- Tests du service : authentification, projets non partagés inaccessibles, droits de modification, conflit de révision, révocation de session, changement de mot de passe.
- Test de sauvegarde : original copié sans modification, restauration dans un nouveau projet, empreinte vérifiée, fichier altéré et chemins traversants refusés.
- Parcours Mac natif : analyse réelle de trois portraits avec le modèle MediaPipe hors ligne, pinceau visible, cadrage libre, export TIFF 16 bits, sauvegarde complète, restauration des réglages/calques/versions, réouverture du catalogue.
- RAW réel de test fourni par le projet LibRaw-Wasm : Sony ILME-FX30, 6 240 × 4 168 pixels, développement en 16 bits. Import et rendu vérifiés dans Chrome puis dans Electron hors ligne.
- Interface équipe reliée à un service SQLite réel de test : connexion chiffrée sur le poste, publication des métadonnées et aperçus, conflit affiché sans écrasement, récupération d’une copie marquée « aperçu partagé ».
- Parcours génération : transport simulé vérifiant première photo + image de référence + masque, puis ajout du résultat comme nouvelle photo. Aucun appel OpenAI payant. Ce test ne valide pas la qualité du modèle distant.
- Catalogue synthétique de 5 000 entrées : écriture ~5,6 s, calcul des groupes ~59 ms, réouverture ~3,1 s, 60 cartes dans la grille, 84 pages et recherche d’une image en fin de catalogue. Les vignettes sont répétées ; ce n’est pas un projet réel de 5 000 RAW.
- Service avec 50 membres et 50 lectures concurrentes d’un catalogue de 5 000 entrées. Le premier essai a révélé un délai dépassé. Après suppression d’un cycle de sérialisation JSON et ajustement des délais réseau, les 50 lectures ont réussi (~14 s au total sur ce Mac fortement chargé). Ce n’est pas une certification de 50 postes en production.
- Mise à jour du moteur Electron vers 44.4.3, du packager vers 20.3.0 et de Vitest vers 4.1.11. Audit npm après mise à jour : aucune vulnérabilité connue signalée au moment du contrôle.

Les tests utilisent des profils séparés et des fichiers de démonstration. Aucune galerie personnelle n’a été envoyée à un tiers. Les sources et originaux ont été conservés.

## Ce qui demande encore une validation ou une configuration

- Tous les modèles de boîtiers Juno, leur rendu des couleurs, les TIFF particuliers, les gros groupes et un vrai lot complet de 5 000 RAW.
- Essai réel de l’exécutable Windows et du paquet Mac Intel ; signature et notarisation avec les comptes de distribution de Juno.
- Clé API, quota et budget des générations réelles ; validation visuelle des résultats, des visages et des détails imprimés.
- Hébergement du service d’équipe, HTTPS, sauvegardes du serveur, supervision, récupération de comptes et politique d’accès/conservation.
- La synchronisation actuelle échange catalogue et aperçus. Les originaux doivent être reliés ou transmis avec une sauvegarde complète.
- La chaîne ICC complète, l’épreuvage, les profils d’objectifs, les outils PSD avancés et l’apprentissage d’un style à partir des galeries Juno ne sont pas implémentés dans cette version.

Le déploiement de production n’a pas été effectué. Cette version doit être qualifiée sur les projets Juno avant de retirer les logiciels existants.

Contrôle du paquet Mac Apple Silicon : démarrage depuis app.asar, modèle de visages hors ligne, styles et import RAW vérifiés. Les paquets Mac Intel et Windows ont été construits mais leur exécution reste à vérifier sur leurs systèmes cibles.
