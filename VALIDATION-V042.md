# Validation 0.4.2 — 22 septembre 2026

- Compilation TypeScript et Vite réussie.
- 42 tests automatisés réussis : 21 photo/catalogue, 7 fiabilité d’import, 13 vidéo et 1 scénario natif d’import mixte.
- L’intégration native couvre le choix de fichiers, un projet lié, WAV et Opus réels, vidéo MKV, vidéo sans extension, copies vérifiées, fichier absent, document non média, diagnostic JSON, reprise ciblée et recherche d’un fichier déplacé.
- L’interface Electron a été testée hors ligne sur PNG, BMP, HEIC et PSD, ainsi que WAV, Opus et MKV : images dans la grille, autres médias dans le projet vidéo lié, édition du PSD composite, reprise sans réimporter les réussites et glisser-déposer natif.
- Une image HEIC de 4032 × 3024 composée de 48 tuiles est décodée en entier. La sélection du premier flux isolé a été retirée pour utiliser la recomposition du moteur. Les dimensions du résultat sont contrôlées avant son utilisation. Voir la [structure de groupes de tuiles FFmpeg](https://www.ffmpeg.org/doxygen/7.1/structAVStreamGroupTileGrid.html).
- Les tests utilisent des profils isolés et des médias fabriqués localement. Aucune image client n’est envoyée à un service externe.

Le test de 30 décodages RAW de la version précédente reste décrit dans `VALIDATION-V041.md`. La gestion RAW est conservée et utilise désormais une liste commune de formats pour l’import et la libération du moteur.

Les images complémentaires utilisent un TIFF composite de travail. Ce test ne valide ni la retouche de calques ni une gestion complète des profils ICC des formats complémentaires. Les anciens CR3 supprimés ne peuvent pas être récupérés par cette mise à jour.

Mac Intel et Windows : paquets construits, à qualifier sur leurs systèmes et leurs pilotes. Les formats propriétaires restent soumis aux décodeurs disponibles ; il n’existe pas de garantie de décodage universel.

```sh
npm run build
npm test
npm run test:import
npm run test:media
npm run test:video
```

Les scripts `media-ui-check.cjs` et `native-image-formats.cjs` sont fournis dans les éléments de validation de l’archive source ; leurs chemins de runtime sont à adapter.
