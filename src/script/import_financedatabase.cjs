"use strict";
/**
 * Optional P5 data import from the MIT-licensed FinanceDatabase project's
 * CSV reference catalog. Donor DATA is never committed or bundled by LiOS.
 * Source: https://github.com/JerBouma/FinanceDatabase
 * The output is provisional instrument discovery, not price coverage.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { resolveDataRoot } = require("../dataRootCore.cjs");

const SOURCE_REPO = "https://github.com/JerBouma/FinanceDatabase.git";
const DONOR_LICENSE_NOTICE = [
  "MIT License",
  "Copyright (c) 2023 Jeroen Bouma",
  "Permission is hereby granted, free of charge, to any person obtaining a copy",
  'of this software and associated documentation files (the "Software"), to deal',
  "in the Software without restriction, including without limitation the rights",
  "to use, copy, modify, merge, publish, distribute, sublicense, and/or sell",
  "copies of the Software, and to permit persons to whom the Software is",
  "furnished to do so, subject to the following conditions:",
  "The above copyright notice and this permission notice shall be included in all",
  "copies or substantial portions of the Software.",
  'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR',
  "IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,",
  "FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE",
  "AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER",
  "LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,",
  "OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE",
  "SOFTWARE.",
].join("\n");
const PINNED_COMMIT = "3815eb341c7aa7bfae4a720744093e75528b6099";
const SUPPORTED = new Set(["equities", "etfs", "funds", "indices", "cryptos", "currencies", "moneymarkets"]);
const DEFAULT_CATEGORIES = [...SUPPORTED];

function parseCsv(text) {
  // RFC 4180 quoting, escaped quotes and multiline fields; fail closed on
  // unfinished quoted records rather than treating their fragments as tickers.
  const rows = [];
  let row = [], field = "", quoted = false, afterQuote = false;
  const finishField = () => { row.push(field); field = ""; afterQuote = false; };
  const finishRow = () => { finishField(); if (row.some(v => v.length)) rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; afterQuote = true; }
      } else field += c;
      continue;
    }
    if (c === '"' && field === "" && !afterQuote) { quoted = true; continue; }
    if (c === ",") { finishField(); continue; }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      finishRow(); continue;
    }
    if (afterQuote) {
      if (c !== " " && c !== "\t") throw new Error("Invalid trailing CSV quoted-field content");
    } else if (c === '"') throw new Error("Invalid unescaped CSV quote");
    else field += c;
  }
  if (quoted) throw new Error("Unterminated quoted CSV field");
  if (row.length || field.length || afterQuote) finishRow();
  return rows;
}

function catalogFiles(database, category) {
  const directory = path.join(database, category);
  if (fs.existsSync(directory)) {
    if (!fs.lstatSync(directory).isDirectory()) throw new Error("Invalid donor category directory");
    return fs.readdirSync(directory).sort().filter(n => n.toLowerCase().endsWith(".csv"))
      .map(n => path.join(directory, n));
  }
  const single = path.join(database, category + ".csv");
  return fs.existsSync(single) ? [single] : [];
}

function optional(row, key) {
  const value = row[key];
  return typeof value === "string" && value.trim() && !/^(?:nan|none|null)$/i.test(value.trim()) ? value.trim() : null;
}

function normalizeRow(row, category) {
  const symbol = optional(row, "symbol") || optional(row, "ticker");
  const name = optional(row, "name");
  if (!symbol || !name || /^FILE CREATION TIME:/i.test(symbol)) return null;
  const exchange = optional(row, "exchange");
  const mic = optional(row, "mic") || optional(row, "mic_code");
  const country = optional(row, "country");
  const currency = optional(row, "currency");
  const isin = optional(row, "isin");
  const figi = optional(row, "figi");
  const compositeFigi = optional(row, "composite_figi");
  const shareClassFigi = optional(row, "shareclass_figi") || optional(row, "share_class_figi");
  const cusip = optional(row, "cusip");
  const delisted = optional(row, "delisted");
  return {
    symbol, name,
    exchange: exchange || null,
    mic: mic || null,
    countryCode: country && /^[A-Z]{2}$/i.test(country) ? country.toUpperCase() : null,
    currency: currency && /^[A-Z]{3}$/i.test(currency) ? currency.toUpperCase() : null,
    provider: "financedatabase",
    active: delisted ? !/^(true|1|yes)$/i.test(delisted) : true,
    assetClass: category,
    // Keep real donor classification for future screening/coverage metadata.
    // A market-cap TIER is never treated as a numeric market-cap amount.
    sector: optional(row, "sector"),
    industry: optional(row, "industry"),
    market: optional(row, "market"),
    countryName: country || null,
    marketCapTier: optional(row, "market_cap"),
    category: optional(row, "category"),
    categoryGroup: optional(row, "category_group"),
    industryGroup: optional(row, "industry_group"),
    cryptocurrency: optional(row, "cryptocurrency"),
    baseCurrency: optional(row, "base_currency"),
    quoteCurrency: optional(row, "quote_currency"),
    family: optional(row, "family"),
    ...(isin && /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/i.test(isin) ? { isin: isin.toUpperCase() } : {}),
    ...(cusip && /^[A-Z0-9]{9}$/i.test(cusip) ? { cusip: cusip.toUpperCase() } : {}),
    ...(figi && /^[A-Z0-9]{12}$/i.test(figi) ? { figi: figi.toUpperCase() } : {}),
    ...(compositeFigi && /^[A-Z0-9]{12}$/i.test(compositeFigi) ? { compositeFigi: compositeFigi.toUpperCase() } : {}),
    ...(shareClassFigi && /^[A-Z0-9]{12}$/i.test(shareClassFigi) ? { shareClassFigi: shareClassFigi.toUpperCase() } : {}),
  };
}

const YIELD_EVERY_ROWS = 4000;
const HASH_CHUNK_BYTES = 16 * 1024 * 1024;
const SERIALIZE_CHUNK_ROWS = 5000;

/** Run a cooperative step generator to completion with no event-loop yielding (CLI, tests). */
function drive(generator) {
  let step = generator.next();
  while (!step.done) step = generator.next();
  return step.value;
}

