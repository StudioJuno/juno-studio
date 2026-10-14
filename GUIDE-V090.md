# Juno Studio 0.9.0 — un tri qui voit vraiment, une retouche qui apprend

## Le tri regarde enfin le sujet

Jusqu’ici Juno jugeait la netteté sur une vignette de 128 pixels de large, où une photo franchement floue conservait 81 % du score d’une photo nette. L’analyse se fait désormais à 1 024 pixels, et la netteté est mesurée **dans le visage du sujet** plutôt que sur l’image entière. Une photo dont l’arrière-plan est net et les mariés flous ne gagne plus contre une photo où les mariés sont nets.

Juno lit aussi les signaux qui font trancher entre deux images d’une même rafale : yeux fermés, sourire, visage tourné. Chaque signal est pondéré par la place que le visage occupe, pour qu’un invité qui cligne au fond ne pèse jamais autant que le sujet.

Sur un fichier RAW, le tri lit l’**aperçu JPEG intégré** au lieu de décoder tout le fichier. C’est ce qui permet d’analyser un album entier sans attendre.

## Les rafales restent entières

Une rafale n’est plus coupée par une fenêtre de vingt-quatre images. Deux photos appartiennent à la même série quand elles ont été prises à moins de huit secondes d’écart et qu’elles se ressemblent encore. Une rafale de quarante images à dix images par seconde reste un seul groupe, avec une seule proposition.

Ce seuil de huit secondes n’est pas arbitraire : il a été mesuré sur vos propres mariages, à partir des groupes qu’Aftershoot avait formés, soit 5 211 paires réelles. Trois secondes n’en gardaient que 95,6 % ensemble ; huit secondes en gardent **99,1 %**. Le temps ne suffit jamais à lui seul, les deux images doivent aussi se ressembler.

Dans une série, les scores sont **relatifs** : la plus nette obtient le maximum et les autres se placent par rapport à elle. C’est ce qui permet de départager deux photos toutes les deux nettes.

## Chaque photo dit pourquoi

Sous la photo courante, Juno écrit en une phrase le critère qui a décidé : « Yeux fermés sur le visage principal », « Visage net et souriant », « Meilleure de la série », ou le score de l’image retenue face au sien. La phrase apparaît aussi en survol dans la grille.

## Juno reconnaît les personnes

Après une passe d’album, Juno regroupe les visages d’un même projet. Dans le panneau sous la photo, donnez un nom à une ou deux personnes : les mariés. À partir de là, tout le tri les privilégie. Leur netteté décide, leurs yeux fermés coûtent même si leur visage est petit dans le cadre, et une image où ils sont absents perd du terrain en le disant.

La reconnaissance s’appuie sur un **vrai réseau d’empreinte faciale embarqué** : 128 nombres par visage, calculés sur votre ordinateur, sans le moindre appel réseau. Mesuré sur vos propres photos, le même visage sur trois fonds différents obtient une distance de **0,141** quand deux personnes différentes sont à **0,768**, pour un seuil de reconnaissance à 0,6 : la marge est large.

Le modèle ne décrit que les visages assez grands pour porter une identité, au plus quatre par photo. Un invité qui occupe un centième de l’image ne servira jamais à retrouver les mariés, et le décrire coûterait des heures sur un album entier.

Si le modèle ne peut pas démarrer, Juno retombe sur une comparaison géométrique des points du visage et **le dit dans le panneau des personnes** au lieu de se dégrader en silence. Dans tous les cas, vérifiez le résultat sur les profils marqués et les visages qui se ressemblent beaucoup.

## La retouche corrige la couleur et tient la scène

La première passe d’album ne se contente plus de trois réglages. Elle corrige la **dominante de couleur**, mesurée sur les tons moyens et pondérée vers la peau, pour que les visages ne virent ni au bleu ni à l’orange. Les pixels brûlés et bouchés ne votent pas : ils ne portent pas de couleur.

Les photos d’un même moment forment une **scène**. Une scène se termine sur un écart de quatre minutes ou sur un changement de lumière franc. À l’intérieur, les réglages sont ramenés vers la médiane du groupe : deux cents photos d’un vin d’honneur gardent le même rendu au lieu de partir dans huit directions.

Une photo volontairement très sombre ou très claire garde son exposition. Seule sa dominante est corrigée, parce qu’une dominante n’est jamais un choix.

## Juno apprend votre style

Chaque fois que vous corrigez une photo après la passe automatique, Juno retient l’écart entre ce qu’il proposait et ce que vous avez gardé. Au bout de douze corrections, il part déjà de votre style. C’est une médiane, pas une moyenne : un album retouché bizarrement ne capture pas le profil.

Le bouton « Préparer l’album » indique où en est l’apprentissage. Tout est local : aucun modèle n’est entraîné, aucune donnée n’est envoyée.

## Tout va plus vite

L’import et les passes d’album utilisent désormais plusieurs cœurs. Le nombre de voies suit la machine et laisse toujours de la place à l’interface. Pendant qu’une photo est écrite, les suivantes sont déjà analysées.

## Commandes IA

Le pilote connaît les fonctions ajoutées depuis la 0.8.0 : « Floute la zone », « Pixelise la zone », « Cache la zone », « Suis le sujet », « Mets du relief de 30 ». Il sait aussi expliquer ce que la nouvelle passe d’album fait et ne fait pas.

## Limites actuelles

Une analyse faite avant cette version n’est pas comparable : Juno la refait à la première passe. Les photos plus étroites que 1 024 pixels sont mesurées à leur largeur native, ce qui est déjà le maximum utile pour elles.

Le suivi des personnes ne distingue pas deux jumeaux, et un visage très tourné n’ouvre jamais une nouvelle identité. La reconnaissance n’a pas encore été qualifiée sur un album complet : elle l’a été sur des visages réels isolés. La retouche automatique ne retire pas d’objet, ne corrige pas la peau et ne recadre pas. L’apprentissage porte sur l’exposition, le contraste, les hautes lumières, les ombres, la chaleur, la teinte et la saturation, pas sur les courbes ni le mixeur de couleurs.
