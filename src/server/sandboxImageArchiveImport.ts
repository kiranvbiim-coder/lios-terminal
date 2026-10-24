import fs from "node:fs";
import { createHash } from "node:crypto";
import { Transform } from "node:stream";
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
  expectedArchiveSha256: string,
  timeoutMs: number = IMAGE_LOAD_TIMEOUT_MS,
): Promise<void> {
  if (!/^[a-f0-9]{64}$/.test(expectedArchiveSha256)) {
    throw new Error("Sandbox image import requires an exact verified archive SHA-256 digest.");
  }
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

  const actualDigest = createHash("sha256");
  const observeCompressedBytes = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      actualDigest.update(chunk);
      callback(null, chunk);
    },
  });
  const transfer = pipeline(fs.createReadStream(archive), observeCompressedBytes, createGunzip(), child.stdin);
  try {
    await Promise.all([transfer, completed]);
    // A path may have changed after verifiedRelease() read the signed archive.
    // Never report a successful import from bytes that differ from that digest.
    if (actualDigest.digest("hex") !== expectedArchiveSha256) {
      throw new Error("Imported sandbox archive bytes differ from the signed release digest.");
    }
  } catch (error) {
    // Join BOTH the child and the archive stream before repair can retry.
    child.kill("SIGKILL");
    await Promise.allSettled([transfer, completed]);
    if (timedOut) throw new Error("Image import exceeded its allowed deadline.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
