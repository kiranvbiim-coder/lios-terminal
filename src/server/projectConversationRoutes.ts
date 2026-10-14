import type { Express, Request, Response } from "express";
import { z } from "zod";
import { requireAuth } from "./auth";
import { cancelConversationRun } from "./conversationRunCancel";
import { conversationRuns } from "./conversationRunRegistry";
import type { RunSummary } from "./conversationRunRegistry";
import {
  ConversationGrantError,
  listProjectGrants,
  recordConversationGrant,
  revokeProjectGrant,
} from "./conversationGrantStore";
import { conversationActionNameSchema, governedToolReviewDecisionSchema } from "@shared/conversationRuntime";
import { ProjectAccessDeniedError } from "./projectStore";
import {
  ConversationStartError,
  reviewGovernedToolRun,
  resumeInterruptedConversationRun,
  startProjectChatRun,
  startTemporaryRun,
} from "./conversationRunService";
import type { ConversationUser } from "./conversationRunService";
import { getProjectChat, listProjectChatMessages, ProjectChatAccessDeniedError } from "./projectChatStore";
import { tenantContext } from "./tenantContext";
import { getConversationExecutionJournal } from "./exec/execution-scope";
import type { ExecutionJournalRecord } from "./exec/execution-journal";
import { executionRecordView, isRestartResumable } from "./executionRecordView";

/**
 * HTTP/SSE door to the Conversation Runtime, kept for scripted clients, tests and MCP. The UI uses the Gateway
 * (`conversation.*`, GM-08b); both start runs through conversationRunService and observe the same run registry.
 */

function conversationUser(req: Request): ConversationUser {
  const user = req.user!;
  return { id: user.id, email: user.email, role: user.role, organizationId: user.organizationId ?? null };
}

function streamRun(res: Response, run: RunSummary): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-store");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  const subscription = conversationRuns.subscribe(run.requestId, run.userId, -1, (entry) => {
    if (res.writableEnded) return;
    res.write(`data: ${JSON.stringify(entry.event)}\n\n`);
    if (entry.event.type === "done") {
      if (entry.event.status !== "waiting_approval") res.end();
      else {
        // Registry listeners see the event before the registry applies its finish/pause transition.
        // A workflow approval ends this response; a native agent pause must stay open for its review event.
        queueMicrotask(() => {
          if (conversationRuns.getScoped(run.requestId, run)?.finished && !res.writableEnded) res.end();
        });
      }
    }
  });
  if (!subscription || subscription.status === "finished") {
    if (!res.writableEnded) res.end();
    return;
  }
  // Closing the HTTP stream detaches the observer; it does not cancel the run (cancel is explicit).
  res.on("close", subscription.detach);
}

async function respond(req: Request, res: Response, start: () => Promise<RunSummary>): Promise<void> {
  try {
    streamRun(res, await start());
  } catch (error) {
    if (error instanceof ConversationStartError) {
      res.status(error.status).json(error.body);
      return;
    }
    res.status(500).json({ error: error instanceof Error ? error.message : "Conversation Runtime failed." });
  }
}

const approvalBodySchema = z.object({
  action: conversationActionNameSchema,
  scope: z.enum(["once", "project"]),
  requestId: z.string().uuid().optional(),
  projectId: z.number().int().positive().optional(),
}).strict();

const governedToolReviewBodySchema = z.object({
  reviewId: z.string().uuid(),
  decision: governedToolReviewDecisionSchema,
}).strict();

function grantFailure(res: Response, error: unknown): void {
  if (error instanceof ConversationGrantError) res.status(error.status).json({ error: error.message });
  else if (error instanceof ProjectAccessDeniedError) res.status(404).json({ error: "Project not found." });
  else res.status(500).json({ error: "The approval could not be saved." });
}

/** One record's resumable flag; reads the chat transcript only for an interrupted record. */
async function resumableFlag(req: Request, chatId: number, record: ExecutionJournalRecord): Promise<boolean> {
  if (record.status !== "interrupted") return false;
  return isRestartResumable(record, await listProjectChatMessages(tenantContext(conversationUser(req)), chatId));
}

