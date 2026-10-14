import assert from "node:assert/strict";
import test from "node:test";
import { canonicalLedgerValue, computeLedgerEventHash, hashLedgerValue, sanitizeLedgerPayload } from "./ledgerStore";

test("P3 canonical hashing is stable across object key order", () => {
  const left = { z: 3, nested: { b: 2, a: 1 }, list: [3, 2, 1] };
  const right = { list: [3, 2, 1], nested: { a: 1, b: 2 }, z: 3 };
  assert.equal(canonicalLedgerValue(left), canonicalLedgerValue(right));
  assert.equal(hashLedgerValue(left), hashLedgerValue(right));
  assert.match(hashLedgerValue(left), /^[a-f0-9]{64}$/);
});

test("P3 ledger sanitizer redacts credential-shaped keys recursively", () => {
  const sanitized = sanitizeLedgerPayload({
    provider: { apiKey: "secret", nested: { accessToken: "token", safe: "visible" } },
    password: "do-not-store",
    ordinary: "retained",
  }) as any;
  assert.equal(sanitized.provider.apiKey, "[REDACTED]");
  assert.equal(sanitized.provider.nested.accessToken, "[REDACTED]");
  assert.equal(sanitized.provider.nested.safe, "visible");
  assert.equal(sanitized.password, "[REDACTED]");
  assert.equal(sanitized.ordinary, "retained");
});

test("P3 event hash commits sequence payload and previous hash", () => {
  const material = {
    id: "ledger:event-1", streamId: "project:7", sequence: 1, projectId: 7, chatId: 8, sessionId: null,
    ownerUserId: 9, organizationId: null, eventType: "execution.receipt", actorType: "engine",
    requestId: null, receiptId: null, correlationId: null, causationId: null,
    payload: { result: 42 }, lineage: { nodes: [], edges: [] }, reversible: false, inversePayload: null,
    previousHash: null, createdAt: "2026-09-22T04:00:00.000Z",
  };
  const first = computeLedgerEventHash(material);
  assert.notEqual(first, computeLedgerEventHash({ ...material, payload: { result: 43 } }));
  assert.notEqual(first, computeLedgerEventHash({ ...material, sequence: 2 }));
  assert.notEqual(first, computeLedgerEventHash({ ...material, previousHash: first }));
});
