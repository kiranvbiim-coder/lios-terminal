"use strict";
/**
 * GM-03 — the ONE place that decides where LiOS keeps user-owned state.
 *
 * Shared by the Electron main process (CommonJS) and the server (via server/dataRoot.ts). Before this,
 * 47 modules each re-derived `~/.limuria-terminal` / `LIMURIA_DATA_DIR` / `cwd/data` (GM-01 D-14), and a
 * missing or unmounted database folder silently became an empty database (GM-01 finding 4).
 *
 * Resolution order:
 *   1. LIOS_DATA_ROOT        canonical override
 *   2. LIMURIA_DATA_DIR      legacy override (kept so existing installs and tests keep their data)
 *   3. <home>/.limuria-terminal/data-root.json   the folder the user chose (Desktop picker or `npm run data-root`)
 *   4. NODE_ENV=production   <home>/.limuria-terminal
 *   5. otherwise             <cwd>/data
 *
 * Fail-safe: a root that LiOS already initialized must never be re-created empty. A `.lios-root.json`
 * marker in the root and, for user-chosen roots (LIOS_DATA_ROOT), a ledger entry in the home anchor
 * (`<home>/.limuria-terminal/known-roots.json`, on the home volume) let startup tell "first run" from
 * "the drive/folder went away".
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const MARKER_FILE = ".lios-root.json";
const MARKER_VERSION = 1;
const LEDGER_FILE = "known-roots.json";
const POINTER_FILE = "data-root.json";
const DATA_ROOT_EXIT_CODE = 78;

class DataRootUnavailableError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "DataRootUnavailableError";
    this.code = code;
    this.details = details;
  }
}

function homeOf(options) {
  return options.homedir ?? (options.env.HOME || options.env.USERPROFILE || os.homedir());
}

function resolveDataRoot(options = {}) {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const home = homeOf({ ...options, env });
  const canonical = env.LIOS_DATA_ROOT?.trim();
  if (canonical) return { root: path.resolve(canonical), source: "LIOS_DATA_ROOT", home };
  const legacy = env.LIMURIA_DATA_DIR?.trim();
  if (legacy) return { root: path.resolve(legacy), source: "LIMURIA_DATA_DIR", home };
  const chosen = readDataRootPointer(home);
  if (chosen) return { root: chosen, source: "pointer", home };
  if (env.NODE_ENV === "production") return { root: path.join(home, ".limuria-terminal"), source: "production_default", home };
  return { root: path.resolve(cwd, "data"), source: "development_default", home };
}

/** True when a PostgreSQL data directory already lives directly in `dir` (installs that set LIMURIA_DATA_DIR). */
function isPgDataDir(dir) {
  return fs.existsSync(path.join(dir, "PG_VERSION"));
}

/** PGlite directory: `<root>/pgdata`, or the root itself for the legacy layout that already holds a database. */
function databaseDir(resolution) {
  const nested = path.join(resolution.root, "pgdata");
  if (!fs.existsSync(nested) && isPgDataDir(resolution.root)) return resolution.root;
  return nested;
}

/**
 * Per-user state files (session secret, API-key digests, AI memory, audit log): `<root>/data` in
 * production and with explicit roots, the root itself in the development default, as before.
 */
function stateDir(resolution) {
  return resolution.source === "development_default" ? resolution.root : path.join(resolution.root, "data");
}

function markerPath(root) {
  return path.join(root, MARKER_FILE);
}

function pointerPath(home) {
  return path.join(home, ".limuria-terminal", POINTER_FILE);
}

/** The user-chosen data folder, or null. Only an absolute path counts; anything else is ignored rather than guessed. */
function readDataRootPointer(home) {
  const pointer = readJson(pointerPath(home));
  return pointer && pointer.version === 1 && typeof pointer.root === "string" && path.isAbsolute(pointer.root) ? path.resolve(pointer.root) : null;
}

function ledgerPath(home) {
  return path.join(home, ".limuria-terminal", LEDGER_FILE);
}

function readJson(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, file);
}

function readMarker(root) {
  const marker = readJson(markerPath(root));
  return marker && marker.version === MARKER_VERSION && typeof marker.rootId === "string" ? marker : null;
}

function readLedger(home) {
  const ledger = readJson(ledgerPath(home));
  return ledger && Array.isArray(ledger.roots) ? ledger : { version: MARKER_VERSION, roots: [] };
}

function recordLedger(home, root, rootId) {
  const ledger = readLedger(home);
  const roots = ledger.roots.filter((entry) => !(entry && entry.path === root));
  roots.push({ path: root, rootId, recordedAt: new Date().toISOString() });
  writeJsonAtomic(ledgerPath(home), { version: MARKER_VERSION, roots });
}

function writeDataRootPointer(home, value) {
  writeJsonAtomic(pointerPath(home), { version: MARKER_VERSION, ...value });
}

function describe(resolution) {
  return `${resolution.root} (from ${resolution.source})`;
}

