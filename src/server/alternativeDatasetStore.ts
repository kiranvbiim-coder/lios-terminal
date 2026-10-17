import crypto from "crypto";
import { and, desc, eq, isNull, lte, or, getTableColumns } from "drizzle-orm";
import { datasetSnapshots, portfolios, positions, users } from "@shared/schema";
import {
  alternativePayloadSchemas,
  alternativeSnapshotInputSchema,
  type AlternativeDataClass,
  type AlternativeSnapshotInput,
} from "@shared/pointInTimeAlternativeData";
import { getDb } from "./db";
import { ensureEntitlementPolicy, getApplicableEntitlementPolicy, getEntitlementPolicyById } from "./dataEntitlementStore";
import { stableSnapshotHash } from "./pointInTimeDatasetStore";
import { getOptionsChain } from "./lseData";
import { getFmpAnalystEstimates } from "./fmpData";
import type { TenantContext } from "./tenantContext";
import type { ProviderEntitlementDecision } from "@shared/universalDataFabric";

const { payload: _retainedPayload, ...retainedMetadataColumns } = getTableColumns(datasetSnapshots);
type RetainedMetadata = Omit<typeof datasetSnapshots.$inferSelect, "payload">;

function retainedDenied(): never {
  throw Object.assign(new Error("Retained source is unavailable under current owner, availability or permitted-use policy."), { status: 403 });
}

/** P5 metadata admission deliberately excludes payload. Organization-null is
 * storage scope, not a public disclosure grant. Historical clocks never
 * replace today's owner/account/rights/expiry checks. */
async function requireRetainedAuthority(metadata: RetainedMetadata, context: TenantContext, now = new Date()): Promise<ProviderEntitlementDecision> {
  const db = getDb();
  const [actor] = await db.select().from(users).where(eq(users.id, context.userId)).limit(1);
  const [owner] = metadata.createdByUserId === null ? [] : await db.select().from(users).where(eq(users.id, metadata.createdByUserId)).limit(1);
  if (!actor?.active || actor.mustChangePassword || actor.lockedUntil && actor.lockedUntil > now || actor.organizationId !== context.organizationId || actor.role !== context.role
    || !owner?.active || owner.mustChangePassword || owner.lockedUntil && owner.lockedUntil > now) retainedDenied();
  if (metadata.organizationId === null
    ? metadata.createdByUserId !== context.userId
    : metadata.organizationId !== context.organizationId || owner.organizationId !== metadata.organizationId) retainedDenied();
  if (metadata.availableAt > now || metadata.expiresAt && metadata.expiresAt <= now || !metadata.source.trim() || !metadata.provider.trim()) retainedDenied();
  if (!metadata.entitlementPolicyId) retainedDenied();
  const captured = await getEntitlementPolicyById(metadata.entitlementPolicyId);
  const policy = await getApplicableEntitlementPolicy(metadata.provider, metadata.dataClass, now);
  if (!captured || captured.provider !== metadata.provider || captured.dataClass !== metadata.dataClass
    || !policy?.reviewedAt || policy.reviewedAt > now || policy.licenseType === "unknown"
    || !policy.permittedUses.includes("internal_research")) retainedDenied();
  return { decision: "allowed", policyId: policy.id, permittedUses: [...policy.permittedUses], reasons: ["Current P5 reviewed source policy permits internal research for this current owner-scoped retained source."] };
}

export async function getRetainedAlternativeMetadata(dataClass: AlternativeDataClass, entityKey: string, context: TenantContext, asOf = new Date()) {
  const scope = context.organizationId === null
    ? and(isNull(datasetSnapshots.organizationId), eq(datasetSnapshots.createdByUserId, context.userId))
    : or(and(isNull(datasetSnapshots.organizationId), eq(datasetSnapshots.createdByUserId, context.userId)), eq(datasetSnapshots.organizationId, context.organizationId));
  const [metadata] = await getDb().select(retainedMetadataColumns).from(datasetSnapshots).where(and(
    eq(datasetSnapshots.dataClass, dataClass), eq(datasetSnapshots.entityKey, entityKey.toUpperCase()),
    lte(datasetSnapshots.availableAt, asOf), scope,
  )).orderBy(desc(datasetSnapshots.availableAt), desc(datasetSnapshots.createdAt)).limit(1);
  if (!metadata) return null;
  await requireRetainedAuthority(metadata, context);
  return metadata;
}

/** Re-admit before reading payload and after retrieval. Comparing all metadata
 * prevents an in-flight owner/source/hash/policy change from authorizing bytes. */
