import crypto from "crypto";

export type ValuationMethod = "dcf" | "trading_comps" | "precedent_transactions" | "lbo" | "sum_of_parts" | "nav";
export interface ValuationLineage {
  id: string;
  organizationId: number;
  modelId: string;
  modelVersionId: string | null;
  method: ValuationMethod;
  outputName: string;
  outputValue: number;
  currency: string;
  inputLineageIds: string[];
  assumptionNames: string[];
  calculationVersion: string;
  outputHash: string;
  createdByUserId: number;
  createdAt: string;
}

export function createValuationLineage(input: {
  organizationId: number;
  modelId: string;
  modelVersionId?: string | null;
  method: ValuationMethod;
  outputName: string;
  outputValue: number;
  currency: string;
  inputLineageIds?: string[];
  assumptionNames?: string[];
  calculationVersion: string;
  outputHash: string;
  createdByUserId: number;
}): ValuationLineage {
  if (!Number.isInteger(input.organizationId) || input.organizationId < 1) throw new Error("INVALID_ORGANIZATION_ID");
  if (!input.modelId.trim() || !input.outputName.trim() || !input.currency.trim()) throw new Error("INVALID_VALUATION_METADATA");
  if (!Number.isFinite(input.outputValue)) throw new Error("INVALID_VALUATION_OUTPUT");
  if (!input.calculationVersion.trim() || !/^[a-f0-9]{64}$/.test(input.outputHash)) throw new Error("INVALID_VALUATION_PROVENANCE");
  if (!Number.isInteger(input.createdByUserId) || input.createdByUserId < 1) throw new Error("INVALID_USER_ID");
  return { id: crypto.randomUUID(), organizationId: input.organizationId, modelId: input.modelId, modelVersionId: input.modelVersionId ?? null, method: input.method, outputName: input.outputName, outputValue: input.outputValue, currency: input.currency.toUpperCase(), inputLineageIds: Array.from(new Set(input.inputLineageIds ?? [])), assumptionNames: Array.from(new Set(input.assumptionNames ?? [])), calculationVersion: input.calculationVersion, outputHash: input.outputHash, createdByUserId: input.createdByUserId, createdAt: new Date().toISOString() };
}

export function assertValuationOrganization(record: Pick<ValuationLineage, "organizationId">, organizationId: number): void {
  if (record.organizationId !== organizationId) throw new Error("TENANT_BOUNDARY_VIOLATION");
}
