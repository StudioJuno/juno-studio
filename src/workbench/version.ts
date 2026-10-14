// La version affichée (Paramètres, diagnostics) vient de package.json, injectée
// par Vite au build : c'est aussi celle que l'application de bureau déclare
// (app.getVersion()). Hors build (tests), elle reste vide plutôt que fausse.
export const VERSION_JUNO =
  typeof __JUNO_VERSION__ === "string" ? __JUNO_VERSION__ : "";
