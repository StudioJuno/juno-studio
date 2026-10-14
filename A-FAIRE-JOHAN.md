# Ce qui vous attend, et rien d'autre

Mis à jour le 1er octobre 2026 : **la 1.4.0 (le dérushage automatique) est installée** dans /Applications depuis le 1er octobre, avec votre accord (catalogue sauvegardé avant dans `Juno Studio Backups/before-install-1.4.0-…`), et la page de téléchargement du site la propose. Avant elle, la **1.3.0** avait été installée le 30 septembre (catalogue sauvegardé avant dans `Juno Studio Backups/before-install-1.3.0-…`). Les paquets sont dans `release/v1.3.0/` : elle contient la 1.2.1 (netteté des visages), la 1.2.2 (une photo par rafale) et une relecture complète de l'application (plus de cent cinquante défauts corrigés, dont dix passes sur la vidéo, voir `GUIDE-V130.md`).

---

## 0. Décisions pour la suite

0. **La 1.4.0 : le dérushage automatique, installée.** Chaque rush est découpé en passages bons, à vérifier et masqués, sans rien supprimer ; onglet « Dérush », pré-montage, « Retirer les passages inutilisables » (voir `GUIDE-V140.md`). À l'ouverture de vos projets, les rushes déjà importés sont dérushés en fond (environ 5 s par minute de rush), après vos exports. Les réglages restent prudents tant qu'ils n'ont pas été mesurés sur de vrais rushes : vous n'en avez pas sous la main, le prochain tournage importé fera l'affaire.

1. **La 1.3.0 est installée.** À la prochaine « Préparer l'album », vos albums seront relus : nouvelle mesure des visages, empreinte de rafale, développement RAW mesuré pour l'exposition, et les HEIC importés en noir sont refaits. Sur un album déjà préparé, vos statuts ne bougent pas : la nouvelle sélection se voit avec « Voir les propositions ». Côté montage, au premier lancement, les rushes à plusieurs pistes son sont relus en tâche de fond et leurs aperçus refaits s'ils faisaient entendre un autre micro que le film ; vos exports passent avant.
2. **Portail client en ligne (clients.studio-juno.fr), si vous l'utilisez** : ajoutez `JUNO_TRUST_PROXY=1` dans son fichier d'environnement (modèle : `deploy/review/review.env.example`) au moment de le mettre à jour. Sans cette ligne, les freins contre les essais de code comptent tous les clients ensemble derrière Caddy. Même chose pour le service d'équipe (`server/compose.yaml` le pose déjà).
3. **Essayer l'envoi à Lightroom sur un catalogue jetable** : créez un catalogue vide dans Lightroom, importez-y quelques RAW après un envoi depuis Juno, et regardez si la couleur s'affiche en vert (et non en blanc). C'est le seul point que je n'ai pas pu vérifier moi-même.

---

## 1. Réinstaller l'IA locale du pilote : 1 minute

Elle n'est plus livrée avec l'application. Ouvrez le pilote (**Demander à Juno**), dépliez **Exemples et fonctionnement**, cliquez **Installer l'IA locale**. 2,5 Go, une seule fois : 45 secondes mesurées sur ce Mac. Les commandes des exemples marchent sans elle.

---

## 2. Relancer « Préparer l'album » sur vos albums en cours

La détection des visages a changé en 1.1.0, la 1.2.0 mesure en plus l'inclinaison, la 1.2.2 l'empreinte des rafales : à la prochaine passe, vos albums seront relus, les photos aux lignes sûres redressées, et une seule image proposée par rafale (sauf pour les photos que vous avez déjà retouchées, dont le statut ne change pas).

---

## 3. Révoquer le mot de passe Apple, si ce n'est pas déjà fait : 1 minute

Celui envoyé le 24 septembre est écrit dans notre conversation, donc dans un fichier sur ce Mac. Il ne sert plus : la notarisation passe par une clé API depuis le 25.

1. **https://account.apple.com/account/manage**
2. **Connexion et sécurité** → **Mots de passe pour applications**
3. Supprimez celui nommé `Juno notarisation`

---

## 4. Le service d'équipe, si ce n'est pas déjà fait : 1 minute

1. Ouvrez **Juno Studio**
2. Menu **Système**, en haut à droite → **Équipe**
3. Saisissez votre adresse et un mot de passe d'**au moins 12 caractères**

---

## 5. Signer la version Windows : facultatif

Le paquet Windows est construit mais non signé : Windows affichera un avertissement SmartScreen au premier lancement. Il faut un certificat de signature de code Windows (DigiCert, Sectigo : 200 à 400 € par an). À ne faire que si vous distribuez réellement sur Windows.

---

## Ce que je ne ferai pas, même avec vos accès

Saisir un mot de passe, en créer un, payer en votre nom. Ce sont vos clés.
