import { discoverDatabaseSchema, type DatabaseColumn, type DatabaseSourceConfig } from "./databaseConnector";

export interface DatabaseDiscoveredTable {
  schema: string;
  name: string;
  columns: DatabaseColumn[];
}

export interface DatabaseCatalogDiscovery {
  databaseType: "postgresql" | "mysql" | "sqlite" | "duckdb";
  tables: DatabaseDiscoveredTable[];
  tableCount: number;
  columnCount: number;
  schemas: string[];
}

export function normalizedDatabaseType(config: DatabaseSourceConfig): DatabaseCatalogDiscovery["databaseType"] {
  if (config.databaseType === "postgres") return "postgresql";
  if (config.databaseType) return config.databaseType;
  try {
    const protocol = new URL(config.endpoint).protocol.replace(":", "");
    if (protocol === "postgres" || protocol === "postgresql") return "postgresql";
    if (protocol === "mysql" || protocol === "sqlite" || protocol === "duckdb") return protocol;
  } catch {
    // The main connector will return the detailed endpoint error.
  }
  return "postgresql";
}

export function databaseTypeNeedsCredential(config: DatabaseSourceConfig): boolean {
  const type = normalizedDatabaseType(config);
  return type === "postgresql" || type === "mysql";
}

export function groupDatabaseColumns(config: DatabaseSourceConfig, columns: readonly DatabaseColumn[]): DatabaseCatalogDiscovery {
  const tableMap = new Map<string, DatabaseDiscoveredTable>();
  for (const column of columns) {
    const key = `${column.schema}\u0000${column.table}`;
    let table = tableMap.get(key);
    if (!table) {
      table = { schema: column.schema, name: column.table, columns: [] };
      tableMap.set(key, table);
    }
    table.columns.push({ ...column });
  }
  const tables = [...tableMap.values()]
    .map(table => ({ ...table, columns: table.columns.sort((a, b) => a.ordinalPosition - b.ordinalPosition || a.name.localeCompare(b.name)) }))
    .sort((a, b) => a.schema.localeCompare(b.schema) || a.name.localeCompare(b.name));
  return {
    databaseType: normalizedDatabaseType(config),
    tables,
    tableCount: tables.length,
    columnCount: columns.length,
    schemas: [...new Set(tables.map(table => table.schema))].sort(),
  };
}

export async function discoverDatabaseCatalog(config: DatabaseSourceConfig, credential: string | null): Promise<DatabaseCatalogDiscovery> {
  if (databaseTypeNeedsCredential(config) && !credential) throw new Error("Database credential is required for PostgreSQL/MySQL discovery.");
  const columns = await discoverDatabaseSchema(config, credential);
  return groupDatabaseColumns(config, columns);
}
