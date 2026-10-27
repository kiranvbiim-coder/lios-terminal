import { and, desc, eq } from "drizzle-orm";
import { getDb } from "./db";
import { auditActor, recordAuditEvent } from "./auditEvents";
import { getConnectorById, getConnectorRegistrySnapshot, getUserScopedConnectorRegistrySnapshot, testConnectorCredential } from "./connectorService";
import type { ConnectorRuntimeState } from "@shared/connectorRegistry";
import { hasConnectorProbe, probeConnector } from "./connectorVerification";
import { getCredentialProbeFactory } from "./connectorCredentialProbes";
import "./connectorProbes";
import { fetchWithEndpointPolicy, normalizeSourceConfig, validateMcpSourceEndpoint, validateSourceEndpoint } from "./sourceConnectionPolicy";
import { resolveCredential } from "./credentialVault";
import { discoverDatabaseSchema, executeReadOnlyQuery, profileDatabaseTable, testDatabaseConnection, type DatabaseColumn, type DatabaseQueryResult, type DatabaseSourceConfig } from "./databaseConnector";
import { fetchApiSource, mapApiRecordsToContract, type ApiFetchResult, type ApiMappedResult, type ApiSourceConfig } from "./apiConnector";
import { sourceConnections, type SourceConnection, type SourceConnectionConfig, type User } from "@shared/schema";
import { persistSourceSnapshot } from "./sourceSnapshotStore";
import { normalizeUniversalFinanceRecords } from "@shared/universalIngestion";
import { assertLocalByodRuntime } from "./runtimeSecurity";
import { clearProviderExecutionCache } from "./providerExecutionCache";
import fs from "node:fs";
import path from "node:path";

export interface SourceConnectionTestResult {
  connectionId: number;
  status: SourceConnection["status"];
  detail: string;
  testedAt: string;
}
async function assertConnectorConfig(input: SourceConnectionConfig): Promise<void> {
  const connector = getConnectorById(input.connectorId);
  const customConnector = input.connectorId.startsWith("custom_");
  if (!connector && !customConnector) throw new Error("Connector is not registered.");
  if (connector && connector.sourceType !== input.sourceType) throw new Error("Source type does not match the registered connector.");
  if (input.credentialRef && connector?.vaultKey && connector.vaultKey !== input.credentialRef && input.sourceType !== "database") throw new Error("Credential reference does not match the registered connector.");
  if (input.sourceType === "private_api" || input.sourceType === "cloud_storage" || input.sourceType === "mcp") {
    const endpoint = input.config.endpoint;
    if (typeof endpoint !== "string") throw new Error("An endpoint is required for this source type.");
    const policy = input.sourceType === "mcp"
      ? await validateMcpSourceEndpoint(endpoint)
      : await validateSourceEndpoint(endpoint);
    if (!policy.valid) throw new Error(`Endpoint rejected: ${policy.reason}.`);
  }
  if (input.sourceType === "file") {
    const configuredPath = input.config.path;
    if (typeof configuredPath !== "string" || !configuredPath.trim()) throw new Error("A local file path is required.");
    const ext = path.extname(configuredPath).toLowerCase();
    if (![".json", ".ndjson", ".jsonl", ".csv", ".tsv", ".parquet"].includes(ext)) {
      throw new Error("File connector supports JSON, NDJSON, CSV, TSV, and Parquet.");
    }
  }
  if (input.sourceType === "database") {
    const endpoint = input.config.endpoint;
    if (typeof endpoint !== "string") throw new Error("A database endpoint is required.");
    let parsed: URL;
    try {
      parsed = new URL(endpoint);
    } catch {
      throw new Error("Database endpoint is not a valid URL.");
    }
    const configuredType = typeof input.config.databaseType === "string" ? input.config.databaseType : parsed.protocol.replace(":", "");
    const supported = new Set(["postgres", "postgresql", "mysql", "sqlite", "duckdb"]);
    if (!supported.has(configuredType)) throw new Error("Database connector supports PostgreSQL, MySQL, SQLite, and DuckDB.");
    if (parsed.username || parsed.password) throw new Error("Database endpoint must not contain credentials.");
    if ((configuredType === "postgres" || configuredType === "postgresql" || configuredType === "mysql") && !input.credentialRef) {
      throw new Error("A database credential reference is required for server databases.");
    }
  }
}
function databaseConfig(connection: SourceConnection): DatabaseSourceConfig {
  const endpoint = connection.config.endpoint;
  if (typeof endpoint !== "string") throw new Error("Database endpoint is missing.");
  const configuredType = typeof connection.config.databaseType === "string" ? connection.config.databaseType : undefined;
  let inferredType: DatabaseSourceConfig["databaseType"];
  try {
    const protocol = new URL(endpoint).protocol.replace(":", "");
    inferredType = protocol === "postgres" || protocol === "postgresql" || protocol === "mysql" || protocol === "sqlite" || protocol === "duckdb" ? protocol : undefined;
  } catch {
    inferredType = undefined;
  }
  return {
    endpoint,
    databaseType: configuredType === "postgres" || configuredType === "postgresql" || configuredType === "mysql" || configuredType === "sqlite" || configuredType === "duckdb" ? configuredType : inferredType,
    schema: typeof connection.config.schema === "string" ? connection.config.schema : undefined,
  };
}

