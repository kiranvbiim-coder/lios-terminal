"use strict";
/**
 * Restore previously obtained LiOS instrument snapshots from a local directory into this checkout.
 * The public repository must never commit these assets.
 *
 *   node script/recover_instrument_catalogs.cjs --restore --from-dir /absolute/path/to/checkout-with-src/server/data
 *   node script/recover_instrument_catalogs.cjs --verify
 *
 * No network access is performed and no credentials are accepted.
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.resolve(__dirname, "..");
const CATALOGS = Object.freeze([
  { name: "tickers.json", blob: "f9edacb9d8dc04485b868ab9ee44638fbbcf416d", bytes: 11882813, kind: "array", minEntries: 10000 },
  { name: "provider_ingested_universe.json", blob: "8b9e82b4143d453a0d0c8e7804820cf7a778cd43", bytes: 2745198, kind: "array", minEntries: 1000 },
  { name: "crypto_coingecko_ids.json", blob: "ca29d5000a89a7382309d667800e495010662662", bytes: 828135, kind: "map", minEntries: 1000 },
]);

function gitBlobDigest(buffer) {
  return crypto.createHash("sha1").update("blob " + buffer.length + "\0").update(buffer).digest("hex");
}
function locate(root, name) {
  return path.join(root, "src", "server", "data", name);
}
function ensureRegularFile(file) {
  const info = fs.lstatSync(file);
  if (!info.isFile()) throw new Error("Catalog source is not a regular file: " + file);
  return info;
}
function validateCatalog(file, spec) {
  const info = ensureRegularFile(file);
  if (info.size !== spec.bytes) {
    throw new Error(spec.name + ": size mismatch; expected " + spec.bytes + ", got " + info.size);
  }
  const bytes = fs.readFileSync(file);
  const digest = gitBlobDigest(bytes);
  if (digest !== spec.blob) {
    throw new Error(spec.name + ": source blob hash does not match pinned snapshot");
  }
  const parsed = JSON.parse(bytes.toString("utf8"));
  const validCollection = spec.kind === "array"
    ? Array.isArray(parsed)
    : parsed !== null && !Array.isArray(parsed) && typeof parsed === "object";
  if (!validCollection) throw new Error(spec.name + ": unexpected JSON shape");
  const count = spec.kind === "array" ? parsed.length : Object.keys(parsed).length;
  if (count < spec.minEntries) throw new Error(spec.name + ": insufficient catalog records (" + count + ")");
  if (spec.kind === "array" && !parsed.every((row) => {
    if (!row || typeof row.symbol !== "string" || !row.symbol.trim()
        || typeof row.name !== "string") return false;
    if (row.name.trim()) return true;
    // The historical Nasdaq file contains one non-instrument timestamp record.
    // Keep the pinned source byte-for-byte; exclude it from search separately.
    return spec.name === "tickers.json" && /^FILE CREATION TIME:/.test(row.symbol);
  })) {
    throw new Error(spec.name + ": invalid symbol or name record");
  }
  if (spec.kind === "map" && !Object.values(parsed).every((row) => row && typeof row.id === "string" && row.id.trim())) {
    throw new Error(spec.name + ": invalid CoinGecko provider ID");
  }
  return { name: spec.name, records: count, bytes: bytes.length, gitBlobSha: digest };
}
function verifyDirectory(root, specs = CATALOGS) {
  return specs.map((spec) => validateCatalog(locate(root, spec.name), spec));
}
function recoverDirectory(privateRoot, destinationRoot, specs = CATALOGS) {
  const all = verifyDirectory(privateRoot, specs); // Fully verify source before writing anything.
  const targetDir = path.dirname(locate(destinationRoot, specs[0].name));
  fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 });
  for (const spec of specs) {
    const source = locate(privateRoot, spec.name);
    const destination = locate(destinationRoot, spec.name);
    if (fs.existsSync(destination)) {
      validateCatalog(destination, spec); // Never silently overwrite local data.
      continue;
    }
    const temp = path.join(targetDir, "." + spec.name + "." + process.pid + ".tmp");
    try {
      fs.writeFileSync(temp, fs.readFileSync(source), { flag: "wx", mode: 0o600 });
      validateCatalog(temp, spec);
      try {
        fs.linkSync(temp, destination); // Atomic no-replace publication.
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        validateCatalog(destination, spec);
      }
      validateCatalog(destination, spec);
    } finally {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
  }
  return all;
}
function run(argv = process.argv.slice(2)) {
  const restore = argv.includes("--restore");
  const verify = argv.includes("--verify");
  const sourceAt = argv.indexOf("--from-dir");
  const valid = (restore !== verify)
    && (verify ? sourceAt === -1 : Boolean(argv[sourceAt + 1]));
  if (!valid) throw new Error("Usage: --verify OR --restore --from-dir ABSOLUTE_SNAPSHOT_CHECKOUT_PATH");
  const allowed = new Set(["--verify", "--restore", "--from-dir"]);
  if (sourceAt !== -1) allowed.add(argv[sourceAt + 1]);
  if (argv.some((a) => !allowed.has(a))) throw new Error("Unrecognized catalog recovery argument.");
  let verified;
  if (restore) {
    verified = recoverDirectory(path.resolve(argv[sourceAt + 1]), ROOT);
  } else verified = verifyDirectory(ROOT);
  console.log(JSON.stringify({ ok: true, operation: restore ? "restored" : "verified",
    catalogs: verified }, null, 2));
  return verified;
}
if (require.main === module) {
  try { run(); }
  catch (error) {
    console.error("LiOS instrument catalog recovery gate failed: " + (error instanceof Error ? error.message : error));
    console.error("Restore from a local snapshot with: node script/recover_instrument_catalogs.cjs --restore --from-dir /absolute/path");
    process.exitCode = 1;
  }
}
module.exports = { CATALOGS, gitBlobDigest, validateCatalog, verifyDirectory, recoverDirectory, run };
