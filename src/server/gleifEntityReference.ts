/**
 * GLEIF / Global LEI Index on-demand public legal-entity reference adapter.
 *
 * Source: https://www.gleif.org/en/lei-data/gleif-api
 * LEI reference data: CC0; GLEIF API use remains subject to fair-access terms.
 * P5 exclusively owns instrument/entity identity. This adapter never writes
 * to P5, never maps names to tickers, and never claims a legal entity trades.
 * No external dependencies, API key, central LiOS compute, or bulk download.
 */
const BASE = "https://api.gleif.org/api/v1/lei-records";
const MAX_RESULTS = 8;
const MAX_RESPONSE_BYTES = 512 * 1024;

export type GleifQuery = { lei: string; name?: never } | { lei?: never; name: string };
export interface GleifLegalEntity {
  lei: string;
  legalName: string;
  jurisdiction: string | null;
  legalAddressCountry: string | null;
  entityStatus: string | null;
  registrationStatus: string | null;
  lastUpdate: string | null;
  sourceUrl: string;
  canonical: false;
  referenceOnly: true;
  tradability: "not_established";
}
export interface GleifLookupResult {
  status: "found" | "candidates" | "not_found";
  query: { lei?: string; name?: string };
  source: "GLEIF Global LEI Index";
  license: "CC0-1.0";
  retrievedAt: string;
  records: GleifLegalEntity[];
  note: string;
}
export class GleifApiError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

/** ISO 17442 LEIs use the mod-97 check on the expanded base-36 string. */
export function isValidLei(input: string): boolean {
  const lei = input.trim().toUpperCase();
  if (!/^[0-9A-Z]{18}[0-9]{2}$/.test(lei)) return false;
  let mod = 0;
  for (const c of lei) {
    const num = c >= "A" ? String(c.charCodeAt(0) - 55) : c;
    for (const digit of num) mod = (mod * 10 + Number(digit)) % 97;
  }
  return mod === 1;
}

function normalizeRecord(raw: unknown): GleifLegalEntity | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const attrs = record.attributes;
  if (!attrs || typeof attrs !== "object" || Array.isArray(attrs)) return null;
  const a = attrs as Record<string, unknown>;
  const entity = a.entity && typeof a.entity === "object" && !Array.isArray(a.entity)
    ? a.entity as Record<string, unknown> : {};
  const registration = a.registration && typeof a.registration === "object" && !Array.isArray(a.registration)
    ? a.registration as Record<string, unknown> : {};
  const nameObj = entity.legalName && typeof entity.legalName === "object" && !Array.isArray(entity.legalName)
    ? entity.legalName as Record<string, unknown> : {};
  const address = entity.legalAddress && typeof entity.legalAddress === "object" && !Array.isArray(entity.legalAddress)
    ? entity.legalAddress as Record<string, unknown> : {};
  const v = (input: unknown) => typeof input === "string" && input.trim() ? input.trim() : null;
  const lei = (v(record.id) ?? v(a.lei) ?? "").toUpperCase();
  const legalName = v(nameObj.name);
  if (!isValidLei(lei) || !legalName) return null;
  return {
    lei, legalName,
    jurisdiction: v(entity.jurisdiction),
    legalAddressCountry: v(address.country),
    entityStatus: v(entity.status),
    registrationStatus: v(registration.status),
    lastUpdate: v(registration.lastUpdateDate),
    sourceUrl: BASE + "/" + lei,
    canonical: false,
    referenceOnly: true,
    tradability: "not_established",
  };
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new GleifApiError("GLEIF response too large", 502);
  if (!response.body) throw new GleifApiError("GLEIF returned no body", 502);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new GleifApiError("GLEIF response exceeded 512 KiB", 502);
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks.map(chunk => Buffer.from(chunk))).toString("utf8"));
  } catch {
    throw new GleifApiError("Malformed GLEIF data", 502);
  }
}

export async function searchGleifLegalEntities(
  query: GleifQuery,
  options: { fetcher?: typeof fetch; signal?: AbortSignal } = {},
): Promise<GleifLookupResult> {
  const byLei = typeof query.lei === "string";
  const input = byLei ? query.lei.trim().toUpperCase() : query.name?.trim() ?? "";
  if (byLei ? !isValidLei(input) : input.length < 3 || input.length > 140) {
    throw new GleifApiError(byLei ? "Enter a valid 20-character LEI with checksum" : "Enter a company name (3–140 characters)", 400);
  }
  const url = new URL(BASE + (byLei ? "/" + input : ""));
  if (!byLei) {
    url.searchParams.set("filter[entity.legalName]", input);
    url.searchParams.set("page[size]", String(MAX_RESULTS));
  }
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(url.toString(), {
      headers: { Accept: "application/vnd.api+json", "User-Agent": "LiOS Local Entity Intelligence/1.0" },
      signal: options.signal ?? AbortSignal.timeout(10_000),
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new GleifApiError("GLEIF lookup unavailable", 502);
  }
  const retrievedAt = new Date().toISOString();
  const result = (records: GleifLegalEntity[]): GleifLookupResult => ({
    status: !records.length ? "not_found" : byLei ? "found" : "candidates",
    query: byLei ? { lei: input } : { name: input },
    source: "GLEIF Global LEI Index",
    license: "CC0-1.0",
    retrievedAt, records,
    note: "Legal-entity reference only. No LiOS identity was promoted and no trading security or live quote is inferred.",
  });
  if (response.status === 404) return result([]);
  if (response.status === 429) throw new GleifApiError("GLEIF rate limit; retry later", 429);
  if (!response.ok) throw new GleifApiError("GLEIF lookup returned HTTP " + response.status, 502);
  const parsed = await readBoundedJson(response);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new GleifApiError("Invalid GLEIF response", 502);
  const data = (parsed as Record<string, unknown>).data;
  if (data === undefined) throw new GleifApiError("Missing GLEIF data envelope", 502);
  const raw = Array.isArray(data) ? data : [data];
  if (raw.length > MAX_RESULTS && !byLei) throw new GleifApiError("Unexpected oversized GLEIF page", 502);
  const records = raw.map(normalizeRecord).filter((x): x is GleifLegalEntity => x !== null);
  if (byLei && records.some(record => record.lei !== input)) throw new GleifApiError("GLEIF LEI identity mismatch", 502);
  return result(records);
}
