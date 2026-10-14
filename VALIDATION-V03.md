# Validation — Juno Studio 0.3.0

Contrôles réalisés le 22 septembre 2026 sur Mac Apple Silicon, dans des catalogues de test isolés. Aucune photo client n’a été envoyée à un service externe.

## Résultats

- Compilation TypeScript et production Vite : réussies.
- Tests unitaires : 21 réussis, couvrant notamment la migration du catalogue, la conservation des originaux et miniatures, les modifications concurrentes, le traitement des pixels et le TIFF 16 bits.
- Sauvegarde native et reprise des exports : 2 tests réussis. Une reprise accepte un fichier déjà écrit uniquement si son contenu est identique ; un contenu différent et les chemins hors du dossier autorisé sont refusés.
- Interface équipe : connexion, partage de métadonnées et aperçus, conflit visible sans écrasement et récupération d’une copie testés avec un service isolé.
- Catalogue de 5 001 entrées : affichage, comparaison de quatre images, sélection, zoom, analyse en arrière-plan, pause, changement de projet, fermeture puis reprise et export TIFF vérifiés.
- RAW Sony ILME-FX30 réel : import et développement hors ligne en 6 240 × 4 168 pixels, 16 bits, dans le moteur de traitement séparé de l’interface.
- Détection locale : régions des visages calculées sur les trois portraits de démonstration, sans réseau.
- Couleur : quatre plages TIFF Display P3 converties vers sRGB et comparées à une référence indépendante LittleCMS. Valeurs de prévisualisation identiques à la référence ; export PNG dans la tolérance de deux niveaux par canal.
- JPEG avec profil ICC sRGB, PNG avec indication sRGB et TIFF 16 bits avec profil ICC contrôlés.

## Paquets

Les applications Mac Apple Silicon, Mac Intel et Windows x64 ont été produites. Le paquet Mac Apple Silicon a été lancé avec un catalogue isolé : détection locale des visages, développement du RAW Sony et exports JPEG/PNG avec vérification des couleurs réussis sans réseau ni erreur d’interface. Les fichiers distribués contiennent les moteurs WASM et leurs modèles.

## Installation sur ce Mac

Version 0.3.0 installée dans `/Applications/Juno Studio.app`. Signature locale vérifiée et archive applicative identique au paquet testé. Catalogue précédent sauvegardé avant installation. Le service local répond sur le port 8787 ; son espace administrateur reste à activer dans l’application avec le mot de passe choisi par l’utilisateur.

## Portée

Le catalogue de 5 001 entrées est synthétique et réutilise une petite image de référence. Il valide la gestion du catalogue et la reprise des opérations ; ce n’est pas une mesure de temps de traitement sur 5 000 RAW différents. Le RAW réel testé provient d’un seul modèle d’appareil. Une qualification multi-boîtiers et une session complète de photographe restent nécessaires.

L’espace de travail et d’export est sRGB. Le contrôle d’impression, les rendus caméra Adobe, les profils d’objectifs et la conservation complète des métadonnées à l’export ne sont pas encore fournis. La conversion des TIFF avec profil et la courbe RAW explicite peuvent modifier le rendu par rapport à la version 0.2.

Les tests IA générative avec service payant ne font pas partie de ce lot. Les profils Aftershoot n’ont pas été convertis ou copiés. Les builds Intel et Windows doivent encore être qualifiés sur leurs machines cibles. Cette version reste une alpha à tester sur des copies de projets.
