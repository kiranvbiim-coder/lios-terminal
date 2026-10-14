import crypto from "crypto";

export interface DatasetVersion {
  id: string;
  datasetId: string;
  version: number;
  sourceSha256: string;
  sourceSizeBytes: number;
  organizationId: number;
  createdByUserId: number;
  createdAt: string;
  parentVersionId: string | null;
  status: "immutable";
}

export function createDatasetVersion(input: {
  datasetId: string;
  sourceSha256: string;
  sourceSizeBytes: number;
  organizationId: number;
  createdByUserId: number;
  version: number;
  parentVersionId?: string | null;
}): DatasetVersion {
  if (!input.datasetId.trim()) throw new Error("INVALID_DATASET_ID");
  if (!/^[a-f0-9]{64}$/.test(input.sourceSha256)) throw new Error("INVALID_SOURCE_HASH");
  if (!Number.isSafeInteger(input.sourceSizeBytes) || input.sourceSizeBytes < 0) throw new Error("INVALID_SOURCE_SIZE");
  if (!Number.isInteger(input.version) || input.version < 1) throw new Error("INVALID_VERSION");
  if (!Number.isInteger(input.organizationId) || input.organizationId < 1) throw new Error("INVALID_ORGANIZATION_ID");
  if (!Number.isInteger(input.createdByUserId) || input.createdByUserId < 1) throw new Error("INVALID_USER_ID");
  return {
    id: crypto.randomUUID(), datasetId: input.datasetId, version: input.version,
    sourceSha256: input.sourceSha256, sourceSizeBytes: input.sourceSizeBytes,
    organizationId: input.organizationId, createdByUserId: input.createdByUserId,
    createdAt: new Date().toISOString(), parentVersionId: input.parentVersionId ?? null,
    status: "immutable",
  };
}

export function nextDatasetVersion(existing: Pick<DatasetVersion, "version">[]): number {
  return existing.reduce((max, item) => Math.max(max, item.version), 0) + 1;
}
