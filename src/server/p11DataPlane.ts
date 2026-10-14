import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  engineDataPlaneRefSchema,
  type EngineDataPlaneRef,
} from "@shared/engineFabricContracts";
import type { HiddenEnginePackDataPlane } from "@shared/hiddenEnginePackManifest";

const JSON_CONTROL_PLANE_MAX_BYTES = 1024 * 1024;

function extension(format: HiddenEnginePackDataPlane): string {
  if (format === "arrow-ipc") return ".arrow";
  if (format === "parquet") return ".parquet";
  if (format === "duckdb-relation") return ".duckdbref";
  return ".json";
}

function insideRoot(rootDir: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(rootDir), path.resolve(candidate));
  return relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative);
}

function resolveScopedSnapshotPath(ref: EngineDataPlaneRef, rootDir: string): string {
  const rootInfo = fs.lstatSync(rootDir);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error("P11 data-plane root is not a regular directory.");
  const expected = path.resolve(rootDir, ref.id + extension(ref.format));
  if (!insideRoot(rootDir, ref.path) || path.resolve(ref.path) !== expected) {
    throw new Error("P11 data-plane reference escapes its scoped directory or does not match its id and format path.");
  }
  return expected;
}

function sqlPath(value: string): string {
  return value.replaceAll("'", "''");
}

