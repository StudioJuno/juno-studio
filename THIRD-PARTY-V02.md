# Composants tiers

- React, React DOM, lucide-react, idb, UTIF : licences MIT/ISC selon les paquets. JSZip : option MIT. Versions exactes fixées dans package-lock.json ; notices copiées dans licenses/npm/.
- libraw-wasm 1.6.0 : wrapper ISC. Sources : https://github.com/ybouane/LibRaw-Wasm/tree/32fd36a9883a10c1632bc20073f1ea88cc60487a . Binaire non modifié du paquet npm. LibRaw : CDDL ou LGPL-2.1 ; texte CDDL inclus. Sources : https://github.com/LibRaw/LibRaw . LittleCMS : MIT, https://github.com/mm2/Little-CMS .
- MediaPipe Tasks Vision 0.10.32 : Apache-2.0. Modèle Face Landmarker v1 : https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task . Cartes de modèle dans licenses/source/.
- Electron : MIT. Chromium et dépendances selon LICENSE et LICENSES.chromium.html distribués avec Electron.
- Photographies de démonstration : Unsplash, crédits dans public/demo/CREDITS.txt. Elles ne sont pas présentées comme des réalisations Juno.

Les moteurs tiers sont distribués sans modification. Les modèles et WASM sont identifiés par leurs empreintes SHA-256 dans licenses/provenance.json.

## Ajouts 0.3

- lcms-wasm 1.0.5 et Little CMS : conversion ICC, licence MIT (`licenses/lcms-wasm-MIT.txt`). Source : https://github.com/mattdesl/lcms-wasm ; moteur : https://github.com/mm2/Little-CMS.
- exifr 7.1.3 : métadonnées de prise de vue, licence MIT (`licenses/exifr-MIT.txt`). Source : https://github.com/MikeKovarik/exifr.
- `public/color/sRGB.icc` : profil standard créé localement avec Little CMS, sans profil tiers incorporé.
