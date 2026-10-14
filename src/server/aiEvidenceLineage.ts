import crypto from "crypto";

export type EvidenceKind = "dataset" | "dataset_version" | "transformation" | "model_input" | "valuation" | "document" | "user_assertion";
export interface AIEvidenceRef { id: string; kind: EvidenceKind; resourceId: string; locator?: string | null; excerptHash?: string | null; }
export interface AIAttributionRecord {
  id: string;
  organizationId: number;
  modelId: string | null;
  modelVersionId: string | null;
  valuationLineageId: string | null;
  promptHash: string;
  outputHash: string;
  evidence: AIEvidenceRef[];
  provider: string;
  modelName: string;
  modelVersion: string | null;
  createdByUserId: number;
  createdAt: string;
}

export function hashText(text: string): string { return crypto.createHash("sha256").update(text, "utf8").digest("hex"); }

export function createAIAttribution(input: {
  organizationId: number;
  modelId?: string | null;
  modelVersionId?: string | null;
  valuationLineageId?: string | null;
  prompt: string;
  output: string;
  evidence: AIEvidenceRef[];
  provider: string;
  modelName: string;
  modelVersion?: string | null;
  createdByUserId: number;
}): AIAttributionRecord {
  if (!Number.isInteger(input.organizationId) || input.organizationId < 1) throw new Error("INVALID_ORGANIZATION_ID");
  if (!input.prompt.trim() || !input.output.trim()) throw new Error("INVALID_AI_CONTENT");
  if (!input.provider.trim() || !input.modelName.trim()) throw new Error("INVALID_AI_MODEL_METADATA");
  if (!Number.isInteger(input.createdByUserId) || input.createdByUserId < 1) throw new Error("INVALID_USER_ID");
  const evidence = input.evidence.map((e) => ({ ...e, locator: e.locator ?? null, excerptHash: e.excerptHash ?? null }));
  return {
    id: crypto.randomUUID(), organizationId: input.organizationId, modelId: input.modelId ?? null,
    modelVersionId: input.modelVersionId ?? null, valuationLineageId: input.valuationLineageId ?? null,
    promptHash: hashText(input.prompt), outputHash: hashText(input.output), evidence,
    provider: input.provider, modelName: input.modelName, modelVersion: input.modelVersion ?? null,
    createdByUserId: input.createdByUserId, createdAt: new Date().toISOString(),
  };
}

export function assertAIEvidenceOrganization(record: Pick<AIAttributionRecord, "organizationId">, organizationId: number): void {
  if (record.organizationId !== organizationId) throw new Error("TENANT_BOUNDARY_VIOLATION");
}
