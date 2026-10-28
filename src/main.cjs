const desktopProcessStartedAtNs = process.hrtime.bigint();
const { app, BrowserWindow, session, ipcMain, dialog, safeStorage, shell, Tray, Menu, nativeImage } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const crypto = require("crypto");
const net = require("net");
const fs = require("fs");
const os = require("os");
const { configureAutoUpdater } = require("./desktopUpdater.cjs");
const { ensureLocalWorkspace } = require("./desktopWorkspace.cjs");
const { choosePersistentPort } = require("./desktopPort.cjs");
const { mayAttachLocalToken } = require("./desktopRequestTrust.cjs");
const { DATA_ROOT_EXIT_CODE, DataRootUnavailableError, foldLegacyWorkspace, prepareDataRoot, resolveDataRoot } = require("./dataRootCore.cjs");
const { migrateDataRootSafely } = require("./governedDataMigration.cjs");
const { imgSrcDirective } = require("./desktopCsp.cjs");
const { loadOrCreateProtectedSecret } = require("./desktopSecretCustody.cjs");
const { protectedDraftsAvailable, storeProtectedArtifactDraft, readProtectedArtifactDraft, removeProtectedArtifactDraft } = require("./desktopArtifactDraftRecovery.cjs");
const { authorizeNativeDraftGrant } = require("./nativeDraftGrant.cjs");
const { runPackagedDesktopSelfTest } = require("./desktopSelfTest.cjs");
const { bundledPythonSidecarPath } = require("./desktopPythonSidecar.cjs");
const { requirePackagedSandboxEnvironment } = require("./desktopSandboxImage.cjs");
const { assertTrustedIpcSender } = require("./desktopIpcSecurity.cjs");
const { normalizeUnicodePdfPayload, buildUnicodeReportHtml, runNativeUnicodePdfSmoke } = require("./desktopUnicodePdf.cjs");
const { redactDesktopLogText } = require("./desktopLogRedaction.cjs");
const {
  createRestoreWorkerLaunchPlan,
  normalizeRestorePassphrase,
  resolveRestoreWorkerPath,
  validateRestoreArchive,
} = require("./desktopBackupRestore.cjs");
app.setName("LiOS Intelligence Terminal");

// Opt-in test isolation (explicit env only): run on a separate Electron profile and data root so
// qualification never touches the real user profile. Remote debugging is loopback-only and also opt-in.
{
  const isolated = (process.env.LIOS_USER_DATA_DIR || "").trim();
  if (isolated) {
    if (!path.isAbsolute(isolated)) throw new Error("LIOS_USER_DATA_DIR must be an absolute path.");
    fs.mkdirSync(isolated, { recursive: true, mode: 0o700 });
    app.setPath("userData", isolated);
    process.env.LIOS_DATA_ROOT = path.join(isolated, "data");
  }
  const debugPort = Number.parseInt(process.env.LIOS_REMOTE_DEBUG_PORT || "", 10);
  if (isolated && Number.isInteger(debugPort) && debugPort > 1024 && debugPort < 65536) {
    app.commandLine.appendSwitch("remote-debugging-port", String(debugPort));
    app.commandLine.appendSwitch("remote-debugging-address", "127.0.0.1");
  }
}

const desktopSelfTestRequested = process.argv.includes("--desktop-self-test");
const nativeUnicodePdfSmokeRequested = process.argv.includes("--unicode-pdf-smoke");

// One desktop profile owns one Home process. A second launch must not compete for its database.
if (!app.requestSingleInstanceLock()) app.exit(0);
app.on("second-instance", () => {
  if (!app.isReady() || !mainWindow) return;
  showMainWindow();
});

function desktopRendererUrl() {
  return `http://localhost:${serverPort}/`;
}

// `stdio: "inherit"` only works when this main process itself has a real
// stdout/stderr (a terminal, when launched via `npm run app:start`). A
// LaunchServices launch (Finder double-click, `open`) has no TTY -- fds 1/2
// go nowhere useful -- so "inherit" silently discards everything and makes
// GUI-launch failures undiagnosable. Log to a real file instead so both
// launch paths are inspectable the same way.
const logDir = app.getPath("logs");
fs.mkdirSync(logDir, { recursive: true });
const mainLogPath = path.join(logDir, "main.log");
function logToFile(msg) {
  try {
    fs.appendFileSync(mainLogPath, `[${new Date().toISOString()}] ${redactDesktopLogText(msg)}\n`);
  } catch {
    // Nothing sensible to do if logging itself fails.
  }
}
logToFile(`--- launch --- pid=${process.pid} argvCount=${process.argv.length}`);
process.on("uncaughtException", (err) => {
  logToFile(`UNCAUGHT EXCEPTION: ${err && err.stack ? err.stack : err}`);
});

// A packaged .app bundle picks up build-resources/icon.icns automatically
// (electron-builder's own "icon" config, baked into the bundle's Info.plist),
// but an unpackaged dev launch (`npm run app:start`) shows Electron's default
// icon in the Dock unless set explicitly here. Electron's nativeImage loader
// (used by app.dock.setIcon()) does not support .icns at runtime -- only the
// OS/packager reads that format -- so this needs a plain PNG.
function setDockIcon() {
  if (process.platform !== "darwin" || app.isPackaged || !app.dock) return;
  const iconPath = path.join(__dirname, "build-resources", "icon.png");
  try {
    const exists = fs.existsSync(iconPath);
    app.dock.setIcon(iconPath);
    logToFile(`setDockIcon: iconPath=${iconPath} exists=${exists} -- setIcon() called with no throw`);
  } catch (err) {
    logToFile(`setDockIcon: threw: ${err && err.stack ? err.stack : err}`);
  }
}

