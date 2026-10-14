import crypto from "crypto";
import fs from "fs";
import path from "path";
import { and, desc, eq } from "drizzle-orm";
import { columnarArtifacts, dataEntitlementPolicies, datasetSnapshots } from "@shared/schema";
import { marketDatasetPayloadSchema, scalarSeriesPayloadSchema, yieldCurvePayloadSchema } from "@shared/pointInTimeData";
import { universePayloadSchema } from "@shared/pointInTimeUniverse";
import { commodityCurvePayloadSchema, estimatesPayloadSchema, optionsPayloadSchema, portfolioPayloadSchema, privateSeriesPayloadSchema } from "@shared/pointInTimeAlternativeData";
import { getDb } from "./db";
import { ensureEntitlementPolicy } from "./dataEntitlementStore";
import type { TenantContext } from "./tenantContext";
import { dataPath } from "./dataRoot";

type ScalarRecord = Record<string, string | number | boolean | null>;

export type ColumnarArtifactActor = number | Pick<TenantContext, "userId" | "organizationId">;

export function canAccessDatasetSnapshot(
  snapshot: { organizationId: number | null; createdByUserId: number | null },
  actor: ColumnarArtifactActor,
): boolean {
  if (typeof actor === "number") {
    return snapshot.createdByUserId === actor;
  }
  if (snapshot.organizationId !== null) {
    return actor.organizationId !== null && actor.organizationId === snapshot.organizationId;
  }
  if (snapshot.createdByUserId !== null) {
    return actor.userId === snapshot.createdByUserId;
  }
  return true;
}

function requireDatasetSnapshotAccess(
  snapshot: { organizationId: number | null; createdByUserId: number | null },
  actor: ColumnarArtifactActor,
): void {
  if (!canAccessDatasetSnapshot(snapshot, actor)) {
    throw new Error("Dataset snapshot is outside the active tenant boundary.");
  }
}

function columnarRoot(): string {
  return dataPath("columnar");
}

function sqlPath(value: string): string { return value.replaceAll("'", "''"); }
function jsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return Number(value);
  if (value && typeof value === "object") {
    if (Array.isArray(value)) return value.map(jsonSafe);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]));
  }
  return value;
}

