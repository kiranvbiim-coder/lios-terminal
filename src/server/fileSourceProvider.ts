import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { SourceConnection } from "@shared/schema";
import type { LiOSDataProviderAdapter } from "./providerSdk";
import { assertLocalByodRuntime } from "./runtimeSecurity";

const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;
const DEFAULT_MAX_ROWS = 50_000;

function configuredPath(connection: SourceConnection): string {
  const value = connection.config.path;
  if (typeof value !== "string" || !value.trim()) throw new Error("File source requires a configured local path.");
  return value.trim();
}
function sqlPath(value: string): string { return value.replaceAll("'", "''"); }

export interface LocalFileReadResult {
  format: "json" | "csv" | "tsv" | "parquet";
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  columns: string[];
  contentHash: string;
  byteLength: number;
}

export async function readConfiguredLocalFile(
  connection: SourceConnection,
  input: { maxRows?: number; maxBytes?: number } = {},
): Promise<LocalFileReadResult> {
  assertLocalByodRuntime("Local file BYOD connector");
  const rawPath = configuredPath(connection);
  const absolute = path.resolve(rawPath);
  const real = fs.realpathSync(absolute);
  const stat = fs.statSync(real);
  if (!stat.isFile()) throw new Error("Configured file source is not a regular file.");
  const maxBytes = Math.min(Math.max(input.maxBytes ?? DEFAULT_MAX_BYTES, 1), 500 * 1024 * 1024);
  if (stat.size > maxBytes) throw new Error(`File source exceeds the configured ${maxBytes}-byte safety limit.`);
  const maxRows = Math.min(Math.max(input.maxRows ?? DEFAULT_MAX_ROWS, 1), 100_000);
  const ext = path.extname(real).toLowerCase();
  const contentHash = crypto.createHash("sha256").update(fs.readFileSync(real)).digest("hex");

  if (ext === ".json" || ext === ".ndjson" || ext === ".jsonl") {
    const raw = fs.readFileSync(real, "utf8");
    let rows: Array<Record<string, unknown>>;
    if (ext === ".ndjson" || ext === ".jsonl") {
      rows = raw.split(/\r?\n/).filter(Boolean).slice(0, maxRows).map((line) => {
        const value = JSON.parse(line);
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("NDJSON rows must be objects.");
        return value as Record<string, unknown>;
      });
    } else {
      const value = JSON.parse(raw);
      const list = Array.isArray(value) ? value : [value];
      rows = list.slice(0, maxRows).map((row) => {
        if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("JSON file records must be objects.");
        return row as Record<string, unknown>;
      });
    }
    return { format: "json", rows, rowCount: rows.length, columns: [...new Set(rows.flatMap((row) => Object.keys(row)))], contentHash, byteLength: stat.size };
  }

  const format = ext === ".parquet" ? "parquet" : ext === ".tsv" ? "tsv" : ext === ".csv" ? "csv" : null;
  if (!format) throw new Error("File connector supports JSON, NDJSON, CSV, TSV, and Parquet.");
  const { DuckDBInstance } = await import("@duckdb/node-api");
  const instance = await DuckDBInstance.create(":memory:");
  const connectionDb = await instance.connect();
  try {
    const source = format === "parquet"
      ? `read_parquet('${sqlPath(real)}')`
      : `read_csv_auto('${sqlPath(real)}', delim='${format === "tsv" ? "\\t" : ","}', header=true)`;
    const result = await connectionDb.run(`SELECT * FROM ${source} LIMIT ${maxRows}`);
    const rows = (await result.getRowObjects()).map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === "bigint" ? Number(value) : value])));
    return { format, rows, rowCount: rows.length, columns: rows[0] ? Object.keys(rows[0]) : [], contentHash, byteLength: stat.size };
  } finally {
    connectionDb.closeSync();
  }
}

export function createFileProviderAdapter(connection: SourceConnection): LiOSDataProviderAdapter {
  return {
    id: `source:${connection.id}`,
    label: connection.name,
    priority: 55,
    capabilities: ["statements", "portfolios", "transactions", "provider_extension"],
    pointInTimeModes: ["latest"],
    async fetch(request) {
      const result = await readConfiguredLocalFile(connection, {
        maxRows: typeof request.parameters.maxRows === "number" ? request.parameters.maxRows : undefined,
      });
      if (!result.rows.length) return null;
      return {
        providerId: `source:${connection.id}`,
        data: result,
        sourceRefs: [`source-connection:${connection.id}`, `file-content:${result.contentHash}`],
        revision: result.contentHash,
        normalized: false,
        entitlement: {
          decision: "allowed",
          policyId: null,
          permittedUses: ["internal_research"],
          reasons: ["User-selected local file; downstream rights remain the user's responsibility."],
        },
      };
    },
    async health() {
      const checkedAt = new Date().toISOString();
      try {
        const p = fs.realpathSync(path.resolve(configuredPath(connection)));
        const stat = fs.statSync(p);
        return { state: stat.isFile() ? "healthy" : "degraded", checkedAt, latencyMs: 0, detail: stat.isFile() ? "Configured local file is readable." : "Configured path is not a regular file." };
      } catch (error) {
        return { state: "unreachable", checkedAt, latencyMs: 0, detail: error instanceof Error ? error.message : "Configured local file is unavailable." };
      }
    },
  };
}
