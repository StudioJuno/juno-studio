const { contextBridge, ipcRenderer, webUtils } = require("electron");
/**
 * Electron préfixe toute erreur du processus principal par « Error invoking
 * remote method '…': Error: » : le photographe lisait ce jargon anglais avant
 * le vrai message (relecture du 29/09/2026). On ne garde que le message.
 */
const invoke = (...args) =>
  ipcRenderer.invoke(...args).catch((e) => {
    const message = String(e?.message || e).replace(
      /^Error invoking remote method '[^']*': (?:[A-Za-z]*Error: )?/,
      "",
    );
    const propre = new Error(message);
    if (e?.code) propre.code = e.code;
    throw propre;
  });
contextBridge.exposeInMainWorld("juno", {
  updates: {
    status: () => invoke('updates-status'),
    configure: input => invoke('updates-configure', input),
    check: () => invoke('updates-check'),
    download: () => invoke('updates-download'),
    cancel: () => invoke('updates-cancel'),
    importPackage: () => invoke('updates-import'),
    install: () => invoke('updates-install'),
    reveal: kind => invoke('updates-reveal', kind),
    onStatus: callback => {
      const listener = (_event, value) => callback(value);
      ipcRenderer.on('juno-updates-status', listener);
      return () => ipcRenderer.removeListener('juno-updates-status', listener);
    },
    onOpen: callback => {
      const listener = () => callback(); ipcRenderer.on('juno-updates-open', listener);
      return () => ipcRenderer.removeListener('juno-updates-open', listener);
    },
  },
  windowFullscreen: value => invoke("window-fullscreen", value),
  onWindowFullscreen: callback => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("juno-window-fullscreen", listener);
    return () => ipcRenderer.removeListener("juno-window-fullscreen", listener);
  },
  review: {
    status: () => invoke('review-status'),
    connect: input => invoke('review-connect', input),
    request: input => invoke('review-request', input),
    link: input => invoke('review-link', input),
    createShare: input => invoke('review-create-share', input),
    jobs: () => invoke('review-jobs'),
    begin: input => invoke('review-begin', input),
    preparation: input => invoke('review-preparation', input),
    stagePhoto: input => invoke('review-stage-photo', input),
    preparationError: input => invoke('review-preparation-error', input),
    excludeFailed: input => invoke('review-exclude-failed', input),
    stageVideo: input => invoke('review-stage-video', input),
    start: input => invoke('review-start', input),
    job: input => invoke('review-job', input),
  },
  planner: {
    status: () => invoke("planner-status"),
    plan: (input) => invoke("planner-plan", input),
    cancel: () => invoke("planner-cancel"),
    install: () => invoke("planner-install"),
    cancelInstall: () => invoke("planner-install-cancel"),
    uninstall: () => invoke("planner-uninstall"),
  },
  voice: {
    status: () => invoke("voice-status"),
    transcribe: (input) => invoke("voice-transcribe", input),
    cancel: () => invoke("voice-cancel"),
  },
  lightroom: {
    plan: (input) => invoke("lightroom-plan", input),
    write: (token) => invoke("lightroom-write", token),
    undo: (token) => invoke("lightroom-undo", token),
    locate: (items) => invoke("lightroom-locate", items),
    folder: (input) => invoke("lightroom-folder", input),
    reveal: (file) => invoke("lightroom-reveal", file),
  },
  systemStatus: () => invoke("system-status"),
  registerDroppedMedia: (files) =>
    invoke(
      "register-dropped-media",
      Array.from(files).map((f) => webUtils.getPathForFile(f)),
    ),
  photoRaster: (id) => invoke("media-photo-raster", id),
  importSourceInfo: (id) => invoke("import-source-info", id),
  secureImportSource: (input) =>
    invoke("secure-import-source", input),
  locateImportSource: (input) =>
    invoke("locate-import-source", input),
  revealImportSource: (id) => invoke("reveal-import-source", id),
  video: {
    commandHistory: (input) => invoke("video-command-history", input),
    restoreCommand: (input) => invoke("video-command-restore", input),
    importRegistered: (input) =>
      invoke("video-import-registered", input),
    locateImport: (input) => invoke("video-import-locate", input),
    retryImport: (id) => invoke("video-import-retry", id),
    importReport: (id) => invoke("video-import-report", id),
    revealJob: (id) => invoke("video-reveal-job", id),
    autoColor: (input) => invoke("video-autocolor", input),
    generationKeyStatus: () =>
      invoke("video-generation-key", { action: "status" }),
    saveGenerationKey: (key) =>
      invoke("video-generation-key", { action: "save", key }),
    generate: (input) => invoke("video-generate", input),
    importLut: () => invoke("video-lut", { action: "import" }),
    readLut: (id) => invoke("video-lut", { action: "read", id }),
    restore: () => invoke("video-restore"),
    relink: (input) => invoke("video-relink", input),
    history: (input) => invoke("video-history", input),
    multicam: (input) => invoke("video-multicam", input),
    status: () => invoke("video-status"),
    list: () => invoke("video-list"),
    project: (id) => invoke("video-project", id),
    create: (input) => invoke("video-create", input),
    saveSequence: (input) => invoke("video-sequence", input),
    import: (projectId) => invoke("video-import", projectId),
    space: (input) => invoke("video-space", input),
    job: (input) => invoke("video-job", input),
    processAudio: (input) => invoke("video-audio-process", input),
    analyze: (input) => invoke("video-analyze", input),
    derush: (input) => invoke("video-derush", input),
    derushDecision: (input) => invoke("video-derush-decision", input),
    derushPlans: (input) => invoke("video-derush-plans", input),
    transcribe: (input) => invoke("video-transcribe", input),
    transcript: (input) => invoke("video-transcript", input),
    overlay: (input) => invoke("video-overlay", input),
    export: (input) => invoke("video-export", input),
    trackMask: (input) => invoke("video-track-mask", input),
    backup: (projectId) => invoke("video-backup", projectId),
    comment: (input) => invoke("video-comments", input),
  },
  teamLocalStatus: () => invoke("team-local-status"),
  teamLocalSetup: (input) => invoke("team-local-setup", input),
  teamStatus: () => invoke("team-status"),
  teamLogin: (input) => invoke("team-login", input),
  teamLogout: () => invoke("team-logout"),
  teamRequest: (input) => invoke("team-request", input),
  copyOriginal: (token, name, source, bytes) =>
    invoke("copy-original", token, name, source, bytes),
  stylePickFolder: () => invoke("style-pick-folder"),
  lookPickFolder: () => invoke("look-pick-folder"),
  lookReadFolder: (folder) => invoke("look-read-folder", folder),
  styleReadFolder: (folder) => invoke("style-read-folder", folder),
  restoreBackup: () => invoke("restore-backup"),
  relinkOriginals: (records) => invoke("relink-originals", records),
  pickImages: () => invoke("pick-images"),
  saveFile: (name, data) => invoke("save-file", name, data),
  beginExport: () => invoke("begin-export"),
  writeExport: (token, name, data) =>
    invoke("write-export", token, name, data),
  finishExport: (token) => invoke("finish-export", token),
  keyStatus: () => invoke("key-status"),
  saveKey: (key) => invoke("save-key", key),
  imageBudget: (projectId) => invoke("image-budget", projectId),
  editAI: (request) => invoke("edit-ai", request),
});