/**
 * Run the same generator while returning to the event loop at every `yield`,
 * so a ~300k-row import never freezes the local server (status polling,
 * search and every other request keep being served). `onStage` receives the
 * plain stage objects the generator yields.
 */
async function driveAsync(generator, onStage) {
  let step = generator.next();
  while (!step.done) {
    if (onStage && step.value) onStage(step.value);
    await new Promise(resolve => setImmediate(resolve));
    step = generator.next();
  }
  return step.value;
}

function* importDatabaseSteps(database, categories = DEFAULT_CATEGORIES, minimum = 100000) {
  const rows = [], seen = new Set(), byCategory = {}, files = [];
  let raw = 0, skipped = 0, duplicates = 0;
  for (const category of categories) {
    if (!SUPPORTED.has(category)) throw new Error("Unsupported FinanceDatabase category: " + category);
    const paths = catalogFiles(database, category);
    if (!paths.length) throw new Error("No CSV files for category " + category);
    let accepted = 0;
    for (const file of paths) {
      yield { stage: "read", category, rows: rows.length };
      const info = fs.lstatSync(file);
      if (!info.isFile()) throw new Error("Refusing nonregular donor source file");
      if (info.size > 128 * 1024 * 1024) throw new Error("Oversized donor CSV: " + path.basename(file));
      const bytes = fs.readFileSync(file);
      if (bytes.length > 128 * 1024 * 1024) throw new Error("Oversized donor CSV: " + path.basename(file));
      const records = parseCsv(bytes.toString("utf8").replace(/^\uFEFF/, ""));
      if (!records.length) throw new Error("Missing donor CSV header: " + path.basename(file));
      const header = records.shift().map(x => x.trim().toLowerCase());
      if (!header.includes("symbol") || !header.includes("name")) throw new Error("Donor CSV schema changed: " + path.basename(file));
      let sinceYield = 0;
      for (const cells of records) {
        if (cells.length !== header.length) throw new Error("Malformed CSV width: " + path.basename(file));
        raw++;
        const input = Object.fromEntries(header.map((column, i) => [column, cells[i]]));
        const candidate = normalizeRow(input, category);
        if (!candidate) { skipped++; }
        else {
          const key = [category, candidate.symbol.toUpperCase(), (candidate.mic || candidate.exchange || "").toUpperCase(), (candidate.currency || "").toUpperCase()].join("|");
          if (seen.has(key)) duplicates++;
          else { seen.add(key); rows.push(candidate); accepted++; }
        }
        if (++sinceYield >= YIELD_EVERY_ROWS) { sinceYield = 0; yield { stage: "read", category, rows: rows.length }; }
      }
      files.push({ path: path.relative(database, file).replace(/\\/g, "/"), sha256: crypto.createHash("sha256").update(bytes).digest("hex") });
    }
    if (accepted === 0) throw new Error("No valid identities in donor category: " + category);
    byCategory[category] = accepted;
  }
  if (rows.length < minimum) throw new Error("Import below required verified listing threshold: " + rows.length + " < " + minimum);
  return { rows, stats: { raw, accepted: rows.length, duplicates, skipped, byCategory, files } };
}

