const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  safeStorage,
  protocol,
  net,
  Menu,
  shell,
} = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { randomUUID } = require("node:crypto");
app.setName("Juno Studio");
{
  // Avant toute chose : un essai ne doit jamais toucher les vrais projets.
  const garde = require("./test-isolation.cjs");
  if (garde.enEssai()) {
    const r = garde.verdict({
      essai: true,
      userData: app.getPath("userData"),
      appData: app.getPath("appData"),
      nom: app.getName(),
    });
    if (!r.ok) {
      console.error("Juno refuse de démarrer. " + r.raison);
      app.exit(9);
    }
  }
}
if (!app.requestSingleInstanceLock()) app.exit(0);
app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
});
protocol.registerSchemesAsPrivileged([
  {
    scheme: "juno-video",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
  {
    scheme: "juno",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);
let assets = {},
  win,
  assetFile,
  keyFile,
  assetRegistryError = "",
  exportRegistryError = "";
const allowed = (event) => {
  const u = event.senderFrame?.url || "";
  if (!u.startsWith(pathToFileURL(path.join(__dirname, "../dist/")).href))
    throw Error("Origine non autorisée");
};
function handle(name, fn) {
  ipcMain.handle(name, async (e, ...a) => {
    allowed(e);
    return fn(...a);
  });
}
app.whenReady().then(async () => {
  handle("window-fullscreen", value => {
    if (typeof value !== "boolean" || !win || win.isDestroyed()) throw Error("Fenêtre indisponible.");
    win.setFullScreen(value);
    return value;
  });
  assetFile = path.join(app.getPath("userData"), "assets.json");
  keyFile = path.join(app.getPath("userData"), "provider-key.enc");
  try {
    const data = JSON.parse(await fs.readFile(assetFile, "utf8"));
    if (
      !data ||
      Array.isArray(data) ||
      typeof data !== "object" ||
      Object.values(data).some((p) => typeof p !== "string")
    )
      throw Error("Structure invalide");
    assets = data;
  } catch (e) {
    if (e.code !== "ENOENT") {
      assetRegistryError =
        "Le registre des originaux est illisible. Restaurez une sauvegarde du studio avant d’importer de nouveaux fichiers. Aucun registre existant n’a été remplacé.";
      console.error(assetRegistryError, e.message);
    }
  }
  handle("system-status", async () => {
    const os = require("node:os"),
      disk = await fs.statfs(app.getPath("userData"));
    return {
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      system: os.release(),
      memoryTotal: os.totalmem(),
      memoryFree: os.freemem(),
      appMemory: app
        .getAppMetrics()
        .reduce((sum, p) => sum + p.memory.workingSetSize * 1024, 0),
      diskFree: disk.bavail * disk.bsize,
      originalsRegistered: Object.keys(assets).length,
      registryError: [assetRegistryError, exportRegistryError]
        .filter(Boolean)
        .join(" "),
    };
  });
  protocol.handle("juno", async (request) => {
    const id = new URL(request.url).pathname.slice(1),
      file = assets[id];
    if (!file) return new Response("Not found", { status: 404 });
    try {
      return await net.fetch(pathToFileURL(file).href);
    } catch {
      return new Response("Original indisponible", { status: 404 });
    }
  });
  handle("save-file", async (name, data) => {
    if (
      typeof name !== "string" ||
      !(data instanceof ArrayBuffer) ||
      data.byteLength > 1024 * 1024 * 1024
    )
      throw Error("Fichier invalide");
    const r = await dialog.showSaveDialog(win, {
      defaultPath: path.basename(name),
    });
    if (r.canceled || !r.filePath) return false;
    const tmp = r.filePath + ".juno-" + randomUUID() + ".tmp";
    try {
      await fs.writeFile(tmp, Buffer.from(data));
      await fs.rename(tmp, r.filePath);
    } catch (e) {
      await fs.unlink(tmp).catch(() => {});
      throw e;
    }
    return true;
  });
  let exportDirs;
  try {
    exportDirs = await require("./export.cjs").registerExports({
      handle,
      app,
      dialog,
      getWindow: () => win,
    });
  } catch (error) {
    exportRegistryError = error.message;
    exportDirs = new Map();
    for (const name of ["begin-export", "write-export", "finish-export"])
      handle(name, () => {
        throw Error(exportRegistryError);
      });
  }

  let assetWrites = Promise.resolve();
  const persistAssets = () => {
    const next = assetWrites.then(async () => {
      if (assetRegistryError) throw Error(assetRegistryError);
      const temp = assetFile + "." + randomUUID() + ".tmp";
      try {
        await fs.writeFile(temp, JSON.stringify(assets), { mode: 0o600 });
        const h = await fs.open(temp, "r+");
        try {
          await h.sync();
        } finally {
          await h.close();
        }
        await fs.rename(temp, assetFile);
      } finally {
        await fs.unlink(temp).catch(() => {});
      }
    });
    assetWrites = next.catch(() => {});
    return next;
  };
  // Où le photographe range ses fichiers, à côté de `assets` qui dit d'où
  // Juno les lit. Un registre illisible ne bloque rien : il se reconstruit
  // avec « Retrouver le dossier des originaux ».
  const originFile = path.join(app.getPath("userData"), "origins.json");
  const origins = {};
  try {
    const data = JSON.parse(await fs.readFile(originFile, "utf8"));
    if (data && typeof data === "object" && !Array.isArray(data))
      for (const [id, p] of Object.entries(data))
        if (typeof p === "string" && path.isAbsolute(p)) origins[id] = p;
  } catch {}
  let originWrites = Promise.resolve();
  const persistOrigins = () =>
    (originWrites = originWrites
      .catch(() => {})
      .then(() => require("./atomic.cjs").writeJsonAtomic(originFile, origins)));
  const importApi = require("./imports.cjs").registerImports({
    handle,
    app,
    dialog,
    shell,
    getWindow: () => win,
    assets,
    persistAssets,
    origins,
    persistOrigins,
  });
  const mediaApi = require("./media-import.cjs").registerMediaImport({
    handle,
    dialog,
    getWindow: () => win,
    assets,
    persistAssets,
    origins,
    persistOrigins,
  });
  require("./style-import.cjs").registerStyleImport({
    handle,
    dialog,
    getWindow: () => win,
  });
  require("./backup.cjs").registerBackup({
    handle,
    app,
    dialog,
    getWindow: () => win,
    assets,
    persistAssets,
    exportDirs,
    origins,
    persistOrigins,
  });
  require("./lightroom.cjs").registerLightroom({
    handle,
    app,
    dialog,
    shell,
    getWindow: () => win,
    assets,
    origins,
    persistOrigins,
  });
  require("./team.cjs").registerTeam({ handle, app, safeStorage });
  let videoModule;
  try {
    videoModule = await require("./video/index.cjs").registerVideo({
      handle,
      app,
      dialog,
      protocol,
      safeStorage,
      getWindow: () => win,
      registerMediaFiles: mediaApi.register,
      secureMedia: async (id, hash) => {
        const secured = await importApi["secure-import-source"]({ id, hash });
        return { source: assets[id], hash: secured.hash };
      },
      locateMedia: (input) => importApi["locate-import-source"](input),
      resolveMedia: (id) => assets[id],
      nativeRoot: app.isPackaged
        ? path.join(
            process.resourcesPath,
            process.platform + "-" + process.arch,
          )
        : path.join(
            __dirname,
            "../native",
            process.platform + "-" + process.arch,
          ),
      colorRoot: app.isPackaged
        ? path.join(process.resourcesPath, "video-color")
        : path.join(__dirname, "../dist/video-color"),
      // Les rushes sont dérushés en fond après l'import (video/derush.cjs).
      autoDerush: true,
    });
  } catch (error) {
    const message =
      "Le catalogue vidéo n’a pas pu être ouvert. Vos fichiers ont été conservés. " +
      String(error.message || error);
    console.error(message);
    for (const name of [
      "video-status",
      "video-list",
      "video-create",
      "video-restore",
    ])
      ipcMain.removeHandler(name);
    handle("video-status", () => ({
      available: false,
      version: "",
      encoder: "",
      platform: process.platform + "-" + process.arch,
      spaces: [],
      luts: [],
      transcription: false,
      error: message,
    }));
    handle("video-list", () => ({ projects: [], jobs: [] }));
    handle("video-create", () => {
      throw Error(message);
    });
    handle("video-restore", () => {
      throw Error(message);
    });
  }

  handle("key-status", async () => {
    try {
      await fs.access(keyFile);
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  });
  handle("save-key", async (key) => {
    if (typeof key !== "string" || key.length > 400)
      throw Error("Clé invalide");
    if (!key) {
      await fs.unlink(keyFile).catch(() => {});
      return;
    }
    if (!safeStorage.isEncryptionAvailable())
      throw Error("Le stockage sécurisé de ce système est indisponible.");
    const tmp = keyFile + ".tmp";
    await fs.writeFile(tmp, safeStorage.encryptString(key), { mode: 0o600 });
    await fs.rename(tmp, keyFile);
  });
  let aiBusy = false;
  const imageBudget = new (require("./image-budget.cjs").ImageBudget)(path.join(app.getPath("userData"),"image-budget.json"));
  handle("image-budget", projectId => imageBudget.status(projectId));
  handle("edit-ai", async (req) => {
    if (aiBusy) throw Error("Une génération est déjà en cours.");
    if (
      !req ||
      !["edit", "generate"].includes(req.mode) ||
      typeof req.prompt !== "string" ||
      req.prompt.trim().length < 3 ||
      req.prompt.length > 4000
    )
      throw Error("Décrivez la modification souhaitée.");
    for (const field of ["mask", "reference"])
      if (
        req[field] !== undefined &&
        (!(req[field] instanceof ArrayBuffer) ||
          req[field].byteLength > 20 * 1024 * 1024)
      )
        throw Error("Image complémentaire invalide.");
    if (
      req.mode === "edit" &&
      (!(req.image instanceof ArrayBuffer) ||
        req.image.byteLength > 20 * 1024 * 1024)
    )
      throw Error("Image invalide ou trop volumineuse.");
    imageBudget.validId(req.projectId);
    aiBusy = true;
    try {
      let key;
      try { key = safeStorage.decryptString(await fs.readFile(keyFile)); }
      catch { throw Error("Configurez une clé API OpenAI dans les paramètres."); }
      const model = "gpt-image-1.5";
      await imageBudget.reserve(req.projectId, model);
      let body,
        headers = { Authorization: "Bearer " + key };
      if (req.mode === "edit") {
        body = new FormData();
        body.set("model", model);
        body.set("prompt", req.prompt);
        body.append(
          "image[]",
          new Blob([req.image], { type: "image/png" }),
          "juno.png",
        );
        if (req.reference)
          body.append(
            "image[]",
            new Blob([req.reference], { type: "image/png" }),
            "reference.png",
          );
        if (req.mask)
          body.set(
            "mask",
            new Blob([req.mask], { type: "image/png" }),
            "mask.png",
          );
        body.set("quality", "high");
        body.set("size", "auto");
        body.set("output_format", "png");
        body.set("input_fidelity", "high");
      } else {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify({
          model,
          prompt: req.prompt,
          quality: "high",
          size: "auto",
          output_format: "png",
        });
      }
      const response = await fetch(
        "https://api.openai.com/v1/images/" +
          (req.mode === "edit" ? "edits" : "generations"),
        { method: "POST", headers, body, signal: AbortSignal.timeout(240000) },
      );
      const result = await response.json();
      if (!response.ok)
        throw Error(result.error?.message || "Le service IA est indisponible.");
      const b64 = result.data?.[0]?.b64_json;
      if (!b64) throw Error("Le service n’a pas renvoyé d’image exploitable.");
      return { bytes: new Uint8Array(Buffer.from(b64, "base64")), model };
    } catch (e) {
      if (e.name === "TimeoutError")
        throw Error(
          "Le délai a été dépassé. Vérifiez votre consommation avant de réessayer.",
        );
      throw e;
    } finally {
      aiBusy = false;
    }
  });
  require("./voice.cjs").registerVoice({ handle, app, engine: videoModule?.engine });
  try {
    await require('./review.cjs').registerReview({handle,app,safeStorage,shell,videoModule});
  } catch (error) {
    console.error('Review initialization:', error.message);
    handle('review-status', () => ({available:false,mode:'local',url:'',error:'Le portail local ne peut pas démarrer : '+error.message}));
  }
  require("./local-planner.cjs").registerPlanner({ handle, app, nativeRoot: app.isPackaged
    ? path.join(process.resourcesPath, process.platform + "-" + process.arch)
    : path.join(__dirname, "../native", process.platform + "-" + process.arch) });
  await require('./updates/index.cjs').registerUpdates({ app, handle, dialog, shell, getWindow: () => win, videoModule });
  function create() {
    win = new BrowserWindow({
      show: !process.argv.includes("--juno-test-hidden"),
      width: 1500,
      height: 960,
      minWidth: 1100,
      minHeight: 720,
      title: "Juno Studio",
      backgroundColor: "#f8f8f5",
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    const localPage = pathToFileURL(path.join(__dirname, "../dist/index.html")).href;
    // Toute navigation reste refusée, sauf le rechargement de la page du
    // studio : c'est ce que fait « Rouvrir le studio » de l'écran de plantage
    // (location.reload), qui sans cette exception ne rechargeait rien et
    // laissait l'écran d'erreur pour seule issue.
    win.webContents.on("will-navigate", (e, adresse) => {
      if (String(e.url ?? adresse ?? "").split("#")[0] !== localPage)
        e.preventDefault();
    });
    // La page refuse de se fermer tant qu'un enregistrement ou une tâche est en
    // cours. Sans réponse ici, la fenêtre et ⌘Q restaient sans effet et sans
    // un mot : on demande, et le photographe tranche.
    const fenetre = win;
    fenetre.webContents.on("will-prevent-unload", (event) => {
      const choix = dialog.showMessageBoxSync(fenetre, {
        type: "warning",
        buttons: ["Rester", "Quitter quand même"],
        defaultId: 0,
        cancelId: 0,
        message: "Des changements ne sont pas encore enregistrés.",
        detail:
          "Juno termine un enregistrement ou une tâche. Si vous quittez maintenant, les derniers changements non enregistrés seront perdus.",
      });
      if (choix === 1) event.preventDefault();
    });
    win.webContents.session.setPermissionCheckHandler((wc, permission, _origin, details) =>
      wc === win.webContents && permission === "media" && details.mediaType === "audio" &&
      details.isMainFrame !== false && wc.getURL() === localPage);
    win.webContents.session.setPermissionRequestHandler((wc, permission, callback, details) => {
      const types = details.mediaTypes || [];
      callback(wc === win.webContents && wc.getURL() === localPage && permission === "media" &&
        details.isMainFrame !== false && types.length > 0 && types.every(type => type === "audio"));
    });
    for (const event of ["enter-full-screen", "leave-full-screen"])
      win.on(event, () => { if (!win.isDestroyed()) win.webContents.send("juno-window-fullscreen", win.isFullScreen()); });
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "Juno Studio",
        submenu: [{ role: "about" }, { label: "Rechercher des mises à jour…", click: () => {
          if (win && !win.isDestroyed()) { win.show(); win.focus(); win.webContents.send('juno-updates-open'); }
        } }, { type: "separator" }, { role: "quit" }],
      },
      {
        label: "Édition",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
        ],
      },
      {
        label: "Affichage",
        submenu: [
          { role: "reload" },
          { role: "zoomIn", label: "Agrandir l’interface" },
          { role: "zoomOut", label: "Réduire l’interface" },
          { role: "resetZoom", label: "Taille normale" },
          { role: "togglefullscreen" },
          { role: "toggleDevTools" },
        ],
      },
    ]),
  );
  create();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) create();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
