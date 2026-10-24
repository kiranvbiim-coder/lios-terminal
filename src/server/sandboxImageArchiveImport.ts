import fs from "node:fs";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";

const IMAGE_LOAD_TIMEOUT_MS = 15 * 60_000;
const MAX_ENGINE_STDERR_CHARS = 4_096;

/**
 * Copy an already-verified, packaged gzip OCI archive to the CLI's stdin.
 *
 * Container-engine stdout is an untrusted, potentially unbounded stream and
 * MUST be drained: otherwise a verbose Docker/Podman load can block forever
 * once its output pipe fills, preventing the process from reading the archive.
 * No output is logged, cached, interpreted or returned. Child extinction is
 * joined before this function returns or rejects.
 *
 * The caller must retain custody of signed image/source-lock verification,
 * approved engine/endpoint, explicit user consent and exact image-ID checks.
 */
export async function streamSandboxImageArchive(
  archive: string,
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number = IMAGE_LOAD_TIMEOUT_MS,
): Promise<void> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > IMAGE_LOAD_TIMEOUT_MS) {
    throw new Error("Sandbox image import timeout must be between 1ms and 15 minutes.");
  }

  // This is a pipe, not a log or protocol channel. Drain without buffering.
  child.stdout.resume();
  let stderrTail = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-MAX_ENGINE_STDERR_CHARS);
  });

  let timedOut = false;
  const completed = new Promise<void>((resolve, reject) => {
    child.once("error", () => reject(new Error("Local sandbox image load process could not start.")));
    child.once("close", (code) => {
      if (timedOut) {
        reject(new Error("Image import exceeded its allowed deadline."));
      } else if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Local sandbox image load failed: ${stderrTail.trim() || code}`));
      }
    });
  });
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, timeoutMs);
  timeout.unref();

  try {
    await Promise.all([
      pipeline(fs.createReadStream(archive), createGunzip(), child.stdin),
      completed,
    ]);
  } catch (error) {
    // Always await child extinction before unwinding repair or retrying.
    child.kill("SIGKILL");
    await completed.catch(() => undefined);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