export async function readPermittedAlternativeDataset(metadata: RetainedMetadata, context: TenantContext) {
  const loadMetadata = async () => {
    const [current] = await getDb().select(retainedMetadataColumns).from(datasetSnapshots).where(eq(datasetSnapshots.id, metadata.id)).limit(1);
    if (!current || JSON.stringify(current) !== JSON.stringify(metadata)) retainedDenied();
    const entitlement = await requireRetainedAuthority(current, context);
    return entitlement;
  };
  await loadMetadata();
  const [row] = await getDb().select({ payload: datasetSnapshots.payload }).from(datasetSnapshots).where(and(eq(datasetSnapshots.id, metadata.id), eq(datasetSnapshots.contentHash, metadata.contentHash))).limit(1);
  const entitlement = await loadMetadata();
  if (!row) retainedDenied();
  if (stableSnapshotHash({ payload: row.payload, provider: metadata.provider, lineage: metadata.lineage }) !== metadata.contentHash) retainedDenied();
  const snapshot = rowToSnapshot({ ...metadata, payload: row.payload });
  return { snapshot, entitlement };
}

function bounds(input: AlternativeSnapshotInput): { start: string | null; end: string | null; count: number; missing: number } {
  let dates: string[] = []; let count = 0; let missing = 0;
  switch (input.dataClass) {
    case "estimates": dates = input.payload.observations.map((row) => row.periodEnd).filter((v): v is string => Boolean(v)); count = input.payload.observations.length; missing = input.payload.observations.filter((row) => !row.periodEnd || !row.currency).length; break;
    case "options_chain": dates = input.payload.contracts.map((row) => row.expiry); count = input.payload.contracts.length; missing = input.payload.contracts.filter((row) => row.bid === null || row.ask === null || row.openInterest === null).length; break;
    case "commodity_curve": dates = input.payload.points.map((row) => row.expiry); count = input.payload.points.length; missing = input.payload.points.filter((row) => row.openInterest === null || row.volume === null).length; break;
    case "portfolio_holdings": dates = [input.payload.asOf.slice(0, 10)]; count = input.payload.holdings.length; missing = input.payload.holdings.filter((row) => row.marketPrice === null || row.marketValue === null).length; break;
    case "private_series": dates = input.payload.observations.map((row) => row.observationAt.slice(0, 10)); count = input.payload.observations.length; break;
  }
  dates.sort(); return { start: dates[0] ?? null, end: dates.at(-1) ?? null, count, missing };
}

function rowToSnapshot(row: typeof datasetSnapshots.$inferSelect) {
  const dataClass = row.dataClass as AlternativeDataClass;
  return {
    ...row, dataClass, payload: alternativePayloadSchemas[dataClass].parse(row.payload),
    effectiveAt: row.effectiveAt?.toISOString() ?? null, publishedAt: row.publishedAt?.toISOString() ?? null,
    retrievedAt: row.retrievedAt.toISOString(), availableAt: row.availableAt.toISOString(), createdAt: row.createdAt.toISOString(),
  };
}

export async function captureAlternativeDataset(raw: AlternativeSnapshotInput, createdByUserId: number) {
  const input = alternativeSnapshotInputSchema.parse(raw);
  if ((input.dataClass === "portfolio_holdings" || input.dataClass === "private_series") && input.organizationId === null) {
    throw new Error(`${input.dataClass} snapshots require organization scope.`);
  }
  const range = bounds(input); const policy = await ensureEntitlementPolicy(input.provider, input.dataClass, createdByUserId);
  const datasetKey = `${input.dataClass}:${input.organizationId ?? "public"}:${input.entityKey.toUpperCase()}`;
  const contentHash = stableSnapshotHash({ payload: input.payload, provider: input.provider, lineage: input.lineage }); const db = getDb();
  const [existing] = await db.select().from(datasetSnapshots).where(and(eq(datasetSnapshots.datasetKey, datasetKey), eq(datasetSnapshots.contentHash, contentHash))).limit(1);
  if (existing) return { snapshot: rowToSnapshot(existing), created: false };
  const [parent] = await db.select().from(datasetSnapshots).where(eq(datasetSnapshots.datasetKey, datasetKey)).orderBy(desc(datasetSnapshots.createdAt)).limit(1);
  const warnings: string[] = []; if (range.missing) warnings.push(`${range.missing} of ${range.count} records have optional source fields missing.`);
  if (!policy.reviewedAt) warnings.push("Source-rights policy is pending formal review; access remains internal-only.");
  const [created] = await db.insert(datasetSnapshots).values({
    id: crypto.randomUUID(), datasetKey, entityKey: input.entityKey.toUpperCase(), dataClass: input.dataClass,
    schemaVersion: "1.0.0", source: input.source, provider: input.provider, frequency: input.frequency,
    currency: input.currency, timezone: input.timezone, observationStart: range.start, observationEnd: range.end,
    effectiveAt: input.effectiveAt ? new Date(input.effectiveAt) : null, publishedAt: input.publishedAt ? new Date(input.publishedAt) : null,
    retrievedAt: new Date(input.retrievedAt), availableAt: new Date(input.availableAt), contentHash, parentSnapshotId: parent?.id ?? null,
    quality: { score: range.count ? Math.max(0, 1 - range.missing / range.count) : 0, recordCount: range.count, missingOptionalFields: range.missing, warnings },
    lineage: input.lineage, payload: input.payload as Record<string, unknown>, entitlementPolicyId: policy.id, organizationId: input.organizationId, createdByUserId,
  }).returning();
  return { snapshot: rowToSnapshot(created), created: true };
}

