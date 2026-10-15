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

function configureAutoUpdater({
  updater,
  isPackaged,
  env = process.env,
  log = () => {},
  confirmInstall = null,
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
  // Download automatically, but never install merely because the app quits.
  // Installation requires the explicit confirmation callback below.
  updater.autoInstallOnAppQuit = false;
  updater.allowPrerelease = false;
  updater.allowDowngrade = false;

  let installConfirmationInFlight = false;

  updater.on("checking-for-update", () => log("Checking for a signed desktop update."));
  updater.on("update-available", (info) => log(`Signed desktop update available: ${safeVersion(info?.version)}.`));
  updater.on("update-not-available", (info) => log(`Desktop update check complete; current version ${safeVersion(info?.version)}.`));
  updater.on("download-progress", (progress) => {
    const percent = safePercent(progress?.percent);
    log(percent === null ? "Desktop update download is in progress." : `Desktop update download ${percent}%.`);
  });
  updater.on("update-downloaded", async (info) => {
    const version = safeVersion(info?.version);
    log(`Signed desktop update downloaded: ${version}; awaiting install confirmation.`);

    if (installConfirmationInFlight) {
      log("Desktop update install confirmation is already pending.");
      return;
    }
    if (typeof confirmInstall !== "function") {
      log("Desktop update install confirmation is unavailable; update remains downloaded.");
      return;
    }

    installConfirmationInFlight = true;
    try {
      const confirmed = await confirmInstall({ version });
      if (!confirmed) {
        log("Desktop update installation deferred by user.");
        return;
      }
      log("Desktop update install confirmed; restarting to install.");
      updater.quitAndInstall(false, true);
    } catch {
      log("Desktop update confirmation failed safely.");
    } finally {
      installConfirmationInFlight = false;
    }
  });
  updater.on("error", () => log("Desktop update failed safely."));
  void updater.checkForUpdates().catch(() => log("Desktop update failed safely."));

  return { enabled: true, url: null, source: "packaged_config" };
}

module.exports = { DEFAULT_UPDATE_URL, resolveUpdateUrl, configureAutoUpdater };
