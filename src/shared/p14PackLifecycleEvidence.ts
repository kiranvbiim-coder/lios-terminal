export const P14_PACK_LIFECYCLE_PLATFORMS = ["darwin", "win32"] as const;
export const P14_PACK_LIFECYCLE_ARCHES = ["arm64", "x64"] as const;

type P14PackLifecyclePlatform = (typeof P14_PACK_LIFECYCLE_PLATFORMS)[number];
type P14PackLifecycleArch = (typeof P14_PACK_LIFECYCLE_ARCHES)[number];

export type P14PackLifecycleObservation = {
  schemaVersion: "1";
  category: "pack_lifecycle";
  platform: P14PackLifecyclePlatform;
  arch: P14PackLifecycleArch;
  packId: string;
  baselineVersion: string;
  targetVersion: string;
  baselineArtifactSha256: string;
  targetArtifactSha256: string;
  integrityVerified: true;
  baselineInstallObserved: true;
  baselineHealthVerified: true;
  baselineActivated: true;
  targetInstallObserved: true;
  targetHealthVerified: true;
  targetActivated: true;
  retryFailureObserved: true;
  retrySucceeded: true;
  rollbackExercised: true;
  rollbackSucceeded: true;
  rollbackVersion: string;
  deactivateObserved: true;
  targetRemovalObserved: true;
  baselineRemovalObserved: true;
  finalPackAbsent: true;
  observedAt: string;
  sourceEvidence: string[];
};

const EXACT_KEYS = [
  "schemaVersion",
  "category",
  "platform",
  "arch",
  "packId",
  "baselineVersion",
  "targetVersion",
  "baselineArtifactSha256",
  "targetArtifactSha256",
  "integrityVerified",
  "baselineInstallObserved",
  "baselineHealthVerified",
  "baselineActivated",
  "targetInstallObserved",
  "targetHealthVerified",
  "targetActivated",
  "retryFailureObserved",
  "retrySucceeded",
  "rollbackExercised",
  "rollbackSucceeded",
  "rollbackVersion",
  "deactivateObserved",
  "targetRemovalObserved",
  "baselineRemovalObserved",
  "finalPackAbsent",
  "observedAt",
  "sourceEvidence",
] as const;

const VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
const ISO_WITH_OFFSET_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function requireRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("P14 pack lifecycle observation must be an object.");
  }
  const record = value as Record<string, unknown>;
  const expected = new Set<string>(EXACT_KEYS);
  const unknownKeys = Object.keys(record).filter((key) => !expected.has(key));
  const missingKeys = EXACT_KEYS.filter((key) => !Object.hasOwn(record, key));
  if (unknownKeys.length) throw new Error(`P14 pack lifecycle observation has unsupported fields: ${unknownKeys.join(", ")}.`);
  if (missingKeys.length) throw new Error(`P14 pack lifecycle observation is missing fields: ${missingKeys.join(", ")}.`);
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
  if (record[field] !== true) throw new Error(`${field} must be true for passed P14 pack lifecycle evidence.`);
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

export function validateP14PackLifecycleObservation(value: unknown): P14PackLifecycleObservation {
  const record = requireRecord(value);
  if (record.schemaVersion !== "1") throw new Error("schemaVersion must be 1.");
  if (record.category !== "pack_lifecycle") throw new Error("category must be pack_lifecycle.");

  const platform = requireString(record, "platform", 20);
  if (!P14_PACK_LIFECYCLE_PLATFORMS.includes(platform as P14PackLifecyclePlatform)) {
    throw new Error("platform must be darwin or win32 for P14 packaged Runtime Pack lifecycle evidence.");
  }
  const arch = requireString(record, "arch", 20);
  if (!P14_PACK_LIFECYCLE_ARCHES.includes(arch as P14PackLifecycleArch)) {
    throw new Error("arch must be arm64 or x64 for P14 packaged Runtime Pack lifecycle evidence.");
  }
  if (platform === "win32" && arch !== "x64") {
    throw new Error("win32 packaged Runtime Pack lifecycle evidence must use x64, matching the supported Windows distribution target.");
  }

  const packId = requireString(record, "packId", 200);
  const baselineVersion = requireVersion(record, "baselineVersion");
  const targetVersion = requireVersion(record, "targetVersion");
  if (compareVersions(targetVersion, baselineVersion) <= 0) {
    throw new Error("targetVersion must be newer than baselineVersion for the packaged Runtime Pack update journey.");
  }

  const baselineArtifactSha256 = requireSha256(record, "baselineArtifactSha256");
  const targetArtifactSha256 = requireSha256(record, "targetArtifactSha256");
  if (baselineArtifactSha256 === targetArtifactSha256) {
    throw new Error("Baseline and target Runtime Pack artifact SHA256 digests must be different.");
  }

  const integrityVerified = requireTrue(record, "integrityVerified");
  const baselineInstallObserved = requireTrue(record, "baselineInstallObserved");
  const baselineHealthVerified = requireTrue(record, "baselineHealthVerified");
  const baselineActivated = requireTrue(record, "baselineActivated");
  const targetInstallObserved = requireTrue(record, "targetInstallObserved");
  const targetHealthVerified = requireTrue(record, "targetHealthVerified");
  const targetActivated = requireTrue(record, "targetActivated");
  const retryFailureObserved = requireTrue(record, "retryFailureObserved");
  const retrySucceeded = requireTrue(record, "retrySucceeded");
  const rollbackExercised = requireTrue(record, "rollbackExercised");
  const rollbackSucceeded = requireTrue(record, "rollbackSucceeded");

  const rollbackVersion = requireVersion(record, "rollbackVersion");
  if (rollbackVersion !== baselineVersion) {
    throw new Error("Rollback version must equal the baseline version.");
  }

  const deactivateObserved = requireTrue(record, "deactivateObserved");
  const targetRemovalObserved = requireTrue(record, "targetRemovalObserved");
  const baselineRemovalObserved = requireTrue(record, "baselineRemovalObserved");
  const finalPackAbsent = requireTrue(record, "finalPackAbsent");

  const observedAt = requireString(record, "observedAt", 100);
  if (!ISO_WITH_OFFSET_RE.test(observedAt) || !Number.isFinite(Date.parse(observedAt))) {
    throw new Error("observedAt must be an ISO timestamp with Z or an explicit offset.");
  }

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
    category: "pack_lifecycle",
    platform: platform as P14PackLifecyclePlatform,
    arch: arch as P14PackLifecycleArch,
    packId,
    baselineVersion,
    targetVersion,
    baselineArtifactSha256,
    targetArtifactSha256,
    integrityVerified,
    baselineInstallObserved,
    baselineHealthVerified,
    baselineActivated,
    targetInstallObserved,
    targetHealthVerified,
    targetActivated,
    retryFailureObserved,
    retrySucceeded,
    rollbackExercised,
    rollbackSucceeded,
    rollbackVersion,
    deactivateObserved,
    targetRemovalObserved,
    baselineRemovalObserved,
    finalPackAbsent,
    observedAt,
    sourceEvidence,
  };
}
