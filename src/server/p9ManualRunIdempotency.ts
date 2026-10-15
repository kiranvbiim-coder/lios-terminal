import { isDeepStrictEqual } from "node:util";
import { z } from "zod";

/**
 * Legacy manual runs may send {}. New clients opt into a durable run receipt by
 * submitting a UUID and the exact workflow revision approved by the user.
 * No caller-provided execution action, owner or arbitrary dedupe key is trusted.
 */
export const p9ManualRunRequestSchema = z.union([
  z.object({}).strict(),
  z.object({
    idempotencyKey: z.string().uuid(),
    expectedUpdatedAt: z.string().datetime({ offset: true }),
  }).strict(),
]);

export type P9ManualRunRequest = z.infer<typeof p9ManualRunRequestSchema>;

export function p9ManualRunDedupeKey(idempotencyKey: string): string {
  return "manual:" + z.string().uuid().parse(idempotencyKey.toLowerCase());
}

export function p9ManualRunRevisionMatches(updatedAt: Date, expectedUpdatedAt: string): boolean {
  const parsed = Date.parse(expectedUpdatedAt);
  return Number.isFinite(parsed) && Number.isFinite(updatedAt.getTime()) && parsed === updatedAt.getTime();
}

/**
 * Immutable parts of the workflow whose action is about to be admitted.
 * We compare the freshly locked row against BOTH the explicit approved
 * timestamp and the earlier tenant-checked snapshot. Timestamp-only
 * comparisons can miss two edits recorded in the same millisecond.
 */
export interface P9ManualWorkflowSnapshot {
  updatedAt: Date;
  name: string;
  description: string;
  template: string;
  enabled: boolean;
  trigger: unknown;
  action: unknown;
  notificationPolicy: unknown;
  sourceRefs: unknown;
  engineRefs: unknown;
  artifactRefs: unknown;
}

export function p9ManualRunAdmissionMatches(
  locked: P9ManualWorkflowSnapshot,
  approved: P9ManualWorkflowSnapshot,
  expectedUpdatedAt: Date,
): boolean {
  if (!p9ManualRunRevisionMatches(locked.updatedAt, expectedUpdatedAt.toISOString())
      || locked.updatedAt.getTime() !== approved.updatedAt.getTime()) return false;
  return isDeepStrictEqual(
    {
      name: locked.name,
      description: locked.description,
      template: locked.template,
      enabled: locked.enabled,
      trigger: locked.trigger,
      action: locked.action,
      notificationPolicy: locked.notificationPolicy,
      sourceRefs: locked.sourceRefs,
      engineRefs: locked.engineRefs,
      artifactRefs: locked.artifactRefs,
    },
    {
      name: approved.name,
      description: approved.description,
      template: approved.template,
      enabled: approved.enabled,
      trigger: approved.trigger,
      action: approved.action,
      notificationPolicy: approved.notificationPolicy,
      sourceRefs: approved.sourceRefs,
      engineRefs: approved.engineRefs,
      artifactRefs: approved.artifactRefs,
    },
  );
}

/**
 * Must be called *inside* the DB transaction. readLocked must SELECT FOR
 * UPDATE the canonical workflow row; insert must INSERT the run in that same
 * transaction. A failed match must never call insert or execute an action.
 */
export async function admitP9ApprovedManualRun<T>(
  readLocked: () => Promise<P9ManualWorkflowSnapshot | null>,
  insert: () => Promise<T>,
  approved: P9ManualWorkflowSnapshot,
  expectedUpdatedAt: Date,
): Promise<T | null> {
  const locked = await readLocked();
  if (!locked || !p9ManualRunAdmissionMatches(locked, approved, expectedUpdatedAt)) return null;
  return insert();
}

/** The persisted P9 run row is the authoritative receipt, including 'running'. */
export function p9ManualRunReceiptStatus(status: string): "in_progress" | "completed" {
  return status === "running" ? "in_progress" : "completed";
}
