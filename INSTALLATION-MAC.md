# Installation locale — Juno Studio 0.4.2

Après installation, l’application Mac se trouve dans `/Applications/Juno Studio.app`.
La copie installée est signée localement pour ce Mac. La signature Apple Developer ID et la notarisation destinées à la distribution publique ne sont pas encore configurées.

Les moteurs RAW, de tri des visages, de montage vidéo et de transcription sont inclus et fonctionnent sans Internet. Voir aussi [le guide vidéo](GUIDE-V04.md).

Le service d’équipe local dispose de son propre moteur Node.js. Il démarre à
l’ouverture de la session macOS, à l’adresse `http://127.0.0.1:8787`.

## Activer l’espace local

Dans Juno, ouvrez **Équipe Juno**. Saisissez votre email, choisissez un mot de
passe d’au moins 12 caractères, confirmez-le puis cliquez sur **Créer mon espace
local**. Le compte administrateur est créé une seule fois. Aucun mot de passe
prédéfini n’existe. Les sessions sont chiffrées par le système et expirent après
12 heures ; utilisez ensuite le même email et mot de passe pour vous reconnecter.

Le jeton d’installation, réservé à votre session macOS, est supprimé après
l’activation. Aucun mot de passe n’est enregistré en clair par l’installation.

Pour les photographes sur d’autres ordinateurs, il faut déployer le service sur
un hébergement HTTPS puis entrer son adresse dans Juno. Le service de ce Mac est
accessible uniquement depuis ce Mac. Aucun projet ni aperçu n’est publié avant
votre action explicite de partage.

## Activer les modifications et la génération IA

Ouvrez **Paramètres**, puis renseignez votre clé API OpenAI dans le champ prévu.
La clé reste chiffrée sur ce Mac. Les générations nécessitent Internet et un
compte API actif ; leur consommation est facturée par le fournisseur. Le tri
local et les réglages des photos sont déjà disponibles sans cette clé.

## Emplacement des données

- Catalogue : `~/Library/Application Support/Juno Studio/`
- Service, moteur Node.js et base équipe : `~/Library/Application Support/Juno Studio Team/`
- Sauvegarde du catalogue avant installation : `~/Library/Application Support/Juno Studio Backups/`
- Démarrage automatique : `~/Library/LaunchAgents/fr.juno.studio.team.plist`
- Journaux du service : `~/Library/Logs/Juno Studio Team/`

À partir de la version 0.4.1, les nouveaux originaux sont copiés et vérifiés dans
`~/Library/Application Support/Juno Studio/Originals/`. Depuis la 0.4.2, les vidéos et sons disposent également de cette copie. Les anciens imports
restent liés à leur emplacement précédent. Conservez aussi une sauvegarde sur
un autre disque. Voir [le guide import](GUIDE-V041.md).

## Maintenance du service

Ces commandes concernent uniquement le service d’équipe de Juno :

```sh
launchctl print "gui/$(id -u)/fr.juno.studio.team"
launchctl kickstart -k "gui/$(id -u)/fr.juno.studio.team"
```

Pour arrêter son démarrage automatique, sans supprimer les données :

```sh
launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/fr.juno.studio.team.plist"
```

Pour le réactiver :

```sh
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/fr.juno.studio.team.plist"
```

Une réinstallation conserve le catalogue et la base d’équipe. La récupération
de mot de passe administrateur et l’hébergement distant restent à configurer
avant de déployer le service à toute l’équipe.

## Mise à jour 0.3

Les commandes et emplacements ci-dessus restent valables. La version 0.3 migre le catalogue : fermez toutes les fenêtres Juno avant installation. Le guide courant est GUIDE-V03.md. La sauvegarde précédant la migration permet de revenir à l’ancien catalogue avec l’ancienne application si nécessaire ; n’ouvrez pas un catalogue migré en 0.3 avec la 0.2.
