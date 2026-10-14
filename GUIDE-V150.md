# Juno Studio 1.5.0

## Une image plus grande, un espace mémorisé

Dans l’en-tête, la loupe ouvre la palette d’actions (⌘/Ctrl K). Le bouton de réglages montre ou masque l’inspecteur. Le mode concentration donne davantage de place à l’image. Le menu « Organiser l’espace de travail » permet de masquer la bande photo ou la bibliothèque vidéo et de rétablir l’affichage. La disposition photo et la disposition montage sont mémorisées séparément sur ce poste.

L’inspecteur et la bibliothèque vidéo se redimensionnent en glissant leur bord ; le séparateur est aussi utilisable au clavier avec les flèches. Le menu natif Affichage permet d’agrandir ou de réduire l’interface. Les messages de statut occupent une ligne dédiée. Activité commence sous la navigation, et réserve sa place dans l’espace de travail. Les actions d’album se replient quand cet espace devient étroit. Le thème sombre des livraisons utilise les couleurs du reste de l’application.

Les réglages photo continuent de s’enregistrer automatiquement. Les écritures groupées partagent maintenant des transactions de 100 changements au maximum, en conservant l’historique de chaque photo. Les commandes ultérieures restent ordonnées ; en cas d’échec les changements sont conservés pour reprise. Un changement d’original n’est jamais nécessaire pour enregistrer une retouche.

## Montage, mixage et couleur

L’export signale les profils couleur encore à confirmer et donne un accès direct à leur réglage ; ses erreurs restent visibles dans la fenêtre d’export. Le moniteur peut passer en plein écran natif ; Échap permet de revenir au montage. La timeline propose l’ajout direct de pistes son et leurs commandes Muet/Solo.

Dans Son, le mixeur ajoute le panoramique gauche/droite, des indicateurs de crête d’aperçu et des groupes Voix, Musique, Ambiances et Effets. Assignez une piste à un groupe, puis ajustez son niveau, Muet ou Solo. Les volumes de piste et de groupe se multiplient ; le panoramique de piste et de clip se combine. Les mêmes règles sont utilisées par l’aperçu et l’export. Les indicateurs affichent la crête maximale des clips de la piste dans l’aperçu, pas une mesure LUFS intégrée du mixage exporté. La normalisation LUFS existante reste distincte.

Dans Couleur, les scopes proposent histogramme, waveform de luminance et parade RGB. Ils décrivent l’aperçu SDR 8 bits, pas le signal RAW/LOG original. La comparaison par référence mémorise une image du plan sélectionné : placez la tête de lecture dans ce plan, capturez l’image puis comparez avec un autre plan. Cette référence reste affichée tant que le panneau Couleur est ouvert ; elle n’est pas sauvegardée dans le projet. L’intensité d’harmonisation peut se régler avant de créer une nouvelle version.

## Transcription et sous-titres

Le panneau de transcription propose un lecteur et l’écoute d’un passage. Les mots dont la confiance du modèle est basse sont signalés ; cette confiance est indicative. Une correction contenant le même nombre de mots conserve les temps mesurés. Ajouter ou retirer des mots supprime les repères par mot ; Juno n’invente pas une nouvelle synchronisation. Les plages temporelles des segments restent disponibles.

Les sous-titres peuvent être corrigés mot par mot. Le contrôle de lisibilité signale les lignes longues, la lecture rapide et les mots incertains. Ces avertissements demandent une relecture, ils ne garantissent pas une transcription exacte. Les originaux et les versions précédentes restent disponibles via l’historique existant.

## Réservations de budget IA

La retouche générative d’image réserve 1 € avant chaque requête, jusqu’à 5 € par projet sur ce poste. Le registre est persistant ; une erreur réseau ambiguë conserve la réservation et un registre illisible bloque les nouveaux appels payants. Le montant constitue une réserve prudente et n’est pas une facture fournisseur ni une garantie de change ou de plafond partagé entre plusieurs ordinateurs. La première passe locale de tri/couleur reste à 0 € et ne consomme pas ces réservations. Aucun appel payant n’a été nécessaire pour les tests de cette version.

Le modèle d’image actuel doit faire l’objet d’une migration avant son retrait annoncé ; la version conserve le fournisseur existant. Références consultées : [modèle d’image](https://developers.openai.com/api/docs/models/gpt-image-1.5), [édition d’image](https://developers.openai.com/api/reference/resources/images/methods/edit).

## Installation et partage client

Le modèle Whisper small utilisé pour la voix et la transcription reste embarqué ; le modèle base inutilisé n’est plus dupliqué dans les paquets. Le modèle de compréhension libre des consignes reste téléchargeable à la demande.

L’adresse administrateur Équipe est préremplie avec contact@studio-juno.fr. Le mot de passe se choisit dans l’application. Cela n’active pas à lui seul un service d’équipe distant.

L’archive Juno Review contient le serveur, le portail, les modèles systemd/Caddy et Docker Compose, sans clé ni données clients. Voir `deploy/review/README.md`. Un domaine, un serveur et une vérification HTTPS depuis un autre réseau restent nécessaires pour que les clients puissent accéder aux livraisons quand Juno est fermé. Aucun hébergement n’a été créé dans cette mise à jour.

Les essais sur ce Mac ne qualifient pas encore 5 000 décodages RAW, 10 caméras 6K, les appareils RED/FX3/R5 réels ni les plateformes Windows et Intel. Ces validations nécessitent des médias et machines représentatifs.
