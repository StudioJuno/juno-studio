# Validation Juno Studio 0.4.3

Essais du 22 septembre 2026 sur le Mac Apple Silicon de construction. Profils temporaires isolés ; aucun original de production modifié ni appel IA facturable.

## Tests automatisés

- Compilation TypeScript et Vite : réussie.
- 37 tests TypeScript/Vitest et 22 tests natifs Node : réussis, soit 59 tests. Les deux familles ont désormais des commandes explicites ; `npm run test:all` les exécute toutes.
- Écriture concurrente et ordonnée de 1 000 retouches, panne puis reprise ; annulation de 100 aperçus périmés ; profondeur TIFF ; retour à l’original et historique ; transactions atomiques ; empreintes complètes ; sauvegardes ; export reprenable ; imports mixtes ; génération simulée sans soumission payante répétée ; service équipe, droits, conflits et sessions ; multicaméra ; LUT et transcription réelle.
- Le test natif vidéo injecte une panne disque dans le journal et une interruption après publication du fichier final. Les deux reprises aboutissent sans nouvelle boucle d’écriture ni réencodage du fichier final déjà produit.
- Dernier contrôle ciblé supplémentaire : registre d’export corrompu, diagnostic accessible, application utilisable, registre intact, export désactivé avec une erreur précise.

## Parcours exécutés dans Electron

**Photo** : import multi-format hors ligne, maintien du rapport d’image, édition PSD, copie d’originaux, diagnostic d’un fichier manquant, reprise ciblée, glisser-déposer natif. Accès rapide au clavier, panneau diagnostic, retouche, annuler/rétablir, double retour à l’original, récupération de la retouche, aperçu 100 %, concentration, sélection multiple, fenêtre 1100 × 720 sans débordement horizontal. Exports JPEG, PNG et TIFF 16 bits à 1400 × 933, décodés et mesurés après écriture. Sauvegarde complète de 12 photos de démonstration et restauration dans un nouveau projet.

**Vidéo** : 10 angles d’aperçu simultanés, commutation et séquence multicaméra, LUT appliquée dans le véritable aperçu GPU, harmonisation créant une version, transcription Whisper locale, insertion depuis le texte, sous-titres, titre éditable et master ProRes. La génération non configurée reste désactivée. Aucune erreur JavaScript dans ces parcours.

**Formats audio/vidéo** : import effectif de WAV, MP3, Opus et MP4 H.264 dans un projet lié ; formes d’onde non nulles pour le MP3. MP4 n’est pas une garantie universelle de codec.

**Codecs de sortie** : chaque format a produit 19 images à 30000/1001, durée 0,633967 s, son non silencieux décodé et métadonnées Rec.709 :

| Format | Flux mesuré | Format pixel mesuré |
|---|---|---|
| H.264 | h264 | yuv420p |
| HEVC / H.265 | hevc, balise hvc1 | yuv420p10le |
| ProRes 422 HQ | prores | yuv422p10le |
| DNxHR HQX | dnxhd | yuv422p10le |

L’assemblage a été exécuté avec une garde faisant échouer le test en cas de second encodage vidéo. Un autre scénario reprend un export de 301 images après interruption du deuxième segment.

## Charge et performances observées

- **5 000 PNG distincts de 96 × 64**, réellement importés et copiés : 255,81 s ; pause/reprise effective ; recherche mesurée à 164 ms ; action groupée sur 60 photos. Affichage limité à 60 vignettes. Somme maximale des working sets signalés par Electron : environ 549 Mio, dont un maximum d’environ 279 Mio pour le renderer. Ces valeurs ne constituent pas une mesure de mémoire physique exclusive.
- **Catalogue vidéo synthétique de 5 000 médias et séquence atteignant 20 000 plans** : seuls 80 médias sont affichés et moins de 100 plans sont montés dans le DOM du viewport. Recherche, ajout unique malgré double-clic et refus du dépassement de limite vérifiés. Le fichier de mesure `large-video-validation.json` contient les latences du dernier passage. Ce test n’effectue pas le décodage de 5 000 rushes.
- **4K et 6K** : sources synthétiques ProRes 10 bits de 3840 × 2160 et 6144 × 3240, longues d’une seconde. Préparation de proxies avec transformation S-Log3 ; montage de dix angles logiques utilisant ces deux sources ; master ProRes Rec.709 3840 × 2160, 10 bits, 25 images. Scénario complet : 31,7 s. Ce n’est ni un benchmark de dix caméras réelles ni une validation colorimétrique des boîtiers.
- **Service équipe** : 50 utilisateurs, catalogue de 5 000 photos, 50 lectures concurrentes. Tests de droits et de conflit réussis. Ce contrôle local ne simule pas cinquante postes transférant simultanément leurs RAW sur un réseau réel.

## Reproduction et livraison

```sh
npm run build
npm run test:all
```

Les scénarios Electron complémentaires et les résultats sont archivés dans les éléments `validation-records/audit-v043` de l’archive source. Leurs chemins de runtime sont propres au poste de construction et doivent être adaptés.

Les archives finales et l’application Mac Apple Silicon sont contrôlées séparément après conditionnement ; le bilan de livraison précise ce qui est installé. Windows et Mac Intel restent à qualifier sur leurs machines. Voir AUDIT-V043.md pour les limites, notamment RAW vidéo propriétaires, longs projets, précision HDR, IA réelle, notarisation et redistribution des dépendances.

## Contrôle du paquet Mac Apple Silicon

Après conditionnement 0.4.3, les parcours photo et import mixte ont été rejoués depuis le véritable exécutable. Deux fichiers RAW ARW de contrôle de 6240 × 4168 ont été développés en 16 bits avec deux PNG, puis le RAW est resté éditable après suppression du fichier source de test grâce à la copie gérée. Diagnostic et reprise d’un fichier manquant réussis. Export vidéo de 50 images 640 × 360 en H.264 Rec.709 depuis une source déclarée S-Log3, lecture UI et résistance à un catalogue vidéo invalide vérifiés.

Les 19 fichiers du dossier Electron et `dist/index.html` ont été comparés octet par octet avec le paquet. L’icône personnalisée est incluse. Signature ad hoc vérifiée sur les bundles Mac ARM et Intel. Aucun essai natif Windows ou Intel réel n’est revendiqué.
