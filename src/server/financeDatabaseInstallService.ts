/**
 * Customer-installed LiOS reference-universe acquisition (Git is NOT needed).
 * A user must explicitly consent; the local Home downloads the public pinned
 * GitHub tarball, extracts only CSV assets, verifies accepted rows, and writes
 * to the governed user-owned data root. No central LiOS compute/storage.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import { run as runLocalImport } from "../script/import_financedatabase.cjs";
import { resetFinanceDatabaseCatalogCache } from "./financeDatabaseCatalog";
import { resetInstrumentDirectoryCache } from "./instrumentDirectory";
import { resetCommonInstrumentSearchIndexCache } from "./instrumentSearchIndexStore";

const PINNED_COMMIT = "3815eb341c7aa7bfae4a720744093e75528b6099";
const ARCHIVE_URL = "https://codeload.github.com/JerBouma/FinanceDatabase/tar.gz/" + PINNED_COMMIT;
const CSV_IN_ARCHIVE = /\/database\/((?:equities|etfs|funds)\/[a-zA-Z0-9_.-]+\.csv|(?:indices|currencies|cryptos|moneymarkets)\.csv)$/;
const MAX_SINGLE_FILE = 128 * 1024 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024;
const MAX_ASSETS = 1000;

export type InstallState = "idle" | "fetching" | "extracting" | "verifying" | "completed" | "failed";
export interface InstallStatus {
  state: InstallState;
  startedAt: string | null;
  completedAt: string | null;
  filesExtracted: number;
  bytesExtracted: number;
  importedCount: number | null;
  upstreamCommit: string;
  error: string | null;
}
let job: InstallStatus = {
  state: "idle", startedAt: null, completedAt: null,
  filesExtracted: 0, bytesExtracted: 0, importedCount: null,
  upstreamCommit: PINNED_COMMIT, error: null,
};
export function getFinanceDatabaseInstallStatus(): InstallStatus {
  return { ...job };
}

/** Streaming bounded-memory USTAR extractor: accept CSV files in exactly
 * the pinned donor /database paths and reject link traversal / other assets.
 * Each entry is written incrementally and never interpreted as a shell path.
 */
export async function extractFinanceDatabaseTarGz(
  body: Readable,
  destination: string,
  onProgress?: (files: number, bytes: number) => void,
): Promise<{ files: number; bytes: number }> {
  const stream = body.pipe(createGunzip());
  let buffer = Buffer.alloc(0), mode: "header" | "payload" | "padding" | "done" = "header";
  let remaining = 0, padding = 0, fileHandle: number | null = null;
  let files = 0, bytes = 0, totalBytes = 0, expectedFiles = 0;
  try {
    for await (const chunk of stream) {
      buffer = buffer.length ? Buffer.concat([buffer, chunk as Buffer]) : chunk as Buffer;
      while (buffer.length) {
        if (mode === "done") break;
        if (mode === "header") {
          if (buffer.length < 512) break;
          const header = buffer.subarray(0, 512);
          buffer = buffer.subarray(512);
          if (header.every(b => b === 0)) { mode = "done"; break; }
          const name = header.subarray(0, 100).toString("utf8").split("\u0000")[0]!;
          const sizeString = header.subarray(124, 136).toString("ascii").replace(/\0/g, "").trim();
          const entrySize = parseInt(sizeString, 8);
          if (!Number.isSafeInteger(entrySize) || entrySize < 0 || entrySize > MAX_SINGLE_FILE) {
            throw new Error("Invalid or oversized donor archive entry");
          }
          const type = header[156];
          const matching = name.match(CSV_IN_ARCHIVE);
          const isRegular = type === 0 || type === 48;
          if (matching && isRegular) {
            const rel = matching[1]!;
            const target = path.resolve(destination, "database", rel);
            const safeRoot = path.resolve(destination, "database") + path.sep;
            if (!target.startsWith(safeRoot)) throw new Error("Donor archive path traversal blocked");
            fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
            fileHandle = fs.openSync(target, "w", 0o600);
            expectedFiles++;
            if (expectedFiles > MAX_ASSETS) throw new Error("Too many files in donor archive");
          }
          remaining = entrySize;
          padding = (512 - entrySize % 512) % 512;
          mode = remaining ? "payload" : "padding";
        } else if (mode === "payload") {
          const take = Math.min(remaining, buffer.length);
          if (!take) break;
          if (fileHandle !== null) {
            fs.writeSync(fileHandle, buffer.subarray(0, take));
            bytes += take;
          }
          totalBytes += take;
          if (totalBytes > MAX_TOTAL_BYTES) throw new Error("Donor expanded archive exceeds 1 GiB safety cap");
          remaining -= take;
          buffer = buffer.subarray(take);
          if (!remaining) {
            if (fileHandle !== null) {
              fs.closeSync(fileHandle); fileHandle = null;
              files++;
              onProgress?.(files, bytes);
            }
            mode = "padding";
          }
        } else if (mode === "padding") {
          const take = Math.min(padding, buffer.length);
          buffer = buffer.subarray(take);
          padding -= take;
          if (!padding) mode = "header";
        } else break;
      }
    }
    if (fileHandle !== null || (mode !== "done" && mode !== "header")) {
      throw new Error("Truncated donor archive");
    }
    if (files < 7) throw new Error("Donor archive did not contain expected CSV reference assets");
    return { files, bytes };
  } finally {
    if (fileHandle !== null) fs.closeSync(fileHandle);
  }
}

export async function installPublicFinanceDatabase(): Promise<InstallStatus> {
  if (job.state === "fetching" || job.state === "extracting" || job.state === "verifying") {
    throw new Error("Reference-universe installation already in progress");
  }
  job = { state: "fetching", startedAt: new Date().toISOString(),
    completedAt: null, filesExtracted: 0, bytesExtracted: 0,
    importedCount: null, upstreamCommit: PINNED_COMMIT, error: null };
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "lios-financedatabase-download-"));
  try {
    const response = await fetch(ARCHIVE_URL, {
      signal: AbortSignal.timeout(8 * 60_000),
      headers: { "User-Agent": "LiOS-Local-Reference-Import/1.0", "Accept": "application/gzip" },
    });
    if (!response.ok || !response.body) throw new Error("Public donor archive unavailable (HTTP " + response.status + ")");
    const declaredSize = Number(response.headers.get("content-length") || "0");
    if (declaredSize > 250 * 1024 * 1024) throw new Error("Public donor download size exceeds safety cap");
    job.state = "extracting";
    // The response is a one-shot stream; no credentials are sent to GitHub.
    await extractFinanceDatabaseTarGz(
      Readable.fromWeb(response.body as import("node:stream/web").ReadableStream),
      temp,
      (files, bytes) => { job.filesExtracted = files; job.bytesExtracted = bytes; },
    );
    job.state = "verifying";
    const report = runLocalImport(["--from-dir", temp, "--source-commit", PINNED_COMMIT,
      "--categories", "equities,etfs,funds,indices,cryptos,currencies,moneymarkets",
      "--min", "300000"]);
    resetFinanceDatabaseCatalogCache();
    resetInstrumentDirectoryCache();
    resetCommonInstrumentSearchIndexCache();
    job = { ...job, state: "completed", importedCount: report.count,
      completedAt: new Date().toISOString() };
    return getFinanceDatabaseInstallStatus();
  } catch (error) {
    job = { ...job, state: "failed", error: error instanceof Error ? error.message : "Import failed",
      completedAt: new Date().toISOString() };
    throw error;
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
