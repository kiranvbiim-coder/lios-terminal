/**
 * Persistence for factor-risk model snapshots.
 *
 * Reuses the shared, content-addressed `dataset_snapshots` table (same
 * table pointInTimeDatasetStore.ts already writes to) with a dedicated
 * `dataClass: "factor_risk"` discriminator, instead of standing up a
 * parallel table -- same dedup-by-content-hash and organization-scope
 * columns this app already relies on elsewhere. Migration 0039 adds the
 * one column that table didn't already have: `expiresAt`, because unlike
 * point-in-time source facts a *computed* factor-risk result legitimately
 * goes stale and needs pruning.
 *
 * DB-backed only, no local fallback -- this app's other durable snapshot
 * stores (pointInTimeDatasetStore.ts, calculationJobService.ts) follow the
 * same convention: `getDb()` throws if `initDb()` hasn't run yet, which is
 * the correct failure mode (a server that hasn't finished starting up
 * should not silently persist to a throwaway, single-machine location).
 *
 * The snapshot payload is stored opaquely (`Record<string, unknown>`),
 * exactly like the store this replaces -- factorRiskModel.ts owns the
 * `FactorRiskSnapshot` shape, this module never depends on it.
 */
import { and, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import { datasetSnapshots } from "@shared/schema";
import { getDb } from "./db";
import { getRequestIdentity } from "./requestContext";
import { getApplicableEntitlementPolicy } from "./dataEntitlementStore";

function requestOwnerCondition() {
  const actor = getRequestIdentity();
  return actor ? and(
    actor.userId === null ? isNull(datasetSnapshots.createdByUserId) : eq(datasetSnapshots.createdByUserId, actor.userId),
    actor.organizationId === null ? isNull(datasetSnapshots.organizationId) : eq(datasetSnapshots.organizationId, actor.organizationId),
  ) : undefined;
}

export const FACTOR_RISK_DATA_CLASS = "factor_risk";

export interface FactorRiskSnapshotStoreRecord {
  snapshot: Record<string, unknown>;
  requestKey: string;
  expiresAt: number;
}

export interface FactorRiskSnapshotMetadata {
  snapshotId: string;
  contentHash: string;
  request: {
    symbols: string[];
    benchmarkSymbol: string;
    range: string;
    asOf: string;
  };
  capturedAt: string;
  expiresAt: number;
  organizationScope: string;
  included: string[];
  excluded: Array<{ securityId: string; reason: string }>;
  periodCount: number;
}

export interface FactorRiskSnapshotListOptions {
  page?: number;
  limit?: number;
  symbol?: string;
  organizationScope?: string;
  asOf?: string;
  now?: number;
}

export interface FactorRiskSnapshotMetadataPage {
  items: FactorRiskSnapshotMetadata[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
  nextPage: number | null;
}

export const FACTOR_RISK_SNAPSHOT_MAX_PAGE = 10_000;
export const FACTOR_RISK_SNAPSHOT_MAX_LIST_LIMIT = 100;

export interface FactorRiskSnapshotStore {
  save(snapshot: Record<string, unknown>, requestKey: string, expiresAt: number): Promise<void>;
  getBySnapshotId(snapshotId: string, now?: number): Promise<FactorRiskSnapshotStoreRecord | null>;
  getByRequestKey(requestKey: string, now?: number): Promise<FactorRiskSnapshotStoreRecord | null>;
  list(options?: FactorRiskSnapshotListOptions): Promise<FactorRiskSnapshotMetadataPage>;
  prune(now?: number): Promise<void>;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function boundedListOption(value: number | undefined, fallback: number, maximum: number, name: string): number {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < 1 || result > maximum) {
    throw new RangeError(`${name} must be between 1 and ${maximum}.`);
  }
  return result;
}

function redactSensitiveText(value: string): string {
  return value.replace(/((?:api[-_ ]?key|access[-_ ]?token|secret|password|authorization)\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]");
}

function snapshotMetadata(snapshotId: string, record: FactorRiskSnapshotStoreRecord): FactorRiskSnapshotMetadata {
  const snapshot = record.snapshot;
  const request = snapshot.request && typeof snapshot.request === "object" && !Array.isArray(snapshot.request)
    ? snapshot.request as Record<string, unknown>
    : {};
  const symbols = Array.isArray(request.symbols)
    ? request.symbols.filter((symbol): symbol is string => typeof symbol === "string")
    : [];
  const securities = Array.isArray(snapshot.securities) ? snapshot.securities : [];
  const included = securities
    .map((security) => security && typeof security === "object" && !Array.isArray(security)
      ? (security as Record<string, unknown>).securityId : undefined)
    .filter((securityId): securityId is string => typeof securityId === "string");
  const excluded = Array.isArray(snapshot.excluded)
    ? snapshot.excluded
      .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object" && !Array.isArray(entry)))
      .map((entry) => ({
        securityId: typeof entry.securityId === "string" ? entry.securityId : "",
        reason: typeof entry.reason === "string" ? redactSensitiveText(entry.reason) : "excluded",
      }))
      .filter((entry) => entry.securityId.length > 0)
    : [];
  const estimation = snapshot.estimation && typeof snapshot.estimation === "object" && !Array.isArray(snapshot.estimation)
    ? snapshot.estimation as Record<string, unknown>
    : snapshot.estimator && typeof snapshot.estimator === "object" && !Array.isArray(snapshot.estimator)
      ? snapshot.estimator as Record<string, unknown>
      : {};
  const periodCount = Array.isArray(estimation.factorReturnSeries)
    ? estimation.factorReturnSeries.length
    : Array.isArray(snapshot.factorReturnSeries) ? snapshot.factorReturnSeries.length : 0;
  return {
    snapshotId,
    contentHash: typeof snapshot.contentHash === "string" ? snapshot.contentHash : "",
    request: {
      symbols: [...symbols],
      benchmarkSymbol: typeof request.benchmarkSymbol === "string" ? request.benchmarkSymbol : "",
      range: typeof request.range === "string" ? request.range : "",
      asOf: typeof request.asOf === "string" ? request.asOf : "",
    },
    capturedAt: typeof snapshot.capturedAt === "string" ? snapshot.capturedAt : "",
    expiresAt: record.expiresAt,
    organizationScope: typeof request.scope === "string" ? request.scope : "local",
    included: [...included],
    excluded,
    periodCount,
  };
}

// The opaque payload's own `request.scope` ("local" | "organization:<id>")
// is the single source of truth for which org a snapshot belongs to -- the
// same string factorRiskModel.ts's snapshotIsInRequestScope() checks on
// every read. Parsed once here so the DB row's organizationId column and
// every scope-filtered query agree with that exact-match security model
// (never the looser "org row OR unscoped row" sharing some other stores
// use -- a factor-risk snapshot captured for one organization must never
// be visible to a different one, or to an unscoped/local caller).
function parseScope(snapshot: Record<string, unknown>): number | null {
  const request = snapshot.request as { scope?: unknown } | undefined;
  const scope = typeof request?.scope === "string" ? request.scope : "local";
  const match = /^organization:(\d+)$/.exec(scope);
  return match ? Number(match[1]) : null;
}

function parseOrganizationScopeOption(organizationScope: string) {
  const match = /^organization:(\d+)$/.exec(organizationScope);
  return match ? Number(match[1]) : null;
}

function entityKeyFor(snapshot: Record<string, unknown>): string {
  const request = snapshot.request as { symbols?: unknown } | undefined;
  const symbols = Array.isArray(request?.symbols) ? request.symbols.filter((symbol): symbol is string => typeof symbol === "string") : [];
  return symbols.length ? symbols.join(",") : "unknown";
}

function rowToRecord(row: typeof datasetSnapshots.$inferSelect): FactorRiskSnapshotStoreRecord {
  return {
    snapshot: clone(row.payload),
    requestKey: row.datasetKey,
    expiresAt: row.expiresAt ? row.expiresAt.getTime() : Number.POSITIVE_INFINITY,
  };
}

export class DbFactorRiskSnapshotStore implements FactorRiskSnapshotStore {
  async save(snapshot: Record<string, unknown>, requestKey: string, expiresAt: number): Promise<void> {
    const snapshotId = typeof snapshot.snapshotId === "string" ? snapshot.snapshotId : "";
    const contentHash = typeof snapshot.contentHash === "string" ? snapshot.contentHash : "";
    if (!snapshotId || !contentHash || !requestKey || !Number.isFinite(expiresAt)) {
      throw new Error("Invalid factor-risk snapshot persistence record.");
    }
    const db = getDb();
    // `id` is content-addressed (derived from contentHash by
    // factorRiskModel.ts), so an existing row with this id is expected to
    // be identical content -- a mismatch here is a real bug (hash
    // collision or caller misuse), never a silent overwrite.
    const [existing] = await db.select({ contentHash: datasetSnapshots.contentHash }).from(datasetSnapshots).where(eq(datasetSnapshots.id, snapshotId)).limit(1);
    if (existing) {
      if (existing.contentHash !== contentHash) throw new Error(`Factor-risk snapshot ${snapshotId} is immutable.`);
      return;
    }
    const organizationId = parseScope(snapshot);
    const [parent] = await db.select({ id: datasetSnapshots.id }).from(datasetSnapshots)
      .where(and(
        eq(datasetSnapshots.datasetKey, requestKey),
        organizationId === null ? isNull(datasetSnapshots.organizationId) : eq(datasetSnapshots.organizationId, organizationId),
      ))
      .orderBy(desc(datasetSnapshots.createdAt)).limit(1);
    const capturedAt = typeof snapshot.capturedAt === "string" ? snapshot.capturedAt : new Date().toISOString();
    const request = snapshot.request as { asOf?: unknown } | undefined;
    const asOf = typeof request?.asOf === "string" ? request.asOf : null;
    const now = new Date();
    const policy = await getApplicableEntitlementPolicy("factor_risk_model", FACTOR_RISK_DATA_CLASS, now);
    await db.insert(datasetSnapshots).values({
      id: snapshotId,
      datasetKey: requestKey,
      entityKey: entityKeyFor(snapshot),
      dataClass: FACTOR_RISK_DATA_CLASS,
      schemaVersion: "factor-risk-v1",
      source: "factor_risk_model",
      provider: "factor_risk_model",
      frequency: "on_demand",
      currency: null,
      timezone: "UTC",
      observationStart: asOf,
      observationEnd: asOf,
      effectiveAt: new Date(capturedAt),
      publishedAt: null,
      retrievedAt: now,
      availableAt: now,
      contentHash,
      parentSnapshotId: parent?.id ?? null,
      quality: {},
      lineage: { requestKey },
      payload: snapshot,
      createdByUserId: getRequestIdentity()?.userId ?? null,
      organizationId,
      entitlementPolicyId: policy?.licenseType !== "unknown" ? policy?.id ?? null : null,
      expiresAt: new Date(expiresAt),
    }).onConflictDoNothing();
  }

  async getBySnapshotId(snapshotId: string, now = Date.now()): Promise<FactorRiskSnapshotStoreRecord | null> {
    const db = getDb();
    const [row] = await db.select().from(datasetSnapshots)
      .where(and(eq(datasetSnapshots.id, snapshotId), eq(datasetSnapshots.dataClass, FACTOR_RISK_DATA_CLASS),
        requestOwnerCondition()))
      .limit(1);
    if (!row) return null;
    if (row.expiresAt && row.expiresAt.getTime() <= now) {
      await db.delete(datasetSnapshots).where(eq(datasetSnapshots.id, row.id));
      return null;
    }
    return rowToRecord(row);
  }

  async getByRequestKey(requestKey: string, now = Date.now()): Promise<FactorRiskSnapshotStoreRecord | null> {
    const db = getDb();
    const rows = await db.select().from(datasetSnapshots)
      .where(and(eq(datasetSnapshots.datasetKey, requestKey), eq(datasetSnapshots.dataClass, FACTOR_RISK_DATA_CLASS),
        requestOwnerCondition()))
      .orderBy(desc(datasetSnapshots.createdAt));
    for (const row of rows) {
      if (row.expiresAt && row.expiresAt.getTime() <= now) {
        await db.delete(datasetSnapshots).where(eq(datasetSnapshots.id, row.id));
        continue;
      }
      return rowToRecord(row);
    }
    return null;
  }

  async list(options: FactorRiskSnapshotListOptions = {}): Promise<FactorRiskSnapshotMetadataPage> {
    const page = boundedListOption(options.page, 1, FACTOR_RISK_SNAPSHOT_MAX_PAGE, "page");
    const limit = boundedListOption(options.limit, 25, FACTOR_RISK_SNAPSHOT_MAX_LIST_LIMIT, "limit");
    if (options.now !== undefined && !Number.isFinite(options.now)) throw new RangeError("now must be finite.");
    const now = options.now ?? Date.now();
    const db = getDb();
    const conditions = [eq(datasetSnapshots.dataClass, FACTOR_RISK_DATA_CLASS)];
    const ownerCondition = requestOwnerCondition();
    if (ownerCondition) conditions.push(ownerCondition);
    if (options.organizationScope !== undefined) {
      const organizationId = parseOrganizationScopeOption(options.organizationScope);
      conditions.push(organizationId === null ? isNull(datasetSnapshots.organizationId) : eq(datasetSnapshots.organizationId, organizationId));
    }
    if (options.asOf !== undefined) conditions.push(eq(datasetSnapshots.observationEnd, options.asOf));
    const rows = await db.select().from(datasetSnapshots).where(and(...conditions)).orderBy(desc(datasetSnapshots.createdAt));

    const expiredIds: string[] = [];
    const metadata: FactorRiskSnapshotMetadata[] = [];
    for (const row of rows) {
      if (row.expiresAt && row.expiresAt.getTime() <= now) { expiredIds.push(row.id); continue; }
      const item = snapshotMetadata(row.id, rowToRecord(row));
      if (options.symbol !== undefined && !item.request.symbols.some((symbol) => symbol.toUpperCase() === options.symbol!.toUpperCase())) continue;
      metadata.push(item);
    }
    if (expiredIds.length) await db.delete(datasetSnapshots).where(inArray(datasetSnapshots.id, expiredIds));

    metadata.sort((left, right) => right.capturedAt.localeCompare(left.capturedAt) || left.snapshotId.localeCompare(right.snapshotId));
    const start = (page - 1) * limit;
    const items = metadata.slice(start, start + limit).map(clone);
    const hasMore = start + items.length < metadata.length;
    return { items, page, limit, total: metadata.length, hasMore, nextPage: hasMore ? page + 1 : null };
  }

  async prune(now = Date.now()): Promise<void> {
    const db = getDb();
    await db.delete(datasetSnapshots).where(and(
      eq(datasetSnapshots.dataClass, FACTOR_RISK_DATA_CLASS),
      lt(datasetSnapshots.expiresAt, new Date(now)),
    ));
  }
}

export function createFactorRiskSnapshotStore(): FactorRiskSnapshotStore {
  return new DbFactorRiskSnapshotStore();
}