export async function listAlternativeDatasets(dataClass: AlternativeDataClass, entityKey: string | undefined, organizationId: number | null, limit = 50) {
  const scope = organizationId === null ? isNull(datasetSnapshots.organizationId) : or(isNull(datasetSnapshots.organizationId), eq(datasetSnapshots.organizationId, organizationId));
  const filters = [eq(datasetSnapshots.dataClass, dataClass), scope];
  if (entityKey) filters.push(eq(datasetSnapshots.entityKey, entityKey.toUpperCase()));
  const rows = await getDb().select().from(datasetSnapshots).where(and(...filters)).orderBy(desc(datasetSnapshots.availableAt)).limit(limit);
  return rows.map(rowToSnapshot);
}

export async function getAlternativeDataset(id: string, organizationId: number | null) {
  const scope = organizationId === null ? isNull(datasetSnapshots.organizationId) : or(isNull(datasetSnapshots.organizationId), eq(datasetSnapshots.organizationId, organizationId));
  const [row] = await getDb().select().from(datasetSnapshots).where(and(eq(datasetSnapshots.id, id), scope)).limit(1);
  return row && row.dataClass in alternativePayloadSchemas ? rowToSnapshot(row) : null;
}

export async function getAlternativeDatasetAsOf(dataClass: AlternativeDataClass, entityKey: string, asOf: Date, organizationId: number | null) {
  const scope = organizationId === null ? isNull(datasetSnapshots.organizationId) : or(isNull(datasetSnapshots.organizationId), eq(datasetSnapshots.organizationId, organizationId));
  const [row] = await getDb().select().from(datasetSnapshots).where(and(eq(datasetSnapshots.dataClass, dataClass), eq(datasetSnapshots.entityKey, entityKey.toUpperCase()), lte(datasetSnapshots.availableAt, asOf), scope)).orderBy(desc(datasetSnapshots.availableAt), desc(datasetSnapshots.createdAt)).limit(1);
  return row ? rowToSnapshot(row) : null;
}

export async function getAlternativeDatasetRevisionReport(id: string) {
  const db = getDb();
  const [row] = await db.select().from(datasetSnapshots).where(eq(datasetSnapshots.id, id)).limit(1);
  if (!row || !(row.dataClass in alternativePayloadSchemas)) return null;
  if (!row.parentSnapshotId) {
    return { status: "initial", snapshotId: row.id, parentSnapshotId: null, previousHash: null, currentHash: row.contentHash };
  }
  const [parent] = await db.select().from(datasetSnapshots).where(eq(datasetSnapshots.id, row.parentSnapshotId)).limit(1);
  if (!parent) {
    return { status: "parent_unavailable", snapshotId: row.id, parentSnapshotId: row.parentSnapshotId, previousHash: null, currentHash: row.contentHash };
  }
  return {
    ...compareAlternativePayloads(parent.payload as Record<string, unknown>, row.payload as Record<string, unknown>),
    snapshotId: row.id,
    parentSnapshotId: parent.id,
  };
}

export function compareAlternativePayloads(before: Record<string, unknown>, after: Record<string, unknown>) {
  const previous = stableSnapshotHash(before); const current = stableSnapshotHash(after);
  return { status: previous === current ? "unchanged" : "revised", previousHash: previous, currentHash: current };
}

export function calculateEstimateSurprises(payload: Extract<AlternativeSnapshotInput, { dataClass: "estimates" }>["payload"]) {
  return payload.actuals.flatMap((actual) => {
    const eligible = payload.observations.filter((row) => row.metric === actual.metric && row.fiscalPeriod === actual.fiscalPeriod && row.availableAt <= actual.reportedAt);
    if (!eligible.length) return [];
    const latestTime = eligible.map((row) => row.availableAt).sort().at(-1)!; const latest = eligible.filter((row) => row.availableAt === latestTime);
    const consensus = latest.reduce((sum, row) => sum + row.value, 0) / latest.length; const difference = actual.value - consensus;
    return [{ metric: actual.metric, fiscalPeriod: actual.fiscalPeriod, actual: actual.value, consensus, difference, surprisePct: consensus === 0 ? null : difference / Math.abs(consensus), contributorCount: latest.length, consensusAvailableAt: latestTime, reportedAt: actual.reportedAt }];
  });
}

