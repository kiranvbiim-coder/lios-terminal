import { and, eq } from "drizzle-orm";
import { getDb } from "./db";
import { auditActor, recordAuditEvent } from "./auditEvents";
import { resolveCredential } from "./credentialVault";
import { discoverApiSource, type ApiDiscoveryResult, type ApiSourceConfig } from "./apiConnector";
import { discoverDatabaseCatalog, type DatabaseCatalogDiscovery } from "./databaseDiscovery";
import type { DatabaseSourceConfig } from "./databaseConnector";
import { sourceConnections, type SourceConnection, type User } from "@shared/schema";
import { TELEGRAM_CONNECTOR_ID } from "@shared/telegramConnection";
import { assertLocalByodRuntime } from "./runtimeSecurity";

async function ownedConnection(userId: number, connectionId: number): Promise<SourceConnection> {
  const [connection] = await getDb().select().from(sourceConnections).where(and(
    eq(sourceConnections.id, connectionId),
    eq(sourceConnections.userId, userId),
  )).limit(1);
  if (!connection || connection.connectorId === TELEGRAM_CONNECTOR_ID) throw new Error("Source connection not found.");
  return connection;
}

function credentialFor(connection: SourceConnection): string | null {
  return connection.credentialRef ? resolveCredential("", connection.credentialRef) : null;
}

function apiConfig(connection: SourceConnection): ApiSourceConfig {
  const endpoint = connection.config.endpoint;
  if (typeof endpoint !== "string") throw new Error("API endpoint is missing.");
  const authMode = connection.config.authMode;
  return {
    endpoint,
    protocol: connection.config.protocol === "graphql" || connection.config.protocol === "soap" ? connection.config.protocol : "rest",
    method: connection.config.method === "POST" ? "POST" : "GET",
    pageParam: typeof connection.config.pageParam === "string" ? connection.config.pageParam : undefined,
    pageSizeParam: typeof connection.config.pageSizeParam === "string" ? connection.config.pageSizeParam : undefined,
    pageSize: typeof connection.config.pageSize === "number" ? connection.config.pageSize : undefined,
    maxPages: 1,
    responsePath: typeof connection.config.responsePath === "string" ? connection.config.responsePath : undefined,
    authMode: authMode === "x-api-key" ? "x-api-key" : authMode === "none" ? "none" : "bearer",
    graphqlQuery: typeof connection.config.graphqlQuery === "string" ? connection.config.graphqlQuery : undefined,
    soapAction: typeof connection.config.soapAction === "string" ? connection.config.soapAction : undefined,
    soapBody: typeof connection.config.soapBody === "string" ? connection.config.soapBody : undefined,
  };
}

function databaseConfig(connection: SourceConnection): DatabaseSourceConfig {
  const endpoint = connection.config.endpoint;
  if (typeof endpoint !== "string") throw new Error("Database endpoint is missing.");
  const configuredType = connection.config.databaseType;
  return {
    endpoint,
    databaseType: configuredType === "postgres" || configuredType === "postgresql" || configuredType === "mysql" || configuredType === "sqlite" || configuredType === "duckdb"
      ? configuredType
      : undefined,
    schema: typeof connection.config.schema === "string" ? connection.config.schema : undefined,
  };
}

export async function discoverApiConnection(
  userId: number,
  connectionId: number,
  actor: Pick<User, "id" | "email">,
): Promise<ApiDiscoveryResult> {
  const connection = await ownedConnection(userId, connectionId);
  if (connection.sourceType !== "private_api") throw new Error("Private API source connection not found.");
  assertLocalByodRuntime("Private API BYOD connector");
  const result = await discoverApiSource(apiConfig(connection), credentialFor(connection));
  await recordAuditEvent(actor.id, "source_api_schema_discovered", {
    connectionId,
    organizationId: connection.organizationId,
    fieldCount: result.fields.length,
    previewRows: result.previewRows.length,
    responsePath: result.responsePath,
    ...auditActor(actor),
  });
  return result;
}

export async function discoverDatabaseConnection(
  userId: number,
  connectionId: number,
  actor: Pick<User, "id" | "email">,
): Promise<DatabaseCatalogDiscovery> {
  const connection = await ownedConnection(userId, connectionId);
  if (connection.sourceType !== "database") throw new Error("Database source connection not found.");
  const result = await discoverDatabaseCatalog(databaseConfig(connection), credentialFor(connection));
  await recordAuditEvent(actor.id, "source_database_catalog_discovered", {
    connectionId,
    organizationId: connection.organizationId,
    databaseType: result.databaseType,
    schemaCount: result.schemas.length,
    tableCount: result.tableCount,
    columnCount: result.columnCount,
    ...auditActor(actor),
  });
  return result;
}
