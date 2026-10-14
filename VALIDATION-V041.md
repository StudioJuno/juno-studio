# Validation 0.4.1 — 22 septembre 2026

## Vérifications effectuées

- Compilation TypeScript et Vite.
- 21 tests photo/catalogue existants réussis.
- 7 nouveaux tests réussis : erreurs et délais du décodeur, arrêt avant le premier appel, réponse périmée, interprétation des anciens journaux, copie native vérifiée et reprise ciblée des imports partiels.
- Un lot de 30 fichiers ARW, construit à partir d’un même RAW Sony de test avec des empreintes distinctes, plus 2 PNG portrait/paysage : 32 imports réussis hors ligne en environ 68 secondes sur le Mac de développement. Les RAW ont été décodés en 6240 × 4168, 16 bits. Ce test vérifie la répétition du décodage et la gestion du lot ; il ne représente pas 30 modèles d’appareils différents.
- Chaque original de ce lot a une copie gérée par Juno. La suppression d’une source de test n’empêche pas son ouverture dans l’atelier.
- Contrôle des vignettes sans recadrage, sans zoom au survol et sans erreur JavaScript d’interface.
- Simulation d’un fichier absent : erreur nominative, vérification de présence, rapport JSON exporté, reprise limitée au fichier redevenu disponible.
- Simulation automatisée d’un lot avec un succès et sept échecs : les sept sont repris sans perdre la note manuelle attribuée à la photo réussie ; les diagnostics non résolus survivent à l’effacement des tâches terminées.

Les essais utilisent des profils isolés et des fichiers de test. Aucune image de client n’a été envoyée à un service externe.

## Portée

Les sept CR3 de l’incident original ont été supprimés. Leur journal a été examiné, mais leur décodage n’a pas pu être reproduit et ils n’ont pas été récupérés. La correction de la gestion des erreurs est testée ; la cause initiale du blocage de chacun de ces CR3 reste indéterminée.

Les paquets Mac Intel et Windows sont construits depuis le même code ; ils ne constituent pas une qualification sur ces machines. La validation vidéo 0.4 précédente reste décrite dans `VALIDATION-V04.md`. Cette correction ne change pas les moteurs vidéo.

L’outil reste en phase alpha. Les fichiers de caméras, volumes de 5 000 images et matériels de l’équipe doivent être qualifiés avec un corpus représentatif.

## Reproduire

```sh
npm ci
npm run build
npm test
npm run test:import
```

Le script d’intégration Electron `import-regression-ui.cjs` est fourni dans les éléments de validation de l’archive source. Ses chemins de runtime et le fichier RAW de test sont à adapter au poste. Le corpus de test n’est pas inclus dans l’archive.
