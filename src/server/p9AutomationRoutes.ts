import type { Express, Request, Response } from "express";
import { z } from "zod";
import { requireAuth } from "./auth";
import { tenantContext } from "./tenantContext";
import { getProjectChat } from "./projectChatStore";
import { getProject } from "./projectStore";
import {
  createP9Workflow,
  deleteP9Workflow,
  findP9ManualRunReceipt,
  getP9Workflow,
  listP9Notifications,
  listOwnedP9Notifications,
  listP9Runs,
  listP9Workflows,
  markP9NotificationRead,
  replaceP9Workflow,
  setP9WorkflowEnabled,
} from "./p9AutomationStore";
import { executeP9Workflow } from "./p9AutomationService";
import {
  p9ManualRunDedupeKey,
  p9ManualRunReceiptStatus,
  p9ManualRunRequestSchema,
  p9ManualRunRevisionMatches,
} from "./p9ManualRunIdempotency";
import {
  P9_CANONICAL_WORKFLOW_TEMPLATES,
  p9NotificationPolicySchema,
  p9AcceptedArtifactSchema,
  p9WorkflowDefinitionInputSchema,
  p9WorkflowTemplateSchema,
  p9WorkflowTriggerSchema,
} from "@shared/p9AutomationContracts";
import { conversationRequestSchema } from "@shared/conversationRuntime";

function ctx(req: Request) {
  return tenantContext(req.user!);
}

function projectId(req: Request): number {
  return z.coerce.number().int().positive().parse(req.params.projectId);
}

function fail(res: Response, error: unknown): void {
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: "Invalid P9 automation request.", issues: error.issues });
    return;
  }
  const message = error instanceof Error ? error.message : "Automation request failed.";
  if (/not found|not owned|boundary|different Project|no longer belongs/i.test(message)) {
    res.status(404).json({ error: message });
    return;
  }
  if (/approval|credential|permission|requires fresh|changed since review/i.test(message)) {
    res.status(409).json({ error: message });
    return;
  }
  res.status(400).json({ error: message });
}

const savedConversationRequestSchema = conversationRequestSchema.omit({
  requestId: true,
  continuationOf: true,
});

