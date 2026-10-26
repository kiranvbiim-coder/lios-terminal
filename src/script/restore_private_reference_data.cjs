"use strict";

/**
 * Restore locally held reference datasets from the original PRIVATE LiOS repo.
 * No private data, tokens, credentials, or Git history are committed to the
 * public source repository. GitHub CLI authenticates outside this script.
 *
 * Run from src/: npm run data:restore:private
 * Or: node script/restore_private_reference_data.cjs --restore --source /path/to/lios-v1.0.0
 * Validate: npm run data:check
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const PRIVATE_REPOSITORY = "kiranvbiim-coder/lios-v1.0.0";
const SRC_ROOT = path.resolve(__dirname, "..");
const DATA_PATH = path.join(SRC_ROOT, "server", "data");

// Exact Git blob identities, read from private main on 2026-10-26.
// An upstream modification needs an explicit hash review, not a silent update.
const REFERENCE_ASSETS = Object.freeze([
  { name: "tickers.json", blobSha: "f9edacb9d8dc04485b868ab9ee44638fbbcf416d", bytes: 11882813, minItems: 10000, type: "array" },
  { name: "provider_ingested_universe.json", blobSha: "8b9e82b4143d453a0d0c8e7804820cf7a778cd43", bytes: 2745198, minItems: 1000, type: "array" },
  { name: "crypto_coingecko_ids.json", blobSha: "ca29d5000a89a7382309d667800e495010662662", bytes: 828135, minItems: 1000, type: "object" },
  { name: "shillerCape.json", blobSha: "7f17e852586d3764453344538a14852c7db04d33", bytes: 134783, minItems: 1000, type: "array" },
]);

function blobHash(bytes) {
  return crypto.createHash("sha1")
    .update("blob " + bytes.byteLength + "\0")
    .update(bytes)
    .digest("hex");
}

function verifyAsset(bytes, asset) {
  if (!Buffer.isBuffer(bytes)) throw new TypeError("Asset bytes must be a Buffer.");
  if (bytes.byteLength !== asset.bytes) {
    throw new Error(asset.name + " size mismatch: expected " + asset.bytes + ", got " + bytes.byteLength);
  }
  const observed = blobHash(bytes);
  if (observed !== asset.blobSha) {
    throw new Error(asset.name + " Git blob identity mismatch: expected " + asset.blobSha + ", got " + observed);
  }
  let value;
  try { value = JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error(asset.name + " is not valid JSON."); }
  if (asset.type === "array" ? !Array.isArray(value) : !value || Array.isArray(value) || typeof value !== "object") {
    throw new Error(asset.name + " has an unexpected data shape.");
  }
  const items = asset.type === "array" ? value.length : Object.keys(value).length;
  if (items < asset.minItems) {
    throw new Error(asset.name + " has " + items + " rows, below the checked minimum " + asset.minItems);
  }
  return { name: asset.name, bytes: bytes.byteLength, blobSha: observed, items };
}

function verifyDirectory(directory = DATA_PATH) {
  return REFERENCE_ASSETS.map((asset) => {
    const filename = path.join(directory, asset.name);
    if (!fs.existsSync(filename)) throw new Error("Missing required LiOS instrument/reference data: " + filename);
    if (!fs.lstatSync(filename).isFile()) throw new Error("Reference data must be regular files: " + filename);
    return verifyAsset(fs.readFileSync(filename), asset);
  });
}

function command(exe, args) {
  const p = spawnSync(exe, args, { stdio: "inherit", windowsHide: true });
  if (p.error) throw new Error(exe + " failed: " + p.error.message);
  if (p.status !== 0) throw new Error(exe + " failed with exit code " + p.status);
}

function locateSourceData(repoPath) {
  for (const candidate of [
    repoPath,
    path.join(repoPath, "src", "server", "data"),
    path.join(repoPath, "server", "data"),
  ]) {
    if (fs.existsSync(path.join(candidate, "tickers.json"))) return candidate;
  }
  throw new Error("Original data directory not found in " + repoPath);
}

function restoreAssets({ source = null, overwrite = false, target = DATA_PATH } = {}) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "lios-private-reference-"));
  try {
    let sourceDir;
    if (source) {
      sourceDir = locateSourceData(path.resolve(source));
    } else {
      const checkout = path.join(workspace, "original-private-repo");
      // Auth comes from the operator's existing GitHub CLI login, never env tokens in command text.
      command("gh", ["repo", "clone", PRIVATE_REPOSITORY, checkout, "--",
        "--depth=1", "--filter=blob:none", "--sparse", "--single-branch"]);
      command("git", ["-C", checkout, "sparse-checkout", "set", "src/server/data"]);
      sourceDir = locateSourceData(checkout);
    }

    // Verify all inputs BEFORE modifying any local data. Never publish these files to git.
    const payloads = REFERENCE_ASSETS.map((asset) => {
      const file = path.join(sourceDir, asset.name);
      if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) {
        throw new Error("Private repository is missing " + asset.name);
      }
      const bytes = fs.readFileSync(file);
      const report = verifyAsset(bytes, asset);
      return { asset, bytes, report };
    });
    fs.mkdirSync(target, { recursive: true, mode: 0o700 });
    for (const { asset } of payloads) {
      const destination = path.join(target, asset.name);
      if (fs.existsSync(destination)) {
        if (!fs.lstatSync(destination).isFile()) throw new Error("Not a regular file: " + destination);
        if (!overwrite && blobHash(fs.readFileSync(destination)) !== asset.blobSha) {
          throw new Error("Refusing to replace modified " + destination + "; use --force after reviewing it.");
        }
      }
    }
    for (const { asset, bytes } of payloads) {
      const destination = path.join(target, asset.name);
      if (fs.existsSync(destination) && blobHash(fs.readFileSync(destination)) === asset.blobSha) continue;
      const staged = path.join(target, "." + asset.name + "." + process.pid + ".tmp");
      try {
        fs.writeFileSync(staged, bytes, { flag: "wx", mode: 0o600 });
        fs.renameSync(staged, destination);
      } finally {
        if (fs.existsSync(staged)) fs.unlinkSync(staged);
      }
    }
    return verifyDirectory(target);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

function runCli(args) {
  const doRestore = args.includes("--restore");
  const sourceOpt = args.find((arg) => arg.startsWith("--source="));
  const sourceIndex = args.indexOf("--source");
  const source = sourceOpt ? sourceOpt.slice("--source=".length)
    : sourceIndex < 0 ? null : args[sourceIndex + 1];
  if (!doRestore && (source || args.includes("--force"))) throw new Error("--source and --force require --restore.");
  if (args.some((arg) => !["--check", "--restore", "--force", "--source"].includes(arg)
    && !arg.startsWith("--source=") && arg !== source)) {
    throw new Error("Usage: --check | --restore [--source=/path/to/private/checkout] [--force]");
  }
  const reports = doRestore ? restoreAssets({ source, overwrite: args.includes("--force") }) : verifyDirectory();
  for (const r of reports) console.log("VERIFIED " + r.name + ": " + r.items + " entries, Git blob " + r.blobSha);
  console.log(doRestore
    ? "Original private reference assets restored locally (gitignored); no public commit made."
    : "Instrument/reference datasets verified for the installed desktop build.");
}

if (require.main === module) {
  try { runCli(process.argv.slice(2)); }
  catch (error) {
    console.error("LiOS reference data: " + (error instanceof Error ? error.message : error));
    console.error("Restore from the private source with: npm run data:restore:private");
    process.exitCode = 1;
  }
}

module.exports = { REFERENCE_ASSETS, PRIVATE_REPOSITORY, DATA_PATH, blobHash, verifyAsset, verifyDirectory, restoreAssets, runCli };
