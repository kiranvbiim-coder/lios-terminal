import crypto from "crypto";
import fs from "fs";
import path from "path";
import { and, desc, eq, lte } from "drizzle-orm";
import { companies, companyListings, datasetSnapshots } from "@shared/schema";
import { universePayloadSchema, type UniverseMember, type UniversePayload } from "@shared/pointInTimeUniverse";
import { getDb } from "./db";
import { ensureEntitlementPolicy } from "./dataEntitlementStore";
import { stableSnapshotHash } from "./pointInTimeDatasetStore";

export type UniverseQuality = { score: number; inputCount: number; memberCount: number; duplicateCount: number; missingStartDates: number; missingExchangeCount: number; exitedMemberCount: number; warnings: string[] };

export function normalizeUniversePayload(input: Omit<UniversePayload, "members"> & { members: UniverseMember[] }): { payload: UniversePayload; quality: UniverseQuality } {
  const unique = new Map<string, UniverseMember>(); let duplicateCount = 0;
  for (const raw of input.members) {
    const parsed = universePayloadSchema.shape.members.element.parse({ ...raw, symbol: raw.symbol.trim().toUpperCase(), exchange: raw.exchange.trim().toUpperCase(), entityKey: raw.entityKey.trim().toUpperCase() });
    const key = `${parsed.symbol}@${parsed.exchange}`;
    if (unique.has(key)) duplicateCount += 1;
    unique.set(key, parsed);
  }
  const members = Array.from(unique.values()).sort((a, b) => `${a.symbol}@${a.exchange}`.localeCompare(`${b.symbol}@${b.exchange}`));
  const missingStartDates = members.filter((row) => !row.validFrom).length;
  const missingExchangeCount = members.filter((row) => row.exchange === "UNKNOWN").length;
  const exitedMemberCount = members.filter((row) => row.status !== "active" || row.validTo).length;
  const warnings: string[] = [];
  if (duplicateCount) warnings.push(`${duplicateCount} duplicate symbol/exchange rows were replaced by the last attributed record.`);
  if (missingStartDates) warnings.push(`${missingStartDates} memberships have unknown start dates; they cannot be used before this capture without an explicit historical import.`);
  if (missingExchangeCount) warnings.push(`${missingExchangeCount} members lack an exchange-qualified identity.`);
  const completeness = members.length ? 1 - (missingStartDates + missingExchangeCount) / (2 * members.length) : 0;
  return { payload: universePayloadSchema.parse({ ...input, universeKey: input.universeKey.trim().toUpperCase(), members }),
    quality: { score: Math.max(0, completeness), inputCount: input.members.length, memberCount: members.length, duplicateCount, missingStartDates, missingExchangeCount, exitedMemberCount, warnings } };
}

export function membersEffectiveAsOf(payload: UniversePayload, membershipAsOf: string): UniverseMember[] {
  return payload.members.filter((member) => (!member.validFrom || member.validFrom <= membershipAsOf) && (!member.validTo || member.validTo >= membershipAsOf));
}

export function compareUniversePayloads(before: UniversePayload, after: UniversePayload) {
  const key = (row: UniverseMember) => `${row.symbol}@${row.exchange}`;
  const prior = new Map(before.members.map((row) => [key(row), row])); const current = new Map(after.members.map((row) => [key(row), row]));
  const added = Array.from(current.keys()).filter((id) => !prior.has(id)).sort();
  const removed = Array.from(prior.keys()).filter((id) => !current.has(id)).sort();
  const changed = Array.from(current.entries()).flatMap(([id, row]) => {
    const old = prior.get(id); if (!old) return [];
    const fields = (["name", "weight", "rank", "validFrom", "validTo", "status", "exitReason"] as const).filter((field) => old[field] !== row[field]);
    return fields.length ? [{ member: id, fields, before: old, after: row }] : [];
  });
  return { status: added.length + removed.length + changed.length ? "revised" as const : "unchanged" as const, added, removed, changed };
}

