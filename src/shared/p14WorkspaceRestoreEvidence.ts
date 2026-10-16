export const P14_WORKSPACE_RESTORE_PLATFORMS = ["darwin", "win32"] as const;
export const P14_WORKSPACE_RESTORE_ARCHES = ["arm64", "x64"] as const;

export type P14WorkspaceRestorePlatform = (typeof P14_WORKSPACE_RESTORE_PLATFORMS)[number];
export type P14WorkspaceRestoreArch = (typeof P14_WORKSPACE_RESTORE_ARCHES)[number];

export type P14WorkspaceRestoreObservation = {
  schemaVersion: "1";
  category: "workspace_restore";
  platform: P14WorkspaceRestorePlatform;
  arch: P14WorkspaceRestoreArch;
  backupFormat: "lios-backup/1";
  archiveSha256: string;
  archiveEncrypted: true;
  archiveVerified: true;
  preflightDigestsMatch: true;
  cleanProfileEstablished: true;
  restoreSucceeded: true;
  preflightTables: number;
  rowsRestored: number;
  filesRestored: number;
  projectReopened: true;
  sessionReopened: true;
  artifactIntegrityVerified: true;
  continuityVerified: true;
  observedAt: string;
  sourceEvidence: string[];
};

const EXACT_KEYS = [
  "schemaVersion",
  "category",
  "platform",
  "arch",
  "backupFormat",
  "archiveSha256",
  "archiveEncrypted",
  "archiveVerified",
  "preflightDigestsMatch",
  "cleanProfileEstablished",
  "restoreSucceeded",
  "preflightTables",
  "rowsRestored",
  "filesRestored",
  "projectReopened",
  "sessionReopened",
  "artifactIntegrityVerified",
  "continuityVerified",
  "observedAt",
  "sourceEvidence",
] as const;

const SHA256_RE = /^[a-f0-9]{64}$/;
const ISO_WITH_OFFSET_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function requireRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("P14 workspace restore observation must be an object.");
  }
  const record = value as Record<string, unknown>;
  const expected = new Set<string>(EXACT_KEYS);
  const unknownKeys = Object.keys(record).filter((key) => !expected.has(key));
  const missingKeys = EXACT_KEYS.filter((key) => !Object.hasOwn(record, key));
  if (unknownKeys.length) throw new Error(`P14 workspace restore observation has unsupported fields: ${unknownKeys.join(", ")}.`);
  if (missingKeys.length) throw new Error(`P14 workspace restore observation is missing fields: ${missingKeys.join(", ")}.`);
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
  if (record[field] !== true) throw new Error(`${field} must be true for passed P14 workspace restore evidence.`);
  return true;
}

function requireCount(record: Record<string, unknown>, field: string, minimum = 0): number {
  const value = record[field];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${field} must be an integer greater than or equal to ${minimum}.`);
  }
  return value;
}

export function validateP14WorkspaceRestoreObservation(value: unknown): P14WorkspaceRestoreObservation {
  const record = requireRecord(value);
  if (record.schemaVersion !== "1") throw new Error("schemaVersion must be 1.");
  if (record.category !== "workspace_restore") throw new Error("category must be workspace_restore.");

  const platform = requireString(record, "platform", 20);
  if (!P14_WORKSPACE_RESTORE_PLATFORMS.includes(platform as P14WorkspaceRestorePlatform)) {
    throw new Error("platform must be darwin or win32 for P14 packaged workspace restore evidence.");
  }
  const arch = requireString(record, "arch", 20);
  if (!P14_WORKSPACE_RESTORE_ARCHES.includes(arch as P14WorkspaceRestoreArch)) {
    throw new Error("arch must be arm64 or x64 for P14 packaged workspace restore evidence.");
  }
  if (platform === "win32" && arch !== "x64") {
    throw new Error("win32 packaged workspace restore evidence must use x64, matching the supported Windows distribution target.");
  }

  if (record.backupFormat !== "lios-backup/1") {
    throw new Error("backupFormat must be the canonical lios-backup/1 format.");
  }
  const archiveSha256 = requireString(record, "archiveSha256", 64);
  if (!SHA256_RE.test(archiveSha256)) throw new Error("archiveSha256 must be a lowercase SHA256 digest.");

  const archiveEncrypted = requireTrue(record, "archiveEncrypted");
  const archiveVerified = requireTrue(record, "archiveVerified");
  const preflightDigestsMatch = requireTrue(record, "preflightDigestsMatch");
  const cleanProfileEstablished = requireTrue(record, "cleanProfileEstablished");
  const restoreSucceeded = requireTrue(record, "restoreSucceeded");
  const preflightTables = requireCount(record, "preflightTables", 1);
  const rowsRestored = requireCount(record, "rowsRestored");
  const filesRestored = requireCount(record, "filesRestored");
  const projectReopened = requireTrue(record, "projectReopened");
  const sessionReopened = requireTrue(record, "sessionReopened");
  const artifactIntegrityVerified = requireTrue(record, "artifactIntegrityVerified");
  const continuityVerified = requireTrue(record, "continuityVerified");

  const observedAt = requireString(record, "observedAt", 100);
  if (!ISO_WITH_OFFSET_RE.test(observedAt) || !Number.isFinite(Date.parse(observedAt))) {
    throw new Error("observedAt must be an ISO timestamp with Z or an explicit offset.");
  }

  if (!Array.isArray(record.sourceEvidence) || record.sourceEvidence.length === 0 || record.sourceEvidence.length > 50) {
    throw new Error("sourceEvidence must contain at least one bounded support-artifact identifier.");
  }
  const sourceEvidence = record.sourceEvidence.map((item) => {
    if (typeof item !== "string" || item.trim().length === 0 || item.length > 500) {
      throw new Error("sourceEvidence entries must be non-empty bounded strings.");
    }
    const normalized = item.trim();
    if (normalized === "." || normalized === ".." || normalized.includes("/") || normalized.includes("\\")) {
      throw new Error("sourceEvidence identifiers must be unique artifact basenames.");
    }
    return normalized;
  });
  if (new Set(sourceEvidence).size !== sourceEvidence.length) {
    throw new Error("sourceEvidence must not contain duplicate identifiers.");
  }

  return {
    schemaVersion: "1",
    category: "workspace_restore",
    platform: platform as P14WorkspaceRestorePlatform,
    arch: arch as P14WorkspaceRestoreArch,
    backupFormat: "lios-backup/1",
    archiveSha256,
    archiveEncrypted,
    archiveVerified,
    preflightDigestsMatch,
    cleanProfileEstablished,
    restoreSucceeded,
    preflightTables,
    rowsRestored,
    filesRestored,
    projectReopened,
    sessionReopened,
    artifactIntegrityVerified,
    continuityVerified,
    observedAt,
    sourceEvidence,
  };
}
