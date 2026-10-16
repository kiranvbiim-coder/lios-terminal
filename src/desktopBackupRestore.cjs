const fs = require("node:fs");
const path = require("node:path");

const MAX_RESTORE_PASSPHRASE_CHARS = 512;

function normalizeRestorePassphrase(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > MAX_RESTORE_PASSPHRASE_CHARS || value.includes("\0")) {
    throw new Error("Restore passphrase is invalid.");
  }
  return value;
}

function validateRestoreArchive(file) {
  if (typeof file !== "string" || !path.isAbsolute(file) || file.includes("\0")) {
    throw new Error("Choose an absolute LiOS backup file.");
  }
  const resolved = path.resolve(file);
  // statSync follows symlinks. A restore worker must not be pointed at an
  // unrelated user file through a .liosbak/.tar.gz symlink selected by a
  // native file dialog or supplied to this internal launch boundary.
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink()) throw new Error("The selected LiOS backup must not be a symbolic link.");
  if (!stat.isFile() || stat.size <= 0) throw new Error("The selected LiOS backup is not a readable file.");
  if (!(resolved.endsWith(".liosbak") || resolved.endsWith(".tar.gz"))) {
    throw new Error("Choose a LiOS .liosbak or .tar.gz backup.");
  }
  return resolved;
}

function resolveRestoreWorkerPath({ appPath, isPackaged }) {
  const candidates = isPackaged
    ? [
        path.join(path.dirname(appPath), "app.asar.unpacked", "dist", "desktop-restore.cjs"),
        path.join(appPath, "dist", "desktop-restore.cjs"),
      ]
    : [path.join(__dirname, "dist", "desktop-restore.cjs")];
  const found = candidates.find((candidate) => {
    try {
      const entry = fs.lstatSync(candidate);
      return entry.isFile() && !entry.isSymbolicLink();
    } catch {
      return false;
    }
  });
  if (!found) throw new Error("The packaged LiOS restore worker is missing or unsafe.");
  return found;
}

function createRestoreWorkerLaunchPlan({
  executable,
  workerPath,
  archivePath,
  passphrase,
  destinationVaultSecret,
  dataRoot,
  resourcesPath,
  isPackaged,
  env = process.env,
}) {
  if (typeof executable !== "string" || !executable) throw new Error("Restore worker executable is missing.");
  if (typeof workerPath !== "string" || !path.isAbsolute(workerPath)
    || path.basename(workerPath) !== "desktop-restore.cjs") throw new Error("Restore worker path is invalid.");
  // Revalidate at the process-launch boundary: a previously selected
  // unpacked worker must not become a symlink or non-file before spawning.
  let workerFile;
  try { workerFile = fs.lstatSync(workerPath); } catch { /* handled below */ }
  if (!workerFile?.isFile() || workerFile.isSymbolicLink()) {
    throw new Error("Restore worker is missing or unsafe.");
  }
  if (typeof dataRoot !== "string" || !path.isAbsolute(dataRoot)) throw new Error("LiOS data root is invalid.");
  const archive = validateRestoreArchive(archivePath);
  const secret = normalizeRestorePassphrase(passphrase);
  const destinationSecret = destinationVaultSecret == null || destinationVaultSecret === ""
    ? null
    : normalizeRestorePassphrase(destinationVaultSecret);
  const workerEnv = {
    ...env,
    NODE_ENV: "production",
    LIOS_DATA_ROOT: path.resolve(dataRoot),
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONNOUSERSITE: "1",
    PYTHONUTF8: "1",
    ...(isPackaged ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
    ...(isPackaged && resourcesPath ? { ELECTRON_RESOURCES_PATH: resourcesPath } : {}),
  };
  return Object.freeze({
    executable,
    args: Object.freeze([workerPath]),
    env: Object.freeze(workerEnv),
    stdin: JSON.stringify({
      version: 1,
      archivePath: archive,
      passphrase: secret,
      destinationVaultSecret: destinationSecret,
    }) + "\n",
  });
}

module.exports = {
  MAX_RESTORE_PASSPHRASE_CHARS,
  createRestoreWorkerLaunchPlan,
  normalizeRestorePassphrase,
  resolveRestoreWorkerPath,
  validateRestoreArchive,
};