function rowToUniverse(row: typeof datasetSnapshots.$inferSelect) {
  return { ...row, effectiveAt: row.effectiveAt?.toISOString() ?? null, publishedAt: row.publishedAt?.toISOString() ?? null,
    retrievedAt: row.retrievedAt.toISOString(), availableAt: row.availableAt.toISOString(), createdAt: row.createdAt.toISOString(),
    payload: universePayloadSchema.parse(row.payload), quality: row.quality as UniverseQuality };
}

export async function captureUniverseSnapshot(input: Omit<UniversePayload, "members"> & { members: UniverseMember[] }, createdByUserId: number) {
  const normalized = normalizeUniversePayload(input); const retrievedAt = new Date(); const db = getDb();
  const datasetKey = `universe:${normalized.payload.universeKey}`;
  const lineage = { selectedProvider: normalized.payload.provider, sourceName: normalized.payload.sourceName, sourceUrl: normalized.payload.sourceUrl, historicalCoverage: normalized.quality.missingStartDates ? "partial" : "declared" };
  const contentHash = stableSnapshotHash({ payload: normalized.payload, lineage });
  const [existing] = await db.select().from(datasetSnapshots).where(and(eq(datasetSnapshots.datasetKey, datasetKey), eq(datasetSnapshots.contentHash, contentHash))).limit(1);
  if (existing) return { snapshot: rowToUniverse(existing), created: false };
  const [parent] = await db.select().from(datasetSnapshots).where(eq(datasetSnapshots.datasetKey, datasetKey)).orderBy(desc(datasetSnapshots.createdAt)).limit(1);
  const policy = await ensureEntitlementPolicy(normalized.payload.provider, "universe_membership", createdByUserId);
  const [created] = await db.insert(datasetSnapshots).values({
    id: crypto.randomUUID(), datasetKey, entityKey: normalized.payload.universeKey, dataClass: "universe_membership", schemaVersion: "1.0.0",
    source: normalized.payload.sourceName, provider: normalized.payload.provider, frequency: "event_driven", currency: null, timezone: "UTC",
    observationStart: normalized.payload.effectiveDate, observationEnd: normalized.payload.effectiveDate,
    effectiveAt: new Date(`${normalized.payload.effectiveDate}T00:00:00.000Z`), publishedAt: null, retrievedAt, availableAt: retrievedAt,
    contentHash, parentSnapshotId: parent?.id ?? null, quality: normalized.quality, lineage, payload: normalized.payload,
    entitlementPolicyId: policy.id, createdByUserId,
  }).returning();
  return { snapshot: rowToUniverse(created), created: true };
}

