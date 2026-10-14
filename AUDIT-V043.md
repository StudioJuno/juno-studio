# Audit Juno Studio — 0.4.3

22 septembre 2026. Revue du code photo, traitements asynchrones, catalogue, import, export, moteur vidéo, retouche, interface et service équipe. Essais dans des profils isolés, sans modification des albums réels ni appel IA facturable. Sauvegarde des sources antérieures conservée dans `work/audit-v043/source-before.tar.gz` du dossier de travail.

## Corrections prioritaires

| Risque identifié | Correction | Vérification |
|---|---|---|
| Une retouche rapide peut réécrire un ancien objet photo et effacer une note ou une analyse récente | File de commandes appliquées à la dernière révision, écriture séquentielle, reprise dans l’ordre | 1 000 retouches avec modification concurrente ; panne puis reprise |
| Accumulation de rendus d’aperçu périmés | Annulation des rendus remplacés et nettoyage des requêtes/écouteurs ; lectures source dédupliquées | 100 annulations pendant un import ; panne de worker puis récupération |
| Revenir à l’original fait perdre l’accès à la retouche | Réglages récupérables, annulation/rétablissement et double-clic idempotent | Tests unitaires et parcours Electron réel |
| Nouvelle compression vidéo lors de l’assemblage final | Copie des segments vidéo encodés, durées rationnelles explicites | 4 codecs, nombre exact d’images, durée, audio décodé |
| Format d’export annoncé sans encodeur utilisable | Essai réel de chaque encodeur au démarrage ; liste d’export dynamique | H.264, HEVC 10 bits, ProRes 422 HQ et DNxHR HQX sur le Mac de test |
| Export publié puis journal interrompu | Empreinte complète enregistrée avant publication ; récupération d’un fichier final identique | Interruption injectée après renommage ; reprise sans réencodage |
| Panne disque entraînant des tentatives automatiques répétées | Arrêt de la file, diagnostic visible, reprise explicite | Échec d’écriture injecté, stabilité de la file puis reprise vidéo |
| Échec d’écriture du catalogue laissant un état mémoire non sauvegardé | Écriture atomique avec synchronisation et nettoyage ; publication mémoire après succès | Ancien catalogue conservé après échec |
| Empreinte des seuls débuts/fins insuffisante pour réassocier une source | SHA-256 complet des nouveaux médias et vérification à la réassociation | Deux fichiers aux extrémités identiques mais au centre différent |
| Registre d’export corrompu empêchant le démarrage | Ouverture du studio conservée, erreur d’export précise, diagnostic local | Registre invalide préservé dans un profil Electron |
| Registre des originaux illisible remplacé par un registre vide | Conservation du fichier, blocage des écritures sur ce registre et diagnostic | Profil isolé avec JSON volontairement invalide |
| TIFF 16 bits gris converti silencieusement en 8 bits | Décodage 16 bits gris, inversion white-is-zero ; diagnostic des variantes non prises en charge | Valeurs 16 bits exactes et rejet explicite du flottant |
| Double-clic vidéo insérant plusieurs plans | Un seul ajout pour le bouton ; double-clic du média distingué | Parcours UI sur un gros catalogue |
| Rafraîchissements vidéo superposés et réponses d’un ancien projet | Verrou de rafraîchissement, révision du catalogue et jeton de navigation | Parcours import, changement de vues et montage |
| Historique vidéo très volumineux | Limites en nombre d’étapes et en nombre d’éléments mémorisés | 50 états de 20 000 plans |
| Dépassement de la limite de plans accepté par l’interface | Contrôle avant modification et message invitant à créer une autre séquence | Cas proche de 20 000 plans |

## Ergonomie et performances

Grille photo sans recadrage, inspecteur optionnel, sélection multiple, recherche de projets, tri, mode concentration, accès rapide clavier et trois vues photo. Interface vidéo cohérente avec l’espace photo ; recherche et pagination des médias. Aperçu photo à résolution native. Nettoyage des écouteurs de glissement. Cache borné des LUT ; construction des tables de médias et pistes mémorisée. Diagnostic du studio accessible depuis les deux espaces. Écran de récupération si React rencontre une erreur fatale.

Les changements privilégient les opérations vérifiables et la préservation des originaux. La suppression des anciens logiciels de production n’est pas justifiée par ces seuls essais.

## Points restant à qualifier

- Les tests 5 000 photos portent sur de petites images synthétiques. Un album de 5 000 RAW lourds, plusieurs heures de vidéo et le fonctionnement prolongé pendant plusieurs journées restent à mesurer.
- Les essais 4K/6K utilisent des mires synthétiques ProRes 10 bits. Ils contrôlent la chaîne de traitement, pas l’exactitude colorimétrique des vraies FX3, R5, RED ou de tous les profils Log.
- Windows et Mac Intel : paquets construits, sans qualification complète sur matériel natif de ces plateformes. Pilotes et encodeurs peuvent varier.
- Aucun service IA payant testé en direct. La génération, sa qualité et ses coûts exigent une clé réelle et une qualification séparée. Les tests de soumission ambiguë vérifient un fournisseur simulé.
- RAW vidéo propriétaires, HDR de référence, gestion complète de tous les espaces couleur et exactitude équivalente à un logiciel d’étalonnage de référence ne sont pas certifiés.
- La profondeur 10 bits d’un master n’implique pas que tous les traitements internes et sources conservent une précision HDR de bout en bout. L’aperçu vidéo reste proxy SDR.
- Le futur traitement automatique complet d’album (style Juno, modifications prudentes, budget 5 €) n’est pas livré dans cette passe. Son plan précédent reste à valider séparément.
- La synchronisation équipe locale validée n’est pas un déploiement multi-sites complet avec hébergement, sauvegardes distantes et comptes opérationnels. L’administrateur réel doit toujours définir ses accès dans l’application.
- Signature Apple ad hoc, absence de notarisation et de certificat Windows. Obligations de redistribution des dépendances vidéo à terminer avant diffusion externe, conformément à THIRD-PARTY-VIDEO.md.

Aucun audit ne démontre une absence totale de bugs. Aucun comparatif mesuré ne permet ici d’affirmer que Juno est le logiciel le plus performant du marché.

## Références techniques

Les capacités réelles sont déterminées par les binaires inclus et les sondes de démarrage. Documentation primaire : [codecs FFmpeg](https://ffmpeg.org/ffmpeg-codecs.html), [formats FFmpeg](https://www.ffmpeg.org/ffmpeg-formats.html). Les journaux locaux de validation priment sur une liste théorique d’extensions.
