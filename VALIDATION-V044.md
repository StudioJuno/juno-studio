# Validation Juno Studio 0.4.4

## Vérifications réalisées

- TypeScript : compilation sans erreur ; construction Vite réussie.
- 45 tests TypeScript passent : ancien catalogue, écritures concurrentes et reprise, historique, pixel 8/16 bits, formats, rendu, ainsi que les nouveaux cas de curseur regroupé, saisie française, courbes, TSL et débruitage classique.
- 1 000 valeurs successives d’un même geste, lorsque la première écriture est bloquée : deux écritures effectives, dernière valeur conservée, une étape d’annulation. Il s’agit d’un test contrôlé de la file d’écriture.
- Interface Electron isolée, hors ligne, 1440 × 960 et 1100 × 720 : saisie numérique, Annuler/Rétablir, raccourci avec curseur focalisé, geste complet annulable, réglages avancés persistants après rechargement, retour à l’original/récupération, miniature retouchée, nettoyage de 65 tâches sans supprimer leur journal. Aucune erreur JavaScript observée.
- Parcours de non-régression : exports natifs JPEG, PNG et TIFF 16 bits à la résolution de la photo de test ; sauvegarde complète et restauration ; zoom original, menu de commandes, diagnostic, mode concentration.

Scripts et résultats détaillés : `work/audit-v044` et parcours réutilisé `work/audit-v043/photo-ergonomics.cjs`. Les profils de test sont temporaires ; le catalogue utilisateur n’est pas utilisé par les essais.

22 tests natifs supplémentaires passent : import mixte, copies vérifiées, codecs vidéo/audio, reprise d’exports, sauvegarde, transactions, IA simulée sans double facturation et serveur équipe avec 50 utilisateurs et catalogue de 5 000 entrées. Aucun appel IA payant dans ces tests.

## Mesure comparative sur un RAW Sony

Fichier test : 6240 × 4168 pixels, hors ligne, même Mac et même scénario. Valeurs de cette exécution, sans garantie pour d’autres fichiers ou matériels.

| Mesure | 0.4.3 | 0.4.4 |
|---|---:|---:|
| Premier aperçu visible | 2 905 ms | 88 ms |
| Premier rendu précis | 2 908 ms | 2 838 ms |
| Réaction visible à trois réglages | 748 / 769 / 772 ms | 22 / 21 / 19 ms |
| Rendu précis de ces réglages | 751 / 772 / 781 ms | 606 / 599 / 614 ms |
| Rendu final après vingt changements rapprochés | 2 821 ms | 534 ms |

Le premier aperçu 0.4.4 est de résolution réduite et signalé comme tel. La qualité finale reste calculée depuis l’original. L’accélération de première apparition ne signifie pas que le développement RAW intégral s’effectue en 88 ms.

## Limites de validation

- Ce lot ne constitue pas un test de toutes les caméras, ni de 5 000 RAW développés simultanément. Les essais de charge 0.4.3 restent documentés séparément avec leurs propres limites.
- Les outils avancés ont un moteur Juno. Les tests numériques vérifient notamment les bornes, la neutralité, l’alpha et la conservation des données ; ils ne prouvent pas une équivalence visuelle avec Lightroom/Photoshop.
- Les rendus fins et la réduction de bruit doivent encore faire l’objet d’une validation métier sur un corpus de photographes Juno.
- Les opérations IA payantes ne font pas partie de cette validation. Aucun nouveau plafond de facturation album n’est activé par ce lot.
- Installation utilisateur : en attente de fermeture de l’application et de la copie de la version construite. Ne pas confondre tests en instance isolée et mise à jour de `/Applications`.
