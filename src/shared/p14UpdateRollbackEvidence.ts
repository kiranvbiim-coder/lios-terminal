export const P14_UPDATE_ROLLBACK_PLATFORMS = ["darwin", "win32"] as const;
export const P14_UPDATE_ROLLBACK_ARCHES = ["arm64", "x64"] as const;
export const P14_UPDATE_ROLLBACK_OUTCOMES = ["retained_target", "rolled_back"] as const;

type P14UpdateRollbackPlatform = (typeof P14_UPDATE_ROLLBACK_PLATFORMS)[number];
type P14UpdateRollbackArch = (typeof P14_UPDATE_ROLLBACK_ARCHES)[number];
type P14UpdateRollbackOutcome = (typeof P14_UPDATE_ROLLBACK_OUTCOMES)[number];

export type P14UpdateRollbackObservation = {
  schemaVersion: "1";
  category: "update_rollback";
  platform: P14UpdateRollbackPlatform;
  arch: P14UpdateRollbackArch;
  baselineVersion: string;
  targetVersion: string;
  baselinePackageSha256: string;
  targetPackageSha256: string;
  updateDownloaded: true;
  explicitInstallConfirmed: true;
  installInitiated: true;
  restartObserved: true;
  postUpdateVersion: string;
  migrationExercised: true;
  migrationSucceeded: true;
  continuityVerified: true;
  recoveryExercised: true;
  recoverySucceeded: true;
  recoveryOutcome: P14UpdateRollbackOutcome;
  finalObservedVersion: string;
  observedAt: string;
  sourceEvidence: string[];
};

const EXACT_KEYS = [
  "schemaVersion",
  "category",
  "platform",
  "arch",
  "baselineVersion",
  "targetVersion",
  "baselinePackageSha256",
  "targetPackageSha256",
  "updateDownloaded",
  "explicitInstallConfirmed",
  "installInitiated",
  "restartObserved",
  "postUpdateVersion",
  "migrationExercised",
  "migrationSucceeded",
  "continuityVerified",
  "recoveryExercised",
  "recoverySucceeded",
  "recoveryOutcome",
  "finalObservedVersion",
  "observedAt",
  "sourceEvidence",
] as const;

const VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SHA256_RE = /^[a-f0-9]{64}$/;

function requireRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("P14 update/rollback observation must be an object.");
  }
  const record = value as Record<string, unknown>;
  const expected = new Set<string>(EXACT_KEYS);
  const unknownKeys = Object.keys(record).filter((key) => !expected.has(key));
  const missingKeys = EXACT_KEYS.filter((key) => !Object.hasOwn(record, key));
  if (unknownKeys.length) throw new Error(`P14 update/rollback observation has unsupported fields: ${unknownKeys.join(", ")}.`);
  if (missingKeys.length) throw new Error(`P14 update/rollback observation is missing fields: ${missingKeys.join(", ")}.`);
  return record;
}

function requireString(record: Record<string, unknown>, field: string, max = 200): string {
  const value = record[field];
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) {
    throw new Error(`${field} must be a non-empty bounded string.`);
  }
  return value.trim();
}

function requireTrue(record: Record<string, unknown>, field: string): true {
  if (record[field] !== true) throw new Error(`${field} must be true for passed P14 update/rollback evidence.`);
  return true;
}

function requireVersion(record: Record<string, unknown>, field: string): string {
  const value = requireString(record, field, 100);
  if (!VERSION_RE.test(value)) throw new Error(`${field} must be a stable semantic version (major.minor.patch).`);
  return value;
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] > rightParts[index] ? 1 : -1;
  }
  return 0;
}

function requireSha256(record: Record<string, unknown>, field: string): string {
  const value = requireString(record, field, 64);
  if (!SHA256_RE.test(value)) throw new Error(`${field} must be a lowercase SHA256 digest.`);
  return value;
}