// GPU compositing can silently fail to paint on unsigned/ad-hoc-signed macOS
// builds (the window shows nothing but its raw backgroundColor — a solid
// black screen — even though the exact same page renders fine in a real
// browser). Forcing software rendering trades a little GPU performance for
// actually painting the window reliably. Must be called before app is ready.
app.disableHardwareAcceleration();
// With GPU compositing off Chromium exposes no WebGL, so the offline MapLibre map could never
// render in the packaged app (observed: "Offline MapLibre rendering is unavailable"). Software
// SwiftShader WebGL keeps the safe paint path and renders the bundled, tile-free geography.
app.commandLine.appendSwitch("enable-unsafe-swiftshader");

let serverProcess = null;
let mainWindow = null;
let serverRestartCount = 0;
let serverPort = 5052;
let isQuitting = false;
let desktopTray = null;
let localWorkspace = null;
let dataRootState = null;
// Random per launch. The server only accepts requests that carry it, and only this app's own session adds it
// (see installLocalTrustHeader), so other local processes and web pages cannot use the loopback API.
const localTrustToken = crypto.randomBytes(32).toString("base64url");
let localVaultSecret = null;
let nativeSecretCustodyMode = "uninitialized";
let nativeSecretCustodyAt = "";
let serverReadyTimer = null;
let startupFailureReported = false;
let restoreInProgress = false;
const MAX_SERVER_RESTARTS = 5;
const SERVER_READY_TIMEOUT_MS = 30_000;

function reportStartupFailure(error) {
  if (startupFailureReported || isQuitting) return;
  startupFailureReported = true;
  const message = error && error.message ? error.message : String(error);
  logToFile(`Desktop startup failed: ${message}`);
  dialog.showErrorBox("LiOS Intelligence Terminal could not start", `${message}\n\nSee ${mainLogPath} and server.log for details.`);
  app.quit();
}

function loadOrCreateOsProtectedVaultSecret() {
  try {
    const result = loadOrCreateProtectedSecret({
      safeStorage,
      userDataPath: app.getPath("userData"),
      configuredSecret: process.env.LIMURIA_VAULT_SECRET,
      isPackaged: app.isPackaged,
    });
    nativeSecretCustodyMode = result.mode;
    nativeSecretCustodyAt = new Date().toISOString();
    logToFile(`Desktop secret custody: mode=${result.mode}; protectedAtRest=${result.protectedAtRest}`);
    return result.secret;
  } catch (error) {
    nativeSecretCustodyMode = "native_error";
    nativeSecretCustodyAt = new Date().toISOString();
    logToFile(`OS-protected credential vault key unavailable: ${error && error.message ? error.message : error}`);
    return null;
  }
}

// Helper to check if server port is open
function checkPort(port, callback) {
  const socket = new net.Socket();
  const onError = () => {
    socket.destroy();
    callback(false);
  };
  socket.setTimeout(200);
  socket.once("error", onError);
  socket.once("timeout", onError);
  socket.connect(port, "127.0.0.1", () => {
    socket.end();
    callback(true);
  });
}

// A GUI launch (Finder double-click, `open`, LaunchServices) gives the
// process a minimal PATH (usually just /usr/bin:/bin:/usr/sbin:/sbin) --
// nothing like an interactive shell's PATH, which picks up nvm's shims from
// ~/.zshrc/~/.bash_profile. A bare `spawn("node", ...)` resolves fine when
// launched via `npm run app:start` from a shell, but silently ENOENTs under
// a real double-click launch: the spawn's "error" event fires async (after
// this function has already returned), so with no listener for it there's
// no crash and no log line -- just a server that never starts and a window
// that never shows (createWindow's port-5052 poll never succeeds, so
// loadURL is never called and ready-to-show never fires). Resolve an
// absolute node binary instead of trusting PATH resolution.
function resolveNodeBinary() {
  const candidates = [process.env.LIMURIA_NODE_PATH, "/opt/homebrew/bin/node", "/usr/local/bin/node"].filter(
    Boolean,
  );

  try {
    const nvmDir = path.join(os.homedir(), ".nvm", "versions", "node");
    if (fs.existsSync(nvmDir)) {
      const versions = fs
        .readdirSync(nvmDir)
        .map((v) => path.join(nvmDir, v, "bin", "node"))
        .filter((p) => fs.existsSync(p));
      // Lexicographic sort works here since nvm version dirs are all "vMAJOR.MINOR.PATCH"
      // with no padding inconsistency in practice for this machine's installs.
      versions.sort();
      if (versions.length > 0) candidates.push(versions[versions.length - 1]);
    }
  } catch {
    // Ignore -- fall through to remaining candidates / bare "node".
  }

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return "node"; // Last resort: rely on PATH (fine when launched from a shell).
}

// The workspace (connectors, backups, the workspace id that doubles as the licence device id) lives in the data
// root. Installs that created it under Electron's userData are folded in once: copied, verified, original kept.
// If the fold fails the old location keeps working, so a licence seat is never lost over a copy error.
function prepareLocalWorkspace() {
  const legacyRoot = path.join(app.getPath("userData"), "workspace");
  const targetRoot = path.join(dataRootState.root, "workspace");
  try {
    const fold = foldLegacyWorkspace({ legacyRoot, targetRoot });
    if (fold.action === "folded") logToFile(`Workspace folded into the data root (${fold.files} files, id=${fold.workspaceId}); original kept at ${legacyRoot}`);
    return ensureLocalWorkspace(targetRoot);
  } catch (error) {
    logToFile(`Workspace fold failed; continuing with the existing location: ${error && error.stack ? error.stack : error}`);
    return ensureLocalWorkspace(legacyRoot);
  }
}

