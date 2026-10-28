import { z } from "zod";
import { conversationAttachmentRefSchema } from "./conversationRuntime";
import { runtimeHealthStateSchema } from "./runtimeContracts";

/** Internal Home/worker contract, not another public Gateway or authorization authority. */
export const SUPPORTING_SERVICE_PROTOCOL = "lios-supporting-service/1" as const;
export const SUPPORTING_SERVICE_MAX_FRAME_BYTES = 4 * 1024 * 1024;

const uuid = z.string().uuid();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const operation = z.string().min(1).max(240).regex(/^[a-z0-9][a-z0-9._:-]*$/);
const providerId = z.string().min(1).max(512).regex(/^[^\u0000-\u001f\u007f]+$/);
const epoch = z.number().int().nonnegative().safe();

// All fields originate in Home's admitted launch/account binding. Echoing them is not a grant.
export const supportingServiceBindingSchema = z.object({
  sessionId: uuid,
  generation: uuid,
  accountBindingId: uuid,
  launchNonce: digest,
}).strict();
export type SupportingServiceBinding = z.infer<typeof supportingServiceBindingSchema>;

// Reuse the canonical attachment identity/size contract; no worker-selected host path or URL.
export const supportingServiceAttachmentSchema = conversationAttachmentRefSchema.pick({
  id: true, mimeType: true, sha256: true, byteLength: true,
}).extend({ authorizationRef: uuid }).strict();

const parts = z.array(z.object({
  part: z.number().int().nonnegative().safe(),
  providerMessageId: providerId,
}).strict()).max(100);

/** Transport observations only. Home owns canonical receipts and independently admits these facts. */
export const supportingServiceDeliveryFactSchema = z.object({
  state: z.enum(["accepted", "partial", "rejected", "unknown"]),
  acceptedParts: parts,
  observedAt: z.string().datetime({ offset: true }).nullable(),
}).strict().superRefine((fact, ctx) => {
  const count = fact.acceptedParts.length;
  if ((fact.state === "accepted" || fact.state === "partial") && count === 0) {
    ctx.addIssue({ code: "custom", path: ["acceptedParts"], message: "Accepted provider parts require recorded message identities." });
  }
  if (fact.state === "rejected" && count !== 0) {
    ctx.addIssue({ code: "custom", path: ["state"], message: "A rejected operation cannot erase accepted parts; use partial or unknown." });
  }
  if (new Set(fact.acceptedParts.map(part => part.part)).size !== count) {
    ctx.addIssue({ code: "custom", path: ["acceptedParts"], message: "Provider part indices must be unique." });
  }
});

const base = { protocol: z.literal(SUPPORTING_SERVICE_PROTOCOL), binding: supportingServiceBindingSchema };
const payload = z.record(z.unknown()); // The owning P13/channel adapter must also validate its operation-specific schema.
const attachments = z.array(supportingServiceAttachmentSchema).max(32);
const errorCode = z.enum([
  "INVALID_REQUEST", "PROTOCOL_MISMATCH", "UNAUTHORIZED", "REVOKED", "UNAVAILABLE",
  "RATE_LIMITED", "CANCELLED", "OUTCOME_UNKNOWN", "PAYLOAD_TOO_LARGE", "INTERNAL",
]);

export const supportingServiceHomeFrameSchema = z.discriminatedUnion("kind", [
  z.object({ ...base, kind: z.literal("initialize"), buildSha256: digest, operations: z.array(operation).max(500) }).strict(),
  z.object({
    ...base, kind: z.literal("invoke"), requestId: uuid, operationId: operation,
    authorizationRef: uuid, deadlineAt: epoch, input: payload, attachments,
  }).strict(),
  z.object({ ...base, kind: z.literal("cancel"), requestId: uuid }).strict(),
  // Sent only after canonical durable adoption; this is not provider delivery/read confirmation.
  z.object({ ...base, kind: z.literal("adopt"), eventId: uuid, providerEventId: providerId }).strict(),
  z.object({ ...base, kind: z.literal("shutdown") }).strict(),
]);
export type SupportingServiceHomeFrame = z.infer<typeof supportingServiceHomeFrameSchema>;

export const supportingServiceWorkerFrameSchema = z.discriminatedUnion("kind", [
  z.object({ ...base, kind: z.literal("ready"), buildSha256: digest, operations: z.array(operation).max(500) }).strict(),
  z.object({
    ...base, kind: z.literal("result"), requestId: uuid, output: payload,
    attachments, delivery: supportingServiceDeliveryFactSchema.nullable(),
  }).strict(),
  z.object({
    ...base, kind: z.literal("event"), eventId: uuid, sequence: z.number().int().nonnegative().safe(),
    eventType: operation, providerEventId: providerId, providerConversationId: providerId,
    occurredAt: z.string().datetime({ offset: true }).nullable(), payload, attachments,
  }).strict(),
  // No raw exception message/stack/token-bearing URL is a protocol error field.
  z.object({
    ...base, kind: z.literal("error"), requestId: uuid.nullable(), code: errorCode,
    retryAfterMs: z.number().int().nonnegative().max(300_000).nullable(),
    delivery: supportingServiceDeliveryFactSchema.nullable(),
  }).strict(),
  z.object({ ...base, kind: z.literal("health"), state: runtimeHealthStateSchema }).strict(),
  // A worker's stopped observation does not prove descendant extinction; the supervisor must join it.
  z.object({ ...base, kind: z.literal("stopped") }).strict(),
]);
export type SupportingServiceWorkerFrame = z.infer<typeof supportingServiceWorkerFrameSchema>;

const decoder = new TextDecoder("utf-8", { fatal: true });

/**
 * Validate one complete framed message before dispatch. Limits apply before JSON decoding.
 * The caller must separately check current authority, pending request correlation, monotonic event
 * sequence, attachment grants, startup/closing state and operation-specific payloads. This parser
 * creates no grant, registration, durable state, retry policy or service availability claim.
 */
export function decodeSupportingServiceFrame(
  bytes: Uint8Array,
  direction: "home" | "worker",
  binding: SupportingServiceBinding,
  maxFrameBytes = SUPPORTING_SERVICE_MAX_FRAME_BYTES,
): SupportingServiceHomeFrame | SupportingServiceWorkerFrame {
  if (!Number.isSafeInteger(maxFrameBytes) || maxFrameBytes < 1 || maxFrameBytes > SUPPORTING_SERVICE_MAX_FRAME_BYTES) {
    throw new Error("Invalid supporting-service frame limit.");
  }
  if (bytes.byteLength > maxFrameBytes) throw new Error("Supporting-service frame exceeds its byte limit.");
  const raw: unknown = JSON.parse(decoder.decode(bytes));
  const frame = direction === "home" ? supportingServiceHomeFrameSchema.parse(raw) : supportingServiceWorkerFrameSchema.parse(raw);
  for (const key of ["sessionId", "generation", "accountBindingId", "launchNonce"] as const) {
    if (frame.binding[key] !== binding[key]) throw new Error("Supporting-service session binding does not match.");
  }
  if ((frame.kind === "initialize" || frame.kind === "ready") && new Set(frame.operations).size !== frame.operations.length) {
    throw new Error("Supporting-service operation identifiers must be unique.");
  }
  return frame;
}