export function flattenSnapshotForColumnar(snapshot: Pick<typeof datasetSnapshots.$inferSelect, "id" | "dataClass" | "entityKey" | "payload">): { records: ScalarRecord[]; dateColumn: string | null; numericColumns: string[] } {
  if (snapshot.dataClass === "market_series") {
    const payload = marketDatasetPayloadSchema.parse(snapshot.payload);
    return { records: payload.bars.map((row) => ({ snapshot_id: snapshot.id, symbol: payload.symbol, date: row.date, open: row.open, high: row.high, low: row.low, close: row.close,
      volume: row.volume, price_return: row.priceReturn, log_return: row.logReturn, total_return: row.totalReturn })), dateColumn: "date",
      numericColumns: ["open", "high", "low", "close", "volume", "price_return", "log_return", "total_return"] };
  }
  if (snapshot.dataClass === "economic_series") {
    const payload = scalarSeriesPayloadSchema.parse(snapshot.payload);
    return { records: payload.observations.map((row) => ({ snapshot_id: snapshot.id, series_id: payload.seriesId, date: row.date, value: row.value,
      realtime_start: row.realtimeStart, realtime_end: row.realtimeEnd, available_at: row.availableAt })), dateColumn: "date", numericColumns: ["value"] };
  }
  if (snapshot.dataClass === "yield_curve") {
    const payload = yieldCurvePayloadSchema.parse(snapshot.payload);
    return { records: payload.points.map((row) => ({ snapshot_id: snapshot.id, curve_id: payload.curveId, curve_date: payload.curveDate, tenor: row.label,
      maturity_years: row.maturityYears, yield_value: row.yield, observation_date: row.observationDate, realtime_start: row.realtimeStart })),
      dateColumn: "observation_date", numericColumns: ["maturity_years", "yield_value"] };
  }
  if (snapshot.dataClass === "universe_membership") {
    const payload = universePayloadSchema.parse(snapshot.payload);
    return { records: payload.members.map((row) => ({ snapshot_id: snapshot.id, universe_key: payload.universeKey, effective_date: payload.effectiveDate,
      entity_key: row.entityKey, symbol: row.symbol, name: row.name, exchange: row.exchange, asset_class: row.assetClass, currency: row.currency,
      weight: row.weight, member_rank: row.rank, valid_from: row.validFrom, valid_to: row.validTo, status: row.status, exit_reason: row.exitReason })),
      dateColumn: "effective_date", numericColumns: ["weight", "member_rank"] };
  }
  if (snapshot.dataClass === "estimates") {
    const payload = estimatesPayloadSchema.parse(snapshot.payload);
    return { records: payload.observations.map((row) => ({ snapshot_id: snapshot.id, symbol: payload.symbol, metric: row.metric, fiscal_period: row.fiscalPeriod, period_end: row.periodEnd, contributor: row.contributor, value: row.value, low: row.low, high: row.high, published_at: row.publishedAt, available_at: row.availableAt })), dateColumn: "period_end", numericColumns: ["value", "low", "high"] };
  }
  if (snapshot.dataClass === "options_chain") {
    const payload = optionsPayloadSchema.parse(snapshot.payload);
    return { records: payload.contracts.map((row) => ({ snapshot_id: snapshot.id, underlying: payload.underlying, contract_symbol: row.contractSymbol, quote_at: row.quoteAt, expiry: row.expiry, type: row.type, strike: row.strike, bid: row.bid, ask: row.ask, last: row.last, volume: row.volume, open_interest: row.openInterest, implied_volatility: row.impliedVolatility, delta: row.delta, gamma: row.gamma, theta: row.theta, vega: row.vega, rho: row.rho })), dateColumn: "expiry", numericColumns: ["strike", "bid", "ask", "last", "volume", "open_interest", "implied_volatility", "delta", "gamma", "theta", "vega", "rho"] };
  }
  if (snapshot.dataClass === "commodity_curve") {
    const payload = commodityCurvePayloadSchema.parse(snapshot.payload);
    return { records: payload.points.map((row) => ({ snapshot_id: snapshot.id, commodity: payload.commodity, contract: row.contract, expiry: row.expiry, observation_at: row.observationAt, price: row.price, volume: row.volume, open_interest: row.openInterest })), dateColumn: "expiry", numericColumns: ["price", "volume", "open_interest"] };
  }
  if (snapshot.dataClass === "portfolio_holdings") {
    const payload = portfolioPayloadSchema.parse(snapshot.payload);
    return { records: payload.holdings.map((row) => ({ snapshot_id: snapshot.id, portfolio_id: payload.portfolioId, as_of: payload.asOf, symbol: row.symbol, quantity: row.quantity, cost_basis: row.costBasis, market_price: row.marketPrice, market_value: row.marketValue })), dateColumn: "as_of", numericColumns: ["quantity", "cost_basis", "market_price", "market_value"] };
  }
  if (snapshot.dataClass === "private_series") {
    const payload = privateSeriesPayloadSchema.parse(snapshot.payload);
    return { records: payload.observations.map((row) => ({ snapshot_id: snapshot.id, series_id: payload.seriesId, observation_at: row.observationAt, available_at: row.availableAt, value: row.value })), dateColumn: "observation_at", numericColumns: ["value"] };
  }
  throw new Error(`Columnar projection is not implemented for data class ${snapshot.dataClass}.`);
}