// Adds the per-launch token to every request this app's own session makes to its local server, including the
// WebSocket handshake, at the network layer (page JavaScript never sees it).
function installLocalTrustHeader(port) {
  const urls = ["localhost", "127.0.0.1"].flatMap((host) => [`http://${host}:${port}/*`, `ws://${host}:${port}/*`]);
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls }, (details, callback) => {
    if (!mainWindow || !mayAttachLocalToken(details, { webContentsId: mainWindow.webContents.id, port })) {
      callback({ requestHeaders: details.requestHeaders });
      return;
    }
    callback({ requestHeaders: { ...details.requestHeaders, "X-LiOS-Local-Token": localTrustToken } });
  });
}

function dataRootEnvironment() {
  // The server child always runs with NODE_ENV=production, so resolve the root the same way here.
  return { ...process.env, NODE_ENV: "production" };
}

async function stopLocalServerForMaintenance() {
  isQuitting = true;
  const child = serverProcess;
  if (!child) return;
  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(forceKill);
      resolve();
    };
    const forceKill = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
    }, 15_000);
    child.once("exit", finish);
    child.once("error", finish);
    try {
      child.kill();
    } catch {
      finish();
    }
  });
}

function scheduleDesktopRelaunch(delayMs = 100) {
  setTimeout(() => {
    app.relaunch();
    app.exit(0);
  }, delayMs);
}

async function runDesktopRestoreWorker(archivePath, passphrase) {
  const workerPath = resolveRestoreWorkerPath({
    appPath: app.getAppPath(),
    isPackaged: app.isPackaged,
  });
  const executable = app.isPackaged ? process.execPath : resolveNodeBinary();
  const plan = createRestoreWorkerLaunchPlan({
    executable,
    workerPath,
    archivePath,
    passphrase,
    destinationVaultSecret: localVaultSecret,
    dataRoot: dataRootState.root,
    resourcesPath: process.resourcesPath,
    isPackaged: app.isPackaged,
    env: process.env,
  });

  await new Promise((resolve, reject) => {
    let stderr = "";
    const worker = spawn(plan.executable, plan.args, {
      env: plan.env,
      stdio: ["pipe", "ignore", "pipe"],
      windowsHide: true,
    });
    worker.stderr?.setEncoding("utf8");
    worker.stderr?.on("data", (chunk) => {
      stderr = (stderr + String(chunk)).slice(-8_000);
    });
    worker.once("error", (error) => reject(error));
    worker.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const detail = stderr.trim().slice(0, 4_000);
      reject(new Error(detail || `Restore worker exited with code ${code ?? "unknown"}${signal ? ` (${signal})` : ""}.`));
    });
    worker.stdin?.on("error", (error) => reject(error));
    worker.stdin?.end(plan.stdin);
  });
}

function describeDataRootFailure() {
  try {
    prepareDataRoot({ env: dataRootEnvironment() });
  } catch (error) {
    if (error instanceof DataRootUnavailableError) return error.message;
  }
  return "The LiOS data folder is not available. Check that its drive is connected, then restart LiOS.";
}

