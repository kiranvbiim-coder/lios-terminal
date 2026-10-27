import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, resolve, relative, sep } from "node:path";
import { evaluatePhase4ReleaseEvidence } from "./phase4_release_evidence.mjs";

/** Check actual retained bytes rather than accepting a user-supplied SHA alone. */
export function verifyEvidenceFiles(input, baseDir) {
  const base = realpathSync(baseDir);
  const rows = Array.isArray(input?.evidence) ? input.evidence : [];
  const errors = [];
  for (const row of rows) {
    if (!row || typeof row.artifactPath !== "string") continue;
    const value = row.artifactPath;
    if (!value.trim() || isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value) || value.includes("\\") || value.split("/").includes("..")) {
      errors.push({ id: row.id ?? "invalid", reason: "Evidence path must be a contained relative POSIX path." });
      continue;
    }
    const full = resolve(base, value);
    const relativePath = relative(base, full);
    if (!relativePath || relativePath === ".." || relativePath.startsWith(".." + sep) || isAbsolute(relativePath)) {
      errors.push({ id: row.id ?? "invalid", reason: "Evidence path escapes release evidence root." });
      continue;
    }
    if (!existsSync(full)) {
      errors.push({ id: row.id ?? "invalid", reason: "Evidence file does not exist." });
      continue;
    }
    if (!lstatSync(full).isFile() || realpathSync(full) !== full) {
      errors.push({ id: row.id ?? "invalid", reason: "Evidence must be a regular non-symlinked file." });
      continue;
    }
    // Never read unbounded, untrusted evidence blobs into source-gate memory.
    // Original native release reports may retain larger binary attachments
    // separately; this inventory references concise machine-readable reports.
    if (lstatSync(full).size > 64 * 1024 * 1024) {
      errors.push({ id: row.id ?? "invalid", reason: "Evidence report exceeds the 64 MiB manifest verification ceiling." });
      continue;
    }
    const actual = createHash("sha256").update(readFileSync(full)).digest("hex");
    if (actual !== row.artifactSha256) errors.push({ id: row.id ?? "invalid", reason: "Evidence bytes do not match supplied SHA-256." });
  }
  return errors;
}

export function assessPhase4Release(input, baseDir) {
  const result = evaluatePhase4ReleaseEvidence(input);
  const artifactErrors = baseDir ? verifyEvidenceFiles(input, baseDir) : [];
  // The inventory alone cannot be release proof: physical bytes must be
  // checked against a known retained evidence directory in require-ready mode.
  return {
    ...result,
    releaseReady: Boolean(baseDir) && result.releaseReady && artifactErrors.length === 0,
    artifactErrors,
    evidenceFilesChecked: Boolean(baseDir),
  };
}