export async function writeParquetRecords(records: ScalarRecord[], outputPath: string) {
  if (!records.length) throw new Error("Cannot create an empty columnar artifact.");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.${crypto.randomUUID()}.ndjson`;
  fs.writeFileSync(temporary, records.map((row) => JSON.stringify(row)).join("\n") + "\n", { mode: 0o600 });
  try {
    const { DuckDBInstance } = await import("@duckdb/node-api"); const instance = await DuckDBInstance.create(":memory:"); const connection = await instance.connect();
    try {
      await connection.run(`CREATE TABLE artifact AS SELECT * FROM read_json_auto('${sqlPath(temporary)}', format='newline_delimited')`);
      const described = await (await connection.run("DESCRIBE artifact")).getRowObjects();
      await connection.run(`COPY artifact TO '${sqlPath(outputPath)}' (FORMAT parquet, COMPRESSION zstd)`);
      return { rowCount: records.length, schema: described.map((row) => ({ name: String(row.column_name), type: String(row.column_type) })) };
    } finally { connection.closeSync(); }
  } finally { fs.rmSync(temporary, { force: true }); }
}

export async function createColumnarArtifact(datasetSnapshotId: string, actor: ColumnarArtifactActor) {
  const db = getDb(); const [snapshot] = await db.select().from(datasetSnapshots).where(eq(datasetSnapshots.id, datasetSnapshotId)).limit(1);
  if (!snapshot) throw new Error("Dataset snapshot not found.");
  requireDatasetSnapshotAccess(snapshot, actor);
  const createdByUserId = typeof actor === "number" ? actor : actor.userId;
  const [linkedPolicy] = snapshot.entitlementPolicyId
    ? await db.select().from(dataEntitlementPolicies).where(eq(dataEntitlementPolicies.id, snapshot.entitlementPolicyId)).limit(1)
    : [];
  const policy = linkedPolicy ?? await ensureEntitlementPolicy(snapshot.provider, snapshot.dataClass, createdByUserId);
  if (!policy || !policy.permittedUses.includes("export")) throw new Error("The source entitlement policy does not permit local analytical export.");
  const flattened = flattenSnapshotForColumnar(snapshot); const id = crypto.randomUUID(); const relativePath = `${snapshot.dataClass}/${snapshot.id}.parquet`;
  const absolutePath = path.join(columnarRoot(), relativePath); const written = await writeParquetRecords(flattened.records, absolutePath);
  const contentHash = crypto.createHash("sha256").update(fs.readFileSync(absolutePath)).digest("hex");
  const [existing] = await db.select().from(columnarArtifacts).where(and(eq(columnarArtifacts.datasetSnapshotId, snapshot.id), eq(columnarArtifacts.contentHash, contentHash))).limit(1);
  if (existing) return { artifact: existing, created: false };
  const [artifact] = await db.insert(columnarArtifacts).values({ id, datasetSnapshotId: snapshot.id, relativePath, contentHash, rowCount: written.rowCount,
    schema: written.schema, accessScope: policy.accessScope, createdByUserId }).returning();
  return { artifact, created: true };
}

export async function listColumnarArtifacts(datasetSnapshotId?: string, limit = 50) {
  const query = getDb().select().from(columnarArtifacts);
  return datasetSnapshotId ? query.where(eq(columnarArtifacts.datasetSnapshotId, datasetSnapshotId)).orderBy(desc(columnarArtifacts.createdAt)).limit(limit)
    : query.orderBy(desc(columnarArtifacts.createdAt)).limit(limit);
}

export async function scanColumnarArtifact(id: string, input: { metric?: string; dateFrom?: string; dateTo?: string; limit?: number; offset?: number }, ctx?: ColumnarArtifactActor) {
  const requestedLimit = input.limit === undefined ? 20 : input.limit;
  const offset = input.offset === undefined ? 0 : input.offset;
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1) throw new Error("Limit must be a positive safe integer.");
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Offset must be a nonnegative safe integer.");
  const limit = Math.min(requestedLimit, 200);
  const [artifact] = await getDb().select().from(columnarArtifacts).where(eq(columnarArtifacts.id, id)).limit(1);
  if (!artifact) return null;
  const [snapshot] = await getDb().select().from(datasetSnapshots).where(eq(datasetSnapshots.id, artifact.datasetSnapshotId)).limit(1);
  if (!snapshot) return null;
  if (!ctx) throw new Error("Tenant context is required to query a columnar artifact.");
  requireDatasetSnapshotAccess(snapshot, ctx);
  const flattened = flattenSnapshotForColumnar(snapshot); const metric = input.metric ?? flattened.numericColumns[0];
  if (!metric || !flattened.numericColumns.includes(metric)) throw new Error(`Metric must be one of: ${flattened.numericColumns.join(", ")}.`);
  const absolutePath = path.join(columnarRoot(), artifact.relativePath);
  if (!absolutePath.startsWith(`${columnarRoot()}${path.sep}`) || !fs.existsSync(absolutePath)) throw new Error("Columnar artifact file is unavailable.");
  const filters: string[] = [];
  if (flattened.dateColumn && input.dateFrom) filters.push(`${flattened.dateColumn} >= '${sqlPath(input.dateFrom)}'`);
  if (flattened.dateColumn && input.dateTo) filters.push(`${flattened.dateColumn} <= '${sqlPath(input.dateTo)}'`);
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const { DuckDBInstance } = await import("@duckdb/node-api"); const instance = await DuckDBInstance.create(":memory:"); const connection = await instance.connect();
  try {
    const source = `read_parquet('${sqlPath(absolutePath)}')`;
    const numeric = `TRY_CAST(${metric} AS DOUBLE)`;
    const summary = await (await connection.run(`SELECT count(*) AS row_count, count(${numeric}) AS valid_count, min(${numeric}) AS minimum, max(${numeric}) AS maximum, avg(${numeric}) AS mean, stddev_samp(${numeric}) AS standard_deviation FROM ${source} ${where}`)).getRowObjects();
    // Physical Parquet row numbers are stable for this immutable projection, including date ties.
    // Keep the ordering key private rather than introducing a synthetic data column.
    const order = flattened.dateColumn ? `${flattened.dateColumn} DESC, file_row_number ASC` : "file_row_number ASC";
    const sample = await (await connection.run(`SELECT * EXCLUDE (file_row_number) FROM read_parquet('${sqlPath(absolutePath)}', file_row_number = true) ${where} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`)).getRowObjects();
    const availableRowCount = Number(summary[0].row_count);
    return {
      artifact: jsonSafe(artifact), dataClass: snapshot.dataClass, metric, dateColumn: flattened.dateColumn,
      summary: jsonSafe(summary[0]), sample: sample.map((row) => jsonSafe(row) as Record<string, unknown>),
      rowCount: artifact.rowCount, availableRowCount, offset, limit,
      nextOffset: sample.length > 0 && offset + sample.length < availableRowCount ? offset + sample.length : null,
    };
  } finally { connection.closeSync(); }
}