function importDatabase(database, categories = DEFAULT_CATEGORIES, minimum = 100000) {
  return drive(importDatabaseSteps(database, categories, minimum));
}

function writeAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = file + "." + crypto.randomBytes(8).toString("hex") + ".tmp";
  try {
    fs.writeFileSync(tmp, Buffer.isBuffer(value) ? value : JSON.stringify(value), { mode: 0o600, flag: "wx" });
    fs.renameSync(tmp, file);
  } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}

/** Keep last known snapshot recoverable after an upstream schema/quality change. */
function backupPair(catalog, manifest) {
  if (fs.existsSync(catalog) && fs.existsSync(manifest)) {
    const tempCatalog = catalog + ".previous.new";
    const tempManifest = manifest + ".previous.new";
    try {
      fs.copyFileSync(catalog, tempCatalog);
      fs.copyFileSync(manifest, tempManifest);
      fs.renameSync(tempCatalog, catalog + ".previous");
      fs.renameSync(tempManifest, manifest + ".previous");
    } finally {
      for (const f of [tempCatalog, tempManifest]) if (fs.existsSync(f)) fs.unlinkSync(f);
    }
  }
}

function* verifyInstalledSteps(dest, knownRows = null) {
  const catalog = path.join(dest, "financedatabase_universe.json");
  const manifestFile = path.join(dest, "financedatabase_manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  // Always hash the bytes actually on disk. `knownRows` (the rows this very
  // process just serialised and validated) only lets the install path skip
  // re-parsing 150 MB of JSON on the server's event loop; a standalone
  // --verify still parses the stored file.
  yield { stage: "check" };
  const bytes = fs.readFileSync(catalog);
  const digest = crypto.createHash("sha256");
  for (let offset = 0; offset < bytes.length; offset += HASH_CHUNK_BYTES) {
    digest.update(bytes.subarray(offset, Math.min(bytes.length, offset + HASH_CHUNK_BYTES)));
    yield { stage: "check" };
  }
  const hash = digest.digest("hex");
  if (!manifest.catalogSha256 || manifest.catalogSha256 !== hash) throw new Error("Catalog SHA256 does not match manifest");
  const rows = knownRows ?? JSON.parse(bytes.toString("utf8"));
  if (!Array.isArray(rows) || rows.length !== manifest.accepted) throw new Error("Imported row count mismatch");
  const counter = {}, keys = new Set();
  let sinceYield = 0;
  for (const r of rows) {
    if (r.provider !== "financedatabase" || !r.symbol || !r.name || !SUPPORTED.has(r.assetClass)) {
      throw new Error("Invalid imported identity row");
    }
    const key = [r.assetClass, r.symbol.toUpperCase(), (r.mic || r.exchange || "").toUpperCase(),
      (r.currency || "").toUpperCase()].join("|");
    if (keys.has(key)) throw new Error("Duplicate venue-qualified imported listing key");
    keys.add(key);
    counter[r.assetClass] = (counter[r.assetClass] || 0) + 1;
    if (++sinceYield >= YIELD_EVERY_ROWS * 4) { sinceYield = 0; yield { stage: "check" }; }
  }
  for (const [assetClass, count] of Object.entries(manifest.byCategory)) {
    if (counter[assetClass] !== count) throw new Error("Manifest category count mismatch: " + assetClass);
  }
  return { verified: true, importedAt: manifest.importedAt, upstreamCommit: manifest.upstreamCommit,
    count: rows.length, byCategory: counter, sha256: hash };
}

function verifyInstalled(dest) {
  return drive(verifyInstalledSteps(dest));
}

/** A JSON array identical to JSON.stringify(rows), built in slices so no single call freezes the event loop. */
function* serializeRowsSteps(rows) {
  const parts = [Buffer.from("[")];
  for (let i = 0; i < rows.length; i += SERIALIZE_CHUNK_ROWS) {
    const body = JSON.stringify(rows.slice(i, i + SERIALIZE_CHUNK_ROWS));
    parts.push(Buffer.from((i ? "," : "") + body.slice(1, -1)));
    yield { stage: "write", rows: i };
  }
  parts.push(Buffer.from("]"));
  return Buffer.concat(parts);
}

/** Refuse early, with a plain message, when the destination volume cannot hold the snapshot plus its previous copy. */
function assertFreeSpace(directory, requiredBytes) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  let free = Infinity;
  try {
    const stats = fs.statfsSync(directory);
    free = Number(stats.bavail) * Number(stats.bsize);
  } catch { /* A filesystem that cannot report free space is attempted anyway; a real ENOSPC is handled by the restore path. */ }
  if (free < requiredBytes) {
    const error = new Error("Not enough free disk space: about " + Math.ceil(requiredBytes / 1048576) +
      " MB needed, " + Math.floor(free / 1048576) + " MB available");
    error.code = "ENOSPC";
    throw error;
  }
}