function databaseCredential(connection: SourceConnection): string | null {
  if (!connection.credentialRef) return null;
  return resolveCredential("", connection.credentialRef);
}
function apiConfig(connection: SourceConnection): ApiSourceConfig {
  const endpoint = connection.config.endpoint;
  if (typeof endpoint !== "string") throw new Error("API endpoint is missing.");
  return {
    endpoint,
    protocol: connection.config.protocol === "graphql" || connection.config.protocol === "soap" ? connection.config.protocol : "rest",
    method: connection.config.method === "POST" ? "POST" : "GET",
    pageParam: typeof connection.config.pageParam === "string" ? connection.config.pageParam : undefined,
    pageSizeParam: typeof connection.config.pageSizeParam === "string" ? connection.config.pageSizeParam : undefined,
    pageSize: typeof connection.config.pageSize === "number" ? connection.config.pageSize : undefined,
    maxPages: typeof connection.config.maxPages === "number" ? connection.config.maxPages : undefined,
    responsePath: typeof connection.config.responsePath === "string" ? connection.config.responsePath : undefined,
    authMode: connection.config.authMode === "x-api-key" ? "x-api-key" : connection.config.authMode === "none" ? "none" : connection.config.authMode === "oauth" ? "oauth" : "bearer",
    graphqlQuery: typeof connection.config.graphqlQuery === "string" ? connection.config.graphqlQuery : undefined,
    soapAction: typeof connection.config.soapAction === "string" ? connection.config.soapAction : undefined,
    soapBody: typeof connection.config.soapBody === "string" ? connection.config.soapBody : undefined,
  };
}

function apiCredential(connection: SourceConnection): string | null {
  return connection.credentialRef ? resolveCredential("", connection.credentialRef) : null;
}

export async function listSourceConnections(userId: number): Promise<SourceConnection[]> {
  const db = getDb();
  return db.select().from(sourceConnections).where(eq(sourceConnections.userId, userId)).orderBy(desc(sourceConnections.updatedAt));
}
async function ownedSourceConnection(userId: number, connectionId: number): Promise<SourceConnection | null> {
  const [connection] = await getDb().select().from(sourceConnections).where(and(
    eq(sourceConnections.id, connectionId),
    eq(sourceConnections.userId, userId),
  )).limit(1);
  return connection ?? null;
}

export async function discoverDatabaseSource(
  userId: number,
  connectionId: number,
  actor: Pick<User, "id" | "email">,
): Promise<DatabaseColumn[]> {
  const connection = await ownedSourceConnection(userId, connectionId);
  if (!connection || connection.sourceType !== "database") throw new Error("Database source connection not found.");
  const credential = databaseCredential(connection);
  const result = await discoverDatabaseSchema(databaseConfig(connection), credential);
  await recordAuditEvent(actor.id, "source_database_schema_discovered", { connectionId, organizationId: connection.organizationId, columnCount: result.length, ...auditActor(actor) });
  return result;
}

export async function queryDatabaseSource(
  userId: number,
  connectionId: number,
  query: string,
  params: unknown[],
  actor: Pick<User, "id" | "email">,
): Promise<DatabaseQueryResult> {
  const connection = await ownedSourceConnection(userId, connectionId);
  if (!connection || connection.sourceType !== "database") throw new Error("Database source connection not found.");
  const credential = databaseCredential(connection);
  const result = await executeReadOnlyQuery(databaseConfig(connection), credential, query, params);
  const snapshot = await persistSourceSnapshot({
    connectionId,
    userId,
    organizationId: connection.organizationId,
    connectorId: connection.connectorId,
    operation: "database_query",
    records: result.rows,
    columns: result.columns,
    rowCount: result.rowCount,
    sourceConfig: connection.config,
  });
  await recordAuditEvent(actor.id, "source_database_query_executed", { connectionId, organizationId: connection.organizationId, rowCount: result.rowCount, snapshotId: snapshot.id, ...auditActor(actor) });
  return { ...result, snapshotId: snapshot.id };
}

