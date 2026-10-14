import crypto from "crypto";

export interface ModelInputLineage {
  id: string;
  organizationId: number;
  modelId: string;
  modelVersionId: string | null;
  datasetVersionId: string;
  transformationNodeIds: string[];
  sourceCellRefs: string[];
  targetCellRefs: string[];
  inputHash: string;
  createdByUserId: number;
  createdAt: string;
}

export function createModelInputLineage(input: {
  organizationId: number;
  modelId: string;
  modelVersionId?: string | null;
  datasetVersionId: string;
  transformationNodeIds?: string[];
  sourceCellRefs: string[];
  targetCellRefs: string[];
  inputHash: string;
  createdByUserId: number;
}): ModelInputLineage {
  if (!Number.isInteger(input.organizationId) || input.organizationId < 1) throw new Error("INVALID_ORGANIZATION_ID");
  if (!input.modelId.trim() || !input.datasetVersionId.trim()) throw new Error("INVALID_LINEAGE_RESOURCE");
  if (!/^[a-f0-9]{64}$/.test(input.inputHash)) throw new Error("INVALID_INPUT_HASH");
  if (!input.sourceCellRefs.length || !input.targetCellRefs.length) throw new Error("INVALID_CELL_MAPPING");
  if (!Number.isInteger(input.createdByUserId) || input.createdByUserId < 1) throw new Error("INVALID_USER_ID");
  return {
    id: crypto.randomUUID(), organizationId: input.organizationId, modelId: input.modelId,
    modelVersionId: input.modelVersionId ?? null, datasetVersionId: input.datasetVersionId,
    transformationNodeIds: Array.from(new Set(input.transformationNodeIds ?? [])),
    sourceCellRefs: Array.from(new Set(input.sourceCellRefs)), targetCellRefs: Array.from(new Set(input.targetCellRefs)),
    inputHash: input.inputHash, createdByUserId: input.createdByUserId, createdAt: new Date().toISOString(),
  };
}

export function assertModelInputOrganization(lineage: Pick<ModelInputLineage, "organizationId">, organizationId: number): void {
  if (lineage.organizationId !== organizationId) throw new Error("TENANT_BOUNDARY_VIOLATION");
}
