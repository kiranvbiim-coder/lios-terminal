import assert from "node:assert/strict";
import test from "node:test";
import { buildTelegramConnectRequest, type TelegramConnectForm } from "./telegramConnectionForm";

const valid: TelegramConnectForm = {
  name: " Team bot ", botToken: " 123456:synthetic_token ", projectId: 4, chatId: 9, conversationIds: "123, -456\n123",
  retentionDays: "30", allowAiTransmission: false, consent: true,
  allowOutbound: false, outboundConsent: false,
};

test("a connect request requires explicit consent, an owned Project Chat target and valid allow-list", () => {
  const built = buildTelegramConnectRequest(valid);
  assert.ok("request" in built);
  assert.deepEqual(built.request.allowedConversationIds, ["123", "-456"], "duplicates are removed, order retained");
  assert.equal(built.request.name, "Team bot");
  assert.equal(built.request.allowAiTransmission, false);
  for (const patch of [{ consent: false }, { projectId: null }, { chatId: null }, { conversationIds: " , " }, { conversationIds: "0" }, { botToken: "bot-token" }, { retentionDays: "0" }, { retentionDays: "400" }, { name: "  " }]) {
    assert.ok("error" in buildTelegramConnectRequest({ ...valid, ...patch }), JSON.stringify(patch));
  }
});

test("validation errors never echo the entered bot token", () => {
  const result = buildTelegramConnectRequest({ ...valid, botToken: "9:SECRET value", consent: true });
  assert.ok("error" in result);
  assert.equal(result.error.includes("SECRET"), false);
});
