/**
 * EdgarTools pinned SEC URL-builder mechanics, adapted for the existing LiOS
 * P0/P7 SEC ingestion. Source: dgunning/edgartools@
 * 4e817de7bf3efae44024e168754e8f5d53b1a227 (MIT)
 * edgar/urls.py, blob 02e17b91ce1fb7e0affc6866d484da925e7ea4a2.
 *
 * LiOS tightens upstream's path string formatting: SEC-supplied accession and
 * directory filenames are untrusted, so path traversal, query, host and URL
 * control characters fail closed. No mirror override, provider runtime,
 * alternate SEC client, fetch, cache, source entitlement or filing parsing.
 */
const SEC_ARCHIVES = "https://www.sec.gov/Archives/edgar/data";
const SEC_DATA = "https://data.sec.gov";

export function normalizeSecCik(raw: string | number): { padded: string; numeric: string } {
  const value = typeof raw === "number"
    ? Number.isSafeInteger(raw) && raw > 0 ? String(raw) : ""
    : raw;
  if (!/^\d{1,10}$/.test(value) || !/[1-9]/.test(value)) {
    throw new Error("SEC CIK must be a positive identifier of at most 10 decimal digits.");
  }
  const numeric = String(Number(value));
  return { padded: value.padStart(10, "0"), numeric };
}

export function normalizeSecAccession(raw: string): { dashed: string; digits: string } {
  if (typeof raw !== "string" || !/^\d{10}-\d{2}-\d{6}$/.test(raw)) {
    throw new Error("SEC accession must have the canonical 10-2-6 numeric shape.");
  }
  return { dashed: raw, digits: raw.replace(/-/g, "") };
}

export function safeSecArchiveFileName(raw: string): boolean {
  return typeof raw === "string"
    && /^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/.test(raw)
    && !raw.includes("..");
}

export function buildSecSubmissionsUrl(cik: string | number): string {
  return `${SEC_DATA}/submissions/CIK${normalizeSecCik(cik).padded}.json`;
}

export function buildSecCompanyFactsUrl(cik: string | number): string {
  return `${SEC_DATA}/api/xbrl/companyfacts/CIK${normalizeSecCik(cik).padded}.json`;
}

export function buildSecFilingArchiveUrl(cik: string | number, accession: string, fileName: string): string {
  const company = normalizeSecCik(cik);
  const filing = normalizeSecAccession(accession);
  if (!safeSecArchiveFileName(fileName)) {
    throw new Error("SEC archive filename cannot contain traversal, URL controls or path separators.");
  }
  return `${SEC_ARCHIVES}/${company.numeric}/${filing.digits}/${fileName}`;
}

export function buildSecFilingIndexUrl(cik: string | number, accession: string): string {
  const id = normalizeSecAccession(accession);
  return buildSecFilingArchiveUrl(cik, accession, `${id.dashed}-index.htm`);
}
