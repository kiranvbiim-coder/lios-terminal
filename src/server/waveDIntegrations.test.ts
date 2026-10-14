import assert from "node:assert/strict";
import test from "node:test";
import { answerContextualQuestion, dispatchWaveDNotification } from "./waveDIntegrations";

test("contextual answers fail closed without a card, question, or evidence", async () => {
  assert.equal((await answerContextualQuestion(undefined, "Why?")).status, "unavailable");
  assert.equal((await answerContextualQuestion({
    id: "card:1",
    kind: "news",
    title: "A card",
    whatHappened: "Something happened",
    whyItMatters: "It matters",
    whyItMattersToUser: "It matters to the user",
    nextActions: [],
    createdAt: new Date(0).toISOString(),
    unread: true,
    evidence: [],
  }, "Why?")).status, "unavailable");
});

test("notification delivery requires confirmation and explicit transport configuration", async () => {
  const notification = {
    id: "notification:test:webhook",
    channel: "webhook" as const,
    destination: "https://example.com/hook",
    title: "Test",
    body: "Test body",
    evidenceIds: [],
    requiresConfirmation: true,
    status: "queued" as const,
    createdAt: new Date(0).toISOString(),
  };
  assert.deepEqual(await dispatchWaveDNotification(notification, false), { status: "blocked", reason: "Explicit send confirmation is required." });
  const previous = process.env.WAVE_D_WEBHOOK_ALLOWLIST;
  delete process.env.WAVE_D_WEBHOOK_ALLOWLIST;
  try {
    const result = await dispatchWaveDNotification(notification, true);
    assert.equal(result.status, "blocked");
    assert.match(result.reason ?? "", /WAVE_D_WEBHOOK_ALLOWLIST/);
  } finally {
    if (previous === undefined) delete process.env.WAVE_D_WEBHOOK_ALLOWLIST;
    else process.env.WAVE_D_WEBHOOK_ALLOWLIST = previous;
  }
});

test("unsupported provider channels remain explicit blockers", async () => {
  const result = await dispatchWaveDNotification({
    id: "notification:test:slack",
    channel: "slack",
    destination: "workspace/channel",
    title: "Test",
    body: "Test body",
    evidenceIds: [],
    requiresConfirmation: true,
    status: "queued",
    createdAt: new Date(0).toISOString(),
  }, true);
  assert.equal(result.status, "blocked");
  assert.match(result.reason ?? "", /provider adapter and authorization/);
});
