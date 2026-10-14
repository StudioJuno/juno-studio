# Composants vidéo et provenance — Juno Studio 0.4

Les exécutables vidéo sont lancés comme programmes séparés. Les fichiers `native/<plateforme>/` dans les sources, et `<Resources>/<plateforme>/` dans l’application, peuvent être remplacés par une version compatible. Les DLL Windows restent séparées. Aucune restriction de rétro-ingénierie des composants libres n’est ajoutée.

| Composant | Version / usage | Licence / source |
|---|---|---|
| FFmpeg, Mac | 9.0.2, décodage, proxies, son et rendu ; build sans GPL ni réseau | LGPL 2.1 ou ultérieure ; [sources officielles](https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz), [informations de licence](https://ffmpeg.org/legal.html) |
| FFmpeg, Windows | Branche 9.0, build BtbN LGPL shared épinglé par SHA-256 | LGPL 3 ou ultérieure, avec dépendances du distributeur ; [builds et scripts](https://github.com/BtbN/FFmpeg-Builds), [archive téléchargée](https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n9.0-latest-win64-lgpl-shared-9.0.zip) |
| whisper.cpp | Mac 1.9.4 CPU ; Windows build officiel b5130 CPU | MIT ; [sources](https://github.com/ggml-org/whisper.cpp), [build Windows](https://github.com/ggml-org/whisper.cpp/releases/tag/b5130) |
| Whisper base multilingue | Reconnaissance vocale locale, modèle de 148 Mo | MIT ; [Whisper](https://github.com/openai/whisper), [modèle distribué pour whisper.cpp](https://huggingface.co/ggerganov/whisper.cpp) |
| OpenColorIO | 2.5.2, préparation des LUT de normalisation | BSD 3 clauses ; [projet](https://opencolorio.org/) |
| Config ACES pour OCIO | Studio v4, ACES 2, sortie SDR Rec.709 | BSD 3 clauses ; [sources de configuration](https://github.com/AcademySoftwareFoundation/OpenColorIO-Config-ACES) |

Les textes de licence sont inclus dans `licenses/`, également copiés hors de l’archive de l’application. Les manifestes des binaires et du modèle contiennent leurs empreintes et URL de provenance. Le manifest des LUT indique la configuration, la version OCIO et les empreintes des fichiers.

Le FFmpeg Mac a été compilé depuis l’archive officielle dont la signature PGP a été vérifiée avec la clé `FCF986EA15E6E293A5644F10B4322F04D67658D8`. Le dossier de travail conserve l’archive signée, la signature et la configuration de compilation. Les binaires Windows et le modèle ont été comparés aux SHA-256 publiés par leurs distributeurs.

Les programmes Mac peuvent être recompilés avec le script de construction conservé dans `work/video-engine/`. Pour remplacer un binaire dans une copie de développement de l’application Mac, une nouvelle signature ad hoc de cette copie peut être nécessaire. La signature de distribution et la notarisation ne sont pas mises en place dans cette alpha.

Avant diffusion externe, compléter la qualification des dépendances Windows, l’archive de leurs sources correspondantes et les notices de chaque dépendance du build BtbN. La fourniture de liens en ligne n’est pas présentée comme une validation juridique complète de la distribution.

Google Veo est un service distant optionnel, soumis au compte et aux conditions Google. Juno utilise son API documentée ; aucun modèle Google n’est embarqué. [Documentation de l’API](https://ai.google.dev/gemini-api/docs/veo).
