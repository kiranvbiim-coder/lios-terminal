import type { Express, Request, Response } from "express";
import { z } from "zod";
import {
  artifactContentSchema,
  artifactKindSchema,
  artifactOriginSchema,
  artifactReferenceTypeSchema,
  artifactRefreshSpecSchema,
  spreadsheetCellDiffSchema,
  decisionArtifactApprovalBaseSchema,
  decisionArtifactApprovalLinkInputSchema,
} from "@shared/artifactContracts";
import { conversationArtifactDraftSchema } from "@shared/conversationRuntime";
import { trustManifestSchema } from "@shared/trustContracts";
import { requireAuth, requireRole } from "./auth";
import { tenantContext } from "./tenantContext";
import { openTerminalArtifact } from "./terminalArtifact";
import { updateTerminalArtifact } from "./terminalArtifactTool";
import { addProjectChatMessage } from "./projectChatStore";
import {
  compareArtifactVersions,
  createArtifact,
  createArtifactProposal,
  createArtifactReference,
  createArtifactVersion,
  decideArtifactProposal,
  forkArtifact,
  getArtifact,
  getArtifactVersion,
  keepConversationDraft,
  keepConversationDraftVersion,
  listArtifactInteractionReceipts,
  appendArtifactReviewNote,
  listArtifactProposals,
  listArtifactReferences,
  listArtifactVersions,
  listOwnedArtifacts,
  listProjectArtifacts,
  listChatArtifacts,
  permanentlyDeleteArtifact,
  restoreTrashedArtifact,
  setArtifactStatus,
  trashArtifact,
  undoArtifactHead,
  restoreArtifactRevision,
} from "./artifactStore";
import { queryDataArtifact } from "./dataArtifactStore";
import { createArtifactPackage, importArtifactPackage, verifyArtifactPackage } from "./artifactPackage";
import { getArtifactExportPlan } from "./artifactExport";
import { proposeArtifactBranchMerge } from "./artifactRevisionMerge";
import {
  SPREADSHEET_IMPORT_MAX_FILE_BYTES,
  SpreadsheetArtifactImportError,
  importSpreadsheetArtifact,
  importSpreadsheetArtifactIsolated,
} from "./spreadsheetArtifactImport";
import {
  SandboxRuntimeConfigurationError,
  resolveSandboxRuntimeProfile,
} from "./exec/sandbox-runtime-profile";
import { createMemoryUpload, uploadErrorResponse } from "./uploadPolicy";
import { IntegratedModelArtifactError } from "./integratedModelArtifact";
import { artifactIntegratedModelReviewSchema, artifactIntegratedModelRunSchema, reviewArtifactIntegratedModelInputs, runArtifactIntegratedModelInputs } from "./artifactIntegratedModelInput";
import { artifactModelMaintenanceHeadSchema, artifactModelMaintenanceReviewSchema, artifactModelMaintenanceApplySchema, listArtifactModelMaintenanceOptions, reviewArtifactModelMaintenance, applyArtifactModelMaintenance } from "./artifactModelMaintenance";
import { createModelChangeReport } from "./artifactModelChangeReport";
import { proposeOfficeArtifactReturn } from "./officeArtifactReturn";
import { proposeSpreadsheetReturn } from "./spreadsheetArtifactReturn";
import { proposeArtifactComposition } from "./artifactComposition";
import { createProfessionalWorkPackage } from "./professionalWorkPackage";
import { createArtifactReviewPackage } from "./artifactReviewPackage";
import {
  DecisionObjectArtifactError,
  getDecisionObjectArtifactApproval,
  listDecisionObjectArtifactApprovalOptions,
  linkDecisionObjectArtifactApproval,
  unlinkDecisionObjectArtifactApproval,
} from "./decisionObjectArtifact";
import { inspectArtifact } from "./artifactInspection";
import { getProjectChat } from "./projectChatStore";

const spreadsheetArtifactImportUpload = createMemoryUpload(
  ["xlsx", "csv", "xlsm"],
  SPREADSHEET_IMPORT_MAX_FILE_BYTES,
  { fields: 0 },
);

