import assert from "node:assert/strict";
import test from "node:test";
import { buildTelegramConnectRequest, type TelegramConnectForm } from "./telegramConnectionForm";

const valid: TelegramConnectForm = {
  name: " Team bot ", botToken: " 123456:synthetic_token ", projectId: 4, chatId: 9, conversationIds: "123, -456\n123",
  retentionDays: "30", allowAiTransmission: false, consent: true,
  allowOutbound: false, outboundConsent: false,
  autoRunEnabled: false, autoRunSenderRefs: "", autoRunMaxRunsPerHour: "2", autoRunMaxRunsPerDay: "10",
  autoRunMaxAiCalls: "2", autoRunMaxSteps: "4", autoRunMaxDurationSeconds: "60", autoRunConsent: false,
};

test("a connect request requires explicit consent, an owned Project Chat target and valid allow-list", () => {
  const built = buildTelegramConnectRequest(valid);
  assert.ok("request" in built);
  assert.deepEqual(built.request.allowedConversationIds, ["123", "-456"], "duplicates are removed, order retained");
  assert.equal(built.request.name, "Team bot");
  assert.equal(built.request.allowAiTransmission, false);
  assert.equal(built.request.autoRun, undefined, "import and AI visibility do not opt in execution");
  for (const patch of [{ consent: false }, { projectId: null }, { chatId: null }, { conversationIds: " , " }, { conversationIds: "0" }, { botToken: "bot-token" }, { retentionDays: "0" }, { retentionDays: "400" }, { name: "  " }]) {
    assert.ok("error" in buildTelegramConnectRequest({ ...valid, ...patch }), JSON.stringify(patch));
  }
});

test("validation errors never echo the entered bot token", () => {
  const result = buildTelegramConnectRequest({ ...valid, botToken: "9:SECRET value", consent: true });
  assert.ok("error" in result);
  assert.equal(result.error.includes("SECRET"), false);
});

test("incoming AI work needs separate opt-in, provider permission, explicit actors and bounded numeric limits", () => {
  const optedIn = { ...valid, autoRunEnabled: true, allowAiTransmission: true, autoRunConsent: true, autoRunSenderRefs: "user:7, chat:-42 user:7" };
  const built = buildTelegramConnectRequest(optedIn);
  assert.ok("request" in built);
  assert.deepEqual(built.request.autoRun, { enabled: true, allowedSenderRefs: ["user:7", "chat:-42"], maxRunsPerHour: 2, maxRunsPerDay: 10, maxAiCalls: 2, maxSteps: 4, maxDurationMs: 60_000 });
  assert.equal(built.request.allowOutbound, false, "incoming execution never enables sending");
  for (const patch of [{ autoRunConsent: false }, { allowAiTransmission: false }, { autoRunSenderRefs: "" }, { autoRunSenderRefs: "user:0" }, { autoRunSenderRefs: "chat:0" }, { autoRunMaxRunsPerHour: "13" }, { autoRunMaxRunsPerDay: "101" }, { autoRunMaxAiCalls: "5" }, { autoRunMaxSteps: "9" }, { autoRunMaxDurationSeconds: "121" }, { autoRunMaxAiCalls: "" }, { autoRunMaxSteps: "NaN" }]) {
    const result = buildTelegramConnectRequest({ ...optedIn, ...patch });
    assert.ok("error" in result, JSON.stringify(patch));
    assert.equal(result.error.includes("synthetic_token"), false);
  }
  assert.ok("request" in buildTelegramConnectRequest({ ...valid, autoRunSenderRefs: "invalid", autoRunMaxAiCalls: "invalid" }), "disabled controls cannot accidentally enable work");
});
