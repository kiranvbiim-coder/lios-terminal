"use strict";

/**
 * Recover LiOS's original private market catalogs into the local, ignored
 * server/data directory. This script never publishes those datasets to Git.
 *
 * Run from src/: npm run data:catalogs:restore
 * Alternative: node script/restore_market_catalogs.cjs --restore --from-dir /path/to/private/checkout
 * Validate:    npm run data:catalogs:check
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const SOURCE_REPOSITORY = "kiranvbiim-coder/lios-v1.0.0";
const CATALOGS = Object.freeze([
  { name: "tickers.json", sha: "f9edacb9d8dc04485b868ab9ee44638fbbcf416d", kind: "array", minRecords: 5000, minBytes: 500000 },
  { name: "provider_ingested_universe.json", sha: "8b9e82b4143d453a0d0c8e7804820cf7a778cd43", kind: "array", minRecords: 1000, minBytes: 100000 },
  { name: "crypto_coingecko_ids.json", sha: "ca29d5000a89a7382309d667800e495010662662", kind: "object", minRecords: 1000, minBytes: 100000 },
]);
const DEFAULT_DESTINATION = path.resolve(__dirname, "..", "server", "data");
const MAX_BYTES = 24 * 1024 * 1024;

function gitBlobSha(bytes) {
  return crypto.createHash("sha1")
    .update("blob " + bytes.length + "\0")
    .update(bytes)
    .digest("hex");
}

function validateCatalogBytes(bytes, definition) {
  if (!Buffer.isBuffer(bytes)) throw new Error(definition.name + " must be a Buffer");
  if (bytes.length < definition.minBytes || bytes.length > MAX_BYTES) {
    throw new Error(definition.name + " size outside expected bounds (" + bytes.length + " bytes)");
  }
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(definition.name + " contains invalid JSON");
  }
  const isArray = Array.isArray(parsed);
  if (definition.kind === "array" && !isArray) throw new Error(definition.name + " must contain an array");
  if (definition.kind === "object" && (!parsed || typeof parsed !== "object" || isArray)) {
    throw new Error(definition.name + " must contain a mapping object");
  }
  const count = isArray ? parsed.length : Object.keys(parsed).length;
  if (count < definition.minRecords) throw new Error(definition.name + " unexpectedly small: " + count);
  if (isArray) {
    if (!parsed.every(row => row && typeof row.symbol === "string" && row.symbol.trim()
      && typeof row.name === "string" && row.name.trim())) {
      throw new Error(definition.name + " contains invalid symbol/name rows");
    }
  } else if (!Object.entries(parsed).every(([symbol, row]) =>
    symbol.length > 0 && row && typeof row.id === "string" && row.id.trim()
    && typeof row.name === "string" && row.name.trim())) {
    throw new Error(definition.name + " contains invalid CoinGecko identifiers");
  }
  return { count, bytes: bytes.length, gitBlobSha: gitBlobSha(bytes) };
}

function downloadOriginal(definition, runner = spawnSync) {
  // Pin directly to the audited Git object. The private repository may change
  // its main branch without silently changing the recovered source bytes.
  const endpoint = "repos/" + SOURCE_REPOSITORY + "/git/blobs/" + definition.sha;
  const result = runner("gh", ["api", endpoint], {
    encoding: null,
    maxBuffer: MAX_BYTES + 1024 * 1024,
    windowsHide: true,
  });
  if (result.error || result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
    throw new Error(
      "Unable to read private " + definition.name
      + ". Run 'gh auth login' with access to " + SOURCE_REPOSITORY
      + ", or supply --from-dir /path/to/private/checkout."
    );
  }
  let payload;
  try { payload = JSON.parse(result.stdout.toString("utf8")); }
  catch { throw new Error("Authenticated private Git blob response is not JSON: " + definition.name); }
  if (!payload || payload.sha !== definition.sha || payload.encoding !== "base64"
    || typeof payload.content !== "string") {
    throw new Error("Authenticated private Git blob response is invalid: " + definition.name);
  }
  return Buffer.from(payload.content.replace(/\s/g, ""), "base64");
}

function localOriginal(directory, definition) {
  const root = path.resolve(directory);
  const direct = path.join(root, definition.name);
  const checkedOut = path.join(root, "src", "server", "data", definition.name);
  const file = fs.existsSync(direct) ? direct : checkedOut;
  return fs.readFileSync(file);
}

function checkCatalogs(directory = DEFAULT_DESTINATION) {
  const result = [];
  for (const definition of CATALOGS) {
    const filename = path.join(directory, definition.name);
    if (!fs.existsSync(filename)) {
      throw new Error("Missing " + filename + ". Run npm run data:catalogs:restore first.");
    }
    result.push({ name: definition.name, ...validateCatalogBytes(fs.readFileSync(filename), definition) });
  }
  return result;
}

function restoreCatalogs(options = {}) {
  const destination = path.resolve(options.destination || DEFAULT_DESTINATION);
  const pending = [];
  const current = [];
  // Validate every source before changing any destination file.
  for (const definition of CATALOGS) {
    const filename = path.join(destination, definition.name);
    if (fs.existsSync(filename) && !options.force) {
      const status = validateCatalogBytes(fs.readFileSync(filename), definition);
      current.push({ name: definition.name, ...status, action: "retained" });
      continue;
    }
    const bytes = options.fromDir
      ? localOriginal(options.fromDir, definition)
      : downloadOriginal(definition, options.runner);
    const status = validateCatalogBytes(bytes, definition);
    if (status.gitBlobSha !== definition.sha) {
      throw new Error(
        "Private source " + definition.name + " no longer matches the audited original Git blob "
        + definition.sha + ". Inspect the changed source; do not silently import it."
      );
    }
    pending.push({ definition, filename, bytes, status });
  }

  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  const staged = [];
  try {
    for (const item of pending) {
      const stagedPath = item.filename + ".recover-" + crypto.randomBytes(8).toString("hex");
      fs.writeFileSync(stagedPath, item.bytes, { mode: 0o600, flag: "wx" });
      staged.push({ ...item, stagedPath });
    }
    for (const item of staged) {
      fs.renameSync(item.stagedPath, item.filename);
      current.push({ name: item.definition.name, ...item.status, action: "restored" });
    }
  } finally {
    for (const item of staged) {
      if (fs.existsSync(item.stagedPath)) fs.unlinkSync(item.stagedPath);
    }
  }
  return current;
}

function main(argv = process.argv.slice(2)) {
  const mode = argv[0];
  if (!["--check", "--restore"].includes(mode)) {
    throw new Error("Usage: node script/restore_market_catalogs.cjs --check | --restore [--from-dir PRIVATE_REPO] [--force]");
  }
  const fromDirIndex = argv.indexOf("--from-dir");
  if (fromDirIndex >= 0 && !argv[fromDirIndex + 1]) throw new Error("--from-dir needs a path");
  const fromDir = fromDirIndex < 0 ? null : argv[fromDirIndex + 1];
  const result = mode === "--check"
    ? checkCatalogs()
    : restoreCatalogs({ fromDir, force: argv.includes("--force") });
  for (const item of result) {
    console.log(item.name + ": " + item.count + " records; " + item.bytes
      + " bytes; git blob " + item.gitBlobSha + (item.action ? "; " + item.action : ""));
  }
  console.log("LiOS local market catalogs verified; source assets remain ignored by public Git.");
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    console.error("Market catalog recovery failed: " + (error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  }
}

module.exports = { SOURCE_REPOSITORY, CATALOGS, gitBlobSha, validateCatalogBytes, checkCatalogs, restoreCatalogs, main };