async function validateParquet(bytes: Uint8Array, expectedRows: number | null | undefined): Promise<number> {
  if (bytes.byteLength < 12 || Buffer.from(bytes.subarray(0, 4)).toString("ascii") !== "PAR1" || Buffer.from(bytes.subarray(-4)).toString("ascii") !== "PAR1") {
    throw new Error("P11 Parquet payload does not have valid PAR1 framing.");
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-p11-parquet-check-"));
  const file = path.join(dir, "snapshot.parquet");
  fs.writeFileSync(file, bytes, { mode: 0o600 });
  try {
    const { DuckDBInstance } = await import("@duckdb/node-api");
    const instance = await DuckDBInstance.create(":memory:");
    try {
      const connection = await instance.connect();
      try {
        const result = await connection.run(`SELECT count(*) AS row_count FROM read_parquet('${sqlPath(file)}')`);
        const [row] = await result.getRowObjects();
        const count = Number(row?.row_count);
        if (!Number.isSafeInteger(count) || count < 0) throw new Error("P11 Parquet row count is invalid.");
        if (expectedRows != null && expectedRows !== count) throw new Error("P11 Parquet row count does not match its data-plane metadata.");
        return count;
      } finally {
        connection.closeSync();
      }
    } finally {
      instance.closeSync();
    }
  } catch (error) {
    if (error instanceof Error && /row count does not match|row count is invalid/.test(error.message)) throw error;
    throw new Error("P11 Parquet payload could not be decoded by DuckDB.", { cause: error });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function validateDuckDbRelation(bytes: Uint8Array): void {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch {
    throw new Error("P11 DuckDB relation handle is not valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("P11 DuckDB relation handle has an invalid shape.");
  const handle = value as Record<string, unknown>;
  if (handle.schemaVersion !== "1" || typeof handle.databaseId !== "string" || !/^[0-9a-f-]{36}$/i.test(handle.databaseId) || typeof handle.relation !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(handle.relation)) {
    throw new Error("P11 DuckDB relation handle must declare a v1 database id and safe relation name.");
  }
  if (Object.keys(handle).some((key) => !["schemaVersion", "databaseId", "relation"].includes(key))) throw new Error("P11 DuckDB relation handle contains unsupported fields.");
}

async function validateDataFormat(format: HiddenEnginePackDataPlane, bytes: Uint8Array, rows?: number | null): Promise<number | null> {
  if (format === "parquet") return validateParquet(bytes, rows);
  if (format === "arrow-ipc") {
    // Apache Arrow is a P5 runtime-pack candidate (third_party/p5-data-fabric-benchmark.json:
    // "arrowBundled": false) and must not become a bundled P5 Core dependency until a measured
    // runtime-pack benchmark justifies it (see validate_p5_data_fabric_footprint.ts). P11-07
    // prematurely bundled apache-arrow directly; this restores the documented gate instead of
    // silently accepting unvalidated Arrow IPC payloads. Packs may still declare "arrow-ipc" in
    // their manifest dataPlane capability list — only host-side validation is deferred.
    throw new Error(
      "P11 Arrow IPC data-plane format is not yet supported: apache-arrow remains a P5 runtime-pack " +
      "candidate pending a measured cross-process-transfer benchmark. Use \"parquet\" (DuckDB, bundled) " +
      "or \"duckdb-relation\" until Arrow IPC is reintroduced through a properly isolated runtime pack.",
    );
  }
  if (format === "duckdb-relation") {
    validateDuckDbRelation(bytes);
    return null;
  }
  try {
    JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    throw new Error("P11 JSON data-plane payload is not valid JSON.");
  }
  return rows ?? null;
}

export async function writeP11DataPlaneSnapshot(input: {
  rootDir: string;
  format: HiddenEnginePackDataPlane;
  bytes: Uint8Array;
  rows?: number | null;
  maxBytes: number;
}): Promise<EngineDataPlaneRef> {
  if (input.bytes.byteLength > input.maxBytes) throw new Error("P11 data-plane snapshot exceeds the pack dataset limit.");
  if (input.rows != null && (!Number.isSafeInteger(input.rows) || input.rows < 0)) throw new Error("P11 data-plane row count must be a non-negative safe integer.");
  if (input.format === "json" && input.bytes.byteLength > JSON_CONTROL_PLANE_MAX_BYTES) {
    throw new Error("Large P11 datasets must use Arrow/Parquet/local typed handles instead of giant JSON.");
  }
  fs.mkdirSync(input.rootDir, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(input.rootDir).isSymbolicLink()) throw new Error("P11 data-plane root cannot be a symbolic link.");
  const rows = await validateDataFormat(input.format, input.bytes, input.rows);
  const id = crypto.randomUUID();
  const target = path.join(input.rootDir, id + extension(input.format));
  const temporary = `${target}.tmp`;
  let fd: number | null = null;
  try {
    fd = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(fd, input.bytes);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(temporary, target);
  } catch (error) {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* retain the original write failure */ }
    }
    fs.rmSync(temporary, { force: true });
    throw error;
  }
  return engineDataPlaneRefSchema.parse({
    schemaVersion: "1",
    id,
    format: input.format,
    path: target,
    sha256: crypto.createHash("sha256").update(input.bytes).digest("hex"),
    bytes: input.bytes.byteLength,
    rows,
    immutable: true,
  });
}

export async function readP11DataPlaneSnapshot(refInput: EngineDataPlaneRef, rootDir: string): Promise<Buffer> {
  const ref = engineDataPlaneRefSchema.parse(refInput);
  const target = resolveScopedSnapshotPath(ref, rootDir);
  const info = fs.lstatSync(target);
  if (info.isSymbolicLink() || !info.isFile()) throw new Error("P11 data-plane snapshot is not a regular file.");
  const bytes = fs.readFileSync(target);
  if (bytes.byteLength !== ref.bytes) throw new Error("P11 data-plane snapshot size changed after publication.");
  const digest = crypto.createHash("sha256").update(bytes).digest("hex");
  if (digest !== ref.sha256) throw new Error("P11 data-plane snapshot hash verification failed.");
  await validateDataFormat(ref.format, bytes, ref.rows);
  return bytes;
}

export function removeP11DataPlaneSnapshot(refInput: EngineDataPlaneRef, rootDir: string): void {
  const ref = engineDataPlaneRefSchema.parse(refInput);
  const target = resolveScopedSnapshotPath(ref, rootDir);
  fs.rmSync(target, { force: true });
}
