# Service d’équipe Juno

Service local ou serveur privé. Node.js 24 recommandé (SQLite intégré). Aucun abonnement ni hébergement n’est créé automatiquement.

## Lancer en développement

Dans ce dossier, définissez ces variables dans votre terminal ou votre gestionnaire de secrets :

- `JUNO_DATA_DIR` : dossier persistant hors iCloud/OneDrive, par exemple un volume dédié au serveur.
- `JUNO_ADMIN_EMAIL` : votre email administrateur.
- `JUNO_ADMIN_PASSWORD` : mot de passe initial fort d’au moins 12 caractères. Pas de mot de passe fourni par défaut.
- `HOST` : `127.0.0.1` par défaut.
- `PORT` : `8787` par défaut.

Puis `node team-server.mjs`. L’administrateur initial est créé uniquement si la base est vide. Les variables de création initiale ne réinitialisent pas un compte existant.

Avec Docker : créez un fichier `.env` local non versionné contenant les deux variables administrateur, puis lancez `docker compose up -d` depuis ce dossier. Le volume `juno-data` conserve la base. Le port publié reste limité à l’ordinateur hôte.

Dans l’application : Équipe Juno → adresse du service → connexion. Pour un service local, utilisez `http://127.0.0.1:8787`. Un service distant exige HTTPS ; les redirections sont refusées pour éviter de déplacer les identifiants vers un autre hôte.

## Ce qui est partagé

- Projets, sélections, étoiles, réglages, calques et jusqu’à cinq versions par photo.
- Aperçus JPEG, envoyés par lots et récupérés par pages de 50.
- Commentaires, comptes et droits par projet.
- Les originaux restent sur les postes. Une copie récupérée est clairement marquée « aperçu partagé » ; utilisez Sauvegardes → Relier les originaux ou échangez une sauvegarde complète pour pouvoir retoucher et exporter.

La synchronisation est déclenchée manuellement. Chaque envoi fournit la révision connue. Une modification concurrente renvoie HTTP 409 ; aucun catalogue distant n’est écrasé sans version concordante. « Récupérer en copie » conserve le travail local. Il n’y a pas de fusion automatique ni de transfert des originaux vers S3 dans cette version.

## Déploiement réel

Placez un reverse proxy TLS devant le service, limitez l’accès à votre organisation, conservez les secrets hors du dépôt, et configurez une sauvegarde quotidienne du volume. Sauvegardez SQLite avec une procédure cohérente (API de backup SQLite, ou arrêt du service pendant la copie de la base et de ses journaux). Testez régulièrement une restauration. Le journal d’audit est accessible aux administrateurs via `/audit`.

Sessions de 12 heures ; jetons aléatoires stockés sous forme d’empreinte côté serveur, chiffrement système côté application ; mots de passe dérivés avec scrypt et sel aléatoire. Désactiver un compte révoque ses sessions. Le propriétaire ou un administrateur gère les membres.

Avant un déploiement pour 50 personnes : ajouter le processus de récupération de mot de passe, SSO/MFA selon vos exigences, supervision, politique de conservation et quotas, administration des sauvegardes et test d’intrusion du déploiement. Le service livré n’a pas été exposé sur Internet pendant la construction.