function rollback(dest) {
  const catalog = path.join(dest, "financedatabase_universe.json");
  const manifest = path.join(dest, "financedatabase_manifest.json");
  if (!fs.existsSync(catalog + ".previous") || !fs.existsSync(manifest + ".previous")) {
    throw new Error("No previous FinanceDatabase catalog version available for rollback");
  }
  const oldBytes = fs.readFileSync(catalog + ".previous");
  const oldManifest = JSON.parse(fs.readFileSync(manifest + ".previous", "utf8"));
  if (crypto.createHash("sha256").update(oldBytes).digest("hex") !== oldManifest.catalogSha256) {
    throw new Error("Previous catalog integrity check failed");
  }
  const rows = JSON.parse(oldBytes.toString("utf8"));
  if (!Array.isArray(rows) || rows.length !== oldManifest.accepted) throw new Error("Previous catalog count mismatch");
  writeAtomic(catalog, oldBytes);
  writeAtomic(manifest, oldManifest);
  return verifyInstalled(dest);
}

/**
 * Replace the installed snapshot. The previous verified pair is kept; if any
 * step fails (disk full, interrupted write, failed verification) the previous
 * pair is restored — or the half-written files removed on a first install — so
 * a failed update can never leave a catalog/manifest pair that disagrees.
 */
function* publishSnapshotSteps(dest, rows, catalogBytes, manifest) {
  const catalog = path.join(dest, "financedatabase_universe.json");
  const manifestPath = path.join(dest, "financedatabase_manifest.json");
  assertFreeSpace(dest, catalogBytes.length * 2 + 32 * 1048576);
  const hadCurrent = fs.existsSync(catalog) && fs.existsSync(manifestPath);
  let replaced = false;
  try {
    yield { stage: "write", rows: rows.length };
    backupPair(catalog, manifestPath);
    replaced = true;
    writeAtomic(catalog, catalogBytes);
    yield { stage: "write", rows: rows.length };
    writeAtomic(manifestPath, manifest);
    return yield* verifyInstalledSteps(dest, rows);
  } catch (error) {
    if (replaced) {
      try {
        if (hadCurrent) rollback(dest);
        else for (const f of [catalog, manifestPath]) fs.rmSync(f, { force: true });
      } catch (restoreError) {
        error.message += " (previous catalog could not be restored: " + restoreError.message + ")";
      }
    }
    throw error;
  }
}

function openDonorCheckout() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-financedatabase-"));
  const checkout = path.join(root, "source");
  try {
    execFileSync("git", ["clone", "--filter=blob:none", "--no-checkout", "--depth=1", SOURCE_REPO, checkout], { timeout: 180000, stdio: "pipe" });
    execFileSync("git", ["-C", checkout, "fetch", "--depth=1", "origin", PINNED_COMMIT], { timeout: 180000, stdio: "pipe" });
    // Enable sparse checkout before materializing files: do not expand the
    // entire donor (hundreds of thousands of rows) into the temporary tree.
    execFileSync("git", ["-C", checkout, "sparse-checkout", "set", "database"], { timeout: 180000, stdio: "pipe" });
    execFileSync("git", ["-C", checkout, "checkout", "--detach", PINNED_COMMIT], { timeout: 180000, stdio: "pipe" });
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true });
    throw error;
  }
  return { checkout, commit: PINNED_COMMIT, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

/** Parse CLI-style options (shared by the sync CLI and the server's async install). */
function parseRunArguments(argv) {
  let sourceDir = null, sourceCommit = null, categories = DEFAULT_CATEGORIES, minimum = 300000;
  let dest = path.join(resolveDataRoot({ cwd: path.resolve(__dirname, "..") }).root, "instrument-catalogs");
  const destIndex = argv.indexOf("--dest");
  if (destIndex >= 0) {
    if (!argv[destIndex + 1]) throw new Error("--dest requires a directory");
    dest = path.resolve(argv[destIndex + 1]);
    argv = argv.filter((_, i) => i !== destIndex && i !== destIndex + 1);
  }
  if (argv.length === 1 && argv[0] === "--verify") return { mode: "verify", dest };
  if (argv.length === 1 && argv[0] === "--rollback") return { mode: "rollback", dest };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--from-dir") sourceDir = path.resolve(argv[++i] || "");
    else if (arg === "--source-commit") sourceCommit = argv[++i] || "";
    else if (arg === "--categories") categories = (argv[++i] || "").split(",").filter(Boolean);
    else if (arg === "--min") minimum = Number(argv[++i]);
    else if (arg === "--all") categories = DEFAULT_CATEGORIES;
    else throw new Error("Unknown option " + arg);
  }
  if (!Number.isSafeInteger(minimum) || minimum < 1 || !categories.length) throw new Error("Invalid import threshold or categories");
  return { mode: "import", dest, sourceDir, sourceCommit, categories, minimum };
}

