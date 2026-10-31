import assert from "node:assert/strict";
import test from "node:test";
import { decideAiConnectionGate, type AiChatPermission, type AiSetupStatus } from "./aiConnection";

const openai = {
  id: "openai", name: "OpenAI", available: true, isLocal: false, models: ["gpt-test"],
  credentialName: "OPENAI_API_KEY", defaultModel: "gpt-test", allowCustomModel: true,
};
const setupWith = (aiProviderId: string | null, available = true): AiSetupStatus => ({
  setupNeeded: false,
  setup: { selectedConnectorIds: [], pythonRuntimeId: "lios-managed", pythonPackIds: ["core"], aiProviderId, aiModelId: aiProviderId ? "gpt-test" : null },
  aiProviders: [{ ...openai, available }],
});
const on: AiChatPermission = { state: "on", mode: "ai_assist" };
const off: AiChatPermission = { state: "off", mode: "manual" };

test("no AI step while new work is not allowed (trial choice or read-only owns the screen)", () => {
  assert.equal(decideAiConnectionGate({ newWorkAllowed: false, permission: undefined, permissionUnavailable: false, setup: undefined }), "not_required");
});

test("waits for the server before deciding", () => {
  assert.equal(decideAiConnectionGate({ newWorkAllowed: true, permission: undefined, permissionUnavailable: false, setup: undefined }), "checking");
  assert.equal(decideAiConnectionGate({ newWorkAllowed: true, permission: undefined, permissionUnavailable: false, setup: setupWith(null) }), "checking");
});

test("a verified AI allowed for Chat opens Chat", () => {
  assert.equal(decideAiConnectionGate({ newWorkAllowed: true, permission: on, permissionUnavailable: false, setup: setupWith("openai") }), "ready");
});

test("a saved provider whose permission is off asks to reconnect; unreadable status never opens Chat silently", () => {
  assert.equal(decideAiConnectionGate({ newWorkAllowed: true, permission: off, permissionUnavailable: false, setup: setupWith("openai") }), "reconnect");
  assert.equal(decideAiConnectionGate({ newWorkAllowed: true, permission: undefined, permissionUnavailable: true, setup: setupWith("openai") }), "reconnect");
  assert.equal(decideAiConnectionGate({ newWorkAllowed: true, permission: off, permissionUnavailable: false, setup: undefined, setupUnavailable: true }), "reconnect");
});

test("no usable provider means the user must connect one", () => {
  assert.equal(decideAiConnectionGate({ newWorkAllowed: true, permission: off, permissionUnavailable: false, setup: setupWith(null) }), "connect");
  assert.equal(decideAiConnectionGate({ newWorkAllowed: true, permission: off, permissionUnavailable: false, setup: setupWith("openai", false) }), "connect");
});
