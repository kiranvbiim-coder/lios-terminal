/**
 * Phase 4 release decision: source CI proves source only. Packaged acceptance
 * requires evidence for the *same exact commit* and both supported platforms.
 * Missing evidence is a blocker, never a successful or "not applicable" check.
 *
 * This contract deliberately does not run or simulate Electron, payments,
 * providers, Docker, signed installers or SP-01. The native runbooks produce
 * their own observations; this evaluates the resulting evidence inventory.
 */
export const PHASE4_REQUIRED_EVIDENCE = Object.freeze([
  { id: "source-linux", scope: "source", platform: "linux" },
  { id: "source-windows", scope: "source", platform: "windows" },
  { id: "source-macos", scope: "source", platform: "macos" },
  { id: "signed-macos", scope: "native", platform: "macos" },
  { id: "signed-windows", scope: "native", platform: "windows" },
  { id: "clean-install-macos", scope: "native", platform: "macos" },
  { id: "clean-install-windows", scope: "native", platform: "windows" },
  { id: "update-rollback-macos", scope: "native", platform: "macos" },
  { id: "update-rollback-windows", scope: "native", platform: "windows" },
  { id: "accessibility-macos", scope: "native", platform: "macos" },
  { id: "accessibility-windows", scope: "native", platform: "windows" },
  { id: "performance-macos", scope: "native", platform: "macos" },
  { id: "performance-windows", scope: "native", platform: "windows" },
  { id: "sp01-packaged-journey", scope: "native", platform: "macos" },
  { id: "packaged-valuation-http", scope: "native", platform: "macos" },
]);

const shaPattern = /^[a-f0-9]{40}$/;
const digestPattern = /^[a-f0-9]{64}$/;

/**
 * Records are identifiers for separately verified, retained artifacts,
 * not counters, declarations or self-reported statuses. Both the exact
 * gitSha and artifact SHA-256 must be present for a record to count.
 * No stale/foreign-commit evidence can make a release ready.
 */
export function evaluatePhase4ReleaseEvidence(input) {
  const commit = input?.commit;
  const evidence = Array.isArray(input?.evidence) ? input.evidence : [];
  const commitValid = typeof commit === "string" && shaPattern.test(commit);
  const seen = new Set();
  const checks = PHASE4_REQUIRED_EVIDENCE.map(requirement => {
    const matches = evidence.filter(row => row && row.id === requirement.id);
    const row = matches[0];
    const errors = [];
    if (!commitValid) errors.push("Release commit must be an exact 40-character lowercase Git SHA.");
    if (matches.length !== 1) errors.push(matches.length ? "Duplicate evidence ID." : "Required evidence not recorded.");
    if (row) {
      if (row.scope !== requirement.scope || row.platform !== requirement.platform) errors.push("Evidence scope/platform mismatch.");
      if (row.commit !== commit) errors.push("Evidence was not produced for this exact commit.");
      if (row.status !== "passed") errors.push("The real check was not recorded as passed.");
      if (typeof row.artifactSha256 !== "string" || !digestPattern.test(row.artifactSha256)) errors.push("Evidence artifact SHA-256 is missing/invalid.");
      if (typeof row.artifactPath !== "string" || !/^[^\\\0\r\n]{1,500}$/.test(row.artifactPath.trim()) || /(?:^|\/)\.\.(?:\/|$)/.test(row.artifactPath)) errors.push("Evidence artifact path must be a safe retained relative reference.");
      else if (row.artifactPath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(row.artifactPath)) errors.push("Absolute evidence paths are not portable.");
      const date = new Date(row.observedAt);
      if (typeof row.observedAt !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(row.observedAt) || !Number.isFinite(date.getTime())) errors.push("Dated observation required.");
      if (row.synthetic === true || row.mode === "mock" || row.mode === "fixture") errors.push("Synthetic evidence cannot authorize release.");
    }
    const passed = errors.length === 0;
    seen.add(requirement.id);
    return { id: requirement.id, scope: requirement.scope, platform: requirement.platform, passed, errors };
  });
  const unrecognized = evidence.filter(row => !row || !seen.has(row.id)).map(row => row?.id ?? "invalid");
  return {
    schemaVersion: "1",
    commit: commitValid ? commit : null,
    releaseReady: checks.every(c => c.passed) && unrecognized.length === 0,
    sourceChecksPassed: checks.filter(c => c.scope === "source" && c.passed).length,
    nativeChecksPassed: checks.filter(c => c.scope === "native" && c.passed).length,
    required: checks.length,
    blockers: checks.filter(c => !c.passed).map(c => ({ id: c.id, reasons: c.errors })),
    unknownEvidence: unrecognized,
  };
}
