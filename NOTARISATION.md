# Diffuser Juno Studio chez d'autres photographes

## C'est fait, le 25 septembre 2026

Juno Studio 1.0.0 est **signée, notarisée et agrafée**. Elle s'installe sans avertissement sur le Mac de n'importe quel photographe.

```
spctl -a -vvv -t install :  accepted
                            source=Notarized Developer ID
                            origin=Developer ID Application: Juno (542CN5886Z)
xcrun stapler validate   :  The validate action worked!
identifiant de soumission : 9293b766-c9f9-4e19-a055-75113d30d9cd
```

Le ticket est agrafé dans l'application, donc un Mac hors ligne l'accepte aussi.

### Ce qui avait bloqué, et comment ça s'est débloqué

Le compte d'Apple n'était pas activé pour App Store Connect, et le service de notarisation s'authentifie à travers lui. Le support d'Apple l'a activé (dossier 102970623587), puis l'accès à l'API a été demandé et approuvé dans la foulée. Une clé API a été créée avec le rôle Développeur, et la notarisation a abouti du premier coup.

La clé est rangée dans `signing/`, avec `signing/notary.json` qui en donne le chemin. Ni l'une ni l'autre ne doit être partagée.

### Pour notariser une version suivante

```bash
npm run package:mac
node scripts/notarize-mac.mjs "/chemin/vers/Juno Studio.app"
```

Puis réarchiver l'application agrafée, parce que le ticket doit voyager avec elle :

```bash
ditto -c -k --keepParent "/chemin/vers/Juno Studio.app" "release/vX/Juno Studio-X-darwin-arm64.zip"
```

---

## Ce qui existe déjà sur ce Mac

Vérifié le 23 septembre 2026 :

| | État |
|---|---|
| Compte Apple Developer Program | **actif**, équipe « Juno », identifiant `542CN5886Z` |
| Certificat « Apple Development » | valide jusqu'au 22 septembre 2027 |
| Certificat « Apple Distribution » | valide jusqu'au 22 septembre 2027 |
| Certificat **« Developer ID Application »** | **présent depuis le 23/09/2026**, `AC49BE1B…F101` |
| Accès App Store Connect | **ouvert le 25/09/2026** |
| Clé API de notarisation | **créée**, `YC29R7G7A4` |
| Identifiants de notarisation | **absents** |
| `notarytool` | présent, version 1.1.2 |

Le certificat « Apple Distribution » sert à l'App Store. Il ne convient pas ici : pour installer Juno directement chez un photographe, il faut « Developer ID Application », et lui seul.

## L'état du paquet actuel, mesuré

Le paquet 0.9.0 contient **34 binaires** (Electron, ses processus auxiliaires, et 22 fichiers natifs : FFmpeg, FFprobe, whisper-cli, llama-server et leurs bibliothèques). Tous sont signés **ad hoc**, aucun ne porte d'exécution durcie. Sur un autre Mac, macOS les refuse.

## La signature est faite et prouvée

Le 23 septembre 2026 à 16 h 21, sur une copie du paquet 0.9.0 :

```
binaires                 34
signés Developer ID      34
sans exécution durcie     0
codesign --verify --deep --strict : conforme
```

Chaîne d'autorité complète : `Developer ID Application: Juno` → `Developer ID Certification Authority` → `Apple Root CA`, avec horodatage Apple et `TeamIdentifier=542CN5886Z`.

Gatekeeper répond aujourd'hui :

```
rejected
source=Unnotarized Developer ID
origin=Developer ID Application: Juno (542CN5886Z)
```

Ce message est la preuve que tout est correct sauf une chose : **le ticket de notarisation**. Il ne manque plus que les identifiants d'envoi.

Un défaut a été corrigé au passage : `codesign` refuse tout fichier portant un attribut étendu, que le Finder pose dès qu'un dossier est ouvert. Le nettoyage fait désormais partie de la chaîne.

## Ce que j'ai préparé