export async function captureCanonicalListingsUniverse(createdByUserId: number) {
  const rows = await getDb().select({ company: companies, listing: companyListings }).from(companyListings).innerJoin(companies, eq(companyListings.companyId, companies.id));
  const effectiveDate = new Date().toISOString().slice(0, 10);
  if (!rows.length) {
    const resourcesBase = (process as { resourcesPath?: string }).resourcesPath || process.env.ELECTRON_RESOURCES_PATH;
    const directoryPath = resourcesBase ? path.resolve(resourcesBase, "server", "data", "tickers.json") : path.resolve(process.cwd(), "server", "data", "tickers.json");
    if (!fs.existsSync(directoryPath)) throw new Error("Neither canonical listings nor the terminal security directory are available to capture.");
    const directory = JSON.parse(fs.readFileSync(directoryPath, "utf8")) as Array<{ symbol: string; name: string; exchange: string; assetClass?: string; sector?: string; region?: string }>;
    return captureUniverseSnapshot({ universeKey: "LIMURIA_TERMINAL_DIRECTORY", name: "Limuria Terminal Security Directory", description: "Searchable securities distributed with this terminal build.",
      methodology: "Full bundled terminal directory at capture time. It is a current coverage universe, not reconstructed historical index membership.", provider: "limuria_directory", sourceName: "bundled_terminal_security_directory", sourceUrl: null, effectiveDate,
      members: directory.map((row) => ({ entityKey: `${row.symbol}@${row.exchange || "UNKNOWN"}`, symbol: row.symbol, name: row.name?.trim() || row.symbol, exchange: row.exchange?.trim() || "UNKNOWN",
        assetClass: row.assetClass ?? "equity", currency: null, weight: null, rank: null, validFrom: null, validTo: null, status: "active", exitReason: null,
        sourceMemberId: null, metadata: { sector: row.sector ?? null, region: row.region ?? null, historicalMembershipKnown: false, nameWasMissing: !row.name?.trim(), exchangeWasMissing: !row.exchange?.trim() } })),
    }, createdByUserId);
  }
  return captureUniverseSnapshot({ universeKey: "LIMURIA_CANONICAL_LISTINGS", name: "Limuria Canonical Listings", description: "Exchange-qualified listings known to the Limuria entity master at capture time.",
    methodology: "All canonical company listing rows. Historical membership begins only where listing validFrom/validTo is known.", provider: "limuria_directory", sourceName: "canonical_company_listings", sourceUrl: null, effectiveDate,
    members: rows.map(({ company, listing }) => ({ entityKey: String(company.id), symbol: listing.symbol, name: company.name, exchange: listing.exchange,
      assetClass: listing.assetClass, currency: listing.currency, weight: null, rank: null, validFrom: listing.validFrom, validTo: listing.validTo,
      status: listing.validTo ? "unknown_exit" : "active", exitReason: listing.validTo ? "Listing ended; reason not recorded." : null,
      sourceMemberId: String(listing.id), metadata: { companyId: company.id, mic: listing.mic, country: listing.country, isPrimary: listing.isPrimary } })),
  }, createdByUserId);
}

export async function listUniverseSnapshots(universeKey?: string, limit = 50) {
  const query = getDb().select().from(datasetSnapshots);
  const rows = universeKey ? await query.where(and(eq(datasetSnapshots.dataClass, "universe_membership"), eq(datasetSnapshots.entityKey, universeKey.toUpperCase()))).orderBy(desc(datasetSnapshots.createdAt)).limit(limit)
    : await query.where(eq(datasetSnapshots.dataClass, "universe_membership")).orderBy(desc(datasetSnapshots.createdAt)).limit(limit);
  return rows.map(rowToUniverse);
}

export async function getUniverseSnapshot(id: string) {
  const [row] = await getDb().select().from(datasetSnapshots).where(and(eq(datasetSnapshots.id, id), eq(datasetSnapshots.dataClass, "universe_membership"))).limit(1);
  return row ? rowToUniverse(row) : null;
}

export async function getUniverseAsOf(universeKey: string, knowledgeAsOf: Date, membershipAsOf: string) {
  const [row] = await getDb().select().from(datasetSnapshots).where(and(eq(datasetSnapshots.datasetKey, `universe:${universeKey.toUpperCase()}`), lte(datasetSnapshots.availableAt, knowledgeAsOf))).orderBy(desc(datasetSnapshots.availableAt)).limit(1);
  if (!row) return null; const snapshot = rowToUniverse(row);
  return { snapshot, membershipAsOf, members: membersEffectiveAsOf(snapshot.payload, membershipAsOf) };
}

export async function getUniverseRevisionReport(id: string) {
  const snapshot = await getUniverseSnapshot(id); if (!snapshot) return null;
  if (!snapshot.parentSnapshotId) return { snapshotId: id, parentSnapshotId: null, status: "initial" as const, added: snapshot.payload.members.map((row) => `${row.symbol}@${row.exchange}`), removed: [], changed: [] };
  const parent = await getUniverseSnapshot(snapshot.parentSnapshotId); return parent ? { snapshotId: id, parentSnapshotId: parent.id, ...compareUniversePayloads(parent.payload, snapshot.payload) } : null;
}
