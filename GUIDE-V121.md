# Juno Studio 1.2.1 : un visage flou est enfin reconnu

## Ce qui change pour vous

Le tri photo juge désormais la netteté du visage principal comme vous le feriez : en regardant les yeux à 100 %.

- **Un visage flou met la photo « à vérifier »**, avec la raison « Visage principal flou ». Avant, il fallait un flou extrême pour déclencher l'alerte, et elle ne mettait même pas la photo à vérifier.
- **Un visage entre les deux est signalé « à vérifier à 100 % »** : c'est la zone où, même à l'œil, c'est un pile ou face.
- **Un portrait net sur fond flou n'est plus mis à vérifier.** L'ancienne règle jugeait l'image entière ; elle signalait à tort 50 des 756 photos livrées de l'album d'Audrey-Ann et Clément. Il en reste 17.
- **Un invité flou au premier plan ne condamne pas la photo** quand la personne derrière lui, de taille comparable, est nette : c'est sur elle que vous aviez fait le point.
- **Une personne que vous avez nommée est jugée pour elle-même**, même si un autre visage est plus grand ou plus net.

Vos albums seront relus à la prochaine « Préparer l'album » : c'est ce qui leur donne la nouvelle mesure.

## Ce qu'on a mesuré

Sur l'album entier d'Audrey-Ann et Clément (3 552 RAW), avec le vrai code de l'application :

| | Avant | Après |
|---|---|---|
| Visages flous à l'œil, signalés « à vérifier » | 0 sur 79 | **46 sur 79** |
| Visages nets à l'œil, signalés à tort | 0 sur 110 | **0 sur 110** |
| Photos livrées mises à vérifier pour « peu de détails » | 50 | **17** |

Des 33 visages flous non signalés, 12 le sont à raison : un invité flou devant la personne nette. Les 21 autres sont les flous légers que la mesure ne voit pas.

La netteté a été jugée à l'œil par trois juges indépendants sur 200 visages de l'album, d'accord entre eux 166 fois à l'unanimité.

## Ce que ça ne change pas

- **Le tri reste loin d'Aftershoot** : il garde toujours environ 2 600 photos quand vous en avez livré 756. Ce qui pèse, ce sont les rafales qu'il ne reconnaît pas et le choix de la meilleure image dans une rafale ; la netteté des visages n'y change presque rien.
- **La mesure ne s'applique qu'aux photos d'au moins 3 000 px** (tous les RAW et JPEG de boîtier). En dessous, et sur une photo relue sans son original, l'ancien jugement reste.
- **Les photos de soirée très bruitées** peuvent cacher un flou léger : le bruit ressemble à du détail. L'erreur va toujours dans ce sens-là, jamais vers une fausse alerte.
- **Aucun album Sony ou Fuji n'a été mesuré.**
