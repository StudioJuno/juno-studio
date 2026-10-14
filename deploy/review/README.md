# Portail Juno Review 0.6.0 — déploiement pilote

Le serveur et son portail sont livrés dans `server/review/`. Ils ne dépendent d’aucun paquet npm au fonctionnement. **Node.js 24 requis**, avec `node:sqlite`. Cette livraison n’est pas encore hébergée et aucun DNS n’a été modifié.

## Architecture livrée

Une instance Node, SQLite en WAL et stockage local privé. Une seconde instance sur les mêmes données est refusée. Le rendu vidéo est produit par Juno sur le poste du photographe ; le serveur reçoit du JPEG/PNG ou du MP4 H.264/AAC prêt à consulter. Aucune clé IA fournisseur n’est envoyée au portail. Le test local 5 000 métadonnées / 50 clients simultanés ne qualifie pas 50 uploads 6K, la capacité disque, le réseau WAN ou une exploitation multi-serveur.

Ce socle permet un pilote sur un serveur unique. PostgreSQL, stockage objet/S3, CDN, encodage HLS adaptatif, notification email et authentification des clients par email restent à ajouter avant un service distribué à plus grande échelle. Le lien avec code ne constitue pas une vérification d’identité.

## Installation à préparer sur l’hôte choisi

1. Fournir un serveur Linux avec disque local persistant, Node.js 24 et un reverse proxy TLS ; créer le compte système `juno-review`. Ne pas utiliser un partage réseau pour SQLite. Réserver les ports publics 80/443 au proxy ; le port 8788 reste sur la boucle locale.
2. Construire le portail (`npm ci`, `npm run build:review`) puis copier le contenu de `server/review/` dans `/opt/juno-review`. Les fichiers applicatifs sont en lecture seule pour le service. Créer `/var/lib/juno-review`, propriétaire `juno-review`, mode 0700.
3. Vérifier l’accès DNS au domaine choisi et générer le fichier secret avec `node deploy/review/setup.mjs https://clients.studio-juno.fr /etc/juno-review.env`. Le domaine ci-dessus est une proposition, pas une adresse active. Le fichier doit rester détenu par root, mode 0600 ; systemd le transmet au service.
4. Installer `juno-review.service` dans `/etc/systemd/system/`. Vérifier que `/usr/bin/node` est bien Node 24 ; adapter ce chemin sinon. Configurer le proxy Caddy avec le domaine réel, ou un autre reverse proxy qui préserve le Host. Le serveur vérifie strictement Host et Origin.
5. Démarrer le service puis vérifier `/health` en HTTPS. Ne pas activer de journal de corps de requête ou d’entête Authorization. Le fragment secret du lien privé n’est pas transmis dans la requête HTTP initiale.
6. Dans Juno : **Retours clients → Connexion**, saisir l’adresse HTTPS et la clé. Pour le pilote, l’administrateur crée les clés personnelles via `admin.mjs`; ne pas partager une clé administrateur entre photographes. Les autorisations du portail sont distinctes du service Équipe Juno existant.
7. Faire une livraison avec des médias de test, consulter depuis un autre réseau, tester le code, une révocation, la lecture vidéo, le téléchargement autorisé/interdit, un envoi coupé puis repris. Faire une sauvegarde et une restauration avant les premiers albums clients.

Ces modèles systemd/Caddy sont fournis, mais leur exécution sur Linux et le TLS réel n’ont pas été qualifiés sur ce Mac. Aucun abonnement n’a été souscrit.

## Exploitation et récupération

- Sauvegarde **à froid** : arrêter le service, exécuter `node /opt/juno-review/backup.mjs backup /var/lib/juno-review /chemin/prive/nouvelle-sauvegarde`, puis redémarrer le service. L’outil refuse la copie d’un serveur encore ouvert, contrôle les empreintes et ne remplace jamais un dossier existant. Sauvegarder aussi la configuration secrète et conserver une copie chiffrée hors du serveur.
- Restauration : `node /opt/juno-review/backup.mjs restore /sauvegarde /nouveau-dossier`. Après contrôle, sélectionner le nouveau dossier dans la configuration. Conserver l’ancien jusqu’à validation de la restauration. Ne pas fusionner deux bases.
- Le quota par défaut de 100 Go comprend les rendus réservés et reçus. Les brouillons annulés et les versions historiques sont conservés ; pas de purge automatique de contenus clients. Surveiller espace libre, quota, latence, codes 5xx et taille de la base. Prévoir et approuver une politique de conservation avant le déploiement collectif.
- Pour annuler un partage publié : révoquer ses liens. Cela supprime l’accès ultérieur, mais ne retire pas les fichiers déjà téléchargés ou capturés par un destinataire.
- En cas de saturation, Juno conserve la tâche et son diagnostic ; libérer le quota ou augmenter le disque puis reprendre. Les réponses clients utilisent des identifiants d’opération afin d’éviter les doublons lors d’un réessai.
- Les brouillons sont propres au navigateur. Une session expirée ou un changement de navigateur ne récupère pas automatiquement la sélection nominative d’une ancienne session. Les retours déjà envoyés restent côté serveur.
- Garder au moins un administrateur actif et les clés personnelles dans un gestionnaire de secrets. Aucun système d’envoi automatique d’email n’est activé par cette livraison.

## Archive et déploiement Docker Compose (1.5.0)

`npm run package:review` produit l’archive du serveur et des modèles de déploiement, sans clé ni base client. Sur l’hôte Linux : extraire l’archive, créer une configuration privée avec `node deploy/review/setup.mjs https://VOTRE-DOMAINE /chemin/prive/review.env`, puis lancer depuis la racine extraite :

```sh
docker compose --env-file /chemin/prive/review.env -f deploy/review/compose.yaml up -d --build
```

Le domaine doit pointer vers cet hôte et les ports 80/443 doivent être disponibles. Caddy obtient le certificat ; le service Node reste dans le réseau interne. Les volumes nommés conservent les données et les certificats. Ne pas utiliser `down -v` sur un serveur en production. Contrôler `/health`, puis faire les vérifications de livraison et restauration ci-dessus. Ce modèle Docker est préparé mais n’a pas été exécuté ici : Docker et l’hôte public ne sont pas configurés sur ce Mac.