/**
 * Called once at startup before anything creates state. Returns `{ firstRun }` or throws
 * DataRootUnavailableError — never creates a replacement for a root LiOS already used.
 */
function prepareDataRoot(options = {}) {
  const env = options.env ?? process.env;
  const resolution = resolveDataRoot({ ...options, env });
  const { root, home } = resolution;
  const localDatabase = options.localDatabase ?? !env.DATABASE_URL?.trim();
  const marker = readMarker(root);
  // The ledger protects user-chosen roots (LIOS_DATA_ROOT or the saved pointer), which may sit on removable or network storage.
  // The default roots live on the home volume and the legacy LIMURIA_DATA_DIR override is used by tests and
  // old configs, so neither writes to the user's real home anchor.
  const ledgered = resolution.source === "LIOS_DATA_ROOT" || resolution.source === "pointer";
  const known = ledgered ? readLedger(home).roots.find((entry) => entry && entry.path === root) : undefined;
  const databasePresent = isPgDataDir(databaseDir(resolution));

  if (!marker && known && !databasePresent) {
    throw new DataRootUnavailableError(
      "root_missing",
      `The LiOS data folder ${describe(resolution)} was used before but is not available now. If it is on an external or network drive, reconnect it and restart LiOS. LiOS will not create an empty replacement.`,
      { root, source: resolution.source },
    );
  }
  if (marker && marker.databaseInitialized && localDatabase && !databasePresent) {
    throw new DataRootUnavailableError(
      "database_missing",
      `The LiOS database folder is missing from ${describe(resolution)}. Restore it from a backup or reconnect the drive that holds it. LiOS will not create an empty database over it.`,
      { root, source: resolution.source },
    );
  }

  if (marker) {
    if (ledgered && (!known || known.rootId !== marker.rootId)) recordLedger(home, root, marker.rootId);
    return { ...resolution, rootId: marker.rootId, firstRun: !marker.databaseInitialized && !databasePresent };
  }

  // No marker: either a brand-new root or an install that predates markers. Adopt either; a database that
  // already exists is recorded so it is protected from now on.
  const rootId = `root_${crypto.randomUUID().replace(/-/g, "")}`;
  writeJsonAtomic(markerPath(root), {
    version: MARKER_VERSION,
    rootId,
    createdAt: new Date().toISOString(),
    databaseInitialized: databasePresent,
    adoptedExistingData: databasePresent,
  });
  if (ledgered) recordLedger(home, root, rootId);
  return { ...resolution, rootId, firstRun: !databasePresent };
}

/** Records that this root now has a local database, so a later missing folder is an error, not a first run. */
function markDatabaseInitialized(options = {}) {
  const resolution = resolveDataRoot(options);
  const marker = readMarker(resolution.root);
  if (!marker) throw new Error("prepareDataRoot() must run before markDatabaseInitialized().");
  if (marker.databaseInitialized) return;
  writeJsonAtomic(markerPath(resolution.root), { ...marker, databaseInitialized: true, databaseInitializedAt: new Date().toISOString() });
}

function listFiles(directory, base = directory) {
  const entries = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Refusing to copy symbolic link ${full}.`);
    if (entry.isDirectory()) entries.push(...listFiles(full, base));
    else if (entry.isFile()) entries.push({ relative: path.relative(base, full), size: fs.statSync(full).size });
  }
  return entries.sort((a, b) => a.relative.localeCompare(b.relative));
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/**
 * One-time fold of the old Electron `userData/workspace` folder into `<root>/workspace`.
 * Copies to a temporary sibling, verifies every file (path, size, workspace.json digest), renames into
 * place, then rewrites the absolute directory paths stored in workspace.json. The original is left
 * untouched as a backup and the workspace id (the licence device id) is preserved byte-for-byte.
 */
function foldLegacyWorkspace({ legacyRoot, targetRoot }) {
  const legacyMetadata = path.join(legacyRoot, "workspace.json");
  const targetMetadata = path.join(targetRoot, "workspace.json");
  if (!fs.existsSync(legacyMetadata)) return { action: "no_legacy_workspace" };
  if (fs.existsSync(targetMetadata)) return { action: "already_folded" };
  if (path.resolve(legacyRoot) === path.resolve(targetRoot)) return { action: "same_location" };

  const staging = `${targetRoot}.fold-${process.pid}`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(targetRoot), { recursive: true, mode: 0o700 });
  try {
    fs.cpSync(legacyRoot, staging, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
    const expected = listFiles(legacyRoot);
    const actual = listFiles(staging);
    if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error("Copied workspace does not match the original file list.");
    if (sha256(legacyMetadata) !== sha256(path.join(staging, "workspace.json"))) throw new Error("Copied workspace metadata does not match the original.");
    const metadata = JSON.parse(fs.readFileSync(path.join(staging, "workspace.json"), "utf8"));
    const rewritten = {
      ...metadata,
      connectorDirectory: path.join(targetRoot, "connectors"),
      datasetDirectory: path.join(targetRoot, "datasets"),
      exportDirectory: path.join(targetRoot, "exports"),
      foldedFrom: path.resolve(legacyRoot),
      foldedAt: new Date().toISOString(),
    };
    writeJsonAtomic(path.join(staging, "workspace.json"), rewritten);
    fs.renameSync(staging, targetRoot);
    return { action: "folded", files: actual.length, workspaceId: metadata.workspaceId };
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

/** Files that anchor a home to its data folder; they describe where the data is and are never part of the data. */
const ANCHOR_FILES = new Set([LEDGER_FILE, POINTER_FILE]);
/** Process-bound files that must not be carried to a new location. */
const PROCESS_FILES = new Set(["postmaster.pid", ".limuria-pglite-owner.json"]);

function copyDataTree(source, target, rootSource) {
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (PROCESS_FILES.has(entry.name) || (source === rootSource && ANCHOR_FILES.has(entry.name))) continue;
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Refusing to move symbolic link ${from}.`);
    if (entry.isDirectory()) {
      fs.mkdirSync(to, { recursive: true, mode: 0o700 });
      copyDataTree(from, to, rootSource);
    } else if (entry.isFile()) {
      fs.copyFileSync(from, to);
    }
  }
}

