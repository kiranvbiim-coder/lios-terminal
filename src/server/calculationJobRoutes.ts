/**
 * Generic calculation-job endpoints backing the durable job queue in
 * calculationJobService.ts. Any registered `kind` (factor-risk snapshots,
 * long valuation runs, etc.) is enqueued/read/cancelled through the same
 * surface here -- domain modules own their own runner registration and
 * their own request-body validation for `input`/`result` shapes.
 */
import type { Express, Request } from "express";
import { z } from "zod";
import { requireRole } from "./auth";
import { auditActor, recordAuditEvent } from "./auditEvents";
import { registerBuiltInCalculationJobRunners } from "./calculationJobRunners";
import {
  calculationJobRuntimeStatus,
  enqueueCalculationJob,
  getCalculationJob,
  initializeCalculationJobService,
  listCalculationJobs,
  requestCalculationJobCancellation,
  type CalculationJobOwner,
  type CalculationJobScope,
  type CalculationJobStatus,
} from "./calculationJobService";

const READ_ROLES = ["internal_admin", "internal_analyst", "internal_compliance"] as const;
const AUTHOR_ROLES = ["internal_admin", "internal_analyst"] as const;
const JOB_STATUSES: readonly CalculationJobStatus[] = ["queued", "running", "succeeded", "failed", "cancelled"];

const idSchema = z.string().uuid();

export const calculationJobEnqueueSchema = z.object({
  kind: z.string().trim().min(1).max(120),
  input: z.unknown(),
  maxRetries: z.number().int().min(0).max(10).optional(),
}).strict();

export function calculationJobOwnerFromRequest(req: Pick<Request, "user">): CalculationJobOwner {
  return {
    userId: req.user!.id,
    organizationId: req.user!.organizationId ?? null,
  };
}

function parseId(value: unknown): string | null {
  const parsed = idSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

// internal_compliance is the only role allowed to widen its read scope to a
// whole organization (not just its own jobs) -- and only for the specific
// org id it asks for via ?organizationId=, never every org at once.
function readScope(req: Request): CalculationJobScope {
  const requested = req.query.organizationId;
  const organizationId = typeof requested === "string" && requested.trim() !== "" ? Number(requested) : null;
  return {
    userId: req.user!.id,
    includeOrganization: req.user!.role === "internal_compliance",
    organizationId: Number.isInteger(organizationId) ? organizationId : null,
  };
}

export function registerCalculationJobRoutes(app: Express): void {
  registerBuiltInCalculationJobRunners();
  void initializeCalculationJobService().catch((error) => console.error("Calculation job recovery failed:", error));
  app.get("/api/calculation-jobs/runtime", requireRole(...READ_ROLES), (_req, res) => {
    res.json(calculationJobRuntimeStatus());
  });

  app.post("/api/calculation-jobs", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const parsed = calculationJobEnqueueSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    try {
      const job = await enqueueCalculationJob(parsed.data.kind, parsed.data.input, calculationJobOwnerFromRequest(req), {
        maxRetries: parsed.data.maxRetries,
      });
      await recordAuditEvent(req.user!.id, "calculation_job_queued", { jobId: job.id, kind: job.kind, ...auditActor(req.user!) });
      res.status(202).json(job);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to queue calculation job.";
      res.status(422).json({ error: message });
    }
  });

  app.get("/api/calculation-jobs", requireRole(...READ_ROLES), async (req, res) => {
    const kind = typeof req.query.kind === "string" ? req.query.kind : undefined;
    const limitParam = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
    const statusParam = typeof req.query.status === "string"
      ? req.query.status.split(",").filter((value): value is CalculationJobStatus => (JOB_STATUSES as readonly string[]).includes(value))
      : undefined;
    const jobs = await listCalculationJobs(readScope(req), { kind, status: statusParam, limit: limitParam });
    res.json(jobs);
  });

  app.get("/api/calculation-jobs/:id", requireRole(...READ_ROLES), async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid job id." });
    const job = await getCalculationJob(id, readScope(req));
    if (!job) return res.status(404).json({ error: "Calculation job not found." });
    res.json(job);
  });

  app.post("/api/calculation-jobs/:id/cancel", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid job id." });
    const job = await requestCalculationJobCancellation(id, readScope(req));
    if (!job) return res.status(404).json({ error: "Calculation job not found." });
    await recordAuditEvent(req.user!.id, "calculation_job_cancel_requested", { jobId: id, kind: job.kind, ...auditActor(req.user!) });
    res.json(job);
  });
}
