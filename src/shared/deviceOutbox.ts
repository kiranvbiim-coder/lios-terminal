import { z } from "zod";

/** GM device continuity: drafts are not approval tokens and never authorize execution. */
export const DEVICE_OUTBOX_MAX_ITEMS = 50;
export const DEVICE_OUTBOX_MAX_BYTES = 1_000_000;
export const DEVICE_REVIEW_TTL_MS = 24 * 60 * 60 * 1000;
export const DEVICE_REVIEW_POLICY_VERSION = "decision-review-v1";
const id = z.number().int().positive();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const deviceReviewBindingSchema = z.object({
  homeId: z.string().uuid(),
  userId: id,
  deviceId: z.string().regex(/^[a-f0-9]{32}$/).nullable(),
  decisionId: id,
  receiptVersionId: id,
  snapshotHash: hash,
  decisionHead: hash,
  policyDigest: hash,
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
}).strict();
export type DeviceReviewBinding = z.infer<typeof deviceReviewBindingSchema>;
const reviewText = (max: number) => z.string().trim().min(1).max(max).refine(
  (value) => !/(?:\b(?:api[_\s-]?key|access[_\s-]?token|refresh[_\s-]?token|password|secret|private[_\s-]?key)\b\s*[:=]\s*\S+|\bbearer\s+\S+|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i.test(value),
  "Credentials must never be stored in a review outbox.",
);
export const deviceReviewSubmissionSchema = z.object({
  requestId: z.string().uuid(),
  binding: deviceReviewBindingSchema,
  outcome: z.enum(["approved", "rejected"]),
  finalDecision: reviewText(5000),
  rationale: reviewText(10000),
  note: reviewText(3000).optional(),
}).strict();
export type DeviceReviewSubmission = z.infer<typeof deviceReviewSubmissionSchema>;
export const deviceOutboxItemSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("decision_review"),
  submission: deviceReviewSubmissionSchema,
  createdAt: z.string().datetime(),
  status: z.enum(["pending", "sending", "unconfirmed", "submitted", "refused"]),
  error: z.string().max(1000).nullable(),
  approvalId: id.nullable(),
}).strict();
export type DeviceOutboxItem = z.infer<typeof deviceOutboxItemSchema>;
export const deviceReviewResultSchema = z.object({
  approvalId: id,
  decisionId: id,
  receiptVersionId: id,
  snapshotHash: hash,
  outcome: z.enum(["approved", "rejected", "waived"]),
  requestId: z.string().uuid(),
  idempotent: z.boolean(),
}).strict();

/** Identity, policy and content must match; a fresh read cannot silently rebind an old draft. */
export function sameDeviceReviewAuthority(a: DeviceReviewBinding, b: DeviceReviewBinding): boolean {
  return a.homeId === b.homeId && a.userId === b.userId && a.deviceId === b.deviceId
    && a.decisionId === b.decisionId && a.receiptVersionId === b.receiptVersionId
    && a.snapshotHash === b.snapshotHash && a.decisionHead === b.decisionHead && a.policyDigest === b.policyDigest;
}

const record = z.record(z.unknown());
export const deviceContinuityMethods = {
  "projects.list": { scope: "read", params: z.object({}).strict(), result: z.object({ projects: z.array(record) }).strict() },
  "chats.create": { scope: "write", params: z.object({ projectId: id, title: z.string().trim().min(1).max(200).optional() }).strict(), result: z.object({ chat: record }).strict() },
  "device.continuity.read": {
    scope: "read", params: z.object({ projectId: id, chatId: id.optional(), offset: z.number().int().min(0).max(1_000_000).default(0), limit: z.number().int().min(1).max(100).default(50) }).strict(),
    result: z.object({ homeId: z.string().uuid(), userId: id, project: record, chats: z.array(record), messages: z.array(record), artifacts: z.array(record), nextOffset: z.number().int().nullable() }).strict(),
  },
  "artifacts.read": { scope: "read", params: z.object({ artifactId: z.string().regex(/^artifact:[0-9a-f-]{36}$/i), version: id.optional() }).strict(), result: z.object({ artifact: record, revision: record }).strict() },
  "notifications.list": { scope: "read", params: z.object({ projectId: id, limit: z.number().int().min(1).max(100).default(50) }).strict(), result: z.object({ notifications: z.array(record) }).strict() },
  "notifications.read": { scope: "write", params: z.object({ projectId: id, notificationId: z.string().min(1).max(300) }).strict(), result: z.object({ notification: record }).strict() },
  "decision.review.read": { scope: "read", params: z.object({ decisionId: id }).strict(), result: z.object({ binding: deviceReviewBindingSchema, decision: record, receipt: record, canReview: z.boolean(), approval: record.nullable() }).strict() },
  "decision.review.submit": { scope: "write", params: deviceReviewSubmissionSchema, result: deviceReviewResultSchema },
} as const;
