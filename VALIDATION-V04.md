# Validation Juno Studio 0.4

Contrôles du 22 septembre 2026, sur Mac Apple Silicon. Les projets et fenêtres de test utilisent des profils isolés ; les catalogues et médias du studio ne sont pas modifiés par ces scénarios.

## Tests automatiques

**39 tests réussis** : 21 photo/catalogue, 4 service équipe, 1 reprise d’export photo et 13 vidéo.

Les contrôles vidéo couvrent :

- calcul des durées fractionnaires, bornes des plans, découpage à vitesse modifiée et import/export SRT ;
- dix angles, timecodes drop-frame et passage de minuit, corrélation audio avec décalage connu et rejet du silence ;
- écritures sérialisées et récupération des tâches après redémarrage ;
- import de LUT, interpolation, restrictions de modèle et d’adresses pour la génération ;
- protection contre le renvoi d’une demande payante dont la réponse initiale est incertaine ;
- import natif, aperçus, transcription réelle Whisper, protection des textes corrigés, reconnexion et historique ;
- export interrompu après un segment puis repris avec un nouveau catalogue en mémoire : **301 images à 30000/1001**, durée contrôlée et étiquettes Rec.709 dans le MP4 final ;
- sauvegarde transportant les LUT et restauration dans un projet distinct.

Le test du service équipe utilise cinquante membres, un catalogue de cinq mille photos et des lectures concurrentes. Il ne mesure pas cinquante monteurs vidéo simultanés.

## Parcours dans l’interface

L’automatisation de développement a vérifié import, lecture effectivement décodée, déplacement du curseur, découpage, style et export H.264. Un second scénario a vérifié dix aperçus multicaméra, placement de coupes, LUT appliquée dans le shader, création d’une version harmonisée, transcription, insertion depuis le texte, sous-titres et titre modifiable, puis export ProRes 422 HQ.

Le master est identifié comme ProRes 10 bits. Les titres et sous-titres ont été inspectés sur une image extraite du fichier exporté. Une LUT inversant une mire rouge produit un pixel de contrôle **[2, 255, 255]** dans le master, cohérent avec l’aperçu cyan. Ce contrôle élémentaire ne constitue pas une qualification colorimétrique complète.

Le panneau de génération reste désactivé en l’absence de clé. Aucun appel facturé n’a été effectué. Les tests du fournisseur utilisent des réponses simulées.

## Plateformes et conditionnement

Les binaires Mac Apple Silicon sont exécutés dans les tests. Les binaires Intel sont compilés séparément ; leur commande de diagnostic a été exécutée via la traduction macOS sur ce Mac. Les binaires Windows proviennent d’archives dont les SHA-256 ont été vérifiés, sans exécution sur Windows.

Les contrôles finaux du paquet Mac, des signatures et de l’installation sont consignés dans le document de livraison placé au-dessus du dossier de l’application.

## Qualification restante

Aucun rush client n’a servi à ces essais. Restent à valider les sources réelles FX3/R5/RED, les variantes 4K/6K Log et 10 bits, les longs enregistrements, les appareils Windows/Intel réels, les disques externes et les performances sur dix caméras. Le pipeline interactif est un aperçu 8 bits SDR ; le rendu natif ne fournit pas de support RAW propriétaire ou HDR absent du moteur.

Les outils de compositing avancé, la collaboration vidéo, les échanges NLE complets et la reproduction des profils Aftershoot restent hors du périmètre implémenté de cette alpha. Voir la feuille de route pour la suite.
