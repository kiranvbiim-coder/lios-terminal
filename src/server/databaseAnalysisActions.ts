/**
 * P5 / SI-03: turn a user's existing, owned database schema into executable
 * read-only analysis actions. No AI token, guessed mapping, provider call,
 * new query engine, SQL supplied by a model, or background job is involved.
 *
 * SQL can be executed only after the caller has re-read the current owned
 * catalog and chosen one exact recipe. Existing BYOD runtime, auth and SQL
 * read-only checks remain the execution authority.
 */
import type { DatabaseCatalogDiscovery, DatabaseDiscoveredTable } from "./databaseDiscovery";

export type DatabaseAnalysisKind =
  | "preview"
  | "count"
  | "missingness"
  | "numeric_summary"
  | "category_breakdown"
  | "time_metric"
  | "category_metric";

export interface DatabaseAnalysisAction {
  id: string;
  kind: DatabaseAnalysisKind;
  title: string;
  description: string;
  columns: string[];
  sql: string;
}

export interface DatabaseAnalysisActionSet {
  dataset: { schema: string; table: string; databaseType: DatabaseCatalogDiscovery["databaseType"] };
  source: "discovered_schema";
  ready: boolean;
  explanation: string;
  actions: DatabaseAnalysisAction[];
}

const SAFE_SQL_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function safeIdentifier(name: string): boolean {
  return name.length > 0 && name.length <= 63 && SAFE_SQL_NAME.test(name);
}

function quoteIdentifier(name: string, type: DatabaseCatalogDiscovery["databaseType"]): string {
  if (!safeIdentifier(name)) throw new Error("The database identifier cannot be used in a generated analysis.");
  const quote = type === "mysql" ? String.fromCharCode(96) : '"';
  return quote + name + quote;
}

function qualifiedTable(table: DatabaseDiscoveredTable, type: DatabaseCatalogDiscovery["databaseType"]): string {
  const name = quoteIdentifier(table.name, type);
  return type === "sqlite" ? name : quoteIdentifier(table.schema, type) + "." + name;
}

function isNumeric(type: string): boolean {
  return /(?:tinyint|smallint|bigint|integer|decimal|numeric|double|float|real|money|number|^int\b)/i.test(type);
}
function isTemporal(type: string): boolean {
  return /date|time/i.test(type);
}
function isCategorical(type: string): boolean {
  return /char|text|enum|uuid|bool/i.test(type);
}

/**
 * These are SQL templates, NOT inferred findings or confirmed semantic
 * mappings. Only currently discovered, strictly safe identifiers are used.
 */
export function suggestDatabaseAnalysisActions(
  catalog: DatabaseCatalogDiscovery,
  schema: string,
  tableName: string,
): DatabaseAnalysisActionSet {
  const table = catalog.tables.find(row => row.schema === schema && row.name === tableName);
  if (!table) throw new Error("This table is not present in the current authorized database catalog.");
  const dataset = { schema: table.schema, table: table.name, databaseType: catalog.databaseType };
  if (!safeIdentifier(table.schema) || !safeIdentifier(table.name)) {
    return {
      dataset,
      source: "discovered_schema",
      ready: false,
      explanation: "This table uses an identifier the conservative analysis runner cannot safely generate SQL for. Use the existing read-only database query workflow.",
      actions: [],
    };
  }
  const qualified = qualifiedTable(table, catalog.databaseType);
  const eligible = table.columns.filter(column => column.table === table.name
    && column.schema === table.schema && safeIdentifier(column.name));
  // Duplicate case-insensitive column names cannot have an unambiguous action identity.
  const seen = new Set<string>();
  const columns = eligible.filter(column => {
    const key = column.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const numeric = columns.filter(column => isNumeric(column.dataType)).slice(0, 4);
  const category = columns.filter(column => !isTemporal(column.dataType)
    && isCategorical(column.dataType)).slice(0, 3);
  const temporal = columns.filter(column => isTemporal(column.dataType)).slice(0, 2);
  const actions: DatabaseAnalysisAction[] = [];

  const add = (id: string, kind: DatabaseAnalysisKind, title: string, description: string, used: string[], sql: string) => {
    if (actions.length >= 24) return;
    actions.push({ id, kind, title, description, columns: used, sql });
  };
  add("preview", "preview", "Preview records", "Read up to 50 records. This is not a table-wide summary.", [],
    "SELECT * FROM " + qualified + " LIMIT 50");
  add("count", "count", "Count records", "Compute the actual row count at execution time.", [],
    "SELECT COUNT(*) AS record_count FROM " + qualified);
  for (const column of columns.slice(0, 4)) {
    const name = quoteIdentifier(column.name, catalog.databaseType);
    add("missing:" + column.name, "missingness", "Missing values: " + column.name,
      "Count null values in this column, using the current source data.", [column.name],
      "SELECT COUNT(*) AS total_rows, COUNT(*) - COUNT(" + name + ") AS missing_rows FROM " + qualified);
  }
  for (const column of numeric) {
    const name = quoteIdentifier(column.name, catalog.databaseType);
    add("numeric:" + column.name, "numeric_summary", "Summarize: " + column.name,
      "Compute minimum, maximum, average and observed count, excluding nulls.", [column.name],
      "SELECT COUNT(" + name + ") AS observed_count, MIN(" + name + ") AS minimum, MAX(" + name
        + ") AS maximum, AVG(" + name + ") AS average_value FROM " + qualified);
  }
  for (const column of category) {
    const name = quoteIdentifier(column.name, catalog.databaseType);
    add("category:" + column.name, "category_breakdown", "Top groups: " + column.name,
      "Count records by exact stored value. Null is a separate group.", [column.name],
      "SELECT " + name + " AS category, COUNT(*) AS record_count FROM " + qualified
        + " GROUP BY " + name + " ORDER BY record_count DESC LIMIT 20");
  }
  if (temporal.length && numeric.length) {
    const time = temporal[0]!;
    const value = numeric[0]!;
    const t = quoteIdentifier(time.name, catalog.databaseType);
    const v = quoteIdentifier(value.name, catalog.databaseType);
    add("time:" + time.name + ":" + value.name, "time_metric",
      "Recent values: " + value.name + " by " + time.name,
      "Show recorded date/time values without inventing a reporting period or currency.", [time.name, value.name],
      "SELECT " + t + " AS observed_at, " + v + " AS value FROM " + qualified
        + " WHERE " + t + " IS NOT NULL AND " + v + " IS NOT NULL ORDER BY " + t + " DESC LIMIT 100");
  }
  if (category.length && numeric.length) {
    const group = category[0]!;
    const value = numeric[0]!;
    const g = quoteIdentifier(group.name, catalog.databaseType);
    const v = quoteIdentifier(value.name, catalog.databaseType);
    add("groupavg:" + group.name + ":" + value.name, "category_metric",
      "Average " + value.name + " by " + group.name,
      "Compute an average only from observed numeric records, grouped by exact stored values.",
      [group.name, value.name],
      "SELECT " + g + " AS category, AVG(" + v + ") AS average_value, COUNT(" + v
        + ") AS observed_count FROM " + qualified + " GROUP BY " + g
        + " ORDER BY observed_count DESC LIMIT 20");
  }
  return {
    dataset,
    source: "discovered_schema",
    ready: actions.length > 0,
    explanation: "Suggested actions use only discovered column names/types. They are not AI findings, confirmed semantic mappings, or authorization to automate. Execute an action to inspect actual data.",
    actions,
  };
}
