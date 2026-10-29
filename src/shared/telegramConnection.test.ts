import assert from "node:assert/strict";
import test from "node:test";
import { channelMessageExcludedFromAi, telegramSourceConfig } from "./telegramConnection";

test("imported channel text is model input only with explicit adoption-time AI permission", () => {
  assert.equal(channelMessageExcludedFromAi({}), false, "ordinary Chat history is unchanged");
  assert.equal(channelMessageExcludedFromAi({ channelIngress: { aiTransmissionAllowed: true } }), false);
  for (const metadata of [{ channelIngress: {} }, { channelIngress: { aiTransmissionAllowed: false } }, { channelIngress: { aiTransmissionAllowed: "true" } }, { channelIngress: null }, { channelIngress: "x" }]) {
    assert.equal(channelMessageExcludedFromAi(metadata), true, JSON.stringify(metadata));
  }
});

test("saved Telegram source metadata is strict and contains no credential material", () => {
  const policy = { version: "lios-telegram-connection/1" as const, accountBindingId: crypto.randomUUID(), enabled: true, projectId: 1, chatId: 2, allowedConversationIds: ["123"], allowedUpdateTypes: ["message"], retentionDays: 7, allowAiTransmission: false, allowOutbound: false };
  assert.deepEqual(Object.keys(telegramSourceConfig(policy)).sort(), ["channelPolicy", "endpoint"]);
  assert.throws(() => telegramSourceConfig({ ...policy, token: "123:secret" } as never));
  assert.throws(() => telegramSourceConfig({ ...policy, allowedConversationIds: ["123", "123"] }));
});
