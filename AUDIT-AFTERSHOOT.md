# Aftershoot, audit pour Juno Studio

`github.com/orgs/aftershootco` et `github.com/api-evangelist/aftershoot`, analysés le 27 septembre 2026.

> **Suite donnée le 27 septembre 2026 (1.2.0)** : les trois chantiers proposés ici sont faits. Redressement et recadrage automatiques, et envoi du tri à Lightroom en .xmp : livrés, voir `GUIDE-V120.md`. Mesure de Juno contre Aftershoot sur l'album entier d'Audrey-Ann et Clément : voir `COMPARAISON-AFTERSHOOT.md`.

## Verdict

**Les dépôts n'apportent presque rien à Juno.** Ni le tri, ni la retouche, ni aucun modèle utilisable n'y sont publiés : le vrai produit d'Aftershoot est fermé. Aucune ligne de code n'est à reprendre telle quelle.

**Deux idées de fonctionnalités tiennent**, et surtout **l'enquête a appris plus que les dépôts** : en lisant vos propres fichiers Aftershoot, on voit ce qu'il fait réellement à vos photos, et ça change la priorité de la retouche dans Juno.

---

## Ce qui a été analysé, et comment

- **54 dépôts** : les 53 publics d'`aftershootco`, plus `api-evangelist/aftershoot`.
- **13 autres traces publiques** : crates.io, npm, Docker Hub, Hugging Face, le Substack technique d'Aftershoot, son site, son canal de mise à jour, les dépôts personnels d'un ingénieur.
- **Vos fichiers locaux, en lecture seule** : l'application Aftershoot 2.23.3 installée sur ce Mac, sa configuration, les 7 838 retouches qu'Aftershoot a produites sur vos albums (`~/AfterShoot Projects`), et votre catalogue Lightroom. Rien n'a été modifié, et les modèles chiffrés d'Aftershoot n'ont pas été ouverts : ses conditions de licence l'interdisent.

Méthode : sept analystes ont lu le code lui-même, pas les descriptions ; chaque piste jugée utile a été soumise à un vérificateur chargé de la réfuter ; un contrôle de complétude a relu l'ensemble. 34 agents en tout.

Sur 54 dépôts : 21 sont des copies de bibliothèques publiques qu'on trouve à la source, 23 n'ont **aucun fichier de licence** (donc tous droits réservés), et presque tout est du Rust natif, inutilisable dans une application Electron. Les analystes avaient relevé 18 pistes ; **2 ont résisté** à la vérification.

---

## Famille par famille

| Famille | Dépôts | Ce qu'on y trouve | Pour Juno |
|---|---|---|---|
| Inférence et modèles | 12 | Enveloppes Rust d'ONNX, TFLite, OpenVINO, CoreML, MNN. Un seul modèle entraîné public : `shadow-matte-unet-mitb0`, qui dessine l'ombre portée d'un sujet détouré. L'ancienne app Android de 2020 contenait un classifieur d'exposition. | Rien. Le modèle d'ombre n'a pas de licence et ne répond à aucun besoin de Juno ; le classifieur d'exposition est dépassé, Juno mesure déjà l'exposition. |
| Formats et métadonnées | 14 | Liaisons Rust vers LibRaw, libheif, libjpeg, libexif ; lecteurs XMP et IPTC ; un lecteur des préférences Lightroom (`agprefs`). | **Deux idées** (voir plus bas). |
| Traitement d'image | 4 | `el-noches` (transfert d'histogramme, avec deux bugs), des ponts vers OpenCV. | Rien. |
| Infrastructure | 11 | Un fork de démonstration de mise à jour Electron, un copieur de carte, des outils SQL. | Rien que la documentation d'Electron ne donne déjà. |
| Interface | 6 | Leur système de design (React, Apache-2.0), leurs icônes (sans licence), des forks d'`egui`, `slint`, `wgpu`. | Rien. |
| Web et profil tiers | 7 | Site statique, gabarits d'e-mail, images, et le profil `api-evangelist` : 43 résumés de billets de blog, aucune API. | Rien. Le profil confirme qu'Aftershoot n'a **aucune API publique**. |
| Autres traces | 13 | Crates publiées (`agprefs`, `mnn`), deux paquets npm internes, une image Docker ComfyUI, des billets techniques. | Rien de plus. |

---

## Les deux idées qui tiennent

### 1. Passer le tri de Juno à Lightroom

Juno garde des étoiles et un statut « gardée » ou « écartée », mais **n'écrit aucun fichier XMP**. Or c'est la chaîne de travail de base de tout outil de tri : on trie, puis on retouche dans Lightroom, qui retrouve les étoiles et les couleurs.

Ce qu'il faut : écrire à côté de chaque RAW un fichier `.xmp` portant la note, l'étiquette de couleur et les mots-clés, en fusionnant avec un XMP existant sans l'écraser. C'est de l'XMP standard, à écrire en TypeScript. **Environ 1 à 2 jours.** Le code d'Aftershoot n'est pas repris : il n'a pas de licence, et sa façon d'écrire dans les JPEG est hors norme.

### 2. Lire directement votre catalogue Lightroom

Aujourd'hui, pour apprendre votre style, Juno vous demande d'exporter des fichiers XMP (« Enregistrer les métadonnées dans le fichier »). Il pourrait lire directement le catalogue `.lrcat`, qu'on retrouve grâce aux préférences de Lightroom. Vérifié sur ce Mac : **13 catalogues récents**, 3 622 photos retouchées dans le catalogue courant.

