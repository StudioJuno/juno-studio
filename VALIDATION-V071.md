# Validation de Juno Studio 0.7.1

## Périmètre vérifié

- Compilation TypeScript, application Vite et portail de retours clients.
- Suite complète : 80 tests Vitest et 45 tests natifs réussis, zéro échec. Contrôles ciblés réexécutés après les corrections du rendu : transcription, validation des repères, cycle projet, export/reprise et animation.
- Transcription réelle de l’enregistrement de test JFK par le moteur Whisper local, avec temps par mot conservés dans le catalogue temporaire. Les corrections manuelles restent protégées.
- Conversion des temps à vitesse modifiée, découpe source, cadence fractionnaire, pauses sans surlignage, absence de repères et mode un mot à la fois.
- Comparaison des pixels natifs : les animations gardent leur horloge à une limite de mot et lors d’une reprise de segment.
- Interface Electron sur un profil temporaire indépendant : thèmes clair/sombre, fenêtres 1440×900 et 1280×800, correction puis sauvegarde d’un repère, surlignage visible, déplacement graphique par glissement, annulation et rétablissement. Zéro erreur JavaScript et aucun débordement horizontal détectés lors de ce parcours.
- Export réel H.264/AAC 1080p de six secondes : titre, flèche animée, sous-titres karaoké et voix améliorée. Vérification du surlignage dans les pixels exportés : présent à 1,2 s et 2 s ; absent pendant la pause à 1,6 s.

## Performance observée

Le premier essai du film de six secondes a pris 126 942 ms. Après recadrage des images de texte à leur zone utile et découpage des exports karaoké en blocs de deux secondes, le même parcours a pris 20 271 ms. Ces valeurs incluent la préparation et reflètent des mesures locales sur un Mac partagé avec d’autres applications ; elles ne constituent pas une garantie de performance générale.

Les étapes graphiques sont comptées avant la préparation des images ; au-delà de 20 000, l’export demande de diviser le film en séquences. Les images statiques ne sont plus étendues en carrés pour le calcul des animations. Les repères de mots et les images clés suivent le changement de cadence.

## Limites de validation

Exécution native et parcours d’interface réalisés sur macOS ARM. La production de paquets Mac Intel et Windows ne remplace pas un essai sur ces machines. Aucun catalogue utilisateur n’a été utilisé pour les scénarios de test. Les fonctionnalités de 3D et de suivi automatique de mouvement ne font pas partie de cette version.

Les journaux, captures du profil temporaire, résultats pixel et scripts reproductibles sont conservés dans `work/refonte-v071` à la racine de l’espace de travail.

## Livraison et installation

Les paquets Mac ARM, Mac Intel et Windows x64 ont été générés dans `release/v0.7.1`. Sur ce Mac ARM, la version 0.7.1 installée passe la vérification de signature. Le `app.asar` installé est identique au paquet construit (SHA-256 `a5e204303db7bf00a1d48c9cbba5a1fb8d19760bb1f71cf59cd40df481a98ae4`). Le catalogue utilisateur comportait 392 fichiers ; leurs tailles et empreintes sont identiques avant et après l’installation. Le démarrage isolé de l’application installée a chargé le montage et son API vidéo sans erreur JavaScript. Le service local répond, avec `setupRequired: true` : l’activation de l’administrateur n’est pas constatée dans cette validation.