- `build/entitlements.mac.plist` et `build/entitlements.mac.inherit.plist` : les droits dont Electron a besoin sous exécution durcie (compilation à la volée de V8, chargement des bibliothèques natives, micro).
- `scripts/sign-mac.mjs` : signe le paquet entier, puis **vérifie les 34 binaires un par un** et refuse de conclure s'il en reste un seul non conforme.
- `scripts/notarize-mac.mjs` : envoie le paquet à Apple, attend le verdict, agrafe le ticket, et contrôle que Gatekeeper accepte.
- `scripts/package.mjs` : signe désormais **après** `makeNativeLinksPortable`. C'est un point délicat : la réécriture des chemins de bibliothèques invalide toute signature posée avant elle.
- `signing/DeveloperID.certSigningRequest` : votre demande de certificat, déjà générée. Sa clé privée est dans `signing/DeveloperID.key`, en lecture pour vous seul, et le dossier `signing/` est exclu du paquet.

## Ce que vous devez faire, et vous seul

### 1. Créer le certificat Developer ID Application — FAIT le 23/09/2026

Seul le titulaire du compte peut le faire, et votre mot de passe Apple est demandé.

1. Ouvrez **https://developer.apple.com/account/resources/certificates/add**
2. Choisissez **« Developer ID Application »**
3. Pour « Profile Type », laissez **G2 Sub-CA (Xcode 11.4.1 or later)**
4. À l'étape « Upload a Certificate Signing Request », déposez ce fichier :
   `outputs/juno-studio/signing/DeveloperID.certSigningRequest`
5. Téléchargez le `.cer` produit, et dites-moi où il est. Je l'importe et je vérifie.

À savoir : Apple limite ces certificats à cinq par équipe, et ils durent cinq ans.

### 2. Les identifiants de notarisation — FAIT le 25/09/2026

Le support d'Apple a activé App Store Connect pour le compte. L'accès à l'API a ensuite été demandé et approuvé immédiatement, et une clé de rôle Développeur a été créée.

Ce qui suit reste pour mémoire, si la question se repose un jour.

### 2 bis. Une fois App Store Connect activé

Les deux chemins ci-dessous fonctionneront alors sans rien changer d'autre.

#### Chemin A, le plus simple : mot de passe d'application

1. Ouvrez **https://account.apple.com/account/manage**, rubrique « Connexion et sécurité » → « Mots de passe pour applications »
2. Créez-en un, nommé `Juno notarisation`, et copiez-le
3. Dans votre terminal, lancez la commande ci-dessous et collez ce mot de passe quand elle le demande. **C'est vous qui le tapez, je ne le vois jamais**, et il part directement dans le trousseau :

```bash
xcrun notarytool store-credentials "juno" --apple-id "VOTRE-IDENTIFIANT-APPLE" --team-id 542CN5886Z
```

4. Dites-moi que c'est fait. J'écris `signing/notary.json` et je lance la notarisation.

#### Chemin B : clé API App Store Connect

Plus propre si la page fonctionne : c'est un fichier, révocable d'un clic.

1. Ouvrez **https://appstoreconnect.apple.com/access/integrations/api**
2. Onglet **« Team Keys »**, bouton **+**
3. Nom : `Juno Studio notarisation` — Accès : **Developer**
4. Téléchargez le fichier `AuthKey_XXXXXXXXXX.p8`. **Apple ne le propose qu'une fois.**
5. Notez le **Key ID** (dans la ligne du tableau) et l'**Issuer ID** (en haut de la page)
6. Donnez-moi ces trois éléments : le chemin du fichier, le Key ID, l'Issuer ID. Je n'ouvre jamais le contenu du `.p8`, seul son chemin m'est utile.


## Ce que je fais ensuite, sans vous

1. Je reconstruis les trois paquets, signés et durcis.
2. Je vérifie les 34 binaires un par un.
3. J'envoie à Apple, j'attends le verdict, j'agrafe le ticket.
4. Je contrôle avec `spctl` que Gatekeeper accepte, puis je vous dis ce qui est prouvé.

```bash
npm run package:mac && node scripts/notarize-mac.mjs "release/v0.9.0/Juno Studio-darwin-arm64/Juno Studio.app"
```

## Pourquoi je ne le fais pas à votre place

Saisir votre mot de passe Apple, créer un compte ou payer en votre nom sont des actions que je ne fais pas, même si vous me le demandez. L'étape 2 est désormais la seule qui l'exige. Tout le reste est automatisé et vérifié.
