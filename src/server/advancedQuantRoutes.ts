import type { Express } from "express";
import { requireRole } from "./auth";
import { auditActor, recordAuditEvent } from "./auditEvents";
import { PythonServiceDataError } from "./pythonService";
import { QUANT_MODEL_REGISTRY } from "./quantModelRegistry";
import {
  AdvancedQuantInputError,
  advancedQuantCatalog,
  parseAdvancedQuantRunRequest,
  isAdvancedQuantPath,
  type AdvancedQuantExecution,
} from "./advancedQuantExecution";
import { capabilityExecutor, CapabilityExecutionError } from "./capabilityExecutor";
import { terminalExecutionTargetSchema, type TerminalExecutionTarget } from "@shared/terminalArtifact";
import { tenantContext } from "./tenantContext";
import { validateTerminalExecutionTarget, admitTerminalExecutionSources } from "./terminalArtifactTool";
import { createTerminalArtifactEngineVersion } from "./artifactStore";

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

    let terminalTarget: TerminalExecutionTarget | null = null;
    let executionInput = req.body;
    if (req.body && typeof req.body === "object" && !Array.isArray(req.body) && req.body.terminalArtifact !== undefined) {
      const parsed = terminalExecutionTargetSchema.safeParse(req.body.terminalArtifact);
      if (!parsed.success) { res.status(400).json({ error: "Invalid exact terminal execution target.", issues: parsed.error.issues }); return; }
      terminalTarget = parsed.data;
      const { terminalArtifact: _target, ...parameters } = req.body;
      executionInput = parameters;
      try {
        const ctx = tenantContext(req.user!);
        await validateTerminalExecutionTarget(ctx, terminalTarget, new AbortController().signal);
        const request = parseAdvancedQuantRunRequest(parameters);
        if (!request.success) { res.status(400).json({ error: "Invalid native input provenance." }); return; }
        await admitTerminalExecutionSources(ctx, request.data.inputProvenance, request.data.parameters, undefined, false, undefined, path);
      }
      catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : "Terminal execution target is no longer current." }); return; }
    }

    try {
      const execution = await capabilityExecutor.execute(
        registryEntry.id,
        executionInput,
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
      if (terminalTarget) {
        try {
          const ctx = tenantContext(req.user!);
          const saved = await createTerminalArtifactEngineVersion(ctx, terminalTarget, execution);
          res.json({ ...execution.response, terminalArtifact: { artifactId: saved.artifactId, baseVersion: terminalTarget.baseVersion, version: saved.version, contentHash: saved.contentHash } });
        } catch (error) {
          res.status(409).json({ error: `Native calculation completed but its terminal result was not retained: ${error instanceof Error ? error.message : "target changed"}. Authored inputs are preserved; reopen the current revision before explicitly running again.` });
        }
      } else res.json(execution.response);
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
