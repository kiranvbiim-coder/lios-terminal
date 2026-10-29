import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  SUPPORTING_SERVICE_PROTOCOL,
  decodeSupportingServiceFrame,
  supportingServiceDeliveryFactSchema,
  supportingServiceAttachmentSchema,
} from "./supportingServiceContracts";

const binding = {
  sessionId: "11111111-1111-4111-8111-111111111111",
  generation: "22222222-2222-4222-8222-222222222222",
  accountBindingId: "33333333-3333-4333-8333-333333333333",
  launchNonce: "a".repeat(64),
};
const id = "44444444-4444-4444-8444-444444444444";
const envelope = { protocol: SUPPORTING_SERVICE_PROTOCOL, binding };
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const result = {
  ...envelope, kind: "result", requestId: id, output: { subject: "Recorded Δ", value: 0.123456789012345 },
  attachments: [], delivery: { state: "unknown", acceptedParts: [{ part: 0, providerMessageId: "message-12" }], observedAt: null },
};

test("old session, account, generation and launch bindings are all refused", () => {
  for (const key of Object.keys(binding) as Array<keyof typeof binding>) {
    const foreign = { ...binding, [key]: key === "launchNonce" ? "b".repeat(64) : id };
    assert.throws(() => decodeSupportingServiceFrame(encode({ ...result, binding: foreign }), "worker", binding));
  }
  assert.throws(() => decodeSupportingServiceFrame(encode({ ...result, protocol: "lios-supporting-service/2" }), "worker", binding), z.ZodError);
});

test("worker cannot send Home commands or forge an outer owner, approval or canonical receipt", () => {
  const invocation = {
    ...envelope, kind: "invoke", requestId: id, operationId: "telegram.send", authorizationRef: id,
    deadlineAt: 1_800_000_000_000, input: { recipient: "recorded-target", text: "Review me" }, attachments: [],
  };
  assert.equal(decodeSupportingServiceFrame(encode(invocation), "home", binding).kind, "invoke");
  assert.throws(() => decodeSupportingServiceFrame(encode(invocation), "worker", binding), z.ZodError);
  assert.throws(() => decodeSupportingServiceFrame(encode(result), "home", binding), z.ZodError);
  for (const field of ["userId", "organizationId", "approvedActions", "executionReceipt"]) {
    assert.throws(() => decodeSupportingServiceFrame(encode({ ...result, [field]: "forged" }), "worker", binding), z.ZodError);
  }
});

test("wire byte limits and strict UTF-8 precede schema decoding", () => {
  const bytes = encode(result);
  assert.ok(bytes.byteLength > JSON.stringify(result).length, "Multibyte text exercises byte rather than character bounds");
  assert.throws(() => decodeSupportingServiceFrame(bytes, "worker", binding, bytes.byteLength - 1));
  assert.equal(decodeSupportingServiceFrame(bytes, "worker", binding, bytes.byteLength).kind, "result");
  for (const limit of [0, -1, 1.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => decodeSupportingServiceFrame(bytes, "worker", binding, limit));
  }
  assert.throws(() => decodeSupportingServiceFrame(new Uint8Array([0xff]), "worker", binding), TypeError);
});

test("delivery facts never convert missing IDs, duplicate parts or accepted work into rejection", () => {
  const accepted = { part: 0, providerMessageId: "message-12" };
  for (const state of ["accepted", "partial"] as const) {
    assert.equal(supportingServiceDeliveryFactSchema.safeParse({ state, acceptedParts: [], observedAt: null }).success, false);
  }
  assert.equal(supportingServiceDeliveryFactSchema.safeParse({ state: "rejected", acceptedParts: [accepted], observedAt: null }).success, false);
  assert.equal(supportingServiceDeliveryFactSchema.safeParse({ state: "accepted", acceptedParts: [accepted, accepted], observedAt: null }).success, false);
  assert.equal(supportingServiceDeliveryFactSchema.safeParse({ state: "delivered", acceptedParts: [accepted], observedAt: null }).success, false);
  assert.deepEqual(supportingServiceDeliveryFactSchema.parse({ state: "rejected", acceptedParts: [], observedAt: null }), { state: "rejected", acceptedParts: [], observedAt: null });
});

test("attachments are scoped canonical identities, not host paths or arbitrary URLs", () => {
  const attachment = { id, mimeType: "application/pdf", sha256: "c".repeat(64), byteLength: 42, authorizationRef: binding.sessionId };
  assert.deepEqual(supportingServiceAttachmentSchema.parse(attachment), attachment);
  for (const field of ["path", "url", "token", "ownerUserId"]) {
    assert.equal(supportingServiceAttachmentSchema.safeParse({ ...attachment, [field]: "untrusted" }).success, false);
  }
  for (const byteLength of [0, -1, 101 * 1024 * 1024, 1.5]) {
    assert.equal(supportingServiceAttachmentSchema.safeParse({ ...attachment, byteLength }).success, false);
  }
});

test("readiness cannot advertise duplicate operations and protocol errors cannot carry raw exception text", () => {
  const ready = { ...envelope, kind: "ready", buildSha256: "d".repeat(64), operations: ["telegram.send", "telegram.send"] };
  assert.throws(() => decodeSupportingServiceFrame(encode(ready), "worker", binding));
  const error = { ...envelope, kind: "error", requestId: id, code: "OUTCOME_UNKNOWN", retryAfterMs: null, delivery: result.delivery };
  assert.deepEqual(decodeSupportingServiceFrame(encode(error), "worker", binding), error);
  assert.throws(() => decodeSupportingServiceFrame(encode({ ...error, stack: "private exception" }), "worker", binding), z.ZodError);
});
