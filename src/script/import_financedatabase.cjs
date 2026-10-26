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

function importDatabase(database, categories = DEFAULT_CATEGORIES, minimum = 100000) {
  const rows = [], seen = new Set(), byCategory = {}, files = [];
  let raw = 0, skipped = 0, duplicates = 0;
  for (const category of categories) {
    if (!SUPPORTED.has(category)) throw new Error("Unsupported FinanceDatabase category: " + category);
    const paths = catalogFiles(database, category);
    if (!paths.length) throw new Error("No CSV files for category " + category);
    let accepted = 0;
    for (const file of paths) {
      if (fs.lstatSync(file).isSymbolicLink()) throw new Error("Refusing linked donor source file");
      const bytes = fs.readFileSync(file);
      if (bytes.length > 128 * 1024 * 1024) throw new Error("Oversized donor CSV: " + path.basename(file));
      const records = parseCsv(bytes.toString("utf8").replace(/^\uFEFF/, ""));
      if (records.length < 2) throw new Error("Empty donor CSV: " + path.basename(file));
      const header = records.shift().map(x => x.trim().toLowerCase());
      if (!header.includes("symbol") || !header.includes("name")) throw new Error("Donor CSV schema changed: " + path.basename(file));
      for (const cells of records) {
        if (cells.length !== header.length) throw new Error("Malformed CSV width: " + path.basename(file));
        raw++;
        const input = Object.fromEntries(header.map((column, i) => [column, cells[i]]));
        const candidate = normalizeRow(input, category);
        if (!candidate) { skipped++; continue; }
        const key = [category, candidate.symbol.toUpperCase(), (candidate.mic || candidate.exchange || "").toUpperCase(), (candidate.currency || "").toUpperCase()].join("|");
        if (seen.has(key)) { duplicates++; continue; }
        seen.add(key); rows.push(candidate); accepted++;
      }
      files.push({ path: path.relative(database, file).replace(/\\/g, "/"), sha256: crypto.createHash("sha256").update(bytes).digest("hex") });
    }
    byCategory[category] = accepted;
  }
  if (rows.length < minimum) throw new Error("Import below required verified listing threshold: " + rows.length + " < " + minimum);
  return { rows, stats: { raw, accepted: rows.length, duplicates, skipped, byCategory, files } };
}

function writeAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = file + "." + crypto.randomBytes(8).toString("hex") + ".tmp";
  try {
    fs.writeFileSync(tmp, JSON.stringify(value), { mode: 0o600, flag: "wx" });
    fs.renameSync(tmp, file);
  } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}

function withDonorCheckout(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-financedatabase-"));
  const checkout = path.join(root, "source");
  try {
    execFileSync("git", ["clone", "--filter=blob:none", "--no-checkout", "--depth=1", SOURCE_REPO, checkout], { timeout: 180000, stdio: "pipe" });
    execFileSync("git", ["-C", checkout, "fetch", "--depth=1", "origin", PINNED_COMMIT], { timeout: 180000, stdio: "pipe" });
    // Enable sparse checkout before materializing files: do not expand the
    // entire donor (hundreds of thousands of rows) into the temporary tree.
    execFileSync("git", ["-C", checkout, "sparse-checkout", "set", "database"], { timeout: 180000, stdio: "pipe" });
    execFileSync("git", ["-C", checkout, "checkout", "--detach", PINNED_COMMIT], { timeout: 180000, stdio: "pipe" });
    return callback(checkout, PINNED_COMMIT);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function run(argv = process.argv.slice(2)) {
  let sourceDir = null, categories = DEFAULT_CATEGORIES, minimum = 300000;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--from-dir") sourceDir = path.resolve(argv[++i] || "");
    else if (arg === "--categories") categories = (argv[++i] || "").split(",").filter(Boolean);
    else if (arg === "--min") minimum = Number(argv[++i]);
    else if (arg === "--all") categories = DEFAULT_CATEGORIES;
    else throw new Error("Unknown option " + arg);
  }
  if (!Number.isSafeInteger(minimum) || minimum < 1 || !categories.length) throw new Error("Invalid import threshold or categories");
  const act = (root, commit) => {
    const directory = path.join(root, "database");
    if (!fs.existsSync(directory)) throw new Error("FinanceDatabase /database directory missing");
    const { rows, stats } = importDatabase(directory, categories, minimum);
    const dest = path.join(resolveDataRoot({ cwd: path.resolve(__dirname, "..") }).root, "instrument-catalogs");
    // User-owned LiOS Data Root is excluded from extraResources; never place
    // downloaded data in packaged server/data or the public repository.
    writeAtomic(path.join(dest, "financedatabase_universe.json"), rows);
    writeAtomic(path.join(dest, "financedatabase_manifest.json"), {
      provider: "JerBouma/FinanceDatabase", upstreamCommit: commit,
      importedAt: new Date().toISOString(), categories, ...stats,
      note: "Provisional catalog identities; does not confer live prices, entitlement, or redistribution rights.",
    });
    console.log(JSON.stringify({ destination: dest, upstreamCommit: commit, ...stats, files: stats.files.length }, null, 2));
    return stats;
  };
  if (sourceDir) {
    let commit = "local-unverified";
    try { commit = execFileSync("git", ["-C", sourceDir, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore","pipe","ignore"] }).trim(); }
    catch { /* A local CSV copy does not have verifiable git provenance. */ }
    return act(sourceDir, commit);
  }
  return withDonorCheckout(act);
}
if (require.main === module) {
  try { run(); }
  catch (e) { console.error("LiOS FinanceDatabase import failed:", e.message); process.exitCode = 1; }
}
module.exports = { parseCsv, normalizeRow, importDatabase, run, catalogFiles };
