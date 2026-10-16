const DEFAULT_UPDATE_URL = null;

function resolveUpdateUrl(env = process.env) {
  const raw = String(env.LIOS_UPDATE_URL || "").trim();
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  return parsed.toString().endsWith("/") ? parsed.toString() : `${parsed.toString()}/`;
}

function safeVersion(value) {
  const version = typeof value === "string" ? value.trim() : "";
  return /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/.test(version) ? version : "unknown";
}

function safePercent(value) {
  const percent = Number(value);
  if (!Number.isFinite(percent)) return null;
  return Math.max(0, Math.min(100, Math.round(percent)));
}

async function nativeConfirmDesktopUpdate({ version }) {
  const { BrowserWindow, dialog } = require("electron");
  const options = {
    type: "info",
    title: "LiOS update ready",
    message: version === "unknown" ? "A signed LiOS update is ready to install." : `LiOS ${version} is ready to install.`,
    detail: "LiOS will close and restart to finish installing this signed update.",
    buttons: ["Later", "Install and restart"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  };
  // Prefer a usable window, but do not parent a system modal to a
  // destroyed window when the last foreground window is closing.
  const focused = BrowserWindow.getFocusedWindow?.() ?? null;
  const owner = focused && !focused.isDestroyed?.()
    ? focused
    : (BrowserWindow.getAllWindows?.() ?? []).find((window) => !window.isDestroyed?.()) ?? null;
  const result = owner ? await dialog.showMessageBox(owner, options) : await dialog.showMessageBox(options);
  return result.response === 1;
}

function createDesktopUpdateInstallController({ updater, confirmInstall, log = () => {} }) {
  if (!updater || typeof updater.quitAndInstall !== "function") {
    throw new TypeError("Desktop updater install controller requires quitAndInstall().");
  }
  if (typeof confirmInstall !== "function") {
    throw new TypeError("Desktop updater install controller requires a confirmation callback.");
  }

  let promptActive = false;
  let installRequested = false;

  return {
    async handleDownloaded(info) {
      const version = safeVersion(info?.version);
      if (promptActive || installRequested) {
        return { accepted: false, reason: "busy", version };
      }

      promptActive = true;
      try {
        const approved = await confirmInstall({ version });
        if (!approved) {
          log(`Signed desktop update ${version} was not approved for immediate install.`);
          return { accepted: false, reason: "cancelled", version };
        }

        installRequested = true;
        try {
          updater.quitAndInstall(false, true);
        } catch {
          installRequested = false;
          log("Desktop update install failed safely before restart.");
          return { accepted: false, reason: "install_failed", version };
        }
        log(`User approved signed desktop update ${version}; restarting to install.`);
        return { accepted: true, version };
      } catch {
        log("Desktop update install confirmation failed safely.");
        return { accepted: false, reason: "confirmation_failed", version };
      } finally {
        promptActive = false;
      }
    },
  };
}

function configureAutoUpdater({
  updater,
  isPackaged,
  env = process.env,
  log = () => {},
  confirmInstall = nativeConfirmDesktopUpdate,
}) {
  if (!isPackaged) {
    return { enabled: false, reason: "Desktop updates are disabled for unpackaged development launches." };
  }

  // Signed distribution builds embed the canonical generic provider into
  // resources/app-update.yml. Runtime environment must not be able to replace
  // that packaged release authority after installation.
  if (String(env.LIOS_UPDATE_URL || "").trim()) {
    log("Runtime desktop update feed override ignored; packaged update configuration remains authoritative.");
  }

  updater.autoDownload = true;
  // A downloaded update may only install after the trusted main-process native
  // confirmation returns approval. Normal app quit must never bypass that gate.
  updater.autoInstallOnAppQuit = false;
  updater.allowPrerelease = false;
  updater.allowDowngrade = false;

  const installController = createDesktopUpdateInstallController({ updater, confirmInstall, log });

  updater.on("checking-for-update", () => log("Checking for a signed desktop update."));
  updater.on("update-available", (info) => log(`Signed desktop update available: ${safeVersion(info?.version)}.`));
  updater.on("update-not-available", (info) => log(`Desktop update check complete; current version ${safeVersion(info?.version)}.`));
  updater.on("download-progress", (progress) => {
    const percent = safePercent(progress?.percent);
    log(percent === null ? "Desktop update download is in progress." : `Desktop update download ${percent}%.`);
  });
  updater.on("update-downloaded", async (info) => {
    log(`Signed desktop update downloaded: ${safeVersion(info?.version)}; awaiting explicit install confirmation.`);
    await installController.handleDownloaded(info);
  });
  updater.on("error", () => log("Desktop update failed safely."));
  void updater.checkForUpdates().catch(() => log("Desktop update failed safely."));

  return { enabled: true, url: null, source: "packaged_config" };
}

module.exports = {
  DEFAULT_UPDATE_URL,
  resolveUpdateUrl,
  configureAutoUpdater,
  createDesktopUpdateInstallController,
};