function parseSpreadsheetArtifactImportUpload(req: Request, res: Response, next: (error?: unknown) => void): void {
  spreadsheetArtifactImportUpload.single("file")(req, res, (error) => {
    if (!error) {
      next();
      return;
    }
    const response = uploadErrorResponse(error);
    if (response) {
      res.status(response.status).json({ error: response.message });
      return;
    }
    next(error);
  });
}

function ctx(req: Request) { return tenantContext(req.user!); }

function pathId(value: unknown): number {
  return z.coerce.number().int().positive().parse(value);
}

function pathVersion(value: unknown): number {
  return z.coerce.number().int().positive().parse(value);
}

function pathText(value: unknown): string {
  return z.string().trim().min(1).parse(value);
}

function fail(res: Response, error: unknown): void {
  if (error instanceof DecisionObjectArtifactError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  if (error instanceof IntegratedModelArtifactError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  if (error instanceof SpreadsheetArtifactImportError) {
    res.status(400).json({ error: error.message });
    return;
  }
  if (error instanceof SandboxRuntimeConfigurationError) {
    res.status(503).json({
      code: "sandbox_runtime_unavailable",
      error: error.message,
    });
    return;
  }
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: "Invalid Artifact request.", issues: error.issues });
    return;
  }
  const message = error instanceof Error ? error.message : "Artifact request failed.";
  if (/not found|not owned|outside|different Project|boundary/i.test(message)) {
    res.status(404).json({ error: message });
    return;
  }
  if (/concurrent|stale|head moved/i.test(message)) {
    res.status(409).json({ error: message });
    return;
  }
  if (/cannot|must|invalid|only|empty|exceed|Trash|Artifact|Project/i.test(message)) {
    res.status(400).json({ error: message });
    return;
  }
  console.error("Artifact route failure", error);
  res.status(500).json({ error: "Artifact request failed." });
}

