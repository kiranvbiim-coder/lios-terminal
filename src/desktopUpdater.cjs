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

function configureAutoUpdater({ updater, isPackaged, env = process.env, log = () => {} }) {
  if (!isPackaged) {
    return { enabled: false, reason: "Desktop updates are disabled for unpackaged development launches." };
  }

  const rawOverride = String(env.LIOS_UPDATE_URL || "").trim();
  const overrideUrl = resolveUpdateUrl(env);
  if (rawOverride && !overrideUrl) {
    return { enabled: false, reason: "LIOS_UPDATE_URL is present but is not a valid HTTPS update feed." };
  }

  // A signed distribution build embeds its canonical generic provider in
  // app-update.yml through electron-builder's publish configuration. When no
  // runtime override is present, electron-updater reads that packaged config
  // automatically; calling setFeedURL here would unnecessarily discard it.
  if (overrideUrl) {
    updater.setFeedURL({ provider: "generic", url: overrideUrl });
  }

  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.allowDowngrade = false;
  updater.on("checking-for-update", () => log("Checking for a signed desktop update."));
  updater.on("update-available", (info) => log(`Signed desktop update available: ${info.version}.`));
  updater.on("update-not-available", (info) => log(`Desktop update check complete; current version ${info.version}.`));
  updater.on("download-progress", (progress) => log(`Desktop update download ${Math.round(progress.percent)}%.`));
  updater.on("update-downloaded", (info) => log(`Signed desktop update downloaded: ${info.version}; it will install on quit.`));
  updater.on("error", (error) => log(`Desktop update failed: ${error && error.message ? error.message : error}`));
  void updater.checkForUpdates().catch((error) => log(`Desktop update check failed: ${error && error.message ? error.message : error}`));

  return overrideUrl
    ? { enabled: true, url: overrideUrl, source: "runtime_override" }
    : { enabled: true, url: null, source: "packaged_config" };
}

module.exports = { DEFAULT_UPDATE_URL, resolveUpdateUrl, configureAutoUpdater };