function startServer() {
  const packagedUnpackedPath = path.join(path.dirname(app.getAppPath()), "app.asar.unpacked", "dist", "index.cjs");
  const packagedAppPath = path.join(app.getAppPath(), "dist", "index.cjs");
  const serverPath = app.isPackaged
    ? (fs.existsSync(packagedUnpackedPath) ? packagedUnpackedPath : packagedAppPath)
    : path.join(__dirname, "dist", "index.cjs");
  // A packaged Electron distribution already contains a compatible Node
  // runtime. Reuse the packaged executable in ELECTRON_RUN_AS_NODE mode so a
  // clean customer machine does not need a separate Node installation.
  // Development launches still use the explicitly resolved local Node binary.
  const nodeBin = app.isPackaged ? process.execPath : resolveNodeBinary();
  const serverLogPath = path.join(logDir, "server.log");
  const serverLogFd = fs.openSync(serverLogPath, "a");

  logToFile(`startServer: __dirname=${__dirname} serverPath=${serverPath} nodeBin=${nodeBin}`);
  logToFile(`startServer: serverPath exists=${fs.existsSync(serverPath)} nodeBin exists=${fs.existsSync(nodeBin) || nodeBin === "node"}`);

  // Launch Express backend server. ELECTRON_RESOURCES_PATH is only
  // meaningful for a real packaged build -- process.resourcesPath is truthy
  // even when running unpackaged via `electron main.cjs` directly (it just
  // points at Electron's own bundled Resources, not this app's), which
  // previously made the server look for migrations/seed-db inside Electron
  // itself instead of falling back to cwd. Gate on app.isPackaged so dev/
  // source runs get the correct fallback (see resolveMigrationsFolder in
  // server/db.ts).
  try {
    serverProcess = spawn(nodeBin, ["--max-old-space-size=4096", serverPath], {
      env: {
        ...process.env,
        // Extra PATH entries for whatever inherits this env -- harmless, but
        // NOT what actually fixes python3 resolution for a GUI launch's bare
        // PATH (appending here still puts the real interpreter after
        // /usr/bin, so Apple's no-pandas stub keeps winning the search). The
        // real fix is resolving an absolute python3 path at the call site --
        // see server/marketData.ts's resolvePython3Binary() and
        // server/pythonService.ts's resolvePythonExecutable().
        PATH: `${process.env.PATH || ""}:/usr/local/bin:/opt/homebrew/bin:${path.dirname(nodeBin)}:/Library/Frameworks/Python.framework/Versions/3.13/bin`,
        NODE_ENV: "production",
        // The packaged Resources tree is code-signed on macOS. Every Python
        // descendant must treat it as immutable; .pyc/__pycache__ writes
        // inside Contents/Resources invalidate the app signature after launch.
        PYTHONDONTWRITEBYTECODE: "1",
        PYTHONNOUSERSITE: "1",
        PYTHONUTF8: "1",
        PORT: String(serverPort),
        // The server shuts itself down if this process vanishes without stopping it (crash, force-quit): no orphans.
        LIOS_PARENT_PID: String(process.pid),
        ...(app.isPackaged ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
        ...(localWorkspace ? { LIMURIA_WORKSPACE_DIR: localWorkspace.paths.root } : {}),
        // One root for all user-owned state, decided here and handed to the server so both agree (GM-03).
        ...(dataRootState ? { LIOS_DATA_ROOT: dataRootState.root } : {}),
        // The per-launch trust token and the OS-protected vault secret travel over stdin, never the environment
        // (see server/desktopHandoff.ts).
        LIOS_DESKTOP_HANDOFF_ON_STDIN: "1",
        LIOS_NATIVE_SECRET_CUSTODY: nativeSecretCustodyMode,
        ...(nativeSecretCustodyAt ? { LIOS_NATIVE_SECRET_CUSTODY_AT: nativeSecretCustodyAt } : {}),
        LIOS_DESKTOP_PACKAGED: app.isPackaged ? "true" : "false",
        LIOS_BUNDLED_PYTHON_SIDECAR: app.isPackaged && bundledPythonSidecarPath(process.resourcesPath) ? "present" : "absent",
        ...(localWorkspace ? {
          LIOS_DESKTOP_DEVICE_ID: localWorkspace.workspaceId,
          LIOS_DESKTOP_DEVICE_LABEL: `${os.hostname()} · ${process.platform}`,
        } : {}),
        ...(app.isPackaged ? { ELECTRON_RESOURCES_PATH: process.resourcesPath } : {}),
        ...(app.isPackaged && process.platform === "darwin" ? requirePackagedSandboxEnvironment(process.resourcesPath) : {}),
      },
      stdio: ["pipe", serverLogFd, serverLogFd],
    });
    if (serverProcess.stdin) {
      serverProcess.stdin.on("error", (err) => logToFile(`Desktop handoff failed: ${err.message}`));
      serverProcess.stdin.end(
        `LIOS-LOCAL-TOKEN ${localTrustToken}\n${localVaultSecret ? `LIOS-VAULT-SECRET ${localVaultSecret}\n` : ""}LIOS-HANDOFF-END\n`,
      );
    }
  } catch (err) {
    logToFile(`startServer: spawn() threw synchronously: ${err && err.stack ? err.stack : err}`);
    reportStartupFailure(new Error(`Unable to start the local server: ${err.message}`));
    return;
  }

  logToFile(`startServer: spawned pid=${serverProcess.pid}`);

  serverProcess.on("error", (err) => {
    logToFile(`Failed to spawn Express server (node bin: ${nodeBin}): ${err && err.stack ? err.stack : err}`);
    reportStartupFailure(new Error(`Unable to start the local server: ${err.message}`));
  });

  // A crashed backend (OOM, uncaught native error) previously left the app
  // stuck showing a dead window forever -- nothing restarted it. Restart
  // automatically, but cap retries so a genuinely broken build doesn't spin
  // forever consuming resources.
  serverProcess.on("exit", (code, signal) => {
    logToFile(`Express server exited with code ${code} signal ${signal}`);
    serverProcess = null;
    if (code === DATA_ROOT_EXIT_CODE && !isQuitting) {
      // The server refused to run over a data folder that has gone missing. Restarting cannot fix that.
      reportStartupFailure(new Error(describeDataRootFailure()));
    } else if (!isQuitting && serverRestartCount < MAX_SERVER_RESTARTS) {
      serverRestartCount += 1;
      logToFile(`Restarting Express server (attempt ${serverRestartCount}/${MAX_SERVER_RESTARTS})`);
      setTimeout(startServer, 1000);
    } else if (!isQuitting) {
      logToFile(`Express server crash-looped ${MAX_SERVER_RESTARTS} times -- giving up on auto-restart.`);
      reportStartupFailure(new Error("The local server stopped repeatedly and could not be restarted."));
    }
  });
}
const voiceRuntimeConfigFile = () => path.join(dataRootState.root, "voice-runtime.json");
const VOICE_RUNTIME_LIMITS = Object.freeze({
  whisperExecutable: 100 * 1024 * 1024,
  model: 1600 * 1024 * 1024,
  ffmpeg: 300 * 1024 * 1024,
});
const VOICE_RUNTIME_PICKERS = Object.freeze({
  whisperExecutable: { title: "Choose whisper.cpp executable" },
  model: { title: "Choose whisper.cpp model" },
  ffmpeg: { title: "Choose ffmpeg executable" },
});

function readVoiceRuntimeDesktopConfig() {
  try {
    if (!fs.existsSync(voiceRuntimeConfigFile())) return {};
    const parsed = JSON.parse(fs.readFileSync(voiceRuntimeConfigFile(), "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeVoiceRuntimeDesktopConfig(config) {
  const dir = path.dirname(voiceRuntimeConfigFile());
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(voiceRuntimeConfigFile(), JSON.stringify(config, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
}

ipcMain.handle("limuria:voice-runtime-configure", async (event, rawKind) => {
  assertTrustedIpcSender(event, mainWindow, serverPort);
  const kind = String(rawKind || "");
  const picker = VOICE_RUNTIME_PICKERS[kind];
  if (!picker) throw new Error("Unsupported voice runtime component.");
  const chosen = await dialog.showOpenDialog({
    title: picker.title,
    properties: ["openFile"],
  });
  if (chosen.canceled || !chosen.filePaths[0]) return { cancelled: true, kind };
  const selected = path.resolve(chosen.filePaths[0]);
  const stat = fs.statSync(selected);
  if (!stat.isFile()) throw new Error("Voice runtime selection must be a file.");
  const maxBytes = VOICE_RUNTIME_LIMITS[kind];
  if (stat.size <= 0 || stat.size > maxBytes) {
    throw new Error(`Selected ${kind} file exceeds the LiOS voice-runtime size budget.`);
  }
  if (kind !== "model" && process.platform !== "win32") {
    try {
      fs.accessSync(selected, fs.constants.X_OK);
    } catch {
      throw new Error("Selected voice runtime executable is not executable by the current user.");
    }
  }
  const config = readVoiceRuntimeDesktopConfig();
  config[kind] = selected;
  writeVoiceRuntimeDesktopConfig(config);
  return { cancelled: false, kind, name: path.basename(selected) };
});

ipcMain.handle("limuria:open-external", async (event, rawUrl) => {
  assertTrustedIpcSender(event, mainWindow, serverPort);
  const value = String(rawUrl || "").trim();
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("External URL is invalid.");
  }
  if (parsed.protocol !== "https:") throw new Error("Only HTTPS external URLs are allowed.");
  await shell.openExternal(parsed.toString());
  return { opened: true };
});

async function requireCurrentNativeDraftGrant(input) {
  return authorizeNativeDraftGrant(localTrustToken, input, async scope => {
    const origin = `http://localhost:${serverPort}`;
    const response = await session.defaultSession.fetch(`${origin}/api/artifacts/${encodeURIComponent(scope.artifactId)}/native-draft-grant`, {
      method: "POST", credentials: "include", redirect: "error", cache: "no-store",
      headers: { "content-type": "application/json", "x-lios-local-token": localTrustToken, Origin: origin },
      body: JSON.stringify({ baseVersion: scope.baseVersion, contentHash: scope.contentHash }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error("Native draft recovery requires the current authenticated Artifact owner.");
    return response.json();
  });
}
ipcMain.handle("limuria:artifact-draft-recovery-available", event => {
  assertTrustedIpcSender(event, mainWindow, serverPort);
  return protectedDraftsAvailable(safeStorage);
});
ipcMain.handle("limuria:artifact-draft-recovery-read", async (event, identity) => {
  assertTrustedIpcSender(event, mainWindow, serverPort);
  await requireCurrentNativeDraftGrant(identity);
  return readProtectedArtifactDraft({ root: app.getPath("userData"), safeStorage, input: identity });
});
ipcMain.handle("limuria:artifact-draft-recovery-write", async (event, input) => {
  assertTrustedIpcSender(event, mainWindow, serverPort);
  await requireCurrentNativeDraftGrant(input);
  return storeProtectedArtifactDraft({ root: app.getPath("userData"), safeStorage, input });
});
ipcMain.handle("limuria:artifact-draft-recovery-clear", async (event, identity) => {
  assertTrustedIpcSender(event, mainWindow, serverPort);
  await requireCurrentNativeDraftGrant(identity);
  return removeProtectedArtifactDraft({ root: app.getPath("userData"), safeStorage, input: identity });
});

// Chromium performs Tamil/Indic glyph shaping that jsPDF's standard fonts
// cannot. This is a local, explicit export action from our trusted top frame.
// The hidden renderer accepts inert, escaped markup ONLY, no scripts/resources,
// node access, app credentials, network, filesystem or interactive surfaces.
ipcMain.handle("limuria:export-unicode-pdf", async (event, raw) => {
  assertTrustedIpcSender(event, mainWindow, serverPort);
  const request = normalizeUnicodePdfPayload(raw);
  const html = buildUnicodeReportHtml(request);
  const pick = await dialog.showSaveDialog(mainWindow, {
    title: "Save professional Unicode PDF",
    defaultPath: request.filename,
    buttonLabel: "Save PDF",
    filters: [{ name: "PDF Document", extensions: ["pdf"] }],
  });
  if (pick.canceled || !pick.filePath) return { saved: false, cancelled: true };
  // Isolated in-memory partition per export: no surviving request interceptor,
  // cache, cookie or site data from the previous private document.
  const partition = "lios-unicode-pdf-" + crypto.randomUUID();
  const printSession = session.fromPartition(partition, { cache: false });
  // Network egress is never needed: all source excerpts come from the owned
  // canonical Artifact projection and fonts must be installed locally.
  printSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !details.url.startsWith("data:") });
  });
  let printWindow;
  try {
    printWindow = new BrowserWindow({
      width: 794, height: 1123, show: false, backgroundColor: "#ffffff",
      webPreferences: {
        partition,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        javascript: false,
        webSecurity: true,
        navigateOnDragDrop: false,
      },
    });
    printWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    printWindow.webContents.on("will-navigate", (navEvent) => navEvent.preventDefault());
    await printWindow.loadURL("data:text/html;charset=UTF-8," + encodeURIComponent(html));
    const bytes = await printWindow.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      pageSize: "A4",
    });
    if (!Buffer.isBuffer(bytes) || bytes.length < 100 || bytes.length > 32 * 1024 * 1024
      || bytes.subarray(0, 5).toString("ascii") !== "%PDF-"
      || !/%%EOF\s*$/.test(bytes.subarray(Math.max(0, bytes.length - 32)).toString("ascii"))) {
      throw new Error("Chromium did not produce a valid bounded Unicode PDF.");
    }
    await fs.promises.writeFile(pick.filePath, bytes);
    return { saved: true, filename: path.basename(pick.filePath), bytes: bytes.length };
  } finally {
    if (printWindow && !printWindow.isDestroyed()) printWindow.destroy();
  }
});

ipcMain.handle("limuria:workspace-info", (event) => {
  assertTrustedIpcSender(event, mainWindow, serverPort);
  if (!localWorkspace) throw new Error("Local workspace is not initialized.");
  return {
    version: localWorkspace.version,
    workspaceId: localWorkspace.workspaceId,
    createdAt: localWorkspace.createdAt,
    updatedAt: localWorkspace.updatedAt,
    connectorDirectory: localWorkspace.connectorDirectory,
    datasetDirectory: localWorkspace.datasetDirectory,
    exportDirectory: localWorkspace.exportDirectory,
  };
});
ipcMain.handle("limuria:choose-folder", async (event, purpose) => {
  assertTrustedIpcSender(event, mainWindow, serverPort);
  const titles = { "backup-destination": "Choose a folder for LiOS backups", "data-folder": "Choose the LiOS data folder" };
  if (typeof purpose !== "string" || !Object.hasOwn(titles, purpose)) throw new Error("Unknown folder purpose.");
  const chosen = await dialog.showOpenDialog(mainWindow, { title: titles[purpose], properties: ["openDirectory", "createDirectory"] });
  return chosen.canceled || !chosen.filePaths[0] ? null : chosen.filePaths[0];
});

ipcMain.handle("limuria:data-folder", (event) => {
  assertTrustedIpcSender(event, mainWindow, serverPort);
  const { root, source } = resolveDataRoot({ env: dataRootEnvironment() });
  return { root, source, isDefault: source === "production_default" || source === "development_default" };
});

ipcMain.handle("limuria:move-data-folder", async (event, targetPath) => {
  assertTrustedIpcSender(event, mainWindow, serverPort);
  if (typeof targetPath !== "string" || !path.isAbsolute(targetPath)) throw new Error("Choose an absolute folder path.");
  // Stop the local server first so PGlite releases its files; no auto-restart while moving.
  await stopLocalServerForMaintenance();
  try {
    const migration = await migrateDataRootSafely({
      targetRoot: targetPath,
      env: dataRootEnvironment(),
    });
    if (migration.status === "rollback_restored") {
      throw new Error("LiOS verified the copied data but could not activate the new data folder, so the previous folder was restored.");
    }
  } catch (error) {
    // Relaunch so the user is not left without a running server; the renderer receives the readable refusal first.
    scheduleDesktopRelaunch(500);
    throw error;
  }
  scheduleDesktopRelaunch();
  return { relaunching: true };
});

ipcMain.handle("limuria:restore-backup", async (event, rawPassphrase) => {
  assertTrustedIpcSender(event, mainWindow, serverPort);
  if (restoreInProgress) throw new Error("A LiOS restore is already in progress.");
  const passphrase = normalizeRestorePassphrase(rawPassphrase);
  const chosen = await dialog.showOpenDialog(mainWindow, {
    title: "Choose a LiOS backup to restore",
    properties: ["openFile"],
    filters: [
      { name: "LiOS backups", extensions: ["liosbak", "gz"] },
    ],
  });
  if (chosen.canceled || !chosen.filePaths[0]) return { cancelled: true, relaunching: false };

  const archivePath = validateRestoreArchive(chosen.filePaths[0]);
  const confirmation = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    title: "Restore this LiOS Home?",
    message: `Restore ${path.basename(archivePath)} and restart LiOS?`,
    detail: "The current Home database and backed-up files will be replaced by the verified backup. Replaced files are preserved by the restore engine when possible.",
    buttons: ["Cancel", "Restore and restart"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  if (confirmation.response !== 1) return { cancelled: true, relaunching: false };

  restoreInProgress = true;
  await stopLocalServerForMaintenance();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  try {
    await runDesktopRestoreWorker(archivePath, passphrase);
    logToFile(`Desktop restore completed from ${path.basename(archivePath)}; relaunching LiOS.`);
    scheduleDesktopRelaunch();
    return { cancelled: false, relaunching: true };
  } catch (error) {
    const message = error && error.message ? error.message : "Restore failed.";
    logToFile(`Desktop restore failed: ${message}`);
    dialog.showErrorBox(
      "LiOS backup restore failed",
      `${message}\n\nLiOS will restart without claiming that the restore succeeded.`,
    );
    scheduleDesktopRelaunch(500);
    return { cancelled: false, relaunching: true };
  }
});

function showMainWindow() {
  if (isQuitting) return;
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function installDesktopTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, "build-resources", "icon.png"));
  if (icon.isEmpty()) {
    logToFile("Desktop tray unavailable: icon missing. Window close retains ordinary platform behavior.");
    return;
  }
  try {
    desktopTray = new Tray(icon.resize({ width: process.platform === "darwin" ? 18 : 24, height: process.platform === "darwin" ? 18 : 24 }));
    desktopTray.setToolTip("LiOS Home · running on this machine");
    desktopTray.setContextMenu(Menu.buildFromTemplate([
      { label: "Open LiOS", click: showMainWindow },
      { label: "Home keeps running when the window is closed", enabled: false },
      { type: "separator" },
      { label: "Quit LiOS and stop Home", click: () => app.quit() },
    ]));
    desktopTray.on("click", showMainWindow);
  } catch (error) {
    desktopTray = null;
    logToFile(`Desktop tray unavailable: ${redactDesktopLogText(error.message)}`);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    title: "LiOS Intelligence Terminal",
    icon: path.join(__dirname, "build-resources", "icon.icns"),
    backgroundColor: "#050505",
    titleBarStyle: "hiddenInset", // Premium native macOS traffic light offset
    trafficLightPosition: { x: 12, y: 12 },
    // Don't show the window until content has actually painted — otherwise
    // a slow load (or a GPU hiccup) shows a blank/black window in the
    // meantime instead of nothing at all.
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      safeDialogs: true,
      navigateOnDragDrop: false,
      preload: path.join(__dirname, "preload.cjs"),
      // Hardware acceleration is disabled at startup (see above); tell the renderer so it can
      // suppress always-on ambient animation that would otherwise repaint the whole window.
      additionalArguments: ["--lios-render-mode=software"],
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  // The renderer has no legitimate reason to create privileged child windows.
  // External/customer links should be rendered as ordinary UI or handled by a
  // deliberately reviewed main-process action rather than window.open().
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, navigationUrl) => {
    try {
      const target = new URL(navigationUrl);
      const allowedOrigin = new URL(`http://localhost:${serverPort}`).origin;
      if (target.origin !== allowedOrigin) event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });

  // Poll the selected backend port until this instance is ready, but fail
  // visibly instead of leaving a hidden window forever when the server dies.
  const pollInterval = setInterval(() => {
    checkPort(serverPort, (isOpen) => {
      if (!isOpen || !mainWindow || mainWindow.isDestroyed()) return;
      clearInterval(pollInterval);
      clearTimeout(serverReadyTimer);
      mainWindow.loadURL(desktopRendererUrl()).catch(reportStartupFailure);
    });
  }, 100);
  serverReadyTimer = setTimeout(() => {
    clearInterval(pollInterval);
    reportStartupFailure(new Error(`The local server did not become ready on port ${serverPort} within ${SERVER_READY_TIMEOUT_MS / 1000} seconds.`));
  }, SERVER_READY_TIMEOUT_MS);

  mainWindow.on("close", event => {
    if (!isQuitting && desktopTray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on("closed", () => {
    clearTimeout(serverReadyTimer);
    clearInterval(pollInterval);
    serverReadyTimer = null;
    mainWindow = null;
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("Renderer process gone:", JSON.stringify(details));
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadURL(desktopRendererUrl());
    }
  });

  // hiddenInset draws the native macOS window controls over the web UI. Tell the
  // renderer (fixed string, no user data) so shell CSS can reserve their space.
  mainWindow.webContents.on("dom-ready", () => {
    if (process.platform === "darwin" && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.executeJavaScript('document.documentElement.dataset.desktopPlatform = "darwin";', true).catch(() => {});
    }
  });

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
    console.error("Renderer failed to load:", errorCode, errorDescription);
  });

  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    if (level >= 2) {
      console.error(`Renderer console [${level}]: ${redactDesktopLogText(message)} (${redactDesktopLogText(sourceId)}:${line})`);
    }
  });
}