export function registerP9AutomationRoutes(app: Express): void {
  app.get("/api/automation/notifications", requireAuth, async (req, res) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json(await listOwnedP9Notifications(ctx(req), z.coerce.number().int().min(1).max(500).parse(req.query.limit ?? 100)));
    } catch (error) { fail(res, error); }
  });
  app.use("/api/projects/:projectId/automation", requireAuth);

  app.get("/api/projects/:projectId/automation/runtime", async (req, res) => {
    try {
      const pid = projectId(req);
      await getProject(ctx(req), pid);
      res.json({
        schemaVersion: "1",
        templates: P9_CANONICAL_WORKFLOW_TEMPLATES,
        triggerTypes: ["manual", "schedule", "event"],
        notificationChannels: ["in_app"],
        eventSources: {
          filing: { state: "live", adapter: "sec_edgar_cursor_observer" },
          earnings: { state: "retained_source_observer", adapter: "current_estimate_actual_snapshots", requiresCurrentSourceRights: true },
          estimate_revision: { state: "retained_source_observer", adapter: "current_estimate_vintages", requiresCurrentSourceRights: true },
          data_refresh: { state: "live", adapter: "data_spine" },
          price_threshold: { state: "live", adapter: "price_alerts" },
          risk_threshold: { state: "live", adapter: "decision_monitor" },
          provider_health: { state: "live", adapter: "source_connection_health" },
        },
        visualEditor: {
          enabled: false,
          reason: "P9 keeps Save Workflow simple first. React Flow remains deferred until the simple workflow UX is complete.",
        },
      });
    } catch (error) { fail(res, error); }
  });

  app.get("/api/projects/:projectId/automation/workflows", async (req, res) => {
    try { res.json(await listP9Workflows(ctx(req), projectId(req))); }
    catch (error) { fail(res, error); }
  });

  app.post("/api/projects/:projectId/automation/workflows", async (req, res) => {
    try {
      res.status(201).json(await createP9Workflow(ctx(req), projectId(req), req.body));
    } catch (error) { fail(res, error); }
  });

  app.put("/api/projects/:projectId/automation/workflows/:workflowId", async (req, res) => {
    try {
      const pid = projectId(req);
      const current = await getP9Workflow(ctx(req), String(req.params.workflowId));
      if (current.projectId !== pid) throw new Error("Automation workflow belongs to a different Project.");
      const { expectedUpdatedAt, ...definition } = z.object({ expectedUpdatedAt: z.string().datetime({ offset: true }).optional() }).passthrough().parse(req.body);
      res.json(await replaceP9Workflow(ctx(req), current.id, definition, expectedUpdatedAt));
    } catch (error) { fail(res, error); }
  });

  app.post("/api/projects/:projectId/automation/workflows/:workflowId/enabled", async (req, res) => {
    try {
      const pid = projectId(req);
      const body = z.object({ enabled: z.boolean(), expectedUpdatedAt: z.string().datetime({ offset: true }).optional() }).strict().parse(req.body);
      const current = await getP9Workflow(ctx(req), String(req.params.workflowId));
      if (current.projectId !== pid) throw new Error("Automation workflow belongs to a different Project.");
      res.json(await setP9WorkflowEnabled(ctx(req), current.id, body.enabled, body.expectedUpdatedAt));
    } catch (error) { fail(res, error); }
  });

  app.delete("/api/projects/:projectId/automation/workflows/:workflowId", async (req, res) => {
    try {
      const pid = projectId(req);
      const current = await getP9Workflow(ctx(req), String(req.params.workflowId));
      if (current.projectId !== pid) throw new Error("Automation workflow belongs to a different Project.");
      const expected = z.object({ expectedUpdatedAt: z.string().datetime({ offset: true }).optional() }).strict().parse(req.body ?? {});
      await deleteP9Workflow(ctx(req), current.id, expected.expectedUpdatedAt);
      res.json({ ok: true });
    } catch (error) { fail(res, error); }
  });

  app.post("/api/projects/:projectId/automation/workflows/:workflowId/run", async (req, res) => {
    try {
      const pid = projectId(req);
      const owner = ctx(req);
      const current = await getP9Workflow(owner, String(req.params.workflowId));
      if (current.projectId !== pid) throw new Error("Automation workflow belongs to a different Project.");
      const request = p9ManualRunRequestSchema.parse(req.body ?? {});
      const keyed = "idempotencyKey" in request ? request : null;
      const key = keyed ? p9ManualRunDedupeKey(keyed.idempotencyKey) : null;

      // Return the original durable receipt for a repeated key, even if the
      // workflow was subsequently edited. Never execute a second action.
      if (key && keyed) {
        const previous = await findP9ManualRunReceipt(owner, pid, current.id, key);
        if (previous) {
          res.status(previous.status === "running" ? 202 : 200).json({
            run: previous, notification: null, result: null,
            error: previous.error, replayed: true,
            receiptStatus: p9ManualRunReceiptStatus(previous.status),
          });
          return;
        }
        if (!p9ManualRunRevisionMatches(current.updatedAt, keyed.expectedUpdatedAt)) {
          res.status(409).json({ error: "Workflow changed since approval. Review and confirm again." });
          return;
        }
      }
      const result = await executeP9Workflow({
        workflow: current,
        ctx: owner,
        triggerType: "manual",
        triggerDetail: { requestedAt: new Date().toISOString() },
        dedupeKey: key,
        // beginP9Run locks the canonical row and compares this exact approved
        // snapshot before insert; the earlier route check is only a fast reject.
        expectedWorkflowUpdatedAt: keyed
          ? new Date(keyed.expectedUpdatedAt)
          : null,
      });
      if (!result.run && key) {
        // Another process won the DB unique-key race. Its P9 run row is the
        // receipt; never retry execution just because our insert conflicted.
        const previous = await findP9ManualRunReceipt(owner, pid, current.id, key);
        if (!previous) {
          res.status(409).json({ error: "Workflow changed during admission or request already claimed. Review current workflow and reconcile the receipt; no new execution was admitted." });
          return;
        }
        res.status(previous.status === "running" ? 202 : 200).json({
          run: previous, notification: null, result: null,
          error: previous.error, replayed: true,
          receiptStatus: p9ManualRunReceiptStatus(previous.status),
        });
        return;
      }
      res.status(result.error ? 409 : 200).json({
        ...result, replayed: false,
        receiptStatus: result.run ? p9ManualRunReceiptStatus(result.run.status) : null,
      });
    } catch (error) { fail(res, error); }
  });

  app.get("/api/projects/:projectId/automation/workflows/:workflowId/manual-requests/:requestKey", async (req, res) => {
    try {
      const pid = projectId(req);
      const owner = ctx(req);
      const current = await getP9Workflow(owner, String(req.params.workflowId));
      if (current.projectId !== pid) throw new Error("Automation workflow belongs to a different Project.");
      const key = p9ManualRunDedupeKey(String(req.params.requestKey));
      const receipt = await findP9ManualRunReceipt(owner, pid, current.id, key);
      if (!receipt) {
        res.status(404).json({ error: "Manual execution receipt not found." });
        return;
      }
      res.json({ run: receipt, receiptStatus: p9ManualRunReceiptStatus(receipt.status) });
    } catch (error) { fail(res, error); }
  });

  app.get("/api/projects/:projectId/automation/runs", async (req, res) => {
    try {
      const workflowId = typeof req.query.workflowId === "string" && req.query.workflowId.trim()
        ? req.query.workflowId.trim()
        : undefined;
      const limit = z.coerce.number().int().min(1).max(200).catch(50).parse(req.query.limit);
      res.json(await listP9Runs(ctx(req), projectId(req), workflowId, limit));
    } catch (error) { fail(res, error); }
  });

  app.get("/api/projects/:projectId/automation/notifications", async (req, res) => {
    try {
      const limit = z.coerce.number().int().min(1).max(500).catch(100).parse(req.query.limit);
      res.json(await listP9Notifications(ctx(req), projectId(req), limit));
    } catch (error) { fail(res, error); }
  });

  app.post("/api/projects/:projectId/automation/notifications/:notificationId/read", async (req, res) => {
    try {
      const pid = projectId(req);
      res.json(await markP9NotificationRead(ctx(req), pid, String(req.params.notificationId)));
    } catch (error) { fail(res, error); }
  });

  app.post("/api/projects/:projectId/automation/save-conversation", async (req, res) => {
    try {
      const pid = projectId(req);
      const body = z.object({
        name: z.string().trim().min(1).max(200),
        description: z.string().trim().max(4_000).default(""),
        template: p9WorkflowTemplateSchema.default("custom"),
        chatId: z.number().int().positive(),
        sourceRequestId: z.string().uuid(),
        request: savedConversationRequestSchema,
        acceptedArtifact: p9AcceptedArtifactSchema.optional(),
        currentPersonalFinanceResourceId: z.string().trim().min(1).max(300).optional(),
        trigger: p9WorkflowTriggerSchema,
        notificationPolicy: p9NotificationPolicySchema.default({}),
        sourceRefs: z.array(z.string().trim().min(1).max(1_000)).max(500).default([]),
        engineRefs: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
        artifactRefs: z.array(z.string().trim().min(1).max(500)).max(200).default([]),
        enabled: z.boolean().default(true),
      }).strict().parse(req.body);
      const chat = await getProjectChat(ctx(req), body.chatId);
      if (chat.projectId !== pid || chat.scope !== "project") throw new Error("Saved workflow chat belongs to a different Project.");
      const definition = p9WorkflowDefinitionInputSchema.parse({
        schemaVersion: "1",
        name: body.name,
        description: body.description,
        template: body.template,
        trigger: body.trigger,
        action: { kind: "conversation_rerun", chatId: body.chatId, sourceRequestId: body.sourceRequestId, request: body.request, acceptedArtifact: body.acceptedArtifact, currentPersonalFinanceResourceId: body.currentPersonalFinanceResourceId },
        notificationPolicy: body.notificationPolicy,
        sourceRefs: body.sourceRefs,
        engineRefs: body.engineRefs,
        artifactRefs: body.artifactRefs,
        enabled: body.enabled,
      });
      res.status(201).json(await createP9Workflow(ctx(req), pid, definition));
    } catch (error) { fail(res, error); }
  });
}
