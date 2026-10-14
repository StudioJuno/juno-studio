# Vérification 0.7.0

Tests dans des profils temporaires, sans modification du catalogue utilisateur.

- 76 tests applicatifs passent, dont les liens AV, les limites de source, les verrous et le routage audio des commandes.
- 37 tests natifs existants passent : exports réels, reprise, codecs, import, sauvegarde, revue, 5 000 médias et 50 accès concurrents.
- 3 nouveaux tests audio passent : bornes des paramètres, traitement RNNoise réel, durée/PCM/original intact, tâche persistée et résultat disponible après redémarrage.
- Construction TypeScript/Vite et portail revue réussie avant versionnement final.
- Essai Electron : thèmes clair/sombre, navigation photo/montage, ajout de piste, titres ; zéro erreur JavaScript et pas de débordement horizontal à 1280 × 800. Captures conservées dans work/refonte-v070.
- Export réel de six secondes avec titre mis en forme et voix traitée : work/refonte-v070/titles-and-voice.mp4.

Ce test ne prouve pas l’absence universelle de bugs ni une performance maximale du marché. Les tests natifs et UI sont exécutés sur Mac ARM ; Windows et Mac Intel n’ont pas été testés sur du matériel correspondant. Le test de charge concerne des catalogues synthétiques, pas une session de montage de 5 000 vidéos 6K.

Motion et sous-titres : 3 tests applicatifs supplémentaires et 2 tests natifs (validation, pixels réellement animés, reprise identique). Le parcours Electron vérifie le choix d’un preset social, la création d’une flèche animée et l’export de la composition avec le son amélioré.