export function registerProjectConversationRoutes(app: Express): void {
  // GM-11a: approvals are recorded by the server and are the only grants a run can use. A request body never carries one.
  app.post("/api/conversation/approvals", requireAuth, async (req: Request, res: Response) => {
    const body = approvalBodySchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "Invalid approval.", issues: body.error.issues });
      return;
    }
    try {
      await recordConversationGrant({ user: conversationUser(req), ...body.data });
      res.status(201).json({ ok: true });
    } catch (error) {
      grantFailure(res, error);
    }
  });

  app.get("/api/projects/:projectId/conversation-approvals", requireAuth, async (req: Request, res: Response) => {
    const projectId = z.coerce.number().int().positive().safe().safeParse(req.params.projectId);
    if (!projectId.success) {
      res.status(400).json({ error: "Invalid project id." });
      return;
    }
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json({ grants: await listProjectGrants(conversationUser(req), projectId.data) });
    } catch (error) {
      grantFailure(res, error);
    }
  });

  app.delete("/api/projects/:projectId/conversation-approvals/:action", requireAuth, async (req: Request, res: Response) => {
    const projectId = z.coerce.number().int().positive().safe().safeParse(req.params.projectId);
    const action = conversationActionNameSchema.safeParse(req.params.action);
    if (!projectId.success || !action.success) {
      res.status(400).json({ error: "Invalid project or action." });
      return;
    }
    try {
      await revokeProjectGrant(conversationUser(req), projectId.data, action.data);
      res.json({ ok: true });
    } catch (error) {
      grantFailure(res, error);
    }
  });

  // Authorize the canonical chat first; the journal additionally checks the exact user/project/chat tuple.
  app.get("/api/project-chats/:chatId/executions", requireAuth, async (req: Request, res: Response) => {
    const chatId = z.coerce.number().int().positive().safe().safeParse(req.params.chatId);
    if (!chatId.success) {
      res.status(400).json({ error: "Invalid chat id." });
      return;
    }
    try {
      const chat = await getProjectChat(tenantContext(conversationUser(req)), chatId.data);
      const journal = await getConversationExecutionJournal();
      const records = await journal.list({ userId: req.user!.id, projectId: chat.projectId, chatId: chat.id });
      const messages = records.some((record) => record.status === "interrupted")
        ? await listProjectChatMessages(tenantContext(conversationUser(req)), chat.id)
        : [];
      res.setHeader("Cache-Control", "no-store");
      res.json(records.map((record) => executionRecordView(record, isRestartResumable(record, messages))));
    } catch (error) {
      res.status(error instanceof ProjectChatAccessDeniedError ? 404 : 503).json({
        error: error instanceof ProjectChatAccessDeniedError ? "Chat not found." : "Encrypted conversation execution history is unavailable.",
      });
    }
  });

  app.get("/api/project-chats/:chatId/executions/:requestId", requireAuth, async (req: Request, res: Response) => {
    const chatId = z.coerce.number().int().positive().safe().safeParse(req.params.chatId);
    const requestId = z.string().uuid().safeParse(req.params.requestId);
    if (!chatId.success || !requestId.success) {
      res.status(400).json({ error: "Invalid chat or execution id." });
      return;
    }
    try {
      const chat = await getProjectChat(tenantContext(conversationUser(req)), chatId.data);
      const journal = await getConversationExecutionJournal();
      const record = await journal.read(requestId.data, { userId: req.user!.id, projectId: chat.projectId, chatId: chat.id });
      res.setHeader("Cache-Control", "no-store");
      if (!record) res.status(404).json({ error: "Execution not found." });
      else res.json(executionRecordView(record, await resumableFlag(req, chat.id, record)));
    } catch (error) {
      res.status(error instanceof ProjectChatAccessDeniedError ? 404 : 503).json({
        error: error instanceof ProjectChatAccessDeniedError ? "Chat not found." : "Encrypted conversation execution history is unavailable.",
      });
    }
  });

  app.post("/api/project-chats/:chatId/respond", requireAuth, async (req: Request, res: Response) => {
    const chatId = Number(req.params.chatId);
    if (!Number.isInteger(chatId) || chatId <= 0) {
      res.status(400).json({ error: "Invalid chat id." });
      return;
    }
    await respond(req, res, () => startProjectChatRun(conversationUser(req), chatId, req.body));
  });

  app.post("/api/project-chat/temporary/respond", requireAuth, async (req: Request, res: Response) => {
    await respond(req, res, () => startTemporaryRun(conversationUser(req), req.body));
  });

  app.post("/api/conversation-executions/:requestId/governed-tool-review", requireAuth, async (req: Request, res: Response) => {
    const requestId = z.string().uuid().safeParse(req.params.requestId);
    const body = governedToolReviewBodySchema.safeParse(req.body);
    if (!requestId.success || !body.success) {
      res.status(400).json({ error: "Invalid governed tool review.", ...(!body.success ? { issues: body.error.issues } : {}) });
      return;
    }
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json(await reviewGovernedToolRun(
        conversationUser(req),
        requestId.data,
        body.data.reviewId,
        body.data.decision,
      ));
    } catch (error) {
      if (error instanceof ConversationStartError) {
        res.status(error.status).json(error.body);
        return;
      }
      grantFailure(res, error);
    }
  });

  app.post("/api/conversation-executions/:requestId/cancel", requireAuth, (req: Request, res: Response) => {
    const requestId = String(req.params.requestId || "");
    if (!z.string().uuid().safeParse(requestId).success) {
      return res.status(400).json({ error: "Invalid execution id." });
    }
    const cancelled = cancelConversationRun(requestId, req.user!.id);
    return res.status(cancelled ? 200 : 404).json({ ok: cancelled, requestId });
  });

  // Explicit owner resume of an interrupted agent run. The body must be empty: the requestId in the path is the only input;
  // owner, chat, objective, plan, tool/policy facts and authorization are all derived by the server.
  app.post("/api/conversation-executions/:requestId/resume", requireAuth, async (req: Request, res: Response) => {
    const requestId = z.string().uuid().safeParse(req.params.requestId);
    const body = z.object({}).strict().safeParse(req.body ?? {});
    if (!requestId.success || !body.success) {
      res.status(400).json({ error: "Resume takes only the execution id.", ...(!body.success ? { issues: body.error.issues } : {}) });
      return;
    }
    try {
      res.setHeader("Cache-Control", "no-store");
      const run = await resumeInterruptedConversationRun(conversationUser(req), requestId.data);
      res.json({ ok: true, requestId: run.requestId });
    } catch (error) {
      if (error instanceof ConversationStartError) {
        res.status(error.status).json(error.body);
        return;
      }
      res.status(500).json({ error: error instanceof Error ? error.message : "The execution could not be resumed." });
    }
  });
}
