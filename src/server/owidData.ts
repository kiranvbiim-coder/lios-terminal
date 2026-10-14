/**
 * Our World in Data (OWID) CO2 & emissions connector -- official, free, no
 * API key, no rate limit; the full dataset is published as a single CSV on
 * GitHub (https://github.com/owid/co2-data). Complements World Bank's
 * environment indicators with columns World Bank doesn't carry: per-capita
 * emissions, share of global emissions, and modeled warming contribution
 * (temperature_change_from_co2), all sourced from the Global Carbon Project.
 *
 * The CSV is ~14MB and covers every country/year since fossil-fuel records
 * begin -- fetched and cached to disk (24h TTL, it's an annual-cadence
 * dataset), then parsed into an in-memory per-process cache so repeated
 * requests don't re-parse ~50k rows each time.
 */
import fs from "fs";
import path from "path";
import { dataPath } from "./dataRoot";

const OWID_CSV_URL = "https://raw.githubusercontent.com/owid/co2-data/master/owid-co2-data.csv";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function cacheDir(): string {
  return dataPath("owid-cache");
}

function csvCachePath(): string {
  return path.join(cacheDir(), "owid-co2-data.csv");
}

function metaCachePath(): string {
  return path.join(cacheDir(), "meta.json");
}

export interface OwidRow {
  year: number;
  population: number | null;
  gdp: number | null;
  co2: number | null;              // annual CO2 emissions, Mt
  co2PerCapita: number | null;     // t/person
  co2PerGdp: number | null;        // kg per $ of GDP -- carbon intensity
  shareGlobalCo2: number | null;   // % of that year's global emissions
  tempChangeFromCo2: number | null; // modeled warming contribution, °C
}

export interface OwidCountry { iso3: string; name: string }

let parsedCache: Map<string, OwidRow[]> | null = null;
let countryNames: Map<string, string> | null = null;

async function ensureCsvOnDisk(): Promise<string | null> {
  const csvPath = csvCachePath();
  const meta = fs.existsSync(metaCachePath()) ? JSON.parse(fs.readFileSync(metaCachePath(), "utf8")) : null;
  if (fs.existsSync(csvPath) && meta && Date.now() - meta.fetchedAt < CACHE_TTL_MS) {
    return csvPath;
  }
  try {
    const res = await fetch(OWID_CSV_URL);
    if (!res.ok) throw new Error(`OWID CSV fetch returned ${res.status}`);
    const text = await res.text();
    if (!fs.existsSync(cacheDir())) fs.mkdirSync(cacheDir(), { recursive: true });
    fs.writeFileSync(csvPath, text);
    fs.writeFileSync(metaCachePath(), JSON.stringify({ fetchedAt: Date.now() }));
    return csvPath;
  } catch (err) {
    console.warn("OWID CSV fetch failed, falling back to cached copy on disk:", err instanceof Error ? err.message : err);
    return fs.existsSync(csvPath) ? csvPath : null;
  }
}

// Minimal CSV line splitter -- OWID's file has no quoted commas in the
// columns this module reads, so a plain split is safe and avoids pulling in
// a CSV parsing dependency for one file.
function parseCsv(text: string): Map<string, OwidRow[]> {
  const lines = text.split("\n");
  const header = lines[0].split(",");
  const idx = (col: string) => header.indexOf(col);
  const iCountry = idx("country"), iIso = idx("iso_code"), iYear = idx("year"),
    iPop = idx("population"), iGdp = idx("gdp"), iCo2 = idx("co2"),
    iCo2pc = idx("co2_per_capita"), iCo2pg = idx("co2_per_gdp"),
    iShare = idx("share_global_co2"), iTemp = idx("temperature_change_from_co2");

  const byCountry = new Map<string, OwidRow[]>();
  countryNames = new Map();

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const cols = line.split(",");
    const iso3 = cols[iIso];
    if (!iso3 || iso3.length !== 3) continue; // skip aggregate rows (e.g. "World", "Asia") which have no ISO3 code
    const name = cols[iCountry];
    const num = (s: string | undefined): number | null => (s === undefined || s === "" ? null : Number.isFinite(Number(s)) ? Number(s) : null);
    const row: OwidRow = {
      year: Number(cols[iYear]),
      population: num(cols[iPop]),
      gdp: num(cols[iGdp]),
      co2: num(cols[iCo2]),
      co2PerCapita: num(cols[iCo2pc]),
      co2PerGdp: num(cols[iCo2pg]),
      shareGlobalCo2: num(cols[iShare]),
      tempChangeFromCo2: num(cols[iTemp]),
    };
    if (!byCountry.has(iso3)) byCountry.set(iso3, []);
    byCountry.get(iso3)!.push(row);
    countryNames.set(iso3, name);
  }
  byCountry.forEach((rows) => rows.sort((a, b) => a.year - b.year));
  return byCountry;
}

async function ensureParsed(): Promise<void> {
  if (parsedCache) return;
  const csvPath = await ensureCsvOnDisk();
  if (!csvPath) { parsedCache = new Map(); countryNames = new Map(); return; }
  const text = fs.readFileSync(csvPath, "utf8");
  parsedCache = parseCsv(text);
}

// A representative set of major/regional economies -- same spirit as
// worldBankData.ts's WB_COUNTRIES, keeps comparison views readable against
// a dataset that technically covers 200+ countries.
export const OWID_COUNTRIES: OwidCountry[] = [
  { iso3: "USA", name: "United States" }, { iso3: "CHN", name: "China" }, { iso3: "IND", name: "India" },
  { iso3: "GBR", name: "United Kingdom" }, { iso3: "DEU", name: "Germany" }, { iso3: "JPN", name: "Japan" },
  { iso3: "BRA", name: "Brazil" }, { iso3: "ZAF", name: "South Africa" }, { iso3: "ARE", name: "UAE" },
  { iso3: "SGP", name: "Singapore" }, { iso3: "AUS", name: "Australia" }, { iso3: "FRA", name: "France" },
  { iso3: "CAN", name: "Canada" }, { iso3: "MEX", name: "Mexico" }, { iso3: "IDN", name: "Indonesia" },
  { iso3: "NGA", name: "Nigeria" }, { iso3: "SAU", name: "Saudi Arabia" }, { iso3: "KOR", name: "South Korea" },
];

export async function getOwidCountrySeries(iso3: string): Promise<{ country: string; iso3: string; history: OwidRow[]; isLive: boolean }> {
  await ensureParsed();
  const rows = parsedCache?.get(iso3.toUpperCase()) ?? [];
  const name = countryNames?.get(iso3.toUpperCase()) ?? OWID_COUNTRIES.find((c) => c.iso3 === iso3.toUpperCase())?.name ?? iso3;
  return { country: name, iso3: iso3.toUpperCase(), history: rows, isLive: rows.length > 0 };
}
