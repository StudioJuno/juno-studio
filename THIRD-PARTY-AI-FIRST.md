# Moteurs locaux ajoutés en 0.5.0

- Qwen3-4B-GGUF, variante Q4_K_M, dépôt officiel Qwen, révision `bc640142c66e1fdd12af0bd68f40445458f3869b`. Licence Apache-2.0 reproduite dans `licenses/qwen-license.txt`.
- llama.cpp, publication b11113, commit bbf99b1b3, licence MIT dans `licenses/llama-license.txt`. Exécutables officiels macOS ARM64, macOS x64 et Windows x64 CPU, avec bibliothèques et licences du paquet.
- Whisper base et whisper.cpp restent ceux déjà livrés, licences MIT existantes.

Sources : https://huggingface.co/Qwen/Qwen3-4B-GGUF ; https://github.com/ggml-org/llama.cpp/releases/tag/b11113

Modèle : révision exacte `bc640142c66e1fdd12af0bd68f40445458f3869b`, 2 497 280 256 octets, SHA-256 `7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5`.

Archives vérifiées :

| Cible | SHA-256 archive |
|---|---|
| macOS ARM64 | e60305bf4ff40bee66648d1eeadade91768655fd4ea3b9e7fa983f74bf715115 |
| macOS x64 | 814ff29be3f4ee945f52d680925e2a7a8a494b89db539cb8a63156b9f8797dc4 |
| Windows x64 CPU | b4893d5ee10ad45b6f082f6bdb7c1ad3d2e3861cbeffb0891ee80eb5ade8d6ca |

Le serveur llama.cpp est lié uniquement à 127.0.0.1, avec clé éphémère, une requête à la fois, sans agent ni interface web. Les consignes textuelles passent à ce processus local ; les images, les rushes et les clés de fournisseurs n’y sont pas envoyés. Les variables LLAMA_* héritées sont filtrées.