Deux gains :
- apprendre le style **sans aucune manipulation** de votre part ;
- **3 422 photos notées** dans ce catalogue : une vérité terrain pour mesurer si le tri de Juno choisit comme vous.

Lecture seule, sans jamais écrire dans le catalogue. **Environ 1 à 2 jours**, en TypeScript. Utile seulement aux photographes sous Lightroom Classic.

---

## Plus important que les dépôts : ce qu'Aftershoot fait vraiment

### Ce qu'il change d'une photo à l'autre

Mesuré sur 3 000 des 7 838 retouches qu'Aftershoot a produites sur vos albums :

| Réglage | Valeurs différentes sur 3 000 photos | Ce que ça veut dire |
|---|---|---|
| Exposition | 3 001 | réglée photo par photo |
| Température | 2 069 | réglée photo par photo |
| Teinte | 84 | presque par photo |
| Recadrage (bords) | 874 à 1 193 | réglé photo par photo |
| **Angle de redressement** | **399** | **redressé photo par photo** |
| Courbes de tonalité | 3 | fixes : elles viennent du préréglage |
| Couleurs (HSL) | 13 au plus | fixes : elles viennent du préréglage |

Notre comparaison du 23 septembre supposait qu'Aftershoot apprenait des courbes et des couleurs par photo. **C'est faux** : il applique un préréglage fixe, puis ajuste par photo l'**exposition**, la **balance des blancs** et le **recadrage avec redressement**.

Juno fait déjà l'exposition et la balance des blancs photo par photo. **Il ne recadre ni ne redresse automatiquement**, et il ne sait même pas redresser à la main : le pilote le refuse. **C'est le vrai écart de retouche**, et il est bien plus précis que « le style ».

Réserve : se servir de ces retouches pour **mesurer** Juno ne pose pas de problème ; entraîner un modèle concurrent sur les sorties d'Aftershoot serait à valider au regard de ses conditions d'utilisation.

### Comment il est construit

Vu dans l'application installée sur ce Mac :

- **Electron, comme Juno**, pour l'interface ;
- un moteur **Rust natif de 234 Mo**, qui calcule sur la carte graphique (Metal, OpenCL) ;
- **ONNX Runtime avec CoreML** pour les modèles, sur la puce neuronale du Mac ;
- **RawSpeed** (LGPL) pour décoder les RAW, en bibliothèque séparée ;
- une file en **deux passes** : d'abord les aperçus, puis l'analyse complète ;
- les **profils caméra d'Adobe** (fichiers DCP), qui expliquent qu'il colle au rendu de Lightroom ;
- 27 modèles chiffrés (315 Mo).

Pour l'écart de vitesse, la leçon est claire : faire tourner les modèles de Juno hors du navigateur, avec ONNX Runtime natif et CoreML sur Mac, dans un processus séparé. C'est faisable sans Rust. Le décodage RAW natif en bibliothèque séparée est permis par votre règle sur la LGPL.

### Pour la veille

- Leur téléchargement Mac pèse de 716 à 751 Mo ; **celui de Juno 1.1.0, 635 Mo.**
- Des forks récents (`slint`, `egui`, `wgpu`, un chemin nommé « Literoom ») laissent penser qu'Aftershoot prototype une interface native hors d'Electron. C'est une déduction, rien de public ne le confirme.

---

## Une piste écartée après vérification

Un vérificateur a signalé, à la lecture du code, que les aperçus RAW n'étaient pas tournés et que les photos verticales seraient analysées couchées. **Testé sur six vraies photos verticales de votre album Audrey-Ann et Clément (Canon CR3) : elles sont à l'endroit.** L'aperçu intégré porte sa propre orientation, et elle est respectée. Pas de bug pour Canon. Les autres marques (Nikon, Sony, Fujifilm) n'ont pas été testées.

Le même test montre une limite réelle : sur trois photos où le couple marche dans une rue, petit dans le cadre, **aucun visage n'est trouvé**, même avec la lecture par morceaux. Au-delà d'une certaine distance, le détecteur de Juno ne suit plus.

---

## Ce que je ferais, dans cet ordre

| | Travail | Pourquoi | Effort |
|---|---|---|---|
| 1 | **Redressement et recadrage automatiques** | C'est ce qu'Aftershoot fait réellement à vos photos et que Juno ne fait pas | Moyen : détecter l'horizon et les verticales, puis proposer un angle |
| 2 | **Écrire le tri dans des XMP pour Lightroom** | La chaîne de base de tout outil de tri, absente de Juno | 1 à 2 jours |
| 3 | **Mesurer Juno contre Aftershoot sur vos albums**, avec ses retouches et ses choix comme étalon | Savoir enfin, chiffres en main, où Juno se situe | 1 jour |
| 4 | **Lire le catalogue Lightroom** | Le style sans manipulation, et vos notes comme vérité terrain | 1 à 2 jours |
| 5 | **Modèles en natif avec CoreML** | L'écart de vitesse | Plusieurs jours |

## Limites de cet audit

- 36 dépôts jugés sans intérêt n'ont eu qu'une passe d'analyse, sans contre-vérification. Le contrôle de complétude en a relu les commits propres à Aftershoot : rien de substantiel.
- Les dépôts personnels des autres ingénieurs d'Aftershoot n'ont pas été parcourus.
- Les licences de certaines bibliothèques Microsoft citées pour Windows n'ont pas été lues.
