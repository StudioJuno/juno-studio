# Juno Studio 0.4.2 — importer photos, vidéos et sons

Le bouton **Importer** accepte une sélection mixte. La fenêtre propose aussi un filtre **Tous les fichiers** : les fichiers inconnus ne sont plus écartés silencieusement. Chaque fichier est envoyé à un moteur de lecture ou fait l’objet d’un diagnostic.

## Utilisation

Depuis un projet photo, sélectionner les images, vidéos et sons ensemble. Les photos rejoignent la grille. Les autres médias sont préparés dans un projet vidéo lié au même projet photo ; le bouton **Vidéos et sons du projet** permet de l’ouvrir et indique les imports en cours ou les erreurs. Une sélection composée uniquement de sons ou vidéos ouvre cet espace directement.

Le studio vidéo accepte aussi ses propres imports, y compris des images pour le montage. Le glisser-déposer fonctionne dans les deux espaces de l’application native. Les fichiers restent locaux et les imports classiques fonctionnent hors ligne.

## Familles de formats

| Famille | Exemples |
| --- | --- |
| Photos et RAW | JPEG, PNG, TIFF, WebP, BMP, AVIF, CR3, CR2, ARW, NEF, RAF, DNG… |
| Images complémentaires | HEIC/HEIF/HIF, PSD, TGA, JP2, JPEG XL, DPX… selon les décodeurs inclus |
| Vidéos | MP4, MOV, MKV, MXF, WebM, AVI, MTS/M2TS, MPEG/TS, GIF animé… |
| Sons | WAV, MP3, AAC/M4A, FLAC, AIFF, Opus, OGG, CAF, WMA… |

La présence d’une extension dans le sélecteur ne garantit pas la prise en charge de chaque codec qu’elle peut contenir. Les moteurs vérifient le contenu réel. Un fichier sans extension peut être lu si le moteur identifie son contenu. Un document non média, un fichier endommagé ou un codec non disponible est signalé avec son nom.

## Conservation et retouche

Les nouveaux imports natifs de photos, vidéos et sons disposent d’une copie locale vérifiée de leur original. Les aperçus, proxys et images de travail sont séparés. La copie reste disponible lorsque le fichier de départ est supprimé. Une sauvegarde sur un autre disque reste nécessaire pour se protéger d’une panne du disque de travail.

Les images complémentaires lisibles sont décodées en une image TIFF de travail en pleine définition. Cette image est composite : la retouche de calques PSD/PSB n’est pas implémentée. Les calques restent présents dans le fichier original conservé. Le profil colorimétrique de cette image de travail doit être vérifié ; l’interface le signale. Le conteneur TIFF de travail utilise 16 bits, sans créer d’informations supplémentaires lorsque la source était en 8 bits.

Les images HDR ou à virgule flottante sont signalées plutôt que converties silencieusement vers une plage réduite. Les SDK et décodeurs propriétaires, notamment certains RAW vidéo, restent à intégrer lorsque le moteur fourni ne peut pas les lire. Les séquences d’images, projets Premiere/Resolve, MIDI et partitions ne sont pas des clips automatiquement interprétés par cet import.

## En cas d’erreur

Dans les tâches de l’espace concerné : consulter le nom et le détail, **Exporter le diagnostic**, **Reprendre les fichiers échoués**, ou **Retrouver** un fichier déplacé. La reprise ne supprime pas les réglages des médias réussis. Les diagnostics non résolus sont conservés ; les rapports JSON restent locaux et ne contiennent aucune image ni clé API, mais peuvent contenir des noms et chemins personnels.

Le navigateur seul conserve l’import photo de base. Le décodage natif des médias et des formats image complémentaires nécessite l’application installée.
