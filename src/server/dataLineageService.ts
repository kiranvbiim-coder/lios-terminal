import crypto from "node:crypto";
import type { CanonicalDataCapability, DataLineageReceipt, DataLineageStage, PointInTimePolicy } from "@shared/universalDataFabric";
import { dataLineageReceiptSchema, dataLineageStageSchema } from "@shared/universalDataFabric";
import { isCredentialSafeReference } from "@shared/dataFabric";
import type { TenantContext } from "./tenantContext";
import { recordDataLineageReceipt } from "./universalDataFabricStore";
import { sanitizeLedgerPayload } from "./ledgerStore";
import { emitP10OpenLineageReceipt } from "./p10OpenLineage";

export class DataLineageBuilder {
  private readonly stages: DataLineageStage[] = [];
  constructor(
    private readonly input: {
      projectId: number | null;
      requestId: string | null;
      capability: CanonicalDataCapability;
      entityRef: string;
      pointInTime: PointInTimePolicy;
    },
  ) {}

  add(stage: Omit<DataLineageStage, "at"> & { at?: string }): this {
    const references = [...stage.inputRefs, ...stage.outputRefs];
    if (!isCredentialSafeReference(stage.componentId) || references.some((ref) => !isCredentialSafeReference(ref))) {
      throw new Error("Data lineage references must not contain credentials.");
    }
    const metadata = sanitizeLedgerPayload(stage.metadata);
    this.stages.push(dataLineageStageSchema.parse({
      ...stage,
      metadata: metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : { value: metadata },
      at: stage.at ?? new Date().toISOString(),
    }));
    return this;
  }

  receipt(): DataLineageReceipt {
    if (!this.stages.length) throw new Error("Data lineage requires at least one stage.");
    return dataLineageReceiptSchema.parse({
      schemaVersion: "1",
      id: crypto.randomUUID(),
      projectId: this.input.projectId,
      requestId: this.input.requestId,
      capability: this.input.capability,
      entityRef: this.input.entityRef,
      pointInTime: this.input.pointInTime,
      stages: this.stages,
      createdAt: new Date().toISOString(),
    });
  }

  async persist(ctx: TenantContext) {
    const receipt = this.receipt();
    const persisted = await recordDataLineageReceipt(ctx, receipt);
    void emitP10OpenLineageReceipt(receipt).catch(() => false);
    return persisted;
  }
}
