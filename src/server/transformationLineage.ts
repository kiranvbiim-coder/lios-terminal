import crypto from "crypto";

export type TransformationType = "parse" | "normalize" | "map" | "convert" | "derive" | "aggregate" | "filter";

export interface TransformationNode {
  id: string;
  organizationId: number;
  datasetVersionId: string;
  parentNodeIds: string[];
  type: TransformationType;
  operation: string;
  implementationVersion: string;
  inputHash: string;
  outputHash: string;
  createdByUserId: number;
  createdAt: string;
}

export function createTransformationNode(input: {
  organizationId: number;
  datasetVersionId: string;
  parentNodeIds?: string[];
  type: TransformationType;
  operation: string;
  implementationVersion: string;
  inputHash: string;
  outputHash: string;
  createdByUserId: number;
}): TransformationNode {
  if (!Number.isInteger(input.organizationId) || input.organizationId < 1) throw new Error("INVALID_ORGANIZATION_ID");
  if (!input.datasetVersionId.trim()) throw new Error("INVALID_DATASET_VERSION_ID");
  if (!input.operation.trim() || !input.implementationVersion.trim()) throw new Error("INVALID_TRANSFORMATION_METADATA");
  if (!/^[a-f0-9]{64}$/.test(input.inputHash) || !/^[a-f0-9]{64}$/.test(input.outputHash)) throw new Error("INVALID_TRANSFORMATION_HASH");
  if (!Number.isInteger(input.createdByUserId) || input.createdByUserId < 1) throw new Error("INVALID_USER_ID");
  return {
    id: crypto.randomUUID(), organizationId: input.organizationId, datasetVersionId: input.datasetVersionId,
    parentNodeIds: Array.from(new Set(input.parentNodeIds ?? [])), type: input.type, operation: input.operation,
    implementationVersion: input.implementationVersion, inputHash: input.inputHash, outputHash: input.outputHash,
    createdByUserId: input.createdByUserId, createdAt: new Date().toISOString(),
  };
}

export function assertLineageOrganization(node: Pick<TransformationNode, "organizationId">, organizationId: number): void {
  if (node.organizationId !== organizationId) throw new Error("TENANT_BOUNDARY_VIOLATION");
}
