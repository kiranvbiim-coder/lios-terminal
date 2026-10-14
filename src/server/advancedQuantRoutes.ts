import type { Express } from "express";
import { requireRole } from "./auth";
import { auditActor, recordAuditEvent } from "./auditEvents";
import { PythonServiceDataError } from "./pythonService";
import { QUANT_MODEL_REGISTRY } from "./quantModelRegistry";
import {
  AdvancedQuantInputError,
  advancedQuantCatalog,
  isAdvancedQuantPath,
  type AdvancedQuantExecution,
} from "./advancedQuantExecution";
import { capabilityExecutor, CapabilityExecutionError } from "./capabilityExecutor";

export {
  ADVANCED_QUANT_PATHS,
  advancedQuantCatalog,
  advancedQuantReceiptHeaders,
  advancedQuantRunResponse,
  buildAdvancedQuantRunReceipt,
  executeAdvancedQuant,
  isAdvancedQuantPath,
  parseAdvancedQuantRunRequest,
  type AdvancedQuantExecution,
  type AdvancedQuantPath,
} from "./advancedQuantExecution";

const AUTHOR_ROLES = ["internal_admin", "internal_analyst"] as const;
const READ_ROLES = ["internal_admin", "internal_analyst", "internal_compliance"] as const;

export function registerAdvancedQuantRoutes(app: Express): void {
  app.get("/api/quant/advanced/catalog", requireRole(...READ_ROLES), (_req, res) => {
    res.json(advancedQuantCatalog());
  });

  app.post("/api/quant/advanced/:family/:model", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const path = `${req.params.family}/${req.params.model}`;
    if (!isAdvancedQuantPath(path)) {
      res.status(404).json({ error: "Unknown advanced quant model." });
      return;
    }

    const registryEntry = QUANT_MODEL_REGISTRY.find(
      (entry) => entry.apiEndpoint === `/api/quant/advanced/${path}`,
    );
    if (!registryEntry) {
      console.error(`Advanced quant registry entry missing for ${path}.`);
      res.status(503).json({ error: "Advanced quant capability is not registered.", modelPath: path });
      return;
    }

    try {
      const execution = await capabilityExecutor.execute(
        registryEntry.id,
        req.body,
        { surface: "api", userId: req.user!.id },
      ) as AdvancedQuantExecution;
      const { receipt } = execution;

      for (const [header, value] of Object.entries(execution.headers)) res.setHeader(header, value);
      await recordAuditEvent(req.user!.id, "advanced_quant_run", {
        runId: receipt.runId,
        modelPath: receipt.modelPath,
        modelId: receipt.modelId,
        modelVersion: receipt.modelVersion,
        validationLevel: receipt.validationLevel,
        inputHash: receipt.inputSnapshotHash,
        outputHash: receipt.outputSnapshotHash,
        dataClassification: receipt.dataClassification,
        provenanceDeclaration: receipt.inputProvenance.declaration,
        sourceBindings: receipt.sourceBindings.map(({ connectorId, provider, sourceReference, snapshot }) => ({
          connectorId, provider, sourceReference, snapshotId: snapshot.id, snapshotHash: snapshot.contentHash,
        })),
        transformations: receipt.transformations,
        inputKeys: Object.keys(receipt.parameters).sort(),
        executionSurface: "api",
        capabilityId: registryEntry.id,
        ...auditActor(req.user!),
      });
      res.json(execution.response);
    } catch (error) {
      if (error instanceof AdvancedQuantInputError) {
        res.status(400).json({
          error: error.message,
          issues: error.issues,
          modelPath: path,
        });
        return;
      }
      if (error instanceof PythonServiceDataError) {
        res.status(400).json({ error: error.detail, modelPath: path });
        return;
      }
      if (error instanceof CapabilityExecutionError) {
        console.error(`Capability dispatch (${registryEntry.id}) failed:`, error);
        res.status(503).json({ error: "Advanced quant capability is unavailable right now.", modelPath: path });
        return;
      }
      console.error(`Advanced quant (${path}) failed:`, error);
      res.status(502).json({ error: "Advanced quant engine unavailable right now.", modelPath: path });
    }
  });
}