function dataFiles(root, current = root, entries = []) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    if (PROCESS_FILES.has(entry.name) || (current === root && ANCHOR_FILES.has(entry.name))) continue;
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) dataFiles(root, full, entries);
    else if (entry.isFile()) entries.push({ relative: path.relative(root, full), size: fs.statSync(full).size, sha256: sha256(full) });
  }
  return entries.sort((a, b) => a.relative.localeCompare(b.relative));
}

/**
 * Moves the data folder to a folder the user chose: copy, verify every file by size and SHA-256, then point the home
 * at the new folder. The original is NOT deleted (it stays as the fallback until the user removes it). The caller must
 * have stopped LiOS first because a running PGlite database cannot be copied consistently.
 */
function moveDataRoot({ from, to, env = process.env, homedir }) {
  const home = homeOf({ env, homedir });
  const source = path.resolve(from);
  const target = path.resolve(to);
  if (!path.isAbsolute(to)) throw new Error("Choose an absolute folder path.");
  if (source === target) throw new Error("That is already the current data folder.");
  if (target.startsWith(`${source}${path.sep}`) || source.startsWith(`${target}${path.sep}`)) {
    throw new Error("The new data folder cannot be inside the current one (or contain it).");
  }
  if (!fs.existsSync(source)) throw new Error(`The current data folder ${source} does not exist.`);
  if (fs.existsSync(target) && fs.readdirSync(target).length > 0) throw new Error("Choose an empty folder for the new data location.");
  if (fs.existsSync(path.join(source, "pgdata", "postmaster.pid")) && processAlive(path.join(source, "pgdata", "postmaster.pid"))) {
    throw new Error("LiOS is still running with this data folder. Quit it first.");
  }
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  try {
    copyDataTree(source, target, source);
    const expected = dataFiles(source);
    const actual = dataFiles(target);
    if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error("The copied data does not match the original; nothing was changed.");
    const marker = readMarker(source);
    if (marker) recordLedger(home, target, marker.rootId);
    writeDataRootPointer(home, { root: target, movedFrom: source, movedAt: new Date().toISOString() });
    return { from: source, to: target, files: actual.length, bytes: actual.reduce((sum, file) => sum + file.size, 0) };
  } catch (error) {
    fs.rmSync(target, { recursive: true, force: true });
    throw error;
  }
}

function processAlive(pidFile) {
  try {
    const pid = Number.parseInt(fs.readFileSync(pidFile, "utf8").split("\n")[0], 10);
    if (!Number.isInteger(pid) || pid <= 0) return false;
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error && error.code === "EPERM";
  }
}

/** Re-selects a previously initialized data root without copying or deleting user data. */
function restoreDataRootPointer({ root, env = process.env, homedir }) {
  if (typeof root !== "string" || !path.isAbsolute(root)) throw new Error("LiOS data root restoration requires an absolute folder path.");
  const home = homeOf({ env, homedir });
  const target = path.resolve(root);
  const marker = readMarker(target);
  if (!marker) throw new Error("LiOS data root restoration requires an existing verified root marker.");
  recordLedger(home, target, marker.rootId);
  writeDataRootPointer(home, { root: target, restoredAt: new Date().toISOString() });
  return { root: target, rootId: marker.rootId };
}

/** Points this home back at its default data folder (does not move any data). */
function clearDataRootPointer({ env = process.env, homedir } = {}) {
  fs.rmSync(pointerPath(homeOf({ env, homedir })), { force: true });
}

module.exports = {
  DATA_ROOT_EXIT_CODE,
  DataRootUnavailableError,
  MARKER_FILE,
  databaseDir,
  foldLegacyWorkspace,
  clearDataRootPointer,
  markDatabaseInitialized,
  moveDataRoot,
  readDataRootPointer,
  prepareDataRoot,
  readMarker,
  resolveDataRoot,
  restoreDataRootPointer,
  stateDir,
};