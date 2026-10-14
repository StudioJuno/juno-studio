# État courant — 1.5.1, 10 octobre 2026

Juno 1.5.1 est installé dans `/Applications/Juno Studio.app`, signé Developer ID et accepté par Apple. Lire `MISES-A-JOUR.md`, `VALIDATION-V151.md` et les preuves `../../work/updates-v151/delivery-summary.json`. Les preuves des fonctionnalités photo/montage précédentes restent dans `GUIDE-V150.md`, `VALIDATION-V150.md` et `../../work/refonte-v150`.

La 1.5.1 ajoute le centre de mises à jour (menu Juno, Paramètres et indication discrète dans l’en-tête), catalogues Ed25519, paquets SHA256, préparation vérifiée, sauvegarde des catalogues après fermeture et remplacement avec tentative de retour à l’ancienne application en cas d’échec. Mac ARM/Intel et Windows sont empaquetés ; le remplacement Windows n’a pas été exécuté sur un vrai poste Windows. La recherche en ligne reste à configurer avec l’adresse HTTPS choisie par Johan ; `release/v1.5.1/updates/stable.json` est actuellement un catalogue signé de transfert manuel avec URL `.invalid`, pas un service public. Ne pas annoncer l’hébergement actif. Les utilisateurs 1.5.0 et précédents doivent installer cette version manuellement une première fois.

Préserver `signing/updates-private.pem` (privé, jamais embarqué) et la clé publique correspondante dans `electron/updates/config.json`. Ne pas régénérer ces clés, ni changer des archives publiées sans régénérer le catalogue signé. Utiliser `npm run publish:updates -- https://hote/updates/ nouveautés.txt` après notarisation des ZIP Mac finaux ; ce script ne déploie rien en ligne.

Le code et les données utilisateur restent distincts. Le portail public attend un hôte/domaine ; l’administrateur doit définir son mot de passe dans Juno. Ne pas annoncer ces services activés sans preuve. Le plafond IA est un registre de réservations local, pas une facture ou un quota partagé.

# Juno Studio — contexte de développement

Lis `REPRISE-CLAUDE-CODE.md` en entier avant toute intervention, puis `GUIDE-V090.md` et `VALIDATION-V090.md`. Le prompt de reprise prêt à copier est dans `PROMPT-CLAUDE-CODE.md`.

Travaille dans ce dossier comme sur une application Electron locale. Utilise Node 24 depuis `/Users/johan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin`. Les preuves 0.9.0 sont dans `/Users/johan/Documents/Codex/2026-09-22/ridge-2/work/refonte-v090`, celles de la 0.8.0 dans `work/refonte-v072`.

Le FFmpeg fourni est LGPL : ni `boxblur`, ni `libx264`, et `crop` n’a pas d’option `eval`. Utilise `gblur`, `pixelize` et `h264_videotoolbox`.

Préserve les projets de `~/Library/Application Support/Juno Studio` et les médias originaux. Pour les tests, utilise un profil temporaire et des fixtures. Vérifie la version installée, les paquets et les journaux avant une nouvelle installation. Ne revendique aucune fonctionnalité sans test dans l’interface et, pour la vidéo, dans un fichier exporté.