export async function profileDatabaseSource(
  userId: number,
  connectionId: number,
  schema: string,
  table: string,
  actor: Pick<User, "id" | "email">,
): Promise<DatabaseQueryResult> {
  const connection = await ownedSourceConnection(userId, connectionId);
  if (!connection || connection.sourceType !== "database") throw new Error("Database source connection not found.");
  const credential = databaseCredential(connection);
  const result = await profileDatabaseTable(databaseConfig(connection), credential, schema, table);
  const snapshot = await persistSourceSnapshot({
    connectionId,
    userId,
    organizationId: connection.organizationId,
    connectorId: connection.connectorId,
    operation: "database_profile",
    records: result.rows,
    columns: result.columns,
    rowCount: result.rowCount,
    sourceConfig: { ...connection.config, schema, table },
  });
  await recordAuditEvent(actor.id, "source_database_table_profiled", { connectionId, organizationId: connection.organizationId, schema, table, rowCount: result.rowCount, snapshotId: snapshot.id, ...auditActor(actor) });
  return { ...result, snapshotId: snapshot.id };
}
export async function fetchApiSourceConnection(
  userId: number,
  connectionId: number,
  actor: Pick<User, "id" | "email">,
): Promise<ApiFetchResult> {
  assertLocalByodRuntime("Private API BYOD connector");
  const connection = await ownedSourceConnection(userId, connectionId);
  if (!connection || connection.sourceType !== "private_api") throw new Error("Private API source connection not found.");
  const result = await fetchApiSource(apiConfig(connection), apiCredential(connection));
  const snapshot = await persistSourceSnapshot({
    connectionId,
    userId,
    organizationId: connection.organizationId,
    connectorId: connection.connectorId,
    operation: "api_fetch",
    records: result.records,
    rowCount: result.records.length,
    retrievedAt: result.retrievedAt,
    sourceConfig: connection.config,
  });
  await recordAuditEvent(actor.id, "source_api_fetched", { connectionId, organizationId: connection.organizationId, rowCount: result.records.length, pagesFetched: result.pagesFetched, snapshotId: snapshot.id, ...auditActor(actor) });
  return { ...result, snapshotId: snapshot.id };
}

export async function mapApiSourceConnection(
  userId: number,
  connectionId: number,
  contractFamily: string,
  actor: Pick<User, "id" | "email">,
  options: { symbol?: string; defaultPeriod?: string; defaultCurrency?: string } = {},
): Promise<ApiMappedResult> {
  const fetched = await fetchApiSourceConnection(userId, connectionId, actor);
  const result = mapApiRecordsToContract(fetched.records, contractFamily);
  const connection = await ownedSourceConnection(userId, connectionId);
  if (!connection) throw new Error("Private API source connection not found.");
  const shouldNormalizeFinance = contractFamily === "financial_statements" || contractFamily === "financial_metrics";
  const symbol = options.symbol?.trim().toUpperCase();
  const normalized = shouldNormalizeFinance && symbol
    ? normalizeUniversalFinanceRecords({ symbol, records: result.records, source: connection.name, provider: connection.connectorId, sourceUrl: typeof connection.config.endpoint === "string" ? connection.config.endpoint : undefined, defaultPeriod: options.defaultPeriod, defaultCurrency: options.defaultCurrency })
    : null;
  const snapshot = await persistSourceSnapshot({
    connectionId,
    userId,
    organizationId: connection.organizationId,
    connectorId: connection.connectorId,
    operation: "api_mapping",
    records: result.records,
    contractFamily,
    mappings: result.mappings,
    missingFields: result.missingFields,
    rowCount: result.records.length,
    sourceConfig: connection.config,
  });
  await recordAuditEvent(actor.id, "source_api_mapped", { connectionId, contractFamily, mappedFields: result.mappings.length, missingFields: result.missingFields, normalizedObservations: normalized?.observations.length ?? 0, rejectedRows: normalized?.rejected.length ?? 0, snapshotId: snapshot.id, ...auditActor(actor) });
  return { ...result, normalizedObservations: normalized?.observations, normalizedRejected: normalized?.rejected, snapshotId: snapshot.id };
}