export async function captureLseOptionsChain(underlying: string, createdByUserId: number) {
  const retrievedAt = new Date().toISOString(); const rows = await getOptionsChain(underlying.toUpperCase(), { limit: 5000 });
  if (!rows.length) throw new Error(`No options chain is available for ${underlying.toUpperCase()}.`);
  return captureAlternativeDataset({
    dataClass: "options_chain", entityKey: underlying.toUpperCase(), source: "lse_options_chain", provider: "LSE", frequency: "snapshot", timezone: "UTC", currency: "USD",
    effectiveAt: retrievedAt, publishedAt: null, retrievedAt, availableAt: retrievedAt, organizationId: null,
    lineage: { endpoint: "/options/chain", returnedContracts: rows.length, providerPublicationTimeUnavailable: true },
    payload: { underlying: underlying.toUpperCase(), contracts: rows.map((row) => ({ contractSymbol: row.ticker, underlying: row.underlying, type: row.contract_type, strike: row.strike, expiry: row.expiry, quoteAt: retrievedAt, bid: null, ask: null, last: row.last_price, volume: row.volume_today, openInterest: null, underlyingPrice: row.underlying_price, impliedVolatility: row.iv, delta: row.delta, gamma: row.gamma, theta: row.theta, vega: row.vega, rho: null, multiplier: 100, currency: "USD" })) },
  }, createdByUserId);
}

export async function captureFmpEstimates(symbol: string, createdByUserId: number) {
  const upper = symbol.toUpperCase(); const retrievedAt = new Date().toISOString(); const rows = await getFmpAnalystEstimates(upper);
  if (!rows.length) throw new Error(`No FMP analyst estimates are available for ${upper}.`);
  const observations = rows.flatMap((row) => ([
    ["eps", row.epsAvg, row.epsLow, row.epsHigh, "per_share", row.numAnalystsEps],
    ["revenue", row.revenueAvg, row.revenueLow, row.revenueHigh, "currency", row.numAnalystsRevenue],
    ["ebitda", row.ebitdaAvg, row.ebitdaLow, row.ebitdaHigh, "currency", null],
    ["ebit", row.ebitAvg, row.ebitLow, row.ebitHigh, "currency", null],
  ] as const).flatMap(([metric, value, low, high, unit, count]) => Number.isFinite(value) ? [{ symbol: upper, metric, fiscalPeriod: `FY${row.date.slice(0, 4)}`, periodEnd: row.date, contributor: `FMP aggregate${count ? ` (${count} analysts)` : ""}`, value: value!, low: Number.isFinite(low) ? low! : null, high: Number.isFinite(high) ? high! : null, currency: "USD", unit, publishedAt: retrievedAt, availableAt: retrievedAt, sourceUrl: "https://financialmodelingprep.com/stable/analyst-estimates" }] : []));
  return captureAlternativeDataset({ dataClass: "estimates", entityKey: upper, source: "fmp_analyst_estimates", provider: "FMP", frequency: "annual", timezone: "UTC", currency: "USD", effectiveAt: retrievedAt, publishedAt: null, retrievedAt, availableAt: retrievedAt, organizationId: null,
    lineage: { endpoint: "/stable/analyst-estimates", aggregateOnly: true, providerPublicationTimeUnavailable: true, historicalImportsAvailableAtRetrieval: true }, payload: { symbol: upper, observations, actuals: [] } }, createdByUserId);
}

export async function capturePortfolioSnapshot(portfolioId: number, createdByUserId: number) {
  const db = getDb(); const [portfolio] = await db.select().from(portfolios).where(eq(portfolios.id, portfolioId)).limit(1);
  if (!portfolio) throw new Error("Portfolio not found."); const holdings = await db.select().from(positions).where(eq(positions.portfolioId, portfolioId)); const asOf = new Date().toISOString();
  return captureAlternativeDataset({ dataClass: "portfolio_holdings", entityKey: String(portfolio.id), source: "limuria_portfolio_ledger", provider: "user_supplied", frequency: "event", timezone: "UTC", currency: "USD", effectiveAt: asOf, publishedAt: null, retrievedAt: asOf, availableAt: asOf, organizationId: portfolio.organizationId,
    lineage: { portfolioId, positionRecordIds: holdings.map((row) => row.id), priceFieldsUnavailable: true }, payload: { portfolioId: String(portfolio.id), name: portfolio.name, asOf, baseCurrency: "USD", benchmark: null, cash: 0, holdings: holdings.map((row) => ({ symbol: row.symbol, quantity: row.shares, costBasis: row.avgCost, marketPrice: null, marketValue: null, currency: "USD", taxLotId: String(row.id), acquiredAt: row.addedAt.toISOString().slice(0, 10) })), mandate: {} } }, createdByUserId);
}
