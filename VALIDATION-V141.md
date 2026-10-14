# Validation Juno Studio 1.4.1

- Construction application et portail de retours : `npm run build`.
- Tests unitaires : `npm run test:unit` (631 tests, 65 fichiers, tous réussis).
- Tests natifs : `npm run test:native` (223 tests, tous réussis).
- Parcours Electron avec profil temporaire et deux vidéos H.264/AAC synthétiques : import, déplacement sur V1 avec remplacement, création V2, fondus, volume audio, déplacement et allongement d’un titre, déplacement de la tête, comparaison couleur, agrandissement du moniteur, création d’une version verticale 4K.
- Audio français de synthèse : l’ancien modèle Whisper base a produit des contresens sur « mariés » et « voix » ; le modèle small les a reconnus dans ce test. Cela ne garantit pas la transcription de tous les rushes ; les vrais fichiers du studio doivent encore être évalués.

Le parcours Electron utilise un catalogue temporaire ; aucune vidéo ou photo du catalogue principal n’est modifiée. Les trois archives Mac ARM, Mac Intel et Windows ont passé le contrôle ZIP ; les empreintes figurent dans `release/v1.4.1/SHA256SUMS.txt`. Les paquets Windows et Mac Intel sont construits mais ne sont pas exécutés sur ce Mac ARM.

Juno Studio 1.4.1 a été installé sur ce Mac ARM avec sa signature Developer ID. Le service local répond, l’application installée démarre avec un profil temporaire et les 491 fichiers du catalogue principal ont la même empreinte SHA-256 avant et après l’installation.
