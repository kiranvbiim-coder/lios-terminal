import crypto from "node:crypto";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { ledgerEventTypeSchema } from "@shared/ledgerContracts";
import { requireAuth } from "./auth";
import { tenantContext } from "./tenantContext";
import {
  appendLedgerEvent,
  getLedgerEvent,
  getLedgerEventByReceiptId,
  listChatLedgerEvents,
  listProjectLedgerEvents,
  verifyLedgerIntegrity,
} from "./ledgerStore";
import { undoLedgerEvent } from "./ledgerUndo";
import { createProjectPortabilityManifest } from "./projectPortability";

function ctx(req: Request) {
  return tenantContext(req.user!);
}

function fail(res: Response, error: unknown): void {
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: "Invalid Ledger request.", issues: error.issues });
    return;
  }
  const message = error instanceof Error ? error.message : "Ledger request failed.";
  res.status(/not found|not owned|boundary/i.test(message) ? 404 : 400).json({ error: message });
}

export function registerLedgerRoutes(app: Express): void {
  app.use("/api/ledger", requireAuth);

  app.get("/api/projects/:projectId/ledger", requireAuth, async (req, res) => {
    try {
      const query = z.object({
        limit: z.coerce.number().int().min(1).max(500).optional(),
        beforeSequence: z.coerce.number().int().positive().optional(),
        eventType: ledgerEventTypeSchema.optional(),
      }).parse(req.query);
      res.json(await listProjectLedgerEvents(ctx(req), Number(req.params.projectId), query));
    } catch (error) { fail(res, error); }
  });

  app.get("/api/project-chats/:chatId/ledger", requireAuth, async (req, res) => {
    try {
      const limit = z.coerce.number().int().min(1).max(500).optional().parse(req.query.limit);
      res.json(await listChatLedgerEvents(ctx(req), Number(req.params.chatId), { limit }));
    } catch (error) { fail(res, error); }
  });

  app.get("/api/ledger/events/:eventId", async (req, res) => {
    try { res.json(await getLedgerEvent(ctx(req), req.params.eventId)); }
    catch (error) { fail(res, error); }
  });

  app.get("/api/ledger/receipts/:receiptId/show-work", async (req, res) => {
    try {
      const receiptId = z.string().uuid().parse(req.params.receiptId);
      const event = await getLedgerEventByReceiptId(ctx(req), receiptId);
      const receipt = (event.payload as Record<string, unknown>).receipt;
      res.json({ eventId: event.id, eventHash: event.eventHash, receipt });
    } catch (error) { fail(res, error); }
  });

  app.get("/api/ledger/streams/:streamId/verify", async (req, res) => {
    try { res.json(await verifyLedgerIntegrity(ctx(req), decodeURIComponent(req.params.streamId))); }
    catch (error) { fail(res, error); }
  });

  app.post("/api/projects/:projectId/ledger/decisions", requireAuth, async (req, res) => {
    try {
      const body = z.object({
        title: z.string().trim().min(1).max(300),
        summary: z.string().trim().min(1).max(4_000),
        rationale: z.string().trim().max(10_000).nullable().optional(),
        sessionId: z.string().trim().max(240).nullable().optional(),
        sourceRefs: z.array(z.string().trim().min(1).max(1_000)).max(500).default([]),
        alternatives: z.array(z.string().trim().min(1).max(1_000)).max(100).default([]),
      }).strict().parse(req.body);
      const decisionId = `decision:${crypto.randomUUID()}`;
      const event = await appendLedgerEvent(ctx(req), {
        projectId: Number(req.params.projectId),
        sessionId: body.sessionId ?? null,
        eventType: "decision.recorded",
        actorType: "user",
        correlationId: decisionId,
        payload: { decisionId, ...body },
        lineage: {
          nodes: [
            { kind: "decision", ref: decisionId, version: "decision-v1", hash: null, asOf: null, metadata: { title: body.title } },
            ...body.sourceRefs.map((ref) => ({ kind: "source" as const, ref, version: null, hash: null, asOf: null, metadata: {} })),
            ...(body.sessionId ? [{ kind: "session" as const, ref: body.sessionId, version: null, hash: null, asOf: null, metadata: {} }] : []),
          ],
          edges: [
            ...body.sourceRefs.map((ref) => ({ from: ref, to: decisionId, relation: "used" as const })),
            ...(body.sessionId ? [{ from: body.sessionId, to: decisionId, relation: "configured_by" as const }] : []),
          ],
        },
      });
      res.json(event);
    } catch (error) { fail(res, error); }
  });

  app.post("/api/ledger/events/:eventId/undo", async (req, res) => {
    try { res.json(await undoLedgerEvent(ctx(req), req.params.eventId)); }
    catch (error) { fail(res, error); }
  });

  app.get("/api/projects/:projectId/portability-manifest", requireAuth, async (req, res) => {
    try { res.json(await createProjectPortabilityManifest(ctx(req), Number(req.params.projectId))); }
    catch (error) { fail(res, error); }
  });
}
