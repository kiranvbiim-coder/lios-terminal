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

function configureAutoUpdater({ updater, isPackaged, env = process.env, log = () => {} }) {
  if (!isPackaged) {
    return { enabled: false, reason: "Desktop updates are disabled for unpackaged development launches." };
  }

  // Signed distribution builds embed the canonical generic provider into
  // resources/app-update.yml. A runtime environment variable must never be
  // allowed to replace that packaged trust decision after installation.
  if (String(env.LIOS_UPDATE_URL || "").trim()) {
    log("Runtime desktop update feed override ignored; packaged update configuration remains authoritative.");
  }

  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = false;
  updater.allowPrerelease = false;
  updater.allowDowngrade = false;

  let downloaded = false;
  let installStarted = false;

  updater.on("checking-for-update", () => log("Checking for a signed desktop update."));
  updater.on("update-available", (info) => log(`Signed desktop update available: ${safeVersion(info?.version)}.`));
  updater.on("update-not-available", (info) => log(`Desktop update check complete; current version ${safeVersion(info?.version)}.`));
  updater.on("download-progress", (progress) => {
    const percent = safePercent(progress?.percent);
    log(percent === null ? "Desktop update download is in progress." : `Desktop update download ${percent}%.`);
  });
  updater.on("update-downloaded", (info) => {
    downloaded = true;
    log(`Signed desktop update downloaded: ${safeVersion(info?.version)}; explicit confirmation is required to install and restart.`);
  });
  updater.on("error", () => log("Desktop update failed safely."));
  void updater.checkForUpdates().catch(() => log("Desktop update failed safely."));

  return {
    enabled: true,
    url: null,
    source: "packaged_config",
    installDownloaded(options = {}) {
      if (options.confirmed !== true) {
        return { started: false, reason: "confirmation-required" };
      }
      if (!downloaded) {
        return { started: false, reason: "update-not-downloaded" };
      }
      if (installStarted) {
        return { started: false, reason: "install-already-started" };
      }
      installStarted = true;
      try {
        updater.quitAndInstall(false, true);
        return { started: true, reason: "install-started" };
      } catch {
        installStarted = false;
        log("Desktop update install failed safely.");
        return { started: false, reason: "install-failed" };
      }
    },
  };
}

module.exports = { DEFAULT_UPDATE_URL, resolveUpdateUrl, configureAutoUpdater };
