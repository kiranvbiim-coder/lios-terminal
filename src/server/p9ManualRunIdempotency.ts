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

/** The persisted P9 run row is the authoritative receipt, including 'running'. */
export function p9ManualRunReceiptStatus(status: string): "in_progress" | "completed" {
  return status === "running" ? "in_progress" : "completed";
}
