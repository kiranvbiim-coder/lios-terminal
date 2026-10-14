import { Pool, type PoolClient } from "pg";
import mysql from "mysql2/promise";
import BetterSqlite3 from "better-sqlite3";
import { DuckDBInstance } from "@duckdb/node-api";
import { getContractFamily } from "@shared/dataContracts";
import { assertLocalByodRuntime } from "./runtimeSecurity";

export interface DatabaseSourceConfig {
  endpoint: string;
  databaseType?: "postgresql" | "postgres" | "mysql" | "sqlite" | "duckdb";
  schema?: string;
}

export interface DatabaseCredential {
  username: string;
  password: string;
  ssl?: boolean;
}

export interface DatabaseColumn {
  schema: string;
  table: string;
  name: string;
  dataType: string;
  nullable: boolean;
  ordinalPosition: number;
}

export interface DatabaseQueryResult {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  truncated: boolean;
  snapshotId?: string;
}

export interface ContractColumnMapping {
  sourceColumn: string;
  contractField: string;
  confidence: "exact" | "normalized" | "alias";
}

function identifier(value: string, label: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(value)) throw new Error(`Invalid ${label}.`);
  return value;
}

function parseCredential(value: string): DatabaseCredential {
  try {
    const parsed = JSON.parse(value) as Partial<DatabaseCredential>;
    if (typeof parsed.username !== "string" || typeof parsed.password !== "string") throw new Error("Database credential must contain username and password.");
    return { username: parsed.username, password: parsed.password, ssl: parsed.ssl === true };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Database credential")) throw error;
    throw new Error("Database credential must be JSON with username and password.");
  }
}

export function assertDatabaseConnectorRuntime(env: NodeJS.ProcessEnv = process.env): void {
  assertLocalByodRuntime("Database BYOD connector", env);
}

function databaseType(config: DatabaseSourceConfig): NonNullable<DatabaseSourceConfig["databaseType"]> {
  if (config.databaseType === "postgres") return "postgresql";
  return config.databaseType ?? "postgresql";
}

export function filePath(endpoint: string, protocol: "sqlite" | "duckdb"): string {
  if (endpoint.startsWith(`${protocol}://`)) {
    const remainder = endpoint.slice(protocol.length + 3);
    // A native Windows path such as C:\data\x.db is not a URL authority and `new URL` rejects it.
    if (/^[A-Za-z]:[\\/]/.test(remainder)) return remainder;
    const parsed = new URL(endpoint);
    let decoded = decodeURIComponent(parsed.pathname);
    // sqlite:///C:/data/x.db parses as "/C:/data/x.db"; the leading slash is not part of a Windows path.
    if (/^\/[A-Za-z]:[\\/]/.test(decoded)) decoded = decoded.slice(1);
    if (parsed.hostname && parsed.hostname !== "localhost") return `//${parsed.hostname}${decoded}`;
    return decoded;
  }
  return endpoint;
}

