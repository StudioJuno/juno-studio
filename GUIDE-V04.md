# Juno Studio 0.4 — Photo et vidéo

Version alpha du 22 septembre 2026. Le module photo de la version 0.3 est conservé. Le module vidéo s’adresse à tous les projets : films d’entreprise, événements, mariages, portraits, contenus sociaux, documentaires et créations.

## Monter un film

1. Ouvrir **Studio vidéo** depuis la barre latérale de l’espace photo, puis **Nouveau film**.
2. Importer les vidéos, les sons et les images. Juno crée des aperçus et des formes d’onde audio sur le poste. Les originaux restent dans leur dossier.
3. Dans **Couleur**, confirmer le profil de chaque source dont les métadonnées ne permettent pas de déterminer le rendu. Choisir notamment Sony S-Log3, Canon Log 2/3, RED Log3G10, V-Log, D-Log, Apple Log, Blackmagic Film ou ARRI LogC3/4. Le profil doit correspondre au réglage réellement utilisé au tournage.
4. Cliquer sur un média pour l’ajouter à la fin du montage, ou le glisser sur une piste. Déplacer un plan et tirer ses bords pour modifier son point de départ ou sa durée.
5. Utiliser **Espace** pour lire, les flèches pour avancer image par image, **S** pour couper le plan sélectionné, **Suppr** pour le retirer, **⌘/Ctrl Z** pour annuler. Les originaux ne sont pas supprimés.
6. Les réglages du plan permettent le cadrage, la position, la rotation, la vitesse, l’opacité, le volume et les fondus. Les pistes V1…V10 portent la vidéo ; A1…A10 portent le son.

Les réglages de séquence proposent plusieurs cadences, le Full HD, la 4K et la 6K. **Version verticale** crée une nouvelle séquence 1080 × 1920 ; le cadrage reste à contrôler plan par plan.

## Multicaméra

Ouvrir **Multicaméra**, sélectionner deux à dix fichiers caméra puis créer le groupe. Choisir la caméra portant le son de référence.

- La synchronisation par timecode utilise les métadonnées présentes dans les fichiers, avec prise en charge du passage de minuit et des cadences drop-frame 29,97/59,94.
- La synchronisation par le son cherche une correspondance dans les dix premières minutes. Elle crée un nouveau groupe ; les résultats insuffisamment distincts ne modifient pas le décalage et restent à vérifier.
- Chaque décalage peut être réglé manuellement en secondes.
- Cliquer sur un angle pendant la lecture place une coupe. Les touches 1 à 9 et 0 correspondent aux dix angles.
- **Créer une séquence avec ces coupes** produit des plans éditables et une piste son de référence continue. Un angle hors de sa période d’enregistrement laisse une portion sans image : contrôler les débuts, fins et interruptions de caméra.

Ce modèle prend un fichier par angle. La consolidation automatique des enregistrements répartis sur plusieurs cartes ou fichiers n’est pas encore incluse.

## Couleur et styles Juno

Le profil source normalise le Log vers une sortie SDR Rec.709. Les styles, l’exposition, le contraste, la saturation, la température, la teinte et les noirs adoucis s’appliquent ensuite.

**Importer une LUT .cube** ajoute une LUT créative 3D de taille 2 à 64. Son intensité est réglable ; elle s’applique dans l’aperçu et dans l’export. Le fichier de projet `.junofilm` embarque les LUT utilisées. Une LUT créative prévue pour du Log doit être préparée pour ce pipeline, car elle reçoit ici une image déjà normalisée en SDR.

**Équilibrer la séquence** et **Harmoniser selon ce plan** créent une nouvelle version. Ces corrections reposent sur des statistiques d’image et des échantillons répartis dans les sources : elles ne constituent pas un profil artistique entraîné. L’histogramme mesure le plan affiché dans l’aperçu 8 bits, et non les données RAW ni la totalité d’une composition multicouche.

Les six styles fournis sont des points de départ. Le profil Aftershoot « Johan » et les autres styles retrouvés sur le Mac n’ont pas été transférés. Une LUT compatible ou des couples originaux/rendus validés sont nécessaires pour calibrer les véritables styles du studio.

## Transcription et sous-titres

Dans **Texte & IA**, choisir un média possédant du son et lancer **Transcrire localement**. Le modèle Whisper multilingue est embarqué. Le son reste sur l’ordinateur. Rechercher et corriger les passages, puis les ajouter au montage depuis le texte.