// Initialize Electron lifecycle
app.whenReady().then(async () => {
  if (app.isPackaged && process.env.LIOS_ENABLE_DEVTOOLS !== "1") {
    // Packaged builds do not expose Toggle Developer Tools / Force Reload in the default menu.
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
      { role: "editMenu" },
      { label: "View", submenu: [
        { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" },
        { type: "separator" }, { role: "togglefullscreen" },
      ] },
      { role: "windowMenu" },
    ]));
  }
  if (nativeUnicodePdfSmokeRequested) {
    // A separate opt-in installed-app renderer test. It does not start the
    // local server or access a user workspace. A PDF may be saved ONLY when
    // an operator explicitly supplies a new local evidence path.
    // This is a render smoke probe, not automatic font/visual acceptance.
    const reportPath = process.env.LIOS_UNICODE_PDF_SMOKE_REPORT?.trim();
    const outputPath = process.env.LIOS_UNICODE_PDF_SMOKE_OUTPUT?.trim();
    try {
      if (!app.isPackaged)throw new Error("Native Unicode PDF smoke requires an installed packaged LiOS build.");
      if (outputPath && (!path.isAbsolute(outputPath) || !/\.pdf$/i.test(outputPath))) {
        throw new Error("Native Unicode PDF evidence output requires an absolute .pdf file path.");
      }
      const onPdf = outputPath ? async bytes => {
        // No overwrite, no public upload and no user data. The payload is
        // synthetic, but keep its emitted file private by default.
        await fs.promises.writeFile(outputPath, bytes, {flag:"wx",mode:0o600});
      } : undefined;
      const result = await runNativeUnicodePdfSmoke({BrowserWindow,session,onPdf});
      const report = {version:1,generatedAt:new Date().toISOString(),
        platform:process.platform,arch:process.arch,...result};
      if(reportPath)fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+"\n","utf8");
      console.log(JSON.stringify(report,null,2));
      app.exit(0);
    } catch(error) {
      const report={version:1,generatedAt:new Date().toISOString(),
        platform:process.platform,arch:process.arch,status:"failed",
        error:error?.message??String(error)};
      if(reportPath) {
        try{fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+"\n","utf8");}catch{}
      }
      console.error(JSON.stringify(report,null,2));
      app.exit(1);
    }
    return;
  }
  if (desktopSelfTestRequested) {
    const reportPath = process.env.LIOS_DESKTOP_SELF_TEST_REPORT?.trim();
    try {
      const report = await runPackagedDesktopSelfTest({
        app,
        safeStorage,
        resourcesPath: process.resourcesPath,
        appPath: app.getAppPath(),
        electronAppReadyElapsedMs: Number(process.hrtime.bigint() - desktopProcessStartedAtNs) / 1_000_000,
      });
      if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
      console.log(JSON.stringify(report, null, 2));
      app.exit(0);
    } catch (error) {
      const failure = {
        version: 1,
        generatedAt: new Date().toISOString(),
        platform: process.platform,
        arch: process.arch,
        status: "failed",
        error: error && error.message ? error.message : String(error),
      };
      if (reportPath) {
        try { fs.writeFileSync(reportPath, JSON.stringify(failure, null, 2) + "\n", "utf8"); } catch {}
      }
      console.error(JSON.stringify(failure, null, 2));
      app.exit(1);
    }
    return;
  }

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = { ...(details.responseHeaders || {}) };
    for (const name of Object.keys(responseHeaders)) {
      if (name.toLowerCase() === "content-security-policy") delete responseHeaders[name];
    }
    // Egress allow-list (GM-03 / Q5): the renderer only talks to its own local server. Provider and market-data
    // calls are made by the server on the user's behalf, so there is no reason for page code to reach other
    // hosts. Remote images stay allowed for news thumbnails; nothing else may leave the page.
    const origin = `localhost:${serverPort}`;
    responseHeaders["Content-Security-Policy"] = [
      "default-src 'self'; " +
      "script-src 'self'; " +
      "style-src 'self' 'unsafe-inline'; " +
      `img-src ${imgSrcDirective(process.env)}; ` +
      "font-src 'self' data:; " +
      "media-src 'self' blob: data:; " +
      `connect-src 'self' http://${origin} ws://${origin}; ` +
      "worker-src 'self' blob:; " +
      "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none';",
    ];
    callback({ responseHeaders });
  });
  // Guard against stale cached assets referencing hashed filenames from a
  // previous build (userData dir can persist across app rebuilds/updates).
  // clearCache() alone only clears the HTTP cache — the app also registers a
  // service worker (client/public/sw.js) with its own separate Cache Storage
  // that persisted across rebuilds and pinned the window to a stale
  // app-shell HTML referencing JS files that no longer existed, causing a
  // permanent blank/black window with no visible error. There's no real
  // offline-use case for a desktop app whose server is always local, so
  // clearing service workers + cache storage on every launch is pure upside.
  try {
    setDockIcon();
    await session.defaultSession.clearCache();
    await session.defaultSession.clearStorageData({
      storages: ["serviceworkers", "cachestorage"],
    });
    try {
      dataRootState = prepareDataRoot({ env: dataRootEnvironment() });
    } catch (error) {
      if (error instanceof DataRootUnavailableError) {
        logToFile(`Data root unavailable (${error.code}): ${error.message}`);
        reportStartupFailure(error);
        return;
      }
      throw error;
    }
    localWorkspace = prepareLocalWorkspace();
    localVaultSecret = loadOrCreateOsProtectedVaultSecret();
    logToFile(`whenReady: local workspace ready id=${localWorkspace.workspaceId} root=${localWorkspace.paths.root}; native vault protection=${localVaultSecret ? "enabled" : "fallback"}`);
    const preferredPort = Number.parseInt(process.env.PORT || "", 10);
    serverPort = await choosePersistentPort({
      file: path.join(app.getPath("userData"), "server-port.json"),
      existingInstall: !dataRootState.firstRun,
      isFree: (port) => new Promise((resolve) => checkPort(port, (occupied) => resolve(!occupied))),
      preferredFromEnv: Number.isInteger(preferredPort) && preferredPort > 0 ? preferredPort : null,
    });
    installLocalTrustHeader(serverPort);
    logToFile(`whenReady: cache cleared, starting server + window on port ${serverPort}`);
    startServer();
    createWindow();
    if (!desktopSelfTestRequested) installDesktopTray();
    const { autoUpdater } = require("electron-updater");
    const updateStatus = configureAutoUpdater({
      updater: autoUpdater,
      isPackaged: app.isPackaged,
      releaseChannel: require("./package.json").liosReleaseChannel || "production",
      log: logToFile,
    });
    logToFile(`whenReady: auto-updater ${updateStatus.enabled ? "enabled" : "disabled"}${updateStatus.reason ? ` (${updateStatus.reason})` : ""}`);
  } catch (err) {
    logToFile(`whenReady: threw: ${err && err.stack ? err.stack : err}`);
    reportStartupFailure(err);
  }

  app.on("activate", showMainWindow);
});


app.on("before-quit", () => {
  isQuitting = true;
  clearTimeout(serverReadyTimer);
  desktopTray?.destroy();
  desktopTray = null;
});
// Terminate Express child process on exit
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("will-quit", () => {
  isQuitting = true;
  if (serverProcess) {
    serverProcess.kill();
  }
});