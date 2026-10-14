# Juno Studio 0.6.0 — Retours clients

Le bouton **Retours clients** se trouve dans les espaces photo et vidéo. Ce module s’ajoute aux outils et au Pilote Juno de la version 0.5.0.

## Présenter un album ou un film

1. Ouvrez votre projet, puis **Retours clients → Partager au client**.
2. Pour les photos, choisissez les gardées, la sélection actuelle ou toutes les photos sauf les écartées. Les réglages en cours sont enregistrés avant de figer les rendus. Pour une vidéo, ouvrez le montage à présenter.
3. Donnez un titre et un message d’accueil. Dans **Accès et téléchargement**, choisissez un code facultatif, une durée d’accès et l’autorisation de téléchargement. Celle-ci est désactivée par défaut.
4. Lancez la préparation. Vous pouvez continuer à travailler : les rendus sont figés, les modifications suivantes ne changent pas la livraison. La publication devient disponible uniquement lorsque tous les fichiers et miniatures ont été vérifiés.
5. Ouvrez **Liens clients et accès** pour copier le lien ou le consulter comme un client. Aucun email n’est envoyé automatiquement.

**En mode local**, le lien ne fonctionne que sur cet ordinateur et tant que Juno est ouvert. Il sert à tester le parcours ; ce n’est pas encore une adresse à envoyer au client. Un portail HTTPS hébergé peut être connecté dans **Connexion** pour fonctionner lorsque votre Mac est éteint. Les fichiers de déploiement sont prêts ; hébergement et domaine doivent encore être configurés.

Le portail présente des copies destinées à la relecture : photos JPEG jusqu’à 2 560 px sur le grand côté et vidéos MP4 H.264/AAC jusqu’à 1 920 px, avec la cadence du montage. Le cadrage est conservé et la galerie n’impose pas de recadrage aux miniatures. Les téléchargements proposés concernent ces rendus, pas les RAW ni les masters de livraison. L’absence de bouton Télécharger ne peut pas empêcher une capture d’écran ou une récupération des médias déjà affichés par le navigateur.

## Le parcours du client

Le client ouvre le lien, saisit le code s’il y en a un, puis parcourt sa galerie. Aucun compte n’est obligatoire. Son nom est demandé pour envoyer ses retours ; cette identité est déclarée, sans vérification par email.

- Cœur : sélectionner une photo sans modifier le tri du photographe.
- Ouvrir un média : commenter, pointer un détail, zoomer sur une photo.
- Vidéo : lire, se déplacer image par image, commenter un instant ou une plage, ou faire une remarque sur l’ensemble du film.
- **Ajouter à mes retours** : placer une remarque dans les brouillons. Le texte encore en cours de saisie est également mémorisé sur ce navigateur lors de la fermeture du média.
- **Envoyer mes retours** : transmettre les remarques et la sélection. Un accusé confirme la réception. En cas d’incertitude réseau, Réessayer réutilise l’identifiant d’envoi afin d’éviter un doublon.
- **Valider cette version** : confirmer l’accord séparément des commentaires. Une demande de corrections et le retrait d’une validation sont également possibles.

Les brouillons sont propres au navigateur. Si celui-ci refuse le stockage, gardez la page ouverte jusqu’à l’envoi ; un avertissement apparaît. Une session expirée ou un autre navigateur ne récupère pas automatiquement les brouillons et la sélection personnelle de l’ancienne session. Les échanges envoyés restent enregistrés sur le portail.

## Traiter les retours dans Juno

Les remarques sont regroupées par livraison et version. Filtrez par état : À traiter, En cours, À clarifier, Traité ou Non retenu. Une réponse au client et une note interne sont deux actions distinctes ; les notes internes sont filtrées côté serveur et ne sont jamais envoyées à l’API du client.

**Ouvrir dans l’atelier** retrouve la source locale. Pour la vidéo, Juno cherche le passage correspondant dans le montage actuel. Si les coupes ou les superpositions rendent la correspondance ambiguë, il le signale au lieu de choisir arbitrairement une autre scène.

**Préparer une correction** place le texte du retour dans le Pilote Juno. Aucune retouche n’est appliquée par la seule réception d’un commentaire. Le photographe relit la demande, fait interpréter la consigne et choisit les outils disponibles. Les fonctions et l’historique du pilote 0.5.0 restent applicables ; ce bouton n’ajoute pas une interprétation universelle de toutes les demandes.

**Voir les photos choisies** ouvre les photos présentes sur ce poste et les sélectionne. Le tri et les retouches restent intacts. La sélection du client reste enregistrée sur le portail pour cette version. **Exporter les échanges** enregistre un rapport JSON destiné à Juno, qui comprend aussi les notes internes : ne pas le transmettre au client tel quel.

## Corriger et publier à nouveau

**Nouvelle version** crée une livraison complète des médias choisis. Les anciens rendus, commentaires et validations restent attachés à leur version. Les liens actifs conservent leurs droits ; la nouvelle version nécessite un nouvel accord. Le client peut retrouver les versions précédentes et comparer un média à sa version antérieure si le même média y figurait. Les deux vidéos en comparaison se lisent indépendamment.

Un destinataire supplémentaire peut avoir son propre lien. Les validateurs requis sont figés pour chaque version ; ajouter un validateur après la publication s’applique aux versions suivantes. Révoquer un lien coupe ses nouveaux accès. Réactiver un lien déjà expiré ne prolonge pas son expiration : créer un nouveau lien dans ce cas.

## Suivre et reprendre

Les publications figurent dans **Activité**, à côté des traitements photo et vidéo. Elles peuvent être suspendues, reprises ou annulées ; retirer une tâche terminée ne supprime pas la livraison. Dans Activité, ce retrait peut être annulé. Une publication complète reste accessible dans Retours et livraisons même si sa tâche est retirée.

Après fermeture de Juno, reprendre la préparation ou l’envoi depuis Retours clients. Un fichier en erreur est identifié. Réessayer sa préparation, ou choisir explicitement de publier seulement les rendus prêts. Le logiciel ne publie pas silencieusement un album incomplet.

Le serveur vérifie la taille et les empreintes SHA-256 ; l’envoi reprend au dernier morceau confirmé. Un manque d’espace ou un quota atteint reste signalé, sans suppression des originaux. Les copies de travail locales sont supprimées après la publication réussie ; les versions publiées restent conservées sur le portail.

## Périmètre de cette livraison

Cette version livre le socle de relecture. Restent ouverts : hébergement réel, comptes équipe unifiés, notifications email, vidéo adaptative HLS/CDN, annotations dessinées libres, résumé IA collectif et traitement autonome de tous les retours. Les exemples de déploiement visent un pilote sur un serveur unique ; ils ne constituent pas une qualification d’un service distribué.

La relecture et la préparation du texte pour le pilote ne déclenchent aucun appel IA payant. Le registre technique de réservations existe côté portail, mais il n’est pas encore relié à tous les anciens fournisseurs IA : le plafond global de 5 € par album n’est donc pas annoncé comme activé sur les retouches génératives individuelles.