Sélectionner un plan issu du même média et utiliser **Sous-titrer le plan sélectionné**. Le point d’entrée et la vitesse du plan sont pris en compte. **Habillage** permet de corriger les sous-titres, modifier leurs horaires, ajouter des titres, importer un SRT et exporter le SRT du montage. Les sous-titres sont aussi intégrés visuellement au film exporté. Relire les noms propres et contrôler les coupures avant livraison.

Les transcriptions corrigées manuellement sont protégées contre une nouvelle analyse qui les écraserait.

## Génération vidéo en ligne

**Génération IA** permet de configurer une clé Google AI Studio sur le poste et de demander un plan de huit secondes en 720p ou 1080p, horizontal ou vertical, avec Veo 3.1 ou Veo 3.1 Fast. La description saisie est transmise à Google ; le compte Google porte la facturation. La clé est chiffrée par le stockage sécurisé du système et n’apparaît pas dans les sauvegardes de projet.

La demande et son identifiant distant sont conservés. Une reprise interroge la génération déjà lancée. Une réponse initiale incertaine bloque le renvoi automatique pour éviter une seconde commande involontaire. La pause arrête le suivi local ; elle ne garantit pas l’arrêt du traitement ou de la facturation chez Google.

La génération en ligne a été vérifiée avec des réponses simulées. Aucun appel facturé n’a été effectué ; son activation réelle nécessite une clé et un compte Google compatibles. Cette version génère à partir de texte. Le remplacement d’objets en vidéo, les références image, les extensions et le montage conversationnel restent à développer. Imagen Video n’est pas intégré comme fournisseur : son API n’a pas été identifiée dans la documentation étudiée.

## Exporter, sauvegarder, reprendre

**Exporter** propose :

- MP4 H.264 avec audio AAC pour la livraison ;
- MOV ProRes 422 HQ, vidéo 10 bits et audio PCM 24 bits, pour un master de montage.

Le rendu utilise les originaux et une copie des réglages au lancement. Il est découpé en segments reprenables. Les segments sont encodés une seule fois, assemblés, puis supprimés du cache après réussite. Les fichiers sources et la destination sont contrôlés pour détecter un changement pendant le traitement. Un rapport `.juno-<identifiant>.json` accompagne l’export.

Le volet **Tâches vidéo** permet de suspendre, reprendre et retirer les traitements. Après un arrêt de l’application, les tâches inachevées sont signalées pour reprise. Un export peut demander beaucoup de place, particulièrement en ProRes 4K/6K ; les contrôles d’espace interrompent le rendu avant l’étape suivante si nécessaire.

**Copie du projet** produit un fichier `.junofilm` contenant montage, textes, groupes, notes et LUT. Ce fichier ne contient pas les rushes. Conserver séparément les originaux sur une sauvegarde adaptée.

**Ouvrir un projet vidéo** restaure cette copie dans un nouveau projet. **Retrouver le fichier** reconnecte un média déplacé. Juno compare une empreinte du début et de la fin du fichier et sa taille pour réduire les erreurs de reconnexion ; ce contrôle n’est pas un hachage intégral du média.

**Versions** récupère une ancienne séquence dans une nouvelle version. Les trente dernières sauvegardes automatiques de projet sont conservées. Un brouillon interrompu est récupéré à l’ouverture dans une séquence distincte.

## Limites actuelles

Cette alpha ne remplace pas encore l’ensemble des fonctions de DaVinci Resolve, Premiere, Photoshop ou Lightroom.

- Lecture interactive par aperçus 8 bits dans Electron ; rendu natif FFmpeg. Pas de moteur NLE professionnel qualifié pour dix flux 6K originaux simultanés.
- Pipeline vidéo SDR, transformations Log préparées avec OpenColorIO/ACES puis corrections après normalisation. Le HDR et un étalonnage intégral en espace scène large gamut ne sont pas disponibles.
- Pas de SDK natif RED R3D ou Blackmagic RAW. Un export caméra compatible ou un transcodage est nécessaire lorsque le décodeur ne prend pas en charge l’original.
- Pas encore d’échanges XML/AAF/OTIO complets, de montage vidéo partagé à plusieurs, d’animation par images clés, de suivi de masques, de compositing avancé ou de nettoyage audio par IA.
- Les essais utilisent des fichiers de contrôle et une courte voix de référence. La qualification sur les rushes réels FX3, R5, RED, les longs projets et les postes de l’équipe reste nécessaire.
- L’espace équipe photo existant est conservé. Son service local sur ce Mac ne constitue pas à lui seul un déploiement vidéo pour cinquante personnes.

La feuille de route complète reste dans `PLAN-JUNO-VIDEO.md`, au-dessus du dossier de l’application.