export function validateP14UpdateRollbackObservation(value: unknown): P14UpdateRollbackObservation {
  const record = requireRecord(value);
  if (record.schemaVersion !== "1") throw new Error("schemaVersion must be 1.");
  if (record.category !== "update_rollback") throw new Error("category must be update_rollback.");

  const platform = requireString(record, "platform", 20);
  if (!P14_UPDATE_ROLLBACK_PLATFORMS.includes(platform as P14UpdateRollbackPlatform)) {
    throw new Error("platform must be darwin or win32 for P14 packaged update/rollback evidence.");
  }
  const arch = requireString(record, "arch", 20);
  if (!P14_UPDATE_ROLLBACK_ARCHES.includes(arch as P14UpdateRollbackArch)) {
    throw new Error("arch must be arm64 or x64 for P14 packaged update/rollback evidence.");
  }

  const baselineVersion = requireVersion(record, "baselineVersion");
  const targetVersion = requireVersion(record, "targetVersion");
  if (compareVersions(targetVersion, baselineVersion) <= 0) {
    throw new Error("targetVersion must be newer than baselineVersion for an N-to-N+1 journey.");
  }

  const baselinePackageSha256 = requireSha256(record, "baselinePackageSha256");
  const targetPackageSha256 = requireSha256(record, "targetPackageSha256");
  if (baselinePackageSha256 === targetPackageSha256) {
    throw new Error("Baseline and target package SHA256 digests must be different.");
  }

  const updateDownloaded = requireTrue(record, "updateDownloaded");
  const explicitInstallConfirmed = requireTrue(record, "explicitInstallConfirmed");
  const installInitiated = requireTrue(record, "installInitiated");
  const restartObserved = requireTrue(record, "restartObserved");

  const postUpdateVersion = requireVersion(record, "postUpdateVersion");
  if (postUpdateVersion !== targetVersion) {
    throw new Error("Post-update version must equal the target version.");
  }

  const migrationExercised = requireTrue(record, "migrationExercised");
  const migrationSucceeded = requireTrue(record, "migrationSucceeded");
  const continuityVerified = requireTrue(record, "continuityVerified");
  const recoveryExercised = requireTrue(record, "recoveryExercised");
  const recoverySucceeded = requireTrue(record, "recoverySucceeded");

  const recoveryOutcome = requireString(record, "recoveryOutcome", 40);
  if (!P14_UPDATE_ROLLBACK_OUTCOMES.includes(recoveryOutcome as P14UpdateRollbackOutcome)) {
    throw new Error("recoveryOutcome must be retained_target or rolled_back.");
  }
  const finalObservedVersion = requireVersion(record, "finalObservedVersion");
  if (recoveryOutcome === "rolled_back" && finalObservedVersion !== baselineVersion) {
    throw new Error("Final observed version must equal the baseline version after rollback.");
  }
  if (recoveryOutcome === "retained_target" && finalObservedVersion !== targetVersion) {
    throw new Error("Final observed version must equal the target version when recovery retains the target.");
  }

  const observedAt = requireString(record, "observedAt", 100);
  if (!Number.isFinite(Date.parse(observedAt))) throw new Error("observedAt must be an ISO-compatible timestamp.");

  if (!Array.isArray(record.sourceEvidence) || record.sourceEvidence.length === 0 || record.sourceEvidence.length > 50) {
    throw new Error("sourceEvidence must contain at least one bounded source-evidence identifier.");
  }
  const sourceEvidence = record.sourceEvidence.map((item) => {
    if (typeof item !== "string" || item.trim().length === 0 || item.length > 500) {
      throw new Error("sourceEvidence entries must be non-empty bounded strings.");
    }
    return item.trim();
  });

  return {
    schemaVersion: "1",
    category: "update_rollback",
    platform: platform as P14UpdateRollbackPlatform,
    arch: arch as P14UpdateRollbackArch,
    baselineVersion,
    targetVersion,
    baselinePackageSha256,
    targetPackageSha256,
    updateDownloaded,
    explicitInstallConfirmed,
    installInitiated,
    restartObserved,
    postUpdateVersion,
    migrationExercised,
    migrationSucceeded,
    continuityVerified,
    recoveryExercised,
    recoverySucceeded,
    recoveryOutcome: recoveryOutcome as P14UpdateRollbackOutcome,
    finalObservedVersion,
    observedAt,
    sourceEvidence,
  };
}
