# Reconnaissance des personnes : composants et provenance

## Modèle d'empreinte faciale

Juno 0.9.0 embarque le réseau de reconnaissance faciale de **face-api**
(`@vladmandic/face-api`, licence MIT), avec ses poids
`face_recognition_model.bin` (6,15 Mo) et leur manifeste.

Ce réseau est un ResNet-34 dérivé du modèle de reconnaissance faciale de
**dlib** (Davis King). Il produit 128 nombres par visage ; deux visages dont la
distance euclidienne est inférieure à 0,6 sont considérés comme la même
personne, seuil publié par dlib et repris par face-api.

Les poids sont copiés dans l'application au moment de la construction et lus
depuis le disque local. **Aucune image ne quitte l'ordinateur, aucun appel
réseau n'est fait au moment de l'analyse.**

Si vous avez besoin d'une garantie juridique pour un usage commercial, faites
vérifier la licence des poids dérivés de dlib : la bibliothèque face-api est
sous MIT, mais la provenance des données d'entraînement du modèle dlib doit
être appréciée séparément. Le code de Juno permet de remplacer ce modèle sans
toucher au reste : seul `src/modules/face-embed-worker.ts` le charge.

## Détection et points du visage

La détection des visages, les points caractéristiques et les expressions
proviennent de **MediaPipe Face Landmarker** (Google, licence Apache 2.0),
déjà présent depuis la version 0.3.

## Repli sans modèle

Si le modèle ne démarre pas, Juno retombe sur une signature géométrique
calculée à partir des points MediaPipe, et le dit dans le panneau des
personnes. La reconnaissance est alors moins fiable, mais l'application
continue de fonctionner.
