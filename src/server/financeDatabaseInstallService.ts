/**
 * Customer-installed LiOS reference-universe acquisition (Git is NOT needed).
 * A user must explicitly consent; the local Home downloads the public pinned
 * GitHub tarball, extracts only CSV assets, verifies accepted rows, and writes
 * to the governed user-owned data root. No central LiOS compute/storage.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable, Transform, pipeline } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { createGunzip } from "node:zlib";
import { runAsync as runLocalImportAsync, assertFreeSpace } from "../script/import_financedatabase.cjs";
import { financeDatabaseCatalogPath, resetFinanceDatabaseCatalogCache } from "./financeDatabaseCatalog";
import { resetInstrumentDirectoryCache } from "./instrumentDirectory";
import { resetCommonInstrumentSearchIndexCache } from "./instrumentSearchIndexStore";

const PINNED_COMMIT = "3815eb341c7aa7bfae4a720744093e75528b6099";
const ARCHIVE_URL = "https://codeload.github.com/JerBouma/FinanceDatabase/tar.gz/" + PINNED_COMMIT;
const CSV_IN_ARCHIVE = /\/database\/((?:equities|etfs|funds)\/[a-zA-Z0-9_.-]+\.csv|(?:indices|currencies|cryptos|moneymarkets)\.csv)$/;
const MAX_SINGLE_FILE = 128 * 1024 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024;
const MAX_ASSETS = 1000;
const DOWNLOAD_IDLE_MS = 60_000;
const MIN_FREE_TEMP_BYTES = 256 * 1024 * 1024;
const MIN_FREE_CATALOG_BYTES = 352 * 1024 * 1024;

export type InstallState = "idle" | "fetching" | "extracting" | "verifying" | "completed" | "failed";
export interface InstallStatus {
  state: InstallState;
  startedAt: string | null;
  completedAt: string | null;
  filesExtracted: number;
  bytesDownloaded: number;
  stepDetail: string | null;
  bytesExtracted: number;
  importedCount: number | null;
  upstreamCommit: string;
  error: string | null;
}
let job: InstallStatus = {
  state: "idle", startedAt: null, completedAt: null,
  filesExtracted: 0, bytesExtracted: 0, bytesDownloaded: 0, stepDetail: null, importedCount: null,
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
  const stream = createGunzip();
  const sourceFailed = (error: Error) => stream.destroy(error);
  body.on("error", sourceFailed);
  body.pipe(stream);
  let buffer = Buffer.alloc(0), mode: "header" | "payload" | "padding" | "done" = "header";
  let remaining = 0, padding = 0, fileHandle: number | null = null;
  let files = 0, bytes = 0, totalBytes = 0, expectedFiles = 0;
  try {
    for await (const chunk of stream) {
      if (mode === "done") break;
      buffer = buffer.length ? Buffer.concat([buffer, chunk as Buffer]) : chunk as Buffer;
      while (buffer.length) {
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
          if (!remaining && fileHandle !== null) {
            fs.closeSync(fileHandle); fileHandle = null;
            files++;
            onProgress?.(files, bytes);
          }
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
    body.unpipe(stream);
    if (body.closed) body.off("error", sourceFailed);
    else body.once("close", () => body.off("error", sourceFailed));
    body.destroy();
    stream.destroy();
    if (fileHandle !== null) fs.closeSync(fileHandle);
  }
}

/** Plain-language reason for a failed install; the raw error stays in the server log only. */
export function describeFinanceDatabaseInstallFailure(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const codes: string[] = [];
  for (let e: unknown = error, depth = 0; e && typeof e === "object" && depth < 4; depth++) {
    if ("code" in e && typeof e.code === "string") codes.push(e.code);
    e = "cause" in e ? e.cause : undefined;
  }
  const name = error instanceof Error ? error.name : "";
  if (codes.includes("ENOSPC") || /not enough free disk space|no space left/i.test(raw)) {
    const detail = /^Not enough free disk space/i.test(raw) ? raw + ". " : "";
    return detail + "There is not enough free disk space to load global securities. Free up about 1 GB and try again.";
  }
  const status = raw.match(/\(HTTP (\d{3})\)/);
  if (status) {
    return "The public data host (GitHub) could not provide the download right now (HTTP " + status[1] + "). Try again later.";
  }
  if (name === "AbortError" || name === "TimeoutError" || /stalled|timed out/i.test(raw) ||
      codes.some(c => ["ETIMEDOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_CONNECT_TIMEOUT"].includes(c))) {
    return "The download stalled or took too long. Check your internet connection and try again.";
  }
  if (/fetch failed|terminated|premature close/i.test(raw) ||
      codes.some(c => ["ENOTFOUND", "ECONNREFUSED", "ECONNRESET", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_SOCKET"].includes(c))) {
    return "Could not reach the public data host (GitHub). Check your internet connection and try again.";
  }
  return "The downloaded data did not pass verification and nothing was changed (" + raw.slice(0, 160) + "). Try again later.";
}

const STAGE_LABELS: Record<string, (stage: { category?: string }) => string> = {
  read: stage => "Reading " + (stage.category ?? "securities"),
  write: () => "Saving the catalog",
  check: () => "Checking the saved catalog",
};

export async function installPublicFinanceDatabase(): Promise<InstallStatus> {
  if (job.state === "fetching" || job.state === "extracting" || job.state === "verifying") {
    throw new Error("Reference-universe installation already in progress");
  }
  job = { state: "fetching", startedAt: new Date().toISOString(),
    completedAt: null, filesExtracted: 0, bytesExtracted: 0, bytesDownloaded: 0, stepDetail: null,
    importedCount: null, upstreamCommit: PINNED_COMMIT, error: null };
  let temp: string | null = null;
  const controller = new AbortController();
  let idle: NodeJS.Timeout | undefined;
  const armIdle = () => {
    clearTimeout(idle);
    idle = setTimeout(() => controller.abort(new Error("Download stalled: no data for " + DOWNLOAD_IDLE_MS / 1000 + " s")), DOWNLOAD_IDLE_MS);
  };
  const overall = setTimeout(() => controller.abort(new Error("Download timed out")), 8 * 60_000);
  try {
    const destination = path.dirname(financeDatabaseCatalogPath());
    // Fail before downloading 170 MB when the volume obviously cannot hold it.
    assertFreeSpace(os.tmpdir(), MIN_FREE_TEMP_BYTES);
    assertFreeSpace(destination, MIN_FREE_CATALOG_BYTES);
    temp = fs.mkdtempSync(path.join(os.tmpdir(), "lios-financedatabase-download-"));
    armIdle();
    const response = await fetch(ARCHIVE_URL, {
      signal: controller.signal,
      headers: { "User-Agent": "LiOS-Local-Reference-Import/1.0", "Accept": "application/gzip" },
    });
    if (!response.ok || !response.body) throw new Error("Public donor archive unavailable (HTTP " + response.status + ")");
    const declaredSize = Number(response.headers.get("content-length") || "0");
    if (declaredSize > 250 * 1024 * 1024) throw new Error("Public donor download size exceeds safety cap");
    job.state = "extracting";
    // The response is a one-shot stream; no credentials are sent to GitHub.
    // The counter reports real bytes received and resets the stall timer.
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        job.bytesDownloaded += chunk.length;
        armIdle();
        callback(null, chunk);
      },
    });
    pipeline(Readable.fromWeb(response.body as WebReadableStream), counter, () => { /* errors reach the extractor via the counter */ });
    await extractFinanceDatabaseTarGz(
      counter,
      temp,
      (files, bytes) => { job.filesExtracted = files; job.bytesExtracted = bytes; },
    );
    clearTimeout(idle);
    job.state = "verifying";
    const report = await runLocalImportAsync(["--from-dir", temp, "--source-commit", PINNED_COMMIT,
      "--categories", "equities,etfs,funds,indices,cryptos,currencies,moneymarkets",
      "--min", "300000", "--dest", destination],
      (stage: { stage: string; category?: string }) => { job.stepDetail = STAGE_LABELS[stage.stage]?.(stage) ?? null; });
    resetFinanceDatabaseCatalogCache();
    resetInstrumentDirectoryCache();
    resetCommonInstrumentSearchIndexCache();
    job = { ...job, state: "completed", stepDetail: null, importedCount: report.count,
      completedAt: new Date().toISOString() };
    return getFinanceDatabaseInstallStatus();
  } catch (error) {
    console.error("Reference catalog install failed:", error instanceof Error ? error.message : error);
    job = { ...job, state: "failed", stepDetail: null, error: describeFinanceDatabaseInstallFailure(error),
      completedAt: new Date().toISOString() };
    throw error;
  } finally {
    clearTimeout(overall);
    clearTimeout(idle);
    if (temp) fs.rmSync(temp, { recursive: true, force: true });
  }
}
