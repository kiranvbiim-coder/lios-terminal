import assert from "node:assert/strict";
import test from "node:test";
import {
  changeRecordSchema,
  ledgerEventEnvelopeSchema,
  ledgerLineageEdgeSchema,
  projectPortabilityManifestV1Schema,
  reproducibilityReceiptSchema,
} from "./ledgerContracts";

const hash = "a".repeat(64);
const now = new Date().toISOString();

test("P3 reproducibility receipt keeps deterministic and AI-direct attribution mutually exclusive", () => {
  assert.equal(reproducibilityReceiptSchema.safeParse({
    schemaVersion: "1",
    receiptId: "11111111-1111-4111-8111-111111111111",
    requestId: "22222222-2222-4222-8222-222222222222",
    projectId: 1,
    chatId: 2,
    sessionId: null,
    operation: "valuation",
    status: "completed",
    deterministic: true,
    aiInvolvement: "direct",
    startedAt: now,
    completedAt: now,
    inputHash: hash,
    outputHash: hash,
    integrityHash: hash,
  }).success, false);
});

test("P3 reversible changes require an inverse payload", () => {
  assert.equal(changeRecordSchema.safeParse({
    changeId: "33333333-3333-4333-8333-333333333333",
    action: "change-assumption",
    summary: "Changed WACC",
    path: "assumptions.wacc",
    beforeHash: hash,
    afterHash: hash,
    reversible: true,
    inverse: null,
  }).success, false);
});

test("P3 ledger events require a reversible inverse and a hash-chain shape", () => {
  const parsed = ledgerEventEnvelopeSchema.parse({
    schemaVersion: "1",
    id: "ledger:event",
    streamId: "project:1",
    sequence: 1,
    projectId: 1,
    chatId: null,
    sessionId: null,
    ownerUserId: 1,
    organizationId: null,
    eventType: "state.changed",
    actorType: "user",
    payload: {},
    reversible: true,
    inversePayload: { type: "restore" },
    previousHash: null,
    eventHash: hash,
    createdAt: now,
  });
  assert.equal(parsed.sequence, 1);
});

test("P3 lineage graph rejects self edges", () => {
  assert.equal(ledgerLineageEdgeSchema.safeParse({ from: "a", to: "a", relation: "used" }).success, false);
});

test("P3 portability manifest is explicitly versioned and credential-free", () => {
  const parsed = projectPortabilityManifestV1Schema.parse({
    version: 1,
    generatedAt: now,
    project: { id: 1, name: "Model", instructionsHash: hash, updatedAt: now },
    chats: [],
    sessions: [],
    resourceRefs: [],
    ledger: { schemaVersion: "1", eventCount: 0, streams: [] },
    excludesCredentials: true,
    manifestHash: hash,
  });
  assert.equal(parsed.excludesCredentials, true);
});