function* importFromDirectorySteps(root, commit, options) {
  const { dest, categories, minimum } = options;
  const directory = path.join(root, "database");
  if (!fs.existsSync(directory)) throw new Error("FinanceDatabase /database directory missing");
  const { rows, stats } = yield* importDatabaseSteps(directory, categories, minimum);
  // Catalog snapshots stay in the user-owned root (never server/data).
  yield { stage: "write", rows: 0 };
  const catalogBytes = yield* serializeRowsSteps(rows);
  const catalogSha256 = crypto.createHash("sha256").update(catalogBytes).digest("hex");
  const manifest = {
    provider: "JerBouma/FinanceDatabase", upstreamCommit: commit,
    importedAt: new Date().toISOString(), categories, ...stats, catalogSha256,
    license: "MIT", donorCopyright: "Copyright (c) 2023 Jeroen Bouma",
    licenseNotice: DONOR_LICENSE_NOTICE,
    licenseSource: "https://github.com/JerBouma/FinanceDatabase/blob/" + PINNED_COMMIT + "/LICENSE",
    note: "Reference identities only; not a real-time data or redistribution entitlement.",
  };
  const verified = yield* publishSnapshotSteps(dest, rows, catalogBytes, manifest);
  return { destination: dest, verified, stats };
}

/** The whole run as one cooperative step generator; `log` receives the final CLI report. */
function* runSteps(argv, log) {
  const options = parseRunArguments(argv);
  if (options.mode === "verify") {
    const report = verifyInstalled(options.dest);
    log?.(report);
    return report;
  }
  if (options.mode === "rollback") {
    const report = rollback(options.dest);
    log?.({ rolledBack: true, ...report });
    return report;
  }
  let root = options.sourceDir, commit, cleanup = null;
  if (options.sourceDir) {
    commit = options.sourceCommit && /^[a-f0-9]{40}$/i.test(options.sourceCommit) ? options.sourceCommit : "local-unverified";
    if (commit === "local-unverified") {
      try { commit = execFileSync("git", ["-C", options.sourceDir, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore","pipe","ignore"] }).trim(); }
      catch { /* A local CSV copy does not have verifiable git provenance. */ }
    }
  } else {
    const donor = openDonorCheckout();
    root = donor.checkout; commit = donor.commit; cleanup = donor.cleanup;
  }
  try {
    const { destination, verified, stats } = yield* importFromDirectorySteps(root, commit, options);
    log?.({ destination, ...verified, ...stats, files: stats.files.length });
    return verified;
  } finally { cleanup?.(); }
}

const printReport = report => console.log(JSON.stringify(report, null, 2));

function run(argv = process.argv.slice(2)) {
  return drive(runSteps(argv, printReport));
}

/** Same import as `run`, yielding to the event loop; `onStage({stage, category?, rows?})` reports progress. */
function runAsync(argv, onStage) {
  return driveAsync(runSteps(argv), onStage);
}

if (require.main === module) {
  try { run(); }
  catch (e) { console.error("LiOS FinanceDatabase import failed:", e.message); process.exitCode = 1; }
}
module.exports = { parseCsv, normalizeRow, importDatabase, run, runAsync, catalogFiles, verifyInstalled, rollback, assertFreeSpace };