function poolFor(config: DatabaseSourceConfig, credential: string): Pool {
  const url = new URL(config.endpoint);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") throw new Error("Invalid PostgreSQL endpoint.");
  if (url.username || url.password) throw new Error("Database endpoint must not contain credentials.");
  const auth = parseCredential(credential);
  return new Pool({
    host: url.hostname,
    port: url.port ? Number(url.port) : 5432,
    database: decodeURIComponent(url.pathname.replace(/^\//, "")),
    user: auth.username,
    password: auth.password,
    ssl: auth.ssl ? { rejectUnauthorized: true } : undefined,
    max: 1,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 5_000,
  });
}

async function withReadOnlyClient<T>(config: DatabaseSourceConfig, credential: string, callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const pool = poolFor(config, credential);
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = 5000");
    return await callback(client);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    await pool.end();
  }
}

function resultFromRows(rows: Array<Record<string, unknown>>, columns?: string[]): DatabaseQueryResult {
  const boundedRows = rows.slice(0, 1_000);
  const resolvedColumns = columns ?? (boundedRows.length ? Object.keys(boundedRows[0]) : []);
  return {
    columns: resolvedColumns,
    rows: boundedRows,
    rowCount: rows.length,
    truncated: rows.length > boundedRows.length,
  };
}

async function executeMySql(config: DatabaseSourceConfig, credential: string, query: string, params: unknown[]): Promise<DatabaseQueryResult> {
  const url = new URL(config.endpoint);
  if (url.protocol !== "mysql:") throw new Error("Invalid MySQL endpoint.");
  if (url.username || url.password) throw new Error("Database endpoint must not contain credentials.");
  const auth = parseCredential(credential);
  const connection = await mysql.createConnection({
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    database: decodeURIComponent(url.pathname.replace(/^\//, "")),
    user: auth.username,
    password: auth.password,
    ssl: auth.ssl ? {} : undefined,
    connectTimeout: 5_000,
  });
  try {
    await connection.query("SET TRANSACTION READ ONLY");
    const [rawRows, rawFields] = await connection.query(query, params);
    const rows = Array.isArray(rawRows) ? rawRows as Array<Record<string, unknown>> : [];
    const fields = Array.isArray(rawFields) ? rawFields as Array<{ name?: string }> : [];
    return resultFromRows(rows, fields.map((field) => field.name ?? ""));
  } finally {
    await connection.end();
  }
}

function executeSqlite(config: DatabaseSourceConfig, query: string, params: unknown[]): DatabaseQueryResult {
  const database = new BetterSqlite3(filePath(config.endpoint, "sqlite"), { fileMustExist: true, timeout: 5_000 });
  try {
    database.pragma("query_only = ON");
    const statement = database.prepare(query);
    const rows = statement.all(...params) as Array<Record<string, unknown>>;
    return resultFromRows(rows, statement.columns().map((column) => column.name));
  } finally {
    database.close();
  }
}

async function executeDuckDb(config: DatabaseSourceConfig, query: string): Promise<DatabaseQueryResult> {
  const instance = await DuckDBInstance.create(filePath(config.endpoint, "duckdb"));
  const connection = await instance.connect();
  try {
    const result = await connection.run(query);
    const rows = await result.getRowObjects() as Array<Record<string, unknown>>;
    return resultFromRows(rows);
  } finally {
    connection.closeSync();
  }
}

export async function testDatabaseConnection(config: DatabaseSourceConfig, credential: string | null): Promise<{ detail: string; serverVersion: string | null }> {
  assertDatabaseConnectorRuntime();
  const type = databaseType(config);
  if (type === "sqlite") {
    const result = executeSqlite(config, "SELECT sqlite_version() AS version", []);
    return { detail: "SQLite read-only connection succeeded.", serverVersion: String(result.rows[0]?.version ?? "unknown") };
  }
  if (type === "duckdb") {
    const result = await executeDuckDb(config, "SELECT version() AS version");
    return { detail: "DuckDB read-only connection succeeded.", serverVersion: String(result.rows[0]?.version ?? "unknown") };
  }
  if (!credential) throw new Error("Database credential is required.");
  if (type === "mysql") {
    const result = await executeMySql(config, credential, "SELECT VERSION() AS version", []);
    return { detail: "MySQL read-only connection succeeded.", serverVersion: String(result.rows[0]?.version ?? "unknown") };
  }
  return withReadOnlyClient(config, credential, async (client) => {
    const result = await client.query<{ version: string }>("SELECT current_setting('server_version') AS version");
    return { detail: "PostgreSQL read-only connection succeeded.", serverVersion: result.rows[0]?.version ?? null };
  });
}

export async function discoverDatabaseSchema(config: DatabaseSourceConfig, credential: string | null): Promise<DatabaseColumn[]> {
  assertDatabaseConnectorRuntime();
  const type = databaseType(config);
  if (type === "sqlite") {
    const database = new BetterSqlite3(filePath(config.endpoint, "sqlite"), { fileMustExist: true, timeout: 5_000 });
    try {
      database.pragma("query_only = ON");
      const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>;
      return tables.flatMap((table) => database.prepare(`SELECT name, type, \n              [notnull] = 0 AS nullable, cid + 1 AS ordinalPosition\n         FROM pragma_table_info(?)`).all(table.name).map((column) => ({ schema: "main", table: table.name, name: String((column as { name: string }).name), dataType: String((column as { type: string }).type), nullable: Boolean((column as { nullable: boolean }).nullable), ordinalPosition: Number((column as { ordinalPosition: number }).ordinalPosition) })));
    } finally {
      database.close();
    }
  }
  if (type === "duckdb") {
    const result = await executeDuckDb(config, `SELECT table_schema AS schema, table_name AS table, column_name AS name, data_type AS "dataType", is_nullable = 'YES' AS nullable, ordinal_position AS "ordinalPosition" FROM information_schema.columns WHERE table_schema NOT IN ('pg_catalog', 'information_schema')${config.schema ? ` AND table_schema = '${identifier(config.schema, "schema")}'` : ""} ORDER BY table_schema, table_name, ordinal_position`);
    return result.rows as unknown as DatabaseColumn[];
  }
  if (!credential) throw new Error("Database credential is required.");
  if (type === "mysql") {
    const result = await executeMySql(config, credential, `SELECT table_schema AS schema, table_name AS table, column_name AS name, data_type AS dataType, is_nullable = 'YES' AS nullable, ordinal_position AS ordinalPosition FROM information_schema.columns WHERE table_schema = DATABASE()${config.schema ? " AND table_schema = ?" : ""} ORDER BY table_schema, table_name, ordinal_position`, config.schema ? [config.schema] : []);
    return result.rows as unknown as DatabaseColumn[];
  }
  return withReadOnlyClient(config, credential, async (client) => {
    const result = await client.query<DatabaseColumn>(
      `SELECT table_schema AS schema, table_name AS table, column_name AS name,
              data_type AS "dataType", is_nullable = 'YES' AS nullable,
              ordinal_position AS "ordinalPosition"
         FROM information_schema.columns
        WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
          AND ($1::text IS NULL OR table_schema = $1)
        ORDER BY table_schema, table_name, ordinal_position`,
      [config.schema ?? null],
    );
    return result.rows;
  });
}

export async function executeReadOnlyQuery(config: DatabaseSourceConfig, credential: string | null, query: string, params: unknown[] = []): Promise<DatabaseQueryResult> {
  assertDatabaseConnectorRuntime();
  const normalized = query.trim();
  if (!/^(select|with|explain|pragma)\b/i.test(normalized) || normalized.includes(";")) {
    throw new Error("Only one read-only SELECT, WITH, EXPLAIN, or PRAGMA statement is allowed.");
  }
  const type = databaseType(config);
  if (type === "sqlite") return executeSqlite(config, normalized, params);
  if (type === "duckdb") {
    if (params.length) throw new Error("DuckDB connector does not accept positional parameters in this release.");
    return executeDuckDb(config, normalized);
  }
  if (!credential) throw new Error("Database credential is required.");
  if (type === "mysql") return executeMySql(config, credential, normalized, params);
  return withReadOnlyClient(config, credential, async (client) => {
    const result = await client.query(normalized, params);
    const rows = result.rows.slice(0, 1_000) as Array<Record<string, unknown>>;
    return {
      columns: result.fields.map((field) => field.name),
      rows,
      rowCount: result.rowCount ?? rows.length,
      truncated: result.rows.length > rows.length,
    };
  });
}

export async function profileDatabaseTable(config: DatabaseSourceConfig, credential: string | null, schema: string, table: string): Promise<DatabaseQueryResult> {
  const safeSchema = identifier(schema, "schema");
  const safeTable = identifier(table, "table");
  const type = databaseType(config);
  const qualified = type === "sqlite" ? `"${safeTable}"` : `"${safeSchema}"."${safeTable}"`;
  return executeReadOnlyQuery(config, credential, `SELECT * FROM ${qualified} LIMIT 100`);
}

function normalizeField(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function mapColumnsToContract(columns: string[], contractFamily: string): { mappings: ContractColumnMapping[]; unmappedColumns: string[]; missingFields: string[] } {
  const contract = getContractFamily(contractFamily);
  if (!contract) throw new Error(`Unknown contract family: ${contractFamily}.`);
  const aliases: Record<string, string[]> = {
    revenue: ["sales", "turnover", "revenues"],
    netIncome: ["netprofit", "profitaftertax", "pat"],
    marketCap: ["marketcapitalization", "mktcap"],
    closingPrice: ["close", "closingprice", "adjclose"],
  };
  const used = new Set<string>();
  const mappings: ContractColumnMapping[] = [];
  for (const column of columns) {
    const normalized = normalizeField(column);
    const exact = contract.fields.find((field) => field.name.toLowerCase() === column.toLowerCase() && !used.has(field.name));
    const normalizedMatch = exact
      ?? contract.fields.find((field) => !used.has(field.name) && normalizeField(field.name) === normalized);
    const aliasMatch = normalizedMatch
      ?? contract.fields.find((field) => !used.has(field.name) && (aliases[field.name] ?? []).some((alias) => normalizeField(alias) === normalized));
    const fuzzyMatch = aliasMatch
      ?? contract.fields.find((field) => {
        if (used.has(field.name)) return false;
        const fieldName = normalizeField(field.name);
        return fieldName.includes(normalized) || normalized.includes(fieldName);
      });
    if (!fuzzyMatch) continue;
    used.add(fuzzyMatch.name);
    mappings.push({ sourceColumn: column, contractField: fuzzyMatch.name, confidence: exact ? "exact" : normalizedMatch ? "normalized" : aliasMatch ? "alias" : "normalized" });
  }
  return {
    mappings,
    unmappedColumns: columns.filter((column) => !mappings.some((mapping) => mapping.sourceColumn === column)),
    missingFields: contract.fields.filter((field) => field.requirement === "required" && !used.has(field.name)).map((field) => field.name),
  };
}