export async function upsertSourceConnection(
  userId: number,
  organizationId: number | null,
  input: SourceConnectionConfig,
  actor: Pick<User, "id" | "email">,
): Promise<SourceConnection> {
  await assertConnectorConfig(input);
  const db = getDb();
  const now = new Date();
  const config = await normalizeSourceConfig(input.sourceType, input.config);
  const credentialRef = input.credentialRef ?? null;

  if (input.id !== undefined) {
    const [updated] = await db.update(sourceConnections).set({
      organizationId,
      connectorId: input.connectorId,
      name: input.name,
      sourceType: input.sourceType,
      config,
      credentialRef,
      status: "configured",
      statusDetail: "Source configuration changed; connection test required.",
      updatedAt: now,
    }).where(and(eq(sourceConnections.id, input.id), eq(sourceConnections.userId, userId))).returning();
    if (!updated) throw new Error("Source connection was not found.");
    // An identical adapter id/metadata can resolve a changed endpoint, file,
    // credential or rights policy. Never reuse an earlier cached observation.
    clearProviderExecutionCache();

    await recordAuditEvent(actor.id, "source_connection_saved", {
      connectionId: updated.id,
      connectorId: updated.connectorId,
      sourceType: updated.sourceType,
      organizationId,
      ...auditActor(actor),
    });
    return updated;
  }

  const [connection] = await db.insert(sourceConnections).values({
    userId,
    organizationId,
    connectorId: input.connectorId,
    name: input.name,
    sourceType: input.sourceType,
    config,
    credentialRef,
    status: "configured",
    statusDetail: "Source configured; connection test has not run.",
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [sourceConnections.userId, sourceConnections.connectorId, sourceConnections.name],
    set: {
      organizationId,
      sourceType: input.sourceType,
      config,
      credentialRef,
      status: "configured",
      statusDetail: "Source configuration changed; connection test required.",
      updatedAt: now,
    },
  }).returning();
  clearProviderExecutionCache();

  await recordAuditEvent(actor.id, "source_connection_saved", {
    connectionId: connection.id,
    connectorId: connection.connectorId,
    sourceType: connection.sourceType,
    organizationId,
    ...auditActor(actor),
  });
  return connection;
}

export async function deleteSourceConnection(userId: number, connectionId: number, actor: Pick<User, "id" | "email">): Promise<boolean> {
  const db = getDb();
  const [connection] = await db.select().from(sourceConnections).where(and(eq(sourceConnections.id, connectionId), eq(sourceConnections.userId, userId))).limit(1);
  if (!connection) return false;
  await db.delete(sourceConnections).where(and(eq(sourceConnections.id, connectionId), eq(sourceConnections.userId, userId)));
  clearProviderExecutionCache();
  await recordAuditEvent(actor.id, "source_connection_deleted", { connectionId, connectorId: connection.connectorId, organizationId: connection.organizationId, ...auditActor(actor) });
  return true;
}

/** A passive observation cannot satisfy a user-initiated "Verify" click.
 * Only this invocation's successful live probe may write healthy status. */
export function unprobedConnectionResult(state: ConnectorRuntimeState | null | undefined): {
  status: "configured" | "degraded" | "unreachable" | "invalid";
  detail: string;
} {
  if (!state) return { status: "unreachable", detail: "No live probe is registered and no runtime observation is available. Verification was not performed." };
  const status = state === "catalog_only" ? "invalid"
    : state === "disabled" || state === "degraded" || state === "rate_limited" ? "degraded"
    : state === "adapter_available" || state === "credential_configured" || state === "live_verified" ? "configured"
    : "unreachable";
  return {
    status,
    detail: `Live verification is not supported for this connector in this build. Last observed runtime state: ${state}. This check did not contact the provider or verify access.`,
  };
}

