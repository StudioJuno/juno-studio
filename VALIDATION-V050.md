# Qualification Juno Studio 0.5.0

Qualification locale, Mac Apple Silicon, 16 Go de mémoire. Les profils de test Electron sont temporaires et distincts du catalogue du photographe. Aucun appel IA payant ni capture du microphone réel pendant les tests.

## Résultats vérifiés avant empaquetage

- 64 tests TypeScript : journal photo atomique, rollback, conflits, gestes manuels, tri, RAW, édition, persistance, interprétation française, animation et recalage temporel.
- 27 tests natifs : import média, codecs, catalogue, serveur équipe, reprise, génération simulée, transcriptions réelles, exports et animation. Aucun test sauté dans cette exécution.
- Application Electron : commande photo multiple, conservation d’un réglage manuel indépendant, annulation et rétablissement après rechargement, panneau à 1 100 px, activité commune et absence de l’ancien widget vidéo.
- Album de démonstration de 12 photos : 24 étapes terminées, zéro erreur. Les réglages manuels antérieurs sont conservés. Traitement entièrement local.
- Charge réelle du catalogue Electron : modification de l’exposition de 5 000 fiches photo en 2,88 s, annulation en 2,89 s, conservation des autres propriétés. Ces données synthétiques ne constituent pas un test de décodage ou d’export de 5 000 RAW différents.
- Parcours vidéo Electron : import réel d’un média de test, saisie numérique avec virgule, animation créée par consigne, reprise d’une image clé à la souris, titre éditable, annulation durable après redémarrage.
- Rendu natif : le centre de l’objet passe de x=79,5 à x=239,5 dans une image de 320 px ; le segment repris retrouve x=159,5, identique au rendu continu. RMS audio de 0,0116 à 0,0839.
- Dictée : voix française synthétique de test reconnue par Whisper ; silence rejeté, fichiers temporaires supprimés. Environ 2,9 s pour la transcription et le test de silence.
- Langage local : tests réels Qwen3 4B. Première requête à froid observée jusqu’à 86,8 s, requêtes suivantes 4,2 à 9,5 s. Une première formulation a inversé le sens d’un réglage ; une autre a proposé une action absente. Ajout de contrôles directionnels et de restrictions, validation stricte du catalogue, proposition explicite avant application. Ce modèle n’est pas qualifié pour exécuter des demandes libres sans revue.

## Limites et travaux ouverts

Cette version livre une première tranche L1/L2, une recette locale L3 et les premières animations de L7. Les autres lots du plan restent ouverts. Le montage sémantique ou narratif, les effets génératifs en série, les masques suivis, les précompositions, la 3D, les particules, le remplacement universel des suites professionnelles et les échanges Adobe/Resolve ne sont pas déclarés terminés.

Le quota commun de 5 € pour les appels distants d’un album n’est pas encore implémenté : la nouvelle recette ne fait aucun appel distant. Les corrections génératives individuelles existantes restent facturées par le fournisseur ; pas de déploiement automatique de ces corrections sur un album tant que le registre partagé n’existe pas.

Les styles livrés sont des préréglages. La récupération/apprentissage des profils Aftershoot Juno nécessite leurs exports ou un corpus avant/après autorisé. Les anciens CR3 perdus ne permettent toujours pas de reproduire leurs sept échecs.

Mac Intel et Windows : runtimes fournis, qualification sur ces matériels encore nécessaire. Permission microphone et qualité en environnement bruyant à tester avec les utilisateurs. Les mesures à 5 000 fiches et dix angles synthétiques ne remplacent pas un pilote avec de vrais projets longs 4K/6K LOG.

## Traces

Le dossier `work/ai-first` de l’espace de travail contient les journaux des tests, les résultats JSON, les captures des profils isolés, les manifestes de téléchargement et les scripts de reproduction. L’installation et les empreintes des paquets sont consignées séparément dans le reçu de livraison extérieur à l’application.
