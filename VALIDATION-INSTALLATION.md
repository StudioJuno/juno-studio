# Installation locale — 22 septembre 2026

- Mac Apple Silicon : Juno Studio 0.2.1 installé dans `/Applications` et lancé normalement.
- Vérification de signature locale : `codesign --verify --deep --strict` réussie. Signature ad hoc pour l’usage local ; aucune notarisation de distribution.
- Catalogue antérieur sauvegardé avant installation ; données conservées dans Application Support.
- Moteur Node.js 24.19.0 indépendant installé avec le service sous Application Support, hors iCloud.
- LaunchAgent `fr.juno.studio.team` chargé et actif ; démarrage automatique à l’ouverture de session. Écoute uniquement sur `127.0.0.1:8787`.
- Réinstallation vérifiée : application remplacée après archivage, service redémarré, catalogue et état d’initialisation conservés.
- Santé HTTP vérifiée : service prêt, premier compte encore à créer par l’utilisateur. Aucun identifiant administrateur imposé.
- Aucune clé API OpenAI configurée ; aucune génération payante exécutée.

## Vérifications de cette mise à jour

- Compilation TypeScript et Vite réussie.
- Tests du service : 3 scénarios réussis (initialisation locale protégée et unique avec redémarrage ; permissions et conflits d’équipe ; changement de mot de passe et révocation).
- Interface native dans un profil isolé : validation de confirmation du mot de passe, création du premier administrateur, session chiffrée, déconnexion et reconnexion réussies.
- Copie réellement installée dans Applications, dans un profil de contrôle séparé : version 0.2.1, chargement de l’interface, détection du service local et affichage du formulaire de première activation réussis, aucune erreur JavaScript observée.
- Capture vérifiée : `../Juno-Studio-installation.png`.

Les tests de création de compte utilisent exclusivement une base éphémère de test et des identifiants fictifs. Le compte réel doit être créé dans Juno avec le mot de passe choisi par son utilisateur.

Les vérifications fonctionnelles RAW, retouche, export et tri de la version 0.2 restent décrites dans `VALIDATION-V02.md`. Cette installation ne constitue pas une qualification de production sur 50 postes et n’inclut pas de serveur distant.
