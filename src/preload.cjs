const { contextBridge, ipcRenderer } = require("electron");

function invoke(channel, ...args) {
  return ipcRenderer.invoke(channel, ...args).catch((error) => {
    const message = error && typeof error.message === "string" ? error.message : "Desktop operation failed.";
    const wrapped = new Error(message);
    if (error && typeof error.name === "string") wrapped.name = error.name;
    if (error && typeof error.code === "string") wrapped.code = error.code;
    throw wrapped;
  });
}

const renderModeArg = process.argv.find((arg) => arg.startsWith("--lios-render-mode="));
const renderMode = renderModeArg && renderModeArg.split("=")[1] === "software" ? "software" : "hardware";

contextBridge.exposeInMainWorld("limuriaDesktop", {
  isElectron: true,
  renderMode,
  getWorkspaceInfo: () => invoke("limuria:workspace-info"),
  chooseFolder: (purpose) => invoke("limuria:choose-folder", purpose),
  getDataFolder: () => invoke("limuria:data-folder"),
  moveDataFolder: (targetPath) => invoke("limuria:move-data-folder", targetPath),
  restoreBackup: (passphrase) => invoke("limuria:restore-backup", passphrase),
  configureVoiceRuntimeFile: (kind) => invoke("limuria:voice-runtime-configure", kind),
  openExternal: (url) => invoke("limuria:open-external", url),
  exportUnicodePdf: (payload) => invoke("limuria:export-unicode-pdf", payload),
});