export async function testSourceConnection(userId: number, connectionId: number, actor: Pick<User, "id" | "email">): Promise<SourceConnectionTestResult | null> {
  const db = getDb();
  const [connection] = await db.select().from(sourceConnections).where(and(eq(sourceConnections.id, connectionId), eq(sourceConnections.userId, userId))).limit(1);
  if (!connection) return null;

  let status: SourceConnection["status"] = "unreachable";
  let detail = "Source did not respond.";

  if (connection.sourceType === "file") {
    try {
      assertLocalByodRuntime("Local file BYOD connector");
      const configuredPath = connection.config.path;
      if (typeof configuredPath !== "string") throw new Error("Local file path is missing.");
      const real = fs.realpathSync(path.resolve(configuredPath));
      const stat = fs.statSync(real);
      status = stat.isFile() ? "healthy" : "invalid";
      detail = stat.isFile() ? `Local file is readable (${stat.size} bytes).` : "Configured path is not a regular file.";
    } catch (error) {
      status = "unreachable";
      detail = error instanceof Error ? error.message : "Local file is unavailable.";
    }
  } else if (connection.sourceType === "database") {
    const credential = databaseCredential(connection);
    if (!credential) {
      status = "degraded";
      detail = "Database connector is registered but its credential is unavailable to this runtime.";
    } else {
      try {
        const result = await testDatabaseConnection(databaseConfig(connection), credential);
        status = "healthy";
        detail = result.serverVersion ? `${result.detail} PostgreSQL ${result.serverVersion}.` : result.detail;
      } catch (error) {
        status = "unreachable";
        detail = error instanceof Error ? error.message : "Database connection failed.";
      }
    }
  } else if (connection.sourceType === "private_api") {
    try {
      assertLocalByodRuntime("Private API BYOD connector");
      const result = await fetchApiSource(apiConfig(connection), apiCredential(connection));
      status = "healthy";
      detail = `API responded with HTTP ${result.status}; fetched ${result.records.length} records.`;
    } catch (error) {
      status = "unreachable";
      detail = error instanceof Error ? error.message : "API connection failed.";
    }
  } else if (connection.sourceType === "cloud_storage") {
    try {
      assertLocalByodRuntime("Cloud storage BYOD connector");
      const endpoint = typeof connection.config.endpoint === "string" ? connection.config.endpoint : null;
      const policy = await validateSourceEndpoint(endpoint);
      if (!policy.valid || !policy.normalizedEndpoint) {
        status = "invalid";
        detail = `Endpoint rejected: ${policy.reason}.`;
      } else {
        const response = await fetchWithEndpointPolicy(policy.normalizedEndpoint, { method: "HEAD", signal: AbortSignal.timeout(5_000) });
        status = response.ok ? "healthy" : response.status === 401 || response.status === 403 ? "degraded" : "unreachable";
        detail = `Endpoint responded with HTTP ${response.status}.`;
      }
    } catch (error) {
      status = "unreachable";
      detail = error instanceof Error ? error.message : "Endpoint request failed.";
    }
  } else if (connection.sourceType === "keyed_api") {
    const connector = getConnectorById(connection.connectorId);
    const credential = connector?.vaultKey ? resolveCredential("", connector.vaultKey) : null;
    if (!credential) {
      status = "degraded";
      detail = "Connector is registered but no credential is available to this runtime.";
    } else if (getCredentialProbeFactory(connection.connectorId)) {
      // Reuse the same explicit credential probe required when saving a keyed
      // connector. A user-clicked Verify must test this saved key now, not
      // recycle passive process-local health from another request or owner.
      // Only providers with a registered probe take this path.
      const verification = await testConnectorCredential(connection.connectorId, credential);
      status = verification.state;
      detail = verification.detail;
    } else if (hasConnectorProbe(connection.connectorId)) {
      const verification = await probeConnector(connection.connectorId);
      status = verification.ok ? "healthy" : "unreachable";
      detail = verification.detail;
    } else {
      const snapshot = await getConnectorRegistrySnapshot();
      const health = snapshot.health.find((item) => item.connectorId === connection.connectorId);
      const noLiveProbe = unprobedConnectionResult(health?.state);
      status = noLiveProbe.status;
      detail = noLiveProbe.detail;
    }
  } else if (connection.sourceType === "public_api" || connection.sourceType === "sidecar") {
    if (hasConnectorProbe(connection.connectorId)) {
      const verification = await probeConnector(connection.connectorId);
      status = verification.ok ? "healthy" : "unreachable";
      detail = verification.detail;
    } else {
      const snapshot = await getConnectorRegistrySnapshot();
      const health = snapshot.health.find((item) => item.connectorId === connection.connectorId);
      const noLiveProbe = unprobedConnectionResult(health?.state);
      status = noLiveProbe.status;
      detail = noLiveProbe.detail;
    }
  } else {
    status = "configured";
    detail = "Source configuration is valid; live connector test is not available for this source type yet.";
  }

  const testedAt = new Date().toISOString();
  await db.update(sourceConnections).set({ status, statusDetail: detail, lastTestedAt: new Date(testedAt), lastHealthyAt: status === "healthy" ? new Date(testedAt) : connection.lastHealthyAt, updatedAt: new Date(testedAt) }).where(and(eq(sourceConnections.id, connectionId), eq(sourceConnections.userId, userId)));
  // Verification may revoke a once-healthy source, or prove a freshly
  // rotated credential. Both change the authority of retained observations.
  clearProviderExecutionCache();
  await recordAuditEvent(actor.id, "source_connection_tested", { connectionId, connectorId: connection.connectorId, status, organizationId: connection.organizationId, ...auditActor(actor) });
  return { connectionId, status, detail, testedAt };
}