export function registerArtifactRoutes(app: Express): void {
  app.get("/api/artifacts", requireAuth, async (req, res) => {
    try {
      const query = z.object({
        status: z.enum(["active", "archived", "trash"]).optional(),
        limit: z.coerce.number().int().min(1).max(500).optional(),
      }).parse(req.query);
      res.json(await listOwnedArtifacts(ctx(req), {
        status: query.status === "trash" ? "archived" : query.status,
        trash: query.status === "trash",
        limit: query.limit,
      }));
    } catch (error) { fail(res, error); }
  });

  for (const prefix of ["/api/artifacts", "/api/artifact-proposals"]) app.use(prefix, requireAuth);

  app.get("/api/projects/:projectId/artifacts", requireAuth, async (req, res) => {
    try {
      const query = z.object({
        status: z.enum(["active", "archived", "trash"]).optional(),
        kind: artifactKindSchema.optional(),
        limit: z.coerce.number().int().min(1).max(500).optional(),
      }).parse(req.query);
      res.json(await listProjectArtifacts(ctx(req), pathId(req.params.projectId), {
        ...query,
        status: query.status === "trash" ? "archived" : query.status,
        trash: query.status === "trash",
      }));
    } catch (error) { fail(res, error); }
  });

  app.get("/api/chats/:chatId/artifacts", requireAuth, async (req, res) => {
    try {
      const query = z.object({
        status: z.enum(["active", "archived", "trash"]).optional(),
        limit: z.coerce.number().int().min(1).max(500).optional(),
      }).parse(req.query);
      res.json(await listChatArtifacts(ctx(req), pathId(req.params.chatId), {
        status: query.status === "trash" ? "archived" : query.status,
        trash: query.status === "trash", limit: query.limit,
      }));
    } catch (error) { fail(res, error); }
  });

  app.post("/api/chats/:chatId/artifacts/open-terminal", requireAuth, async (req, res) => {
    try { res.json(await openTerminalArtifact(ctx(req), pathId(req.params.chatId), req.body)); }
    catch (error) { fail(res, error); }
  });
  app.post("/api/chats/:chatId/artifacts/terminal-operation", requireAuth, async (req, res) => {
    try {
      const chatId = pathId(req.params.chatId);
      const body = z.object({ instruction: z.string().trim().min(1).max(2000), update: z.unknown() }).strict().parse(req.body);
      const { parseTerminalArtifactInstruction } = await import("@shared/terminalArtifactOperations");
      const operations = parseTerminalArtifactInstruction(body.instruction);
      if (!operations) throw new Error("This request is not an explicit supported terminal operation.");
      const { terminalArtifactUpdateSchema } = await import("@shared/terminalArtifactOperations");
      const update = terminalArtifactUpdateSchema.parse(body.update);
      if (JSON.stringify(update.operations) !== JSON.stringify(operations)) throw new Error("Terminal operation does not match the explicit instruction.");
      const result = await updateTerminalArtifact(ctx(req), chatId, update, new AbortController().signal);
      await addProjectChatMessage(ctx(req), chatId, { role: "user", content: body.instruction });
      await addProjectChatMessage(ctx(req), chatId, { role: "assistant", content: `Updated the existing terminal Artifact · v${result.version}. Its presentation settings changed; no financial calculation was claimed.`, metadata: { persistedArtifacts: [{ id: result.artifactId, version: result.version, kind: "screen" }] } });
      res.json(result);
    } catch (error) { fail(res, error); }
  });

  app.post("/api/chats/:chatId/artifacts/keep-draft", requireAuth, async (req, res) => {
    try {
      const body = z.object({
        draft: conversationArtifactDraftSchema,
        requestId: z.string().uuid().nullable().optional(),
        trustManifest: trustManifestSchema.nullable().optional(),
        dependencyRefs: z.array(z.string().trim().min(1).max(1_000)).max(5_000).default([]),
        refreshSpec: artifactRefreshSpecSchema.nullable().optional(),
      }).strict().parse(req.body);
      const chatId = pathId(req.params.chatId);
      const chat = await getProjectChat(ctx(req), chatId);
      res.json(await keepConversationDraft(ctx(req), { projectId: chat.projectId, owningChatId: chatId, ...body }));
    } catch (error) { fail(res, error); }
  });

  app.post("/api/projects/:projectId/artifacts", requireAuth, async (req, res) => {
    try {
      const body = z.object({
        title: z.string().trim().min(1).max(500),
        content: artifactContentSchema,
        origin: artifactOriginSchema.optional(),
        adapterId: z.string().trim().max(200).nullable().optional(),
        sourceRefs: z.array(z.string().trim().min(1).max(1_000)).max(2_000).default([]),
        executionReceiptIds: z.array(z.string().uuid()).max(1_000).default([]),
        assumptionRefs: z.array(z.string().trim().min(1).max(500)).max(2_000).default([]),
        trustManifest: trustManifestSchema.nullable().optional(),
        dependencyRefs: z.array(z.string().trim().min(1).max(1_000)).max(5_000).default([]),
        refreshSpec: artifactRefreshSpecSchema.nullable().optional(),
        note: z.string().max(4_000).nullable().optional(),
      }).strict().parse(req.body);
      res.json(await createArtifact(ctx(req), { projectId: pathId(req.params.projectId), ...body }));
    } catch (error) { fail(res, error); }
  });
  app.post("/api/projects/:projectId/artifacts/professional-package", requireRole("internal_admin", "internal_analyst", "client_admin", "client_user"), async (req, res) => {
    try { res.json(await createProfessionalWorkPackage(ctx(req), { ...req.body, projectId: pathId(req.params.projectId) })); }
    catch (error) { fail(res, error); }
  });

  app.post(
    "/api/projects/:projectId/artifacts/import-spreadsheet",
    requireAuth,
    parseSpreadsheetArtifactImportUpload,
    async (req, res) => {
      try {
        const file = (req as Request & { file?: { buffer: Buffer; originalname: string } }).file;
        if (!file) return res.status(400).json({ error: "Choose an XLSX or CSV spreadsheet to import." });
        const projectId = pathId(req.params.projectId);
        const input = { bytes: file.buffer, originalName: file.originalname };
        const sandbox = resolveSandboxRuntimeProfile();
        const imported = sandbox.mode === "strict"
          ? await importSpreadsheetArtifactIsolated(
              ctx(req),
              projectId,
              input,
              {
                backend: sandbox.backend!,
                sandboxNodePath: sandbox.tools.node!,
                sandboxXlsxModulePath: sandbox.tools.xlsxModule!,
              },
            )
          : await importSpreadsheetArtifact(ctx(req), projectId, input);
        res.status(201).json(imported);
      } catch (error) { fail(res, error); }
    },
  );

  app.post("/api/projects/:projectId/artifacts/keep-draft", requireAuth, async (req, res) => {
    try {
      const body = z.object({
        draft: conversationArtifactDraftSchema,
        requestId: z.string().uuid().nullable().optional(),
        sessionId: z.string().trim().max(240).nullable().optional(),
        trustManifest: trustManifestSchema.nullable().optional(),
        dependencyRefs: z.array(z.string().trim().min(1).max(1_000)).max(5_000).default([]),
        refreshSpec: artifactRefreshSpecSchema.nullable().optional(),
      }).strict().parse(req.body);
      res.json(await keepConversationDraft(ctx(req), { projectId: pathId(req.params.projectId), ...body }));
    } catch (error) { fail(res, error); }
  });

  app.post("/api/artifacts/:artifactId/keep-draft-version", requireAuth, async (req, res) => {
    try {
      const body = z.object({
        draft: conversationArtifactDraftSchema,
        requestId: z.string().uuid().nullable().optional(),
        trustManifest: trustManifestSchema.nullable().optional(),
        dependencyRefs: z.array(z.string().trim().min(1).max(1_000)).max(5_000).default([]),
        refreshSpec: artifactRefreshSpecSchema.nullable().optional(),
      }).strict().parse(req.body);
      res.json(await keepConversationDraftVersion(ctx(req), { artifactId: pathText(req.params.artifactId), ...body }));
    } catch (error) { fail(res, error); }
  });

  app.get("/api/artifacts/:artifactId", async (req, res) => {
    try {
      const artifact = await getArtifact(ctx(req), pathText(req.params.artifactId));
      const version = await getArtifactVersion(ctx(req), artifact.id, req.query.version === undefined ? undefined : pathVersion(req.query.version));
      res.json({ artifact, version });
    } catch (error) { fail(res, error); }
  });
  app.post("/api/artifacts/:artifactId/inspect", requireAuth, async (req, res) => {
    try {
      if (req.body?.artifactId !== pathText(req.params.artifactId)) throw new Error("Artifact inspection identity does not match the route.");
      res.json(await inspectArtifact(ctx(req), req.body));
    } catch (error) { fail(res, error); }
  });
  app.get("/api/artifacts/:artifactId/review-notes", async (req, res) => {
    try { res.json((await listArtifactInteractionReceipts(ctx(req), pathText(req.params.artifactId))).filter(receipt => receipt.detail.reviewNote)); }
    catch (error) { fail(res, error); }
  });
  app.post("/api/artifacts/:artifactId/review-notes", async (req, res) => {
    try { res.json(await appendArtifactReviewNote(ctx(req), pathText(req.params.artifactId), req.body)); }
    catch (error) { fail(res, error); }
  });
  app.post("/api/artifacts/:artifactId/review-package", async (req, res) => {
    try { res.json(await createArtifactReviewPackage(ctx(req), pathText(req.params.artifactId), req.body)); }
    catch (error) { fail(res, error); }
  });
  app.post("/api/artifacts/:artifactId/model-change-report", requireRole("internal_admin", "internal_analyst"), async (req, res) => {
    try { res.json(await createModelChangeReport(ctx(req), pathText(req.params.artifactId), req.body)); }
    catch (error) { fail(res, error); }
  });
  app.post("/api/artifacts/:artifactId/spreadsheet-return", requireRole("internal_admin", "internal_analyst", "client_admin", "client_user"), parseSpreadsheetArtifactImportUpload, async (req, res) => {
    try {
      const file = (req as Request & { file?: { buffer: Buffer; originalname: string } }).file;
      if (!file) throw new Error("Choose the edited LiOS-exported XLSX file.");
      res.json(await proposeSpreadsheetReturn(ctx(req), pathText(req.params.artifactId), req.query, file));
    } catch (error) { fail(res, error); }
  });
  app.get("/api/artifacts/:artifactId/decision-approval", async (req, res) => {
    try {
      const query = z.object({ version: z.coerce.number().int().positive().optional() }).strict().parse(req.query);
      res.json(await getDecisionObjectArtifactApproval(ctx(req), pathText(req.params.artifactId), query.version));
    } catch (error) { fail(res, error); }
  });
  app.get("/api/artifacts/:artifactId/decision-approval/options", async (req, res) => {
    try {
      const query = z.object({ version: z.coerce.number().int().positive().optional() }).strict().parse(req.query);
      res.json(await listDecisionObjectArtifactApprovalOptions(ctx(req), pathText(req.params.artifactId), query.version));
    } catch (error) { fail(res, error); }
  });
  app.post("/api/artifacts/:artifactId/decision-approval/link", async (req, res) => {
    try {
      res.json(await linkDecisionObjectArtifactApproval(ctx(req), pathText(req.params.artifactId), decisionArtifactApprovalLinkInputSchema.parse(req.body)));
    } catch (error) { fail(res, error); }
  });
  app.post("/api/artifacts/:artifactId/decision-approval/unlink", async (req, res) => {
    try {
      res.json(await unlinkDecisionObjectArtifactApproval(ctx(req), pathText(req.params.artifactId), decisionArtifactApprovalBaseSchema.parse(req.body)));
    } catch (error) { fail(res, error); }
  });

  app.post("/api/artifacts/:artifactId/office-return", async (req, res) => {
    try { res.json(await proposeOfficeArtifactReturn(ctx(req), pathText(req.params.artifactId), req.body)); }
    catch (error) { fail(res, error); }
  });
  app.post("/api/artifacts/:artifactId/integrated-model-review", requireRole("internal_admin", "internal_analyst"), async (req, res) => {
    try {
      res.json(await reviewArtifactIntegratedModelInputs(ctx(req), pathText(req.params.artifactId), artifactIntegratedModelReviewSchema.parse(req.body)));
    } catch (error) { fail(res, error); }
  });

  app.post("/api/artifacts/:artifactId/integrated-model-run", requireRole("internal_admin", "internal_analyst"), async (req, res) => {
    try {
      res.json(await runArtifactIntegratedModelInputs(ctx(req), pathText(req.params.artifactId), artifactIntegratedModelRunSchema.parse(req.body)));
    } catch (error) { fail(res, error); }
  });

  app.post("/api/artifacts/:artifactId/model-maintenance/options", requireRole("internal_admin", "internal_analyst"), async (req, res) => {
    try { res.json(await listArtifactModelMaintenanceOptions(ctx(req), pathText(req.params.artifactId), artifactModelMaintenanceHeadSchema.parse(req.body))); }
    catch (error) { fail(res, error); }
  });
  app.post("/api/artifacts/:artifactId/model-maintenance/review", requireRole("internal_admin", "internal_analyst"), async (req, res) => {
    try { res.json(await reviewArtifactModelMaintenance(ctx(req), pathText(req.params.artifactId), artifactModelMaintenanceReviewSchema.parse(req.body))); }
    catch (error) { fail(res, error); }
  });
  app.post("/api/artifacts/:artifactId/model-maintenance/apply", requireRole("internal_admin", "internal_analyst"), async (req, res) => {
    try { res.json(await applyArtifactModelMaintenance(ctx(req), pathText(req.params.artifactId), artifactModelMaintenanceApplySchema.parse(req.body))); }
    catch (error) { fail(res, error); }
  });


  app.patch("/api/artifacts/:artifactId", async (req, res) => {
    try {
      const body = z.object({ status: z.enum(["active", "archived"]) }).strict().parse(req.body);
      res.json(await setArtifactStatus(ctx(req), pathText(req.params.artifactId), body.status));
    } catch (error) { fail(res, error); }
  });

  app.post("/api/artifacts/:artifactId/trash", async (req, res) => {
    try { res.json(await trashArtifact(ctx(req), pathText(req.params.artifactId))); }
    catch (error) { fail(res, error); }
  });

  app.post("/api/artifacts/:artifactId/restore-trash", async (req, res) => {
    try { res.json(await restoreTrashedArtifact(ctx(req), pathText(req.params.artifactId))); }
    catch (error) { fail(res, error); }
  });

  app.delete("/api/artifacts/:artifactId", async (req, res) => {
    try { res.json(await trashArtifact(ctx(req), pathText(req.params.artifactId))); }
    catch (error) { fail(res, error); }
  });

  app.delete("/api/artifacts/:artifactId/permanent", async (req, res) => {
    try {
      await permanentlyDeleteArtifact(ctx(req), pathText(req.params.artifactId));
      res.json({ ok: true });
    } catch (error) { fail(res, error); }
  });

  app.get("/api/artifacts/:artifactId/versions", async (req, res) => {
    try { res.json(await listArtifactVersions(ctx(req), pathText(req.params.artifactId))); }
    catch (error) { fail(res, error); }
  });

  app.post("/api/artifacts/:artifactId/versions", async (req, res) => {
    try {
      const body = z.object({
        baseVersion: z.number().int().positive(),
        content: artifactContentSchema,
        adapterId: z.string().trim().max(200).nullable().optional(),
        sourceRefs: z.array(z.string().trim().min(1).max(1_000)).max(2_000).optional(),
        executionReceiptIds: z.array(z.string().uuid()).max(1_000).optional(),
        assumptionRefs: z.array(z.string().trim().min(1).max(500)).max(2_000).optional(),
        trustManifest: trustManifestSchema.nullable().optional(),
        dependencyRefs: z.array(z.string().trim().min(1).max(1_000)).max(5_000).optional(),
        refreshSpec: artifactRefreshSpecSchema.nullable().optional(),
        actorType: z.enum(["user", "conversation", "system"]).default("user"),
        requestId: z.string().uuid().nullable().optional(),
        note: z.string().max(4_000).nullable().optional(),
      }).strict().parse(req.body);
      res.json(await createArtifactVersion(ctx(req), { artifactId: pathText(req.params.artifactId), ...body }));
    } catch (error) { fail(res, error); }
  });

  app.get("/api/artifacts/:artifactId/compare/:leftVersion/:rightVersion", async (req, res) => {
    try {
      res.json(await compareArtifactVersions(
        ctx(req), pathText(req.params.artifactId),
        pathVersion(req.params.leftVersion), pathVersion(req.params.rightVersion),
      ));
    } catch (error) { fail(res, error); }
  });

  app.post("/api/artifacts/:artifactId/fork", async (req, res) => {
    try {
      const body = z.object({
        version: z.number().int().positive().optional(),
        title: z.string().trim().max(500).nullable().optional(),
        projectId: z.number().int().positive().nullable().optional(),
      }).strict().parse(req.body);
      res.json(await forkArtifact(ctx(req), { artifactId: pathText(req.params.artifactId), ...body }));
    } catch (error) { fail(res, error); }
  });

  app.get("/api/artifacts/:artifactId/references", async (req, res) => {
    try { res.json(await listArtifactReferences(ctx(req), pathText(req.params.artifactId))); }
    catch (error) { fail(res, error); }
  });

  app.post("/api/artifacts/:artifactId/references", async (req, res) => {
    try {
      const body = z.object({
        version: z.number().int().positive().nullable().optional(),
        targetType: artifactReferenceTypeSchema,
        targetRef: z.string().trim().min(1).max(1_000),
        label: z.string().trim().max(500).nullable().optional(),
      }).strict().parse(req.body);
      res.json(await createArtifactReference(ctx(req), { artifactId: pathText(req.params.artifactId), ...body }));
    } catch (error) { fail(res, error); }
  });

  app.get("/api/artifacts/:artifactId/proposals", async (req, res) => {
    try { res.json(await listArtifactProposals(ctx(req), pathText(req.params.artifactId))); }
    catch (error) { fail(res, error); }
  });

  app.post("/api/artifacts/:artifactId/compose", async (req, res) => {
    try {
      res.json(await proposeArtifactComposition(ctx(req), pathText(req.params.artifactId), req.body));
    } catch (error) { fail(res, error); }
  });

  app.post("/api/artifacts/:artifactId/proposals", async (req, res) => {
    try {
      const body = z.object({
        baseVersion: z.number().int().positive(),
        type: z.enum(["spreadsheet_ai_diff", "document_edit", "artifact_patch"]),
        summary: z.string().trim().min(1).max(4_000),
        diffs: z.array(spreadsheetCellDiffSchema).max(50_000).optional(),
        patch: z.record(z.unknown()).optional(),
        actorType: z.enum(["user", "conversation"]).default("user"),
        requestId: z.string().uuid().nullable().optional(),
      }).strict().parse(req.body);
      res.json(await createArtifactProposal(ctx(req), { artifactId: pathText(req.params.artifactId), ...body }));
    } catch (error) { fail(res, error); }
  });

  app.post("/api/artifact-proposals/:proposalId/decision", async (req, res) => {
    try {
      const body = z.object({ decision: z.enum(["accept", "reject"]) }).strict().parse(req.body);
      res.json(await decideArtifactProposal(ctx(req), pathText(req.params.proposalId), body.decision));
    } catch (error) { fail(res, error); }
  });

  app.post("/api/artifacts/:artifactId/undo", async (req, res) => {
    try { res.json(await undoArtifactHead(ctx(req), pathText(req.params.artifactId))); }
    catch (error) { fail(res, error); }
  });

  app.post("/api/artifacts/:artifactId/restore-revision", async (req, res) => {
    try {
      const body = z.object({ baseVersion: z.number().int().positive(), targetVersion: z.number().int().positive() }).strict().parse(req.body);
      res.json(await restoreArtifactRevision(ctx(req), pathText(req.params.artifactId), body.baseVersion, body.targetVersion));
    } catch (error) { fail(res, error); }
  });

  app.post("/api/artifacts/:artifactId/merge-branch", async (req, res) => {
    try { res.json(await proposeArtifactBranchMerge(ctx(req), pathText(req.params.artifactId), req.body)); }
    catch (error) { fail(res, error); }
  });

  app.get("/api/artifacts/:artifactId/interactions", async (req, res) => {
    try { res.json(await listArtifactInteractionReceipts(ctx(req), pathText(req.params.artifactId))); }
    catch (error) { fail(res, error); }
  });

  app.post("/api/artifacts/:artifactId/data-query", async (req, res) => {
    try {
      const body = z.object({
        metric: z.string().trim().max(300).optional(),
        dateFrom: z.string().date().optional(),
        dateTo: z.string().date().optional(),
        limit: z.number().int().min(1).max(500).optional(),
        offset: z.number().int().nonnegative().optional(),
      }).strict().parse(req.body);
      const version = await getArtifactVersion(ctx(req), pathText(req.params.artifactId));
      res.json(await queryDataArtifact(version.content, body, ctx(req)));
    } catch (error) { fail(res, error); }
  });

  app.get("/api/artifacts/:artifactId/export-plan", async (req, res) => {
    try {
      const version = req.query.version ? pathVersion(req.query.version) : undefined;
      res.json(await getArtifactExportPlan(ctx(req), pathText(req.params.artifactId), version));
    } catch (error) { fail(res, error); }
  });

  app.get("/api/projects/:projectId/artifact-package", requireAuth, async (req, res) => {
    try { res.json(await createArtifactPackage(ctx(req), pathId(req.params.projectId))); }
    catch (error) { fail(res, error); }
  });

  app.post("/api/projects/:projectId/artifact-package/verify", requireAuth, async (req, res) => {
    try {
      const pkg = verifyArtifactPackage(req.body);
      res.json({ valid: true, packageHash: pkg.packageHash, artifacts: pkg.artifacts.length, sessions: pkg.sessions.length });
    } catch (error) { fail(res, error); }
  });

  app.post("/api/projects/:projectId/artifact-package/import", requireAuth, async (req, res) => {
    try { res.json(await importArtifactPackage(ctx(req), pathId(req.params.projectId), req.body)); }
    catch (error) { fail(res, error); }
  });
}
