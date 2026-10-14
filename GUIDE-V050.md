# Juno Studio 0.5.0 — Pilote local et historique durable

Cette version ajoute un premier ensemble concret d’outils du programme AI-first. Elle ne couvre pas encore l’ensemble de la feuille de route ni la totalité des fonctions de Lightroom, Photoshop, Premiere, Resolve et After Effects.

## Piloter une photo, un album ou un montage

Ouvrez **Pilote Juno**, ou utilisez **⌘/Ctrl + Maj + P**. Choisissez Élément actif, Sélection ou Tout le projet. Les photos gardées sont également disponibles dans l’espace photo.

Exemples de commandes directement exécutables :

- `Exposition à 0,3 puis baisse les hautes lumières de 15`
- `Applique le style Film doux sur la sélection`
- `Garde`, `Protège`, `Mets 4 étoiles`
- `Reviens à l’original`, `Rétablis la retouche`
- `Crée une version "Mon rendu"`
- `Volume à -6 dB`, `Coupe ici`, `Raccourcis à 2 secondes`
- `Ajoute un titre "Juno et vous"`
- `Anime la position horizontale de -20 à 20 sur 2 secondes`
- `Anime le volume de -12 dB à 0 dB sur 2 secondes`
- `Crée un montage vertical de 30 secondes`
- `Transcris les rushes sur tout le projet`, `Crée les sous-titres`
- `Annule`, `Rétablis`, `Importer`, `Exporter`

Le titre doit être entre guillemets. Le curseur doit être à l’intérieur du plan pour une coupe ou une animation. Un mouvement doit se terminer avant la fin du plan. L’assemblage crée une nouvelle séquence éditable avec les médias disponibles ; il ne fait pas encore de sélection narrative ou émotionnelle. La création des sous-titres utilise les transcriptions existantes ; elle préserve les sous-titres déjà corrigés en demandant une copie.

Les consignes plus libres sont interprétées par Qwen3 4B sur l’ordinateur. Le pilote affiche les réglages proposés avant leur application. Son catalogue est limité aux outils déclarés ; certaines demandes sont refusées ou demandent une reformulation. Le modèle peut se tromper : les restrictions de zone, les contradictions de sens détectées et les commandes inconnues sont bloquées. Le premier chargement peut prendre plusieurs dizaines de secondes ; les commandes précises fonctionnent immédiatement sans charger le modèle.

## Voix

Cliquez sur **Parler**, accordez l’accès au microphone au système, puis cliquez sur **Arrêter**. La limite est de 45 secondes. Whisper transcrit localement en français. La même interprétation et le même historique sont utilisés pour le texte et la voix. Fermer le pilote coupe le microphone et interrompt l’interprétation. L’enregistrement temporaire est supprimé ; les restes d’un arrêt brutal sont nettoyés au lancement suivant. L’audio du montage n’est pas utilisé comme commande. Les fichiers de travail restent sur l’ordinateur.

## Première passe d’album

Dans la barre du projet, choisissez un style puis cliquez sur **Préparer l’album**. La passe analyse les photos, rapproche les variantes, propose les vues les plus nettes, équilibre la lumière et applique le style choisi. Les photos déjà retouchées, protégées ou écartées sont conservées telles quelles. Une modification manuelle pendant le traitement est également préservée.

Les vues proposées sans alerte sont gardées. Les variantes et les vues incertaines restent à vérifier ; aucune suppression de fichier. Les ambiances très sombres ou très claires gardent leur exposition. Les styles sont les préréglages livrés dans Juno, pas un apprentissage automatique de profils Aftershoot propriétaires.

Cette passe reste locale et coûte **0 €**. Elle ne lance pas de correction générative en série, de correction de peau ou d’yeux. Le budget demandé de 5 € par album est respecté ici par l’absence d’appel payant ; un véritable registre partagé entre photographes et fournisseurs reste à réaliser avant toute recette distante automatique. Les anciennes retouches génératives individuelles conservent leur fonctionnement et leur facturation fournisseur.

Dans **Activité**, suspendez ou reprenez le traitement. Pour annuler une passe commencée, mettez-la d’abord en pause, puis ouvrez l’historique du pilote. Une passe annulée doit être rétablie ou arrêtée avant sa reprise.

## Historique et enregistrement

Les changements photo et leur journal sont écrits dans la même transaction locale. Une commande portant sur plusieurs photos peut être annulée d’un seul geste. L’annulation ne remplace que les propriétés touchées. Les photos reprises ensuite sur ces mêmes propriétés sont conservées et signalées, les réglages indépendants sont préservés.

Les commandes vidéo sont également enregistrées dans le catalogue natif ; les 500 dernières sont conservées, en complément des versions de secours. L’annulation refuse un conflit au lieu d’écraser une reprise manuelle. L’historique du pilote reste disponible après redémarrage.

## Montage et images clés

Les réglages vidéo acceptent désormais une valeur saisie au clavier, avec virgule ou point. Dans l’inspecteur du plan, **Animation · images clés** anime la position horizontale, verticale et le volume. Choisissez une valeur, une interpolation douce, linéaire ou par maintien, puis placez le point au curseur. Cliquez sur un point pour vous y rendre, sur la corbeille pour le retirer. Limite : 32 points par propriété et par plan.

Une propriété animée suit ses images clés. Modifier sa valeur fixe au curseur ajoute ou met à jour ce point. Coupes et raccourcissements conservent les interpolations ; changer la vitesse conserve la plage source et recale les points. Aperçu et export intègrent les animations. Les titres restent statiques ; pas de particules, précompositions, 3D ou tracking avancé dans cette version.

## Activité commune

Le même panneau suit les tâches photo et vidéo, dans tous les projets. Il comporte En cours, À vérifier et Historique. **Retirer** ou **Vider l’historique** masque les entrées terminées sans supprimer les médias ni les diagnostics. L’action est réversible. Les incidents restent accessibles, peuvent être archivés puis remis à vérifier. L’ancien widget vidéo en bas à droite est retiré.

## Disponibilité

Le moteur de langage ajoute environ 2,5 Go. Il s’arrête après une minute d’inactivité ou à la fermeture du pilote. La qualification réalisée ici concerne le Mac Apple Silicon de développement. Les paquets Intel et Windows doivent encore être testés sur les machines correspondantes. Les SDK propriétaires caméra, les échanges de projets Adobe/Resolve et la couverture complète du programme restent des travaux distincts.
